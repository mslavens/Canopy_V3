package main

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"text/tabwriter"
	"time"
	"canopy-core/cli"
	"canopy-core/engine"
	"canopy-core/storage"

	"golang.org/x/term"
)

const (
	AppDisplayName = "Canopy"
	AppBundleID    = "com.layeredblue.canopy"
)

// PathLookupRequest defines the expected structural JSON payload for incoming queries.
type PathLookupRequest struct {
	SourceIP      string `json:"source_ip"`
	DestinationIP string `json:"destination_ip"`
}

// StateVault defines the expected interface for our SQLite/SQLCipher engine
type StateVault interface {
	DB() *sql.DB
	WriteLock()
	WriteUnlock()
	Close() error
}

var (
	// Global pointers for our encrypted storage vault
	systemDB    StateVault
	activeDB    StateVault
	telemetryDB StateVault
	logDB       *storage.LogDB
	masterKey   string
	vaultMutex  sync.RWMutex
	programLevel *slog.LevelVar = new(slog.LevelVar)
)

var actSchema = `
	CREATE TABLE IF NOT EXISTS scopes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		uuid TEXT UNIQUE NOT NULL,
		type TEXT NOT NULL,          -- 'shared', 'device-group', 'template', 'template-stack', 'firewall'
		reference_id INTEGER,        -- References ID of device_groups, templates, template_stacks, or managed_devices
		name TEXT NOT NULL,          -- Cached name for fast lookup
		parent_uuid TEXT,            -- Optional parent scope UUID
		UNIQUE(type, reference_id),
		FOREIGN KEY (parent_uuid) REFERENCES scopes(uuid) ON DELETE SET NULL
	);
	INSERT OR IGNORE INTO scopes (uuid, type, name) VALUES ('paloalto-panorama-global', 'shared', 'Shared (Panorama)');
	CREATE TABLE IF NOT EXISTS device_groups (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		uuid TEXT UNIQUE NOT NULL,
		name TEXT UNIQUE NOT NULL,
		parent_id INTEGER,
		description TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE,
		FOREIGN KEY (parent_id) REFERENCES device_groups(id) ON DELETE SET NULL
	);
	CREATE TABLE IF NOT EXISTS templates (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		uuid TEXT UNIQUE NOT NULL,
		name TEXT UNIQUE NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS template_stacks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		uuid TEXT UNIQUE NOT NULL,
		name TEXT UNIQUE NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS template_stack_members_raw (
		stack_id INTEGER NOT NULL,
		template_id INTEGER NOT NULL,
		sequence INTEGER NOT NULL,
		PRIMARY KEY (stack_id, template_id),
		FOREIGN KEY (stack_id) REFERENCES template_stacks(id) ON DELETE CASCADE,
		FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
	);
	CREATE VIEW IF NOT EXISTS template_stack_members AS
	SELECT 
		tsm.stack_id,
		t.name AS template_name,
		tsm.sequence
	FROM template_stack_members_raw tsm
	JOIN templates t ON tsm.template_id = t.id;
	CREATE TABLE IF NOT EXISTS network_topology (
		device_uuid TEXT,
		interface_name TEXT,
		network_cidr TEXT,
		zone_name TEXT,
		vendor_metadata TEXT,
		PRIMARY KEY (device_uuid, interface_name),
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS interfaces (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		ip_address TEXT,
		description TEXT,
		zone TEXT,
		vr_name TEXT,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS zones (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		description TEXT,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS variables (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		value TEXT NOT NULL,
		description TEXT,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS framework_metadata (
		app_id TEXT PRIMARY KEY,
		schema_version INTEGER
	);
	CREATE TABLE IF NOT EXISTS license_vault (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		license_key TEXT NOT NULL,
		hwid_hash TEXT NOT NULL,
		activation_token TEXT NOT NULL,
		expires_at DATETIME NOT NULL
	);
	CREATE TABLE IF NOT EXISTS secrets_vault (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE NOT NULL,
		description TEXT,
		secret_value TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE IF NOT EXISTS address_objects (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		value TEXT NOT NULL,
		description TEXT,
		dirty INTEGER DEFAULT 0,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS address_groups (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		type TEXT DEFAULT 'static',
		filter TEXT,
		description TEXT,
		dirty INTEGER DEFAULT 0,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS address_group_members (
		group_id INTEGER NOT NULL,
		member_address_id INTEGER,
		member_group_id INTEGER,
		member_name TEXT,
		PRIMARY KEY (group_id, member_address_id, member_group_id, member_name),
		FOREIGN KEY (group_id) REFERENCES address_groups(id) ON DELETE CASCADE,
		FOREIGN KEY (member_address_id) REFERENCES address_objects(id) ON DELETE CASCADE,
		FOREIGN KEY (member_group_id) REFERENCES address_groups(id) ON DELETE CASCADE,
		CHECK (
			(member_address_id IS NOT NULL AND member_group_id IS NULL AND member_name IS NULL) OR
			(member_address_id IS NULL AND member_group_id IS NOT NULL AND member_name IS NULL) OR
			(member_address_id IS NULL AND member_group_id IS NULL AND member_name IS NOT NULL)
		)
	);
	CREATE TABLE IF NOT EXISTS service_objects (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		protocol TEXT NOT NULL,
		source_port TEXT,
		destination_port TEXT NOT NULL,
		description TEXT,
		dirty INTEGER DEFAULT 0,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS service_groups (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		description TEXT,
		dirty INTEGER DEFAULT 0,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS service_group_members (
		group_id INTEGER NOT NULL,
		member_service_id INTEGER,
		member_group_id INTEGER,
		member_name TEXT,
		PRIMARY KEY (group_id, member_service_id, member_group_id, member_name),
		FOREIGN KEY (group_id) REFERENCES service_groups(id) ON DELETE CASCADE,
		FOREIGN KEY (member_service_id) REFERENCES service_objects(id) ON DELETE CASCADE,
		FOREIGN KEY (member_group_id) REFERENCES service_groups(id) ON DELETE CASCADE,
		CHECK (
			(member_service_id IS NOT NULL AND member_group_id IS NULL AND member_name IS NULL) OR
			(member_service_id IS NULL AND member_group_id IS NOT NULL AND member_name IS NULL) OR
			(member_service_id IS NULL AND member_group_id IS NULL AND member_name IS NOT NULL)
		)
	);
	CREATE TABLE IF NOT EXISTS application_objects (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		category TEXT NOT NULL,
		subcategory TEXT NOT NULL,
		technology TEXT NOT NULL,
		risk INTEGER DEFAULT 1,
		ports TEXT,
		description TEXT,
		dirty INTEGER DEFAULT 0,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS regions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		latitude REAL,
		longitude REAL,
		addresses TEXT,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS schedules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		schedule_type TEXT,
		schedule_details TEXT,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		color TEXT,
		description TEXT,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS security_profiles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS log_forwarding_profiles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		description TEXT,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS security_profile_groups (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		description TEXT,
		antivirus TEXT,
		spyware TEXT,
		vulnerability TEXT,
		url_filtering TEXT,
		file_blocking TEXT,
		wildfire_analysis TEXT,
		dns_security TEXT,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS custom_url_categories (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		description TEXT,
		url_list TEXT,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS external_dynamic_lists (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		description TEXT,
		list_type TEXT,
		source_url TEXT,
		recurring TEXT,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS security_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		rule_name TEXT NOT NULL,
		description TEXT,
		action TEXT NOT NULL,
		disabled INTEGER DEFAULT 0,
		profile_type TEXT,
		profile_group TEXT,
		log_setting TEXT,
		schedule_id INTEGER,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE,
		FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
	);
	CREATE TABLE IF NOT EXISTS nat_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		rule_name TEXT NOT NULL,
		description TEXT,
		disabled INTEGER DEFAULT 0,
		to_zone TEXT,
		service_id INTEGER,
		service_group_id INTEGER,
		service_ad_hoc TEXT,
		source_translation_type TEXT,
		source_translation_address TEXT,
		destination_translation_address TEXT,
		destination_translation_port TEXT,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE,
		FOREIGN KEY (service_id) REFERENCES service_objects(id) ON DELETE SET NULL,
		FOREIGN KEY (service_group_id) REFERENCES service_groups(id) ON DELETE SET NULL
	);
	CREATE TABLE IF NOT EXISTS qos_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		rule_name TEXT NOT NULL,
		description TEXT,
		disabled INTEGER DEFAULT 0,
		qos_class TEXT NOT NULL,
		dscp_tos_marking TEXT,
		schedule_id INTEGER,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE,
		FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
	);
	CREATE TABLE IF NOT EXISTS pbf_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		rule_name TEXT NOT NULL,
		description TEXT,
		disabled INTEGER DEFAULT 0,
		action TEXT NOT NULL,
		forward_interface TEXT,
		forward_next_hop TEXT,
		monitor_profile TEXT,
		schedule_id INTEGER,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE,
		FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
	);
	CREATE TABLE IF NOT EXISTS decryption_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		rule_name TEXT NOT NULL,
		description TEXT,
		disabled INTEGER DEFAULT 0,
		action TEXT NOT NULL,
		decryption_type TEXT,
		decryption_profile TEXT,
		schedule_id INTEGER,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE,
		FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
	);
	CREATE TABLE IF NOT EXISTS application_override_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		rule_name TEXT NOT NULL,
		description TEXT,
		disabled INTEGER DEFAULT 0,
		protocol TEXT NOT NULL,
		port TEXT NOT NULL,
		custom_app_id INTEGER,
		predefined_app_name TEXT,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE,
		FOREIGN KEY (custom_app_id) REFERENCES application_objects(id) ON DELETE SET NULL
	);
	CREATE TABLE IF NOT EXISTS tunnel_inspection_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		rule_name TEXT NOT NULL,
		description TEXT,
		disabled INTEGER DEFAULT 0,
		protocols TEXT,
		action_profile TEXT,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS authentication_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		rule_name TEXT NOT NULL,
		description TEXT,
		disabled INTEGER DEFAULT 0,
		action TEXT NOT NULL,
		authentication_profile TEXT,
		log_setting TEXT,
		schedule_id INTEGER,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE,
		FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
	);
	CREATE TABLE IF NOT EXISTS dos_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		rule_name TEXT NOT NULL,
		description TEXT,
		disabled INTEGER DEFAULT 0,
		action TEXT NOT NULL,
		aggregate_profile TEXT,
		classified_profile TEXT,
		schedule_id INTEGER,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE,
		FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
	);
	CREATE TABLE IF NOT EXISTS static_routes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		vr_name TEXT NOT NULL,
		route_name TEXT NOT NULL,
		destination TEXT NOT NULL,
		nexthop TEXT,
		interface TEXT,
		metric INTEGER DEFAULT 10,
		admin_distance INTEGER DEFAULT 10,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS managed_devices_raw (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		serial TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		ip_address TEXT,
		device_group_id INTEGER,
		template_stack_id INTEGER,
		template_id INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE,
		FOREIGN KEY (device_group_id) REFERENCES device_groups(id) ON DELETE SET NULL,
		FOREIGN KEY (template_stack_id) REFERENCES template_stacks(id) ON DELETE SET NULL,
		FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL
	);
	CREATE VIEW IF NOT EXISTS managed_devices AS
	SELECT 
		m.id,
		m.device_uuid,
		m.serial,
		m.name,
		m.ip_address,
		dg.name AS device_group,
		COALESCE(ts.name, t.name) AS template_stack,
		m.created_at
	FROM managed_devices_raw m
	LEFT JOIN device_groups dg ON m.device_group_id = dg.id
	LEFT JOIN template_stacks ts ON m.template_stack_id = ts.id
	LEFT JOIN templates t ON m.template_id = t.id;
	CREATE TABLE IF NOT EXISTS rule_address_mappings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		rule_type TEXT NOT NULL,
		rule_id INTEGER NOT NULL,
		direction TEXT NOT NULL,
		address_id INTEGER,
		group_id INTEGER,
		ad_hoc_value TEXT,
		FOREIGN KEY (address_id) REFERENCES address_objects(id) ON DELETE CASCADE,
		FOREIGN KEY (group_id) REFERENCES address_groups(id) ON DELETE CASCADE,
		CHECK (
			(address_id IS NOT NULL AND group_id IS NULL AND ad_hoc_value IS NULL) OR
			(address_id IS NULL AND group_id IS NOT NULL AND ad_hoc_value IS NULL) OR
			(address_id IS NULL AND group_id IS NULL AND ad_hoc_value IS NOT NULL)
		)
	);
	CREATE TABLE IF NOT EXISTS rule_service_mappings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		rule_type TEXT NOT NULL,
		rule_id INTEGER NOT NULL,
		service_id INTEGER,
		group_id INTEGER,
		ad_hoc_value TEXT,
		FOREIGN KEY (service_id) REFERENCES service_objects(id) ON DELETE CASCADE,
		FOREIGN KEY (group_id) REFERENCES service_groups(id) ON DELETE CASCADE,
		CHECK (
			(service_id IS NOT NULL AND group_id IS NULL AND ad_hoc_value IS NULL) OR
			(service_id IS NULL AND group_id IS NOT NULL AND ad_hoc_value IS NULL) OR
			(service_id IS NULL AND group_id IS NULL AND ad_hoc_value IS NOT NULL)
		)
	);
	CREATE TABLE IF NOT EXISTS rule_application_mappings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		rule_type TEXT NOT NULL,
		rule_id INTEGER NOT NULL,
		custom_app_id INTEGER,
		group_id INTEGER,
		predefined_app_name TEXT,
		FOREIGN KEY (custom_app_id) REFERENCES application_objects(id) ON DELETE CASCADE,
		FOREIGN KEY (group_id) REFERENCES application_groups(id) ON DELETE CASCADE,
		CHECK (
			(custom_app_id IS NOT NULL AND group_id IS NULL AND predefined_app_name IS NULL) OR
			(custom_app_id IS NULL AND group_id IS NOT NULL AND predefined_app_name IS NULL) OR
			(custom_app_id IS NULL AND group_id IS NULL AND predefined_app_name IS NOT NULL)
		)
	);
	CREATE TABLE IF NOT EXISTS rule_zone_mappings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		rule_type TEXT NOT NULL,
		rule_id INTEGER NOT NULL,
		direction TEXT NOT NULL,
		zone_name TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS rule_category_mappings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		rule_id INTEGER NOT NULL,
		category TEXT NOT NULL,
		FOREIGN KEY (rule_id) REFERENCES security_rules(id) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS entity_tag_mappings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		entity_type TEXT NOT NULL,
		entity_id INTEGER NOT NULL,
		tag_id INTEGER NOT NULL,
		FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS security_rule_profiles (
		rule_id INTEGER NOT NULL,
		profile_id INTEGER NOT NULL,
		PRIMARY KEY (rule_id, profile_id),
		FOREIGN KEY (rule_id) REFERENCES security_rules(id) ON DELETE CASCADE,
		FOREIGN KEY (profile_id) REFERENCES security_profiles(id) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS application_groups (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		description TEXT,
		dirty INTEGER DEFAULT 0,
		FOREIGN KEY (device_uuid) REFERENCES scopes(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS application_group_members (
		group_id INTEGER NOT NULL,
		member_application_id INTEGER,
		member_group_id INTEGER,
		member_name TEXT,
		PRIMARY KEY (group_id, member_application_id, member_group_id, member_name),
		FOREIGN KEY (group_id) REFERENCES application_groups(id) ON DELETE CASCADE,
		FOREIGN KEY (member_application_id) REFERENCES application_objects(id) ON DELETE CASCADE,
		FOREIGN KEY (member_group_id) REFERENCES application_groups(id) ON DELETE CASCADE,
		CHECK (
			(member_application_id IS NOT NULL AND member_group_id IS NULL AND member_name IS NULL) OR
			(member_application_id IS NULL AND member_group_id IS NOT NULL AND member_name IS NULL) OR
			(member_application_id IS NULL AND member_group_id IS NULL AND member_name IS NOT NULL)
		)
	);
	CREATE INDEX IF NOT EXISTS idx_address_objects_lookup ON address_objects (device_uuid, scope, name);
	CREATE INDEX IF NOT EXISTS idx_address_groups_lookup ON address_groups (device_uuid, scope, name);
	CREATE INDEX IF NOT EXISTS idx_service_objects_lookup ON service_objects (device_uuid, scope, name);
	CREATE INDEX IF NOT EXISTS idx_service_groups_lookup ON service_groups (device_uuid, scope, name);
	CREATE INDEX IF NOT EXISTS idx_application_objects_lookup ON application_objects (device_uuid, scope, name);
	CREATE INDEX IF NOT EXISTS idx_application_groups_lookup ON application_groups (device_uuid, scope, name);

	CREATE INDEX IF NOT EXISTS idx_security_rules_device_uuid ON security_rules (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_nat_rules_device_uuid ON nat_rules (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_qos_rules_device_uuid ON qos_rules (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_pbf_rules_device_uuid ON pbf_rules (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_decryption_rules_device_uuid ON decryption_rules (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_application_override_rules_device_uuid ON application_override_rules (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_tunnel_inspection_rules_device_uuid ON tunnel_inspection_rules (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_static_routes_device_uuid ON static_routes (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_network_topology_device_uuid ON network_topology (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_tags_device_uuid ON tags (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_security_profiles_device_uuid ON security_profiles (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_log_forwarding_profiles_device_uuid ON log_forwarding_profiles (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_security_profile_groups_device_uuid ON security_profile_groups (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_custom_url_categories_device_uuid ON custom_url_categories (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_external_dynamic_lists_device_uuid ON external_dynamic_lists (device_uuid);

	CREATE INDEX IF NOT EXISTS idx_rule_address_mappings_address_id ON rule_address_mappings (address_id);
	CREATE INDEX IF NOT EXISTS idx_rule_address_mappings_group_id ON rule_address_mappings (group_id);
	CREATE INDEX IF NOT EXISTS idx_rule_service_mappings_service_id ON rule_service_mappings (service_id);
	CREATE INDEX IF NOT EXISTS idx_rule_service_mappings_group_id ON rule_service_mappings (group_id);
	CREATE INDEX IF NOT EXISTS idx_rule_application_mappings_custom_app_id ON rule_application_mappings (custom_app_id);
	CREATE INDEX IF NOT EXISTS idx_rule_application_mappings_group_id ON rule_application_mappings (group_id);
	CREATE INDEX IF NOT EXISTS idx_security_rule_profiles_profile_id ON security_rule_profiles (profile_id);
	CREATE INDEX IF NOT EXISTS idx_application_group_members_member_app_id ON application_group_members (member_application_id);
	CREATE INDEX IF NOT EXISTS idx_application_group_members_member_group_id ON application_group_members (member_group_id);
	
	CREATE INDEX IF NOT EXISTS idx_address_group_members_member_address_id ON address_group_members (member_address_id);
	CREATE INDEX IF NOT EXISTS idx_address_group_members_member_group_id ON address_group_members (member_group_id);
	CREATE INDEX IF NOT EXISTS idx_service_group_members_member_service_id ON service_group_members (member_service_id);
	CREATE INDEX IF NOT EXISTS idx_service_group_members_member_group_id ON service_group_members (member_group_id);
	
	CREATE INDEX IF NOT EXISTS idx_variables_device_uuid ON variables (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_zones_device_uuid ON zones (device_uuid);
	CREATE INDEX IF NOT EXISTS idx_interfaces_device_uuid ON interfaces (device_uuid);`

// globalCORSMiddleware guarantees that all loopback traffic receives proper CORS headers.

// authMiddleware inspects incoming requests for the cryptographically secure session token.

// generateToken creates a secure random 32-byte cryptographic hex token.

// logAuditSafe securely inserts a human-readable audit trail event into the encrypted SQLite vault.

// createRollbackPatch recursively zips the workspace to preserve the current state, skipping heavy dev directories.
func createRollbackPatch(basePath, backupPath string) error {
	if err := os.MkdirAll(filepath.Dir(backupPath), os.ModePerm); err != nil {
		return err
	}

	outFile, err := os.Create(backupPath)
	if err != nil {
		return err
	}
	defer outFile.Close()

	w := zip.NewWriter(outFile)
	defer w.Close()

	return filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			slog.Warn("Skipping unreadable path during backup", slog.String("path", path), slog.String("error", err.Error()))
			return nil // Skip gracefully instead of failing
		}

		// Exclude bloated development folders and the backups directory itself
		if info.IsDir() {
			name := info.Name()
			if name == "node_modules" || name == ".git" || name == "backups" || name == ".canopy" {
				return filepath.SkipDir
			}
			return nil
		}

		// Skip previously generated patches and active database state files (honoring forward-only migrations)
		if strings.HasSuffix(info.Name(), ".cpatch") || strings.HasPrefix(info.Name(), "app_state.db") {
			return nil
		}

		// Do not try to backup symlinks (like macOS framework aliases) which cause os.Open crashes
		if info.Mode()&os.ModeSymlink != 0 {
			return nil
		}

		relPath, err := filepath.Rel(basePath, path)
		if err != nil {
			return err
		}

		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return nil // skip gracefully
		}

		header.Name = filepath.ToSlash(relPath)
		header.Method = zip.Deflate

		writer, err := w.CreateHeader(header)
		if err != nil {
			return nil // skip gracefully
		}

		file, err := os.Open(path)
		if err != nil {
			slog.Warn("Skipping locked file during backup", slog.String("path", path), slog.String("error", err.Error()))
			return nil // skip gracefully
		}
		defer file.Close()

		_, err = io.Copy(writer, file)
		return err
	})
}

// normalizeZipPath cleans directory traversal attempts and strips macOS/developer wrappers.
// Returns an empty string if the file should be ignored.
func normalizeZipPath(name string) string {
	cleanPath := filepath.Clean(name)
	if strings.Contains(cleanPath, "..") || strings.Contains(cleanPath, "__MACOSX") || strings.HasSuffix(cleanPath, ".DS_Store") {
		return ""
	}

	// Strip wrapper directory if the user accidentally compressed the folder instead of its contents
	pathParts := strings.Split(filepath.ToSlash(cleanPath), "/")
	if len(pathParts) > 1 && strings.HasPrefix(strings.ToLower(pathParts[0]), "patch_") {
		return filepath.Join(pathParts[1:]...)
	}
	return cleanPath
}

// applyPatchPayload safely extracts a .cpatch zip buffer into the workspace root.
func applyPatchPayload(buf []byte, basePath string) (int, error) {
	zipReader, err := zip.NewReader(bytes.NewReader(buf), int64(len(buf)))
	if err != nil {
		return 0, fmt.Errorf("failed to parse .cpatch archive: %w", err)
	}

	filesPatched := 0
	for _, zf := range zipReader.File {
		cleanPath := normalizeZipPath(zf.Name)
		if cleanPath == "" {
			continue
		}

		targetPath := filepath.Join(basePath, cleanPath)

		if zf.FileInfo().IsDir() {
			os.MkdirAll(targetPath, os.ModePerm)
			continue
		}

		os.MkdirAll(filepath.Dir(targetPath), os.ModePerm)

		// Safely handle overwriting running executables (like canopy-core) by renaming the active binary first
		if _, statErr := os.Stat(targetPath); statErr == nil {
			os.Rename(targetPath, targetPath+".old")
		}

		dstFile, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, zf.Mode())
		if err != nil {
			return filesPatched, fmt.Errorf("failed to open target file %s: %w", targetPath, err)
		}

		srcFile, err := zf.Open()
		if err != nil {
			dstFile.Close()
			return filesPatched, fmt.Errorf("failed to open file in archive: %w", err)
		}

		if _, err := io.Copy(dstFile, srcFile); err != nil {
			srcFile.Close()
			dstFile.Close()
			return filesPatched, fmt.Errorf("failed to write data to %s (possible disk full): %w", targetPath, err)
		}

		srcFile.Close()
		dstFile.Close()
		slog.Info("Patched file successfully", slog.String("path", targetPath))
		filesPatched++
	}
	return filesPatched, nil
}

// recoverFromOldFiles provides a zero-disk-space emergency rollback.
// By deleting broken files and renaming the .old artifacts back, it requires zero bytes of free space to execute.
func recoverFromOldFiles(basePath string) {
	filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			name := info.Name()
			if name == "node_modules" || name == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(info.Name(), ".old") {
			originalPath := strings.TrimSuffix(path, ".old")
			os.Remove(originalPath) // Delete the partially written broken file to free up space
			if err := os.Rename(path, originalPath); err == nil {
				slog.Info("Zero-space emergency rollback restored file", slog.String("path", originalPath))
			}
		}
		return nil
	})
}

// cleanupPatchArtifacts sweeps the workspace on boot to delete any .old files
// left over from a previous live-patching cycle, safely freeing up disk space.
func cleanupPatchArtifacts() {
	basePath, err := filepath.Abs(".")
	if err != nil {
		return
	}
	filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			name := info.Name()
			// Skip dev folders for speed
			if name == "node_modules" || name == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(info.Name(), ".old") {
			if err := os.Remove(path); err == nil {
				slog.Info("Cleaned up stale patch artifact", slog.String("path", path))
			}
		}
		return nil
	})
}

func migrateWorkspaceDatabase(db *sql.DB) {
	// Ensure the global shared scope exists in all workspaces
	db.Exec("INSERT OR IGNORE INTO scopes (uuid, type, name) VALUES ('paloalto-panorama-global', 'shared', 'Shared (Panorama)')")

	// Check if framework_metadata table exists
	var exists int
	db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'framework_metadata'").Scan(&exists)

	runMigration := false
	if exists > 0 {
		var version int
		err := db.QueryRow("SELECT schema_version FROM framework_metadata LIMIT 1").Scan(&version)
		if err == nil && version < 3 {
			runMigration = true
		}
	}

	if runMigration {
		slog.Info("Migrating workspace database schema to version 3")
		// Per Canopy Constraints: Database schema mutations must be strictly additive (Forward-Only).
		// Dropping columns or renaming tables is prohibited to ensure .cpatch downgrade compatibility.
		// Therefore, we no longer drop legacy V2 tables/views here. We rely entirely on ALTER TABLE and CREATE TABLE IF NOT EXISTS.
	}

	// Dynamic column migrations for Objects module (errors are safely ignored if columns already exist)
	db.Exec("ALTER TABLE address_objects ADD COLUMN dirty INTEGER DEFAULT 0;")
	db.Exec("ALTER TABLE address_groups ADD COLUMN dirty INTEGER DEFAULT 0;")
	db.Exec("ALTER TABLE address_groups ADD COLUMN type TEXT DEFAULT 'static';")
	db.Exec("ALTER TABLE device_groups ADD COLUMN description TEXT;")
	
	// Ensure legacy tables have device_uuid
	legacyObjectTables := []string{
		"address_objects", "address_groups", "service_objects", "service_groups",
		"application_objects", "application_groups", "regions", "schedules",
		"tags", "security_profiles", "log_forwarding_profiles", "security_profile_groups",
		"custom_url_categories", "external_dynamic_lists", "security_rules",
		"nat_rules", "qos_rules", "pbf_rules", "decryption_rules",
		"application_override_rules", "tunnel_inspection_rules", "authentication_rules",
		"dos_rules", "static_routes", "network_topology", "interfaces", "zones", "variables",
	}
	for _, table := range legacyObjectTables {
		db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN device_uuid TEXT DEFAULT '';", table))
	}

	// Ensure all base tables exist (idempotent, creates zones, interfaces, variables if missing)
	db.Exec(actSchema)
	db.Exec("ALTER TABLE address_groups ADD COLUMN filter TEXT;")
	db.Exec("ALTER TABLE service_objects ADD COLUMN dirty INTEGER DEFAULT 0;")
	db.Exec("ALTER TABLE service_groups ADD COLUMN dirty INTEGER DEFAULT 0;")
	db.Exec("ALTER TABLE interfaces ADD COLUMN zone TEXT;")
	db.Exec("ALTER TABLE interfaces ADD COLUMN vr_name TEXT;")
	db.Exec("ALTER TABLE application_objects ADD COLUMN dirty INTEGER DEFAULT 0;")
	db.Exec("ALTER TABLE rule_application_mappings ADD COLUMN group_id INTEGER REFERENCES application_groups(id) ON DELETE CASCADE;")
	db.Exec("ALTER TABLE security_rules ADD COLUMN log_setting TEXT;")
	db.Exec(`
	CREATE TABLE IF NOT EXISTS rule_category_mappings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		rule_id INTEGER NOT NULL,
		category TEXT NOT NULL,
		FOREIGN KEY (rule_id) REFERENCES security_rules(id) ON DELETE CASCADE
	);`)

	// Ensure all firewalls in managed_devices_raw are registered as scopes in the scopes table
	// to prevent FOREIGN KEY constraint violations when moving or cloning to those scopes.
	rows, err := db.Query("SELECT id, device_uuid, name, device_group_id, template_stack_id, template_id FROM managed_devices_raw")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int64
			var devUUID, name string
			var dgID, stackID, tmplID sql.NullInt64
			if err := rows.Scan(&id, &devUUID, &name, &dgID, &stackID, &tmplID); err == nil {
				// Check if this scope exists
				var count int
				db.QueryRow("SELECT COUNT(*) FROM scopes WHERE uuid = ?", devUUID).Scan(&count)
				if count == 0 {
					var parentScopeUUID interface{}
					if dgID.Valid {
						db.QueryRow("SELECT uuid FROM device_groups WHERE id = ?", dgID.Int64).Scan(&parentScopeUUID)
					} else if stackID.Valid {
						db.QueryRow("SELECT uuid FROM template_stacks WHERE id = ?", stackID.Int64).Scan(&parentScopeUUID)
					} else if tmplID.Valid {
						db.QueryRow("SELECT uuid FROM templates WHERE id = ?", tmplID.Int64).Scan(&parentScopeUUID)
					}

					// Insert scope
					_, err = db.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'firewall', ?, ?, ?)", devUUID, id, name, parentScopeUUID)
					if err != nil {
						slog.Error("Failed to auto-seed scope for managed device", slog.String("uuid", devUUID), slog.String("error", err.Error()))
					}
				}
			}
		}
	}
}

// mountAndSeedVault securely opens the encrypted SQLite databases, asserts the schemas, and mounts the active workspace.
// It assumes vaultMutex is already locked by the caller.
func mountAndSeedVault(password string, w http.ResponseWriter) {
	// Initialize the System Hub
	sys, err := storage.Initialize("canopy_system.db", password)
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "file is not a database") || strings.Contains(errStr, "file is encrypted") {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid passphrase."})
		} else {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("Vault corruption detected: %v", errStr)})
		}
		return
	}
	systemDB = sys
	masterKey = password

	// --- AUTOMATED BACKEND SELF-SEEDING ---
	// 1. System Schema
	systemDB.WriteLock()
	sysSchema := `
	CREATE TABLE IF NOT EXISTS workspaces (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE NOT NULL,
		filename TEXT UNIQUE NOT NULL,
		color TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE IF NOT EXISTS framework_metadata (
		app_id TEXT PRIMARY KEY,
		schema_version INTEGER
	);`
	if _, err := systemDB.DB().Exec(sysSchema); err != nil {
		slog.Error("Failed to initialize database schema", slog.String("error", err.Error()))
	}
	systemDB.DB().Exec("ALTER TABLE workspaces ADD COLUMN color TEXT;")
	systemDB.DB().Exec(fmt.Sprintf("INSERT OR IGNORE INTO framework_metadata (app_id, schema_version) VALUES ('%s', 1)", AppBundleID))
	systemDB.WriteUnlock()

	// --- INITIALIZE IMMUTABLE TELEMETRY DB ---
	tel, err := storage.Initialize("canopy_telemetry.db", password)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to mount telemetry database."})
		return
	}
	telemetryDB = tel

	// --- INITIALIZE LOG DB ---
	log, logErr := storage.InitializeLogStore("canopy_logs.duckdb")
	if logErr != nil {
		slog.Error("Failed to initialize DuckDB", slog.String("error", logErr.Error()))
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to mount logs database."})
		return
	}
	logDB = log

	telemetryDB.WriteLock()
	telSchema := `
	CREATE TABLE IF NOT EXISTS audit_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		action TEXT,
		module TEXT,
		details TEXT
	);`
	telemetryDB.DB().Exec(telSchema)
	telemetryDB.WriteUnlock()

	logAuditSafe("Vault Unlocked", "Security", "The encrypted storage vault was successfully mounted.")

	// Register default workspace if none exist
	var wsCount int
	systemDB.DB().QueryRow("SELECT COUNT(*) FROM workspaces").Scan(&wsCount)
	if wsCount == 0 {
		systemDB.DB().Exec("INSERT INTO workspaces (name, filename) VALUES (?, ?)", "Default Workspace", "workspace_default.db")
	}

	// Determine which workspace to mount
	var activeFilename string
	if err := systemDB.DB().QueryRow("SELECT filename FROM workspaces ORDER BY id ASC LIMIT 1").Scan(&activeFilename); err != nil {
		activeFilename = "workspace_default.db"
	}

	// Initialize the Active Workspace Spoke
	act, err := storage.Initialize(activeFilename, password)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to mount workspace database."})
		return
	}
	activeDB = act

	// 2. Workspace Schema
	activeDB.WriteLock()
	migrateWorkspaceDatabase(activeDB.DB())
	if _, err := activeDB.DB().Exec(actSchema); err != nil {
		slog.Error("Failed to initialize workspace schema", slog.String("error", err.Error()))
	}
	activeDB.DB().Exec(fmt.Sprintf("INSERT OR REPLACE INTO framework_metadata (app_id, schema_version) VALUES ('%s', 3)", AppBundleID))
	activeDB.WriteUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func main() {
	// --- PERSISTENT STORAGE ANCHOR ---
	// If the frontend didn't provide an absolute data path, securely anchor
	// the backend to the OS's persistent application data folder to survive reboots.
	if os.Getenv("CANOPY_DATA_PATH") == "" {
		var targetDir string

		// 1. True Portable Mode (USB Stick)
		if os.Getenv("CANOPY_PORTABLE_MODE") == "true" {
			// The Electron packager securely passes the physical USB stick path via this env var
			if portableDir := os.Getenv("PORTABLE_EXECUTABLE_DIR"); portableDir != "" {
				targetDir = filepath.Join(portableDir, "CanopyData")
			} else {
				targetDir = "CanopyData" // Fallback
			}
		} else {
			// 2. Standard Installed Mode (OS Profile AppData)
			configDir, err := os.UserConfigDir()
			if err != nil {
				configDir = "."
			}
			targetDir = filepath.Join(configDir, "Canopy")
		}

		os.MkdirAll(targetDir, os.ModePerm)
		os.Setenv("CANOPY_DATA_PATH", targetDir)
	}

	// Determine log level from environment
	logLevelStr := strings.ToUpper(os.Getenv("CANOPY_LOG_LEVEL"))

	switch logLevelStr {
	case "DEBUG":
		programLevel.Set(slog.LevelDebug)
	case "WARN":
		programLevel.Set(slog.LevelWarn)
	case "ERROR":
		programLevel.Set(slog.LevelError)
	default:
		programLevel.Set(slog.LevelInfo)
	}

	// --- EMBEDDED CLI ROUTER ---
	// If arguments are passed, bypass the HTTP daemon and execute locally
	if len(os.Args) > 1 {
		command := strings.ToLower(os.Args[1])
		switch command {
		case "help", "--help", "-h":
			fmt.Println("Canopy Core Engine - Embedded CLI")
			fmt.Println("\nUsage:")
			fmt.Println("  canopy-core [command] [arguments]")
			fmt.Println("\nAvailable Commands:")
			fmt.Println("  help        Show this help message")
			fmt.Println("  version     Print the core engine version")
			fmt.Println("  db-query    Execute a direct SQLite query")
			fmt.Println("\nRun without arguments to start the background web daemon.")
			os.Exit(0)
		case "version", "--version", "-v":
			fmt.Println("Canopy Core Engine v0.16.0")
			os.Exit(0)
		case "db-query":
			if len(os.Args) < 3 {
				fmt.Println("Usage: canopy-core db-query \"SELECT * FROM ...\"")
				os.Exit(1)
			}
			query := strings.Join(os.Args[2:], " ")

			fmt.Print("Enter Vault Passphrase: ")
			bytePassword, err := term.ReadPassword(int(syscall.Stdin))
			fmt.Println()
			if err != nil {
				fmt.Printf("Error reading password: %v\n", err)
				os.Exit(1)
			}

			sysDB, err := storage.Initialize("canopy_system.db", string(bytePassword))
			if err != nil {
				errStr := err.Error()
				if strings.Contains(errStr, "file is not a database") || strings.Contains(errStr, "file is encrypted") {
					fmt.Println("Error: Invalid passphrase.")
				} else {
					fmt.Printf("Error: System vault corruption detected: %v\n", errStr)
				}
				os.Exit(1)
			}
			defer sysDB.Close()

			actDB, err := storage.Initialize("workspace_default.db", string(bytePassword))
			if err != nil {
				fmt.Println("Error: Failed to open workspace database.")
				os.Exit(1)
			}
			defer actDB.Close()

			telDB, err := storage.Initialize("canopy_telemetry.db", string(bytePassword))
			if err != nil {
				fmt.Println("Error: Failed to open telemetry database.")
				os.Exit(1)
			}
			defer telDB.Close()
			telDB.DB().Exec("CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, action TEXT, module TEXT, details TEXT);")
			telDB.DB().Exec("INSERT INTO audit_logs (action, module, details) VALUES (?, ?, ?)", "CLI Database Query", "Diagnostics", "Query executed: "+query)

			rows, err := actDB.DB().Query(query)
			if err != nil {
				fmt.Printf("Query Error: %v\n", err)
				os.Exit(1)
			}
			defer rows.Close()

			cols, err := rows.Columns()
			if err != nil {
				fmt.Printf("Error getting columns: %v\n", err)
				os.Exit(1)
			}

			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, strings.Join(cols, "\t"))

			for rows.Next() {
				columns := make([]interface{}, len(cols))
				columnPointers := make([]interface{}, len(cols))
				for i := range columns {
					columnPointers[i] = &columns[i]
				}
				if err := rows.Scan(columnPointers...); err != nil {
					continue
				}
				var rowStrings []string
				for i := range cols {
					val := columnPointers[i].(*interface{})
					if val == nil || *val == nil {
						rowStrings = append(rowStrings, "NULL")
						continue
					}

					// SECURITY GUARDRAIL: Mask sensitive columns from the CLI
					lowerCol := strings.ToLower(cols[i])
					if lowerCol == "secret_value" || lowerCol == "license_key" || lowerCol == "activation_token" {
						rowStrings = append(rowStrings, "******** [REDACTED]")
						continue
					}

					v := *val
					if b, ok := v.([]byte); ok {
						rowStrings = append(rowStrings, string(b))
					} else {
						rowStrings = append(rowStrings, fmt.Sprintf("%v", v))
					}
				}
				fmt.Fprintln(w, strings.Join(rowStrings, "\t"))
			}
			w.Flush()
			os.Exit(0)
		default:
			fmt.Printf("Unknown CLI command: %s\nRun 'canopy-core help' for usage.\n", command)
			os.Exit(1)
		}
	}

	// Setup slog for structured JSON telemetry
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: programLevel}))
	slog.SetDefault(logger)

	slog.Info("Starting Canopy headless backend...")

	// Run background garbage collection to clear dead executables from previous updates
	go cleanupPatchArtifacts()

	// Explicitly configure default outbound client to respect system proxies
	http.DefaultClient = &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
		},
	}
	slog.Info("Proxy detection from environment enabled for outbound requests")

	// Get port from environment or default to 8080

	// Resolve or generate bearer token
	token := os.Getenv("CANOPY_TOKEN")
	if token == "" {
		generated, err := generateToken()
		if err != nil {
			slog.Error("Failed to generate cryptographic token", slog.String("error", err.Error()))
			os.Exit(1)
		}
		token = generated
		slog.Info("Generated new cryptographic bearer token", slog.String("token", token))
	} else {
		slog.Info("Using provided CANOPY_TOKEN from environment")
	}

	// Setup standard net/http router
	mux := http.NewServeMux()

	// Base Health Route
	mux.HandleFunc("/api/health", handleSystemHealth)

	// Vault Lock Endpoint (Triggered by Inactivity Timer)
	mux.HandleFunc("/api/vault/lock", handleVaultLock)

	// Vault Emergency Wipe Endpoint
	mux.HandleFunc("/api/vault/wipe", handleVaultWipe)

	// Vault Rekey Endpoint
	mux.HandleFunc("/api/vault/rekey", handleVaultRekey)

	// Vault Initialization Endpoint
	mux.HandleFunc("/api/init", handleVaultInit)

	// Vault Unlock Endpoint
	mux.HandleFunc("/api/vault/unlock", handleVaultUnlock)

	mux.HandleFunc("/api/workspaces/heal", handleWorkspacesHeal)
	mux.HandleFunc("/api/workspaces", handleWorkspacesList)
	mux.HandleFunc("/api/workspaces/create", handleWorkspacesCreate)

	mux.HandleFunc("/api/workspaces/switch", handleWorkspacesSwitch)
	mux.HandleFunc("/api/workspaces/update", handleWorkspacesUpdate)



	mux.HandleFunc("/api/workspaces/export", handleWorkspacesExport)
	mux.HandleFunc("/api/workspaces/import", handleWorkspacesImport)
	mux.HandleFunc("/api/workspaces/delete", handleWorkspacesDelete)

	// Secrets Vault: List
	mux.HandleFunc("/api/secrets", handleSecretsList)

	// Secrets Vault: Create
	mux.HandleFunc("/api/secrets/create", handleSecretsCreate)

	// Secrets Vault: Update
	mux.HandleFunc("/api/secrets/update", handleSecretsUpdate)

	// Secrets Vault: Delete
	mux.HandleFunc("/api/secrets/delete", handleSecretsDelete)

	// Secrets Vault: Reveal
	mux.HandleFunc("/api/secrets/reveal", handleSecretsReveal)

	// --- DEVICE MANAGEMENT CRUD ENDPOINTS ---

	// Device Groups: Create
	mux.HandleFunc("/api/device-groups/create", handleDeviceGroupsCreate)

	// Device Groups: Update
	mux.HandleFunc("/api/device-groups/update", handleDeviceGroupsUpdate)

	// Device Groups: Delete
	mux.HandleFunc("/api/device-groups/delete", handleDeviceGroupsDelete)

	// Base Templates: Create
	mux.HandleFunc("/api/templates/create", handleTemplatesCreate)

	// Base Templates: Update
	mux.HandleFunc("/api/templates/update", handleTemplatesUpdate)

	// Base Templates: Delete
	mux.HandleFunc("/api/templates/delete", handleTemplatesDelete)

	// Template Stacks: Create
	mux.HandleFunc("/api/template-stacks/create", handleTemplateStacksCreate)

	// Template Stacks: Update
	mux.HandleFunc("/api/template-stacks/update", handleTemplateStacksUpdate)

	// Template Stacks: Delete
	mux.HandleFunc("/api/template-stacks/delete", handleTemplateStacksDelete)

	// Devices: Create
	mux.HandleFunc("/api/devices/create", handleDevicesCreate)

	// Devices: Update
	mux.HandleFunc("/api/devices/update", handleDevicesUpdate)

	// Devices: Delete
	mux.HandleFunc("/api/devices/delete", handleDevicesDelete)

	// Devices: Inventory
	mux.HandleFunc("/api/devices/inventory", handleGetInventory)
	// Pathfinding Evaluation Endpoint
	mux.HandleFunc("/api/paths/resolve", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req PathLookupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Malformed JSON payload", http.StatusBadRequest)
			return
		}

		vaultMutex.RLock()
		if activeDB == nil {
			vaultMutex.RUnlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.RUnlock()

		// Pass our open parallel-read SQLite handler straight into the engine logic
		payload, err := engine.FindPath(dbConn, req.SourceIP, req.DestinationIP)
		if err != nil {
			slog.Error("Path evaluation mapping failed", slog.String("error", err.Error()))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnprocessableEntity)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(payload)
	})

	// Raw Database Queries for System Inspector ONLY
	mux.HandleFunc("/api/system/db-inspector", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			Query string `json:"query"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Malformed JSON payload", http.StatusBadRequest)
			return
		}

		// Basic safety guardrail: only allow SELECT, PRAGMA, or WITH (CTEs) for troubleshooting
		upperQuery := strings.ToUpper(strings.TrimSpace(req.Query))
		if !strings.HasPrefix(upperQuery, "SELECT") && !strings.HasPrefix(upperQuery, "PRAGMA") && !strings.HasPrefix(upperQuery, "WITH") {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Only SELECT or PRAGMA queries are permitted via the troubleshooting browser."})
			return
		}

		vaultMutex.RLock()
		if activeDB == nil {
			vaultMutex.RUnlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.RUnlock()

		rows, err := dbConn.Query(req.Query)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		defer rows.Close()

		cols, _ := rows.Columns()
		result := make([]map[string]interface{}, 0) // Explicitly initialize so it encodes as [] instead of null

		for rows.Next() {
			columns := make([]interface{}, len(cols))
			columnPointers := make([]interface{}, len(cols))
			for i := range columns {
				columnPointers[i] = &columns[i]
			}
			if err := rows.Scan(columnPointers...); err != nil {
				continue
			}
			m := make(map[string]interface{})
			for i, colName := range cols {
				val := columnPointers[i].(*interface{})
				if val == nil || *val == nil {
					m[colName] = nil
					continue
				}

				// SECURITY GUARDRAIL: Mask sensitive credential columns from the generic DB browser
				lowerCol := strings.ToLower(colName)
				if lowerCol == "secret_value" || lowerCol == "license_key" || lowerCol == "activation_token" {
					m[colName] = "******** [REDACTED]"
					continue
				}

				v := *val
				// SQLite driver often returns text as raw bytes; cast to string for clean JSON encoding
				if b, ok := v.([]byte); ok {
					m[colName] = string(b)
				} else {
					m[colName] = v
				}
			}
			result = append(result, m)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"columns": cols,
			"rows":    result,
		})
	})

	// Global Search Endpoint (Categorized Omnibox)
	mux.HandleFunc("/api/search", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		query := strings.TrimSpace(r.URL.Query().Get("q"))
		if query == "" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]interface{}{}) // Return empty array
			return
		}

		slog.Info("Executing global search", slog.String("query", query))

		vaultMutex.RLock()
		if activeDB == nil {
			vaultMutex.RUnlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.RUnlock()

		type SearchResult struct {
			ID        string `json:"id"`
			Type      string `json:"type"`
			Label     string `json:"label"`
			Module    string `json:"module"`
			Submodule string `json:"submodule"`
		}

		// Explicitly initialize to an empty slice so it encodes to [] instead of null
		results := make([]SearchResult, 0)
		searchTerm := "%" + query + "%"

		// 1. Search Scopes/Devices
		devRows, err := dbConn.Query("SELECT uuid, name, type FROM scopes WHERE name LIKE ? OR type LIKE ? LIMIT 5", searchTerm, searchTerm)
		if err != nil {
			slog.Error("Search query failed on scopes", slog.String("error", err.Error()))
		} else {
			defer devRows.Close()
			for devRows.Next() {
				var uuid string
				var name, scopeType sql.NullString
				if err := devRows.Scan(&uuid, &name, &scopeType); err == nil {
					n := ""
					t := "Scope"
					if name.Valid {
						n = name.String
					}
					if scopeType.Valid {
						switch scopeType.String {
						case "shared":
							t = "Shared Context"
						case "device-group":
							t = "Device Group"
						case "template":
							t = "Template"
						case "template-stack":
							t = "Template Stack"
						case "firewall":
							t = "Firewall"
						default:
							t = scopeType.String
						}
					}
					results = append(results, SearchResult{ID: uuid, Type: "device", Label: fmt.Sprintf("%s (%s)", n, t), Module: "System", Submodule: "Database Browser"})
				} else {
					slog.Error("Search row scan failed on scopes", slog.String("error", err.Error()))
				}
			}
		}

		// 2. Search Network Interfaces & Subnets
		netRows, err := dbConn.Query("SELECT device_uuid, interface_name, network_cidr, zone_name FROM network_topology WHERE interface_name LIKE ? OR network_cidr LIKE ? OR zone_name LIKE ? LIMIT 10", searchTerm, searchTerm, searchTerm)
		if err != nil {
			slog.Error("Search query failed on network_topology", slog.String("error", err.Error()))
		} else {
			defer netRows.Close()
			for netRows.Next() {
				var uuid, iface string
				var cidr, zone sql.NullString
				if err := netRows.Scan(&uuid, &iface, &cidr, &zone); err == nil {
					c := ""
					z := ""
					if cidr.Valid {
						c = cidr.String
					}
					if zone.Valid {
						z = zone.String
					}
					results = append(results, SearchResult{ID: uuid + "|" + iface, Type: "interface", Label: fmt.Sprintf("%s - %s (%s)", iface, c, z), Module: "Network", Submodule: "Interfaces"})
				} else {
					slog.Error("Search row scan failed on network_topology", slog.String("error", err.Error()))
				}
			}
		}

		// 3. Search Documentation (Markdown Help Files)
		docsPath := os.Getenv("CANOPY_DOCS_PATH")
		if docsPath != "" {
			files, err := os.ReadDir(docsPath)
			if err == nil {
				lowerQuery := strings.ToLower(query)
				for _, f := range files {
					if !f.IsDir() && strings.HasSuffix(f.Name(), ".md") {
						content, err := os.ReadFile(filepath.Join(docsPath, f.Name()))
						if err == nil && strings.Contains(strings.ToLower(string(content)), lowerQuery) {
							baseName := strings.TrimSuffix(f.Name(), ".md")
							parts := strings.SplitN(baseName, "-", 2)
							module := "System"
							submodule := "Support"
							label := "Documentation"
							if len(parts) == 2 {
								module = strings.ToUpper(parts[0][:1]) + strings.ToLower(parts[0][1:])
								subParts := strings.Split(parts[1], "-")
								for i, sp := range subParts {
									if len(sp) > 0 {
										subParts[i] = strings.ToUpper(sp[:1]) + strings.ToLower(sp[1:])
									}
								}
								submodule = strings.Join(subParts, " ")
								label = submodule + " Handbook"
							}
							results = append(results, SearchResult{ID: "doc|" + baseName, Type: "documentation", Label: label, Module: module, Submodule: submodule})
						}
					}
				}
			} else {
				slog.Error("Failed to read documentation directory", slog.String("path", docsPath), slog.String("error", err.Error()))
			}
		}

		// 4. Search Changelog
		changelogPath := os.Getenv("CANOPY_CHANGELOG_PATH")
		if changelogPath != "" {
			content, err := os.ReadFile(changelogPath)
			if err == nil && strings.Contains(strings.ToLower(string(content)), strings.ToLower(query)) {
				results = append(results, SearchResult{ID: "changelog", Type: "changelog", Label: "Platform Changelog", Module: "System", Submodule: "Changelog"})
			} else if err != nil && !os.IsNotExist(err) {
				slog.Error("Failed to read changelog file", slog.String("path", changelogPath), slog.String("error", err.Error()))
			}
		}

		slog.Info("Global search completed", slog.Int("results_found", len(results)))

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(results)
	})

	// Audit Logs Retrieval Endpoint
	mux.HandleFunc("/api/audit/logs", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		vaultMutex.RLock()
		if telemetryDB == nil {
			vaultMutex.RUnlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := telemetryDB.DB()
		vaultMutex.RUnlock()

		rows, err := dbConn.Query("SELECT id, strftime('%Y-%m-%dT%H:%M:%SZ', timestamp), action, module, details FROM audit_logs ORDER BY timestamp DESC LIMIT 1000")
		if err != nil {
			slog.Error("Failed to query audit logs", slog.String("error", err.Error()))
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to retrieve audit logs."})
			return
		}
		defer rows.Close()

		results := make([]map[string]interface{}, 0)
		for rows.Next() {
			var id int
			var timestamp, action, module, details string
			if err := rows.Scan(&id, &timestamp, &action, &module, &details); err == nil {
				results = append(results, map[string]interface{}{"id": id, "timestamp": timestamp, "action": action, "module": module, "details": details})
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(results)
	})

	// System Log Level Management
	mux.HandleFunc("/api/system/loglevel", handleSystemLoglevel)

	// System Snapshots: List
	mux.HandleFunc("/api/system/snapshots", handleSnapshotsList)

	// System Snapshots: Create
	mux.HandleFunc("/api/system/snapshots/create", handleSnapshotsCreate)

	// System Snapshots: Update
	mux.HandleFunc("/api/system/snapshots/update", handleSnapshotsUpdate)

	// System Snapshots: Delete
	mux.HandleFunc("/api/system/snapshots/delete", handleSnapshotsDelete)

	// System Snapshots: Local Revert
	mux.HandleFunc("/api/system/snapshots/revert", handleSnapshotsRevert)

	// System Snapshots: External Export
	mux.HandleFunc("/api/system/snapshots/export", handleSnapshotsExport)

	// System Snapshots: Import External Archive
	mux.HandleFunc("/api/system/snapshots/import", handleSnapshotsImport)

	// System Patching Ingestion Endpoint
	mux.HandleFunc("/api/system/patch", handleSystemPatch)

	// System Patch Pre-flight Inspection Endpoint
	mux.HandleFunc("/api/system/patch/inspect", handleSystemPatchInspect)

	// Device Configuration XML Import Endpoint
	mux.HandleFunc("/api/devices/import", handleDevicesImport)

	// System Rollback Endpoint
	mux.HandleFunc("/api/system/rollback", handleSystemRollback)



	// --- OBJECTS MODULE ENDPOINTS ---
	mux.HandleFunc("/api/objects/address/create", handleAddressCreate)
	mux.HandleFunc("/api/objects/address/update", handleAddressUpdate)
	mux.HandleFunc("/api/objects/address/delete", handleAddressDelete)
	mux.HandleFunc("/api/objects/import", handleObjectsImport)

	mux.HandleFunc("/api/objects/address-group/create", handleAddressGroupCreate)
	mux.HandleFunc("/api/objects/address-group/update", handleAddressGroupUpdate)
	mux.HandleFunc("/api/objects/address-group/delete", handleAddressGroupDelete)

	mux.HandleFunc("/api/objects/service/create", handleServiceCreate)
	mux.HandleFunc("/api/objects/service/update", handleServiceUpdate)
	mux.HandleFunc("/api/objects/service/delete", handleServiceDelete)

	mux.HandleFunc("/api/objects/service-group/create", handleServiceGroupCreate)
	mux.HandleFunc("/api/objects/service-group/update", handleServiceGroupUpdate)
	mux.HandleFunc("/api/objects/service-group/delete", handleServiceGroupDelete)

	mux.HandleFunc("/api/objects/application/create", handleApplicationCreate)
	mux.HandleFunc("/api/objects/application/update", handleApplicationUpdate)
	mux.HandleFunc("/api/objects/application/delete", handleApplicationDelete)

	mux.HandleFunc("/api/objects/application-group/create", handleApplicationGroupCreate)
	mux.HandleFunc("/api/objects/application-group/update", handleApplicationGroupUpdate)
	mux.HandleFunc("/api/objects/application-group/delete", handleApplicationGroupDelete)

	mux.HandleFunc("/api/objects/application/import-csv", handleApplicationImportCSV)

	mux.HandleFunc("/api/objects/tag/create", handleTagCreate)
	mux.HandleFunc("/api/objects/tag/update", handleTagUpdate)
	mux.HandleFunc("/api/objects/tag/delete", handleTagDelete)

	mux.HandleFunc("/api/objects/log-forwarding-profile/create", handleLogForwardingProfileCreate)
	mux.HandleFunc("/api/objects/log-forwarding-profile/update", handleLogForwardingProfileUpdate)
	mux.HandleFunc("/api/objects/log-forwarding-profile/delete", handleLogForwardingProfileDelete)

	mux.HandleFunc("/api/objects/security-profile/create", handleSecurityProfileCreate)
	mux.HandleFunc("/api/objects/security-profile/update", handleSecurityProfileUpdate)
	mux.HandleFunc("/api/objects/security-profile/delete", handleSecurityProfileDelete)

	// --- POLICIES MODULE ENDPOINTS ---
	mux.HandleFunc("/api/policies", handleGetPolicies)

	// --- DASHBOARD WIDGETS ---
	mux.HandleFunc("/api/objects/security-profile-group/create", handleSecurityProfileGroupCreate)
	mux.HandleFunc("/api/objects/security-profile-group/update", handleSecurityProfileGroupUpdate)
	mux.HandleFunc("/api/objects/security-profile-group/delete", handleSecurityProfileGroupDelete)

	mux.HandleFunc("/api/objects/custom-url-category/create", handleCustomURLCategoryCreate)
	mux.HandleFunc("/api/objects/custom-url-category/update", handleCustomURLCategoryUpdate)
	mux.HandleFunc("/api/objects/custom-url-category/delete", handleCustomURLCategoryDelete)

	mux.HandleFunc("/api/objects/external-dynamic-list/create", handleExternalDynamicListCreate)
	mux.HandleFunc("/api/objects/external-dynamic-list/update", handleExternalDynamicListUpdate)
	mux.HandleFunc("/api/objects/external-dynamic-list/delete", handleExternalDynamicListDelete)

	// --- CLI GENERATION ENDPOINT ---
	mux.HandleFunc("/api/cli/generate", handleCLIGenerate)

	// --- LOGS MODULE ENDPOINTS ---
	mux.HandleFunc("/api/logs/schema", func(w http.ResponseWriter, r *http.Request) {
		HandleGetLogSchema(w, r, logDB)
	})
	mux.HandleFunc("/api/logs/import", func(w http.ResponseWriter, r *http.Request) {
		HandleImportLogs(w, r, nil, logDB)
	})
	mux.HandleFunc("/api/logs", func(w http.ResponseWriter, r *http.Request) {
		HandleGetLogs(w, r, logDB)
	})
	mux.HandleFunc("/api/logs/delete", func(w http.ResponseWriter, r *http.Request) {
		HandleDeleteLogs(w, r, logDB)
	})
	mux.HandleFunc("/api/logs/delete-batch", func(w http.ResponseWriter, r *http.Request) {
		HandleDeleteLogsBatch(w, r, logDB)
	})
	mux.HandleFunc("/api/logs/heatmap", func(w http.ResponseWriter, r *http.Request) {
		HandleGetHeatmap(w, r, logDB)
	})
	mux.HandleFunc("/api/logs/candidates", func(w http.ResponseWriter, r *http.Request) {
		HandleGenerateCandidateRules(w, r, logDB)
	})

	// --- NETWORK MODULE ENDPOINTS ---
	mux.HandleFunc("/api/networks/zones", handleGetZones)
	mux.HandleFunc("/api/networks/interfaces", handleGetInterfaces)
	mux.HandleFunc("/api/networks/routes", handleGetRoutes)
	mux.HandleFunc("/api/networks/counts", handleGetNetworkCounts)

	mux.HandleFunc("/api/variables", handleGetVariables)
	mux.HandleFunc("/api/objects", handleGetObjects)
	mux.HandleFunc("/api/system/objects-reference", handleGetObjectsReference)
	mux.HandleFunc("/api/objects/group-members", handleGetGroupMembers)
	mux.HandleFunc("/api/objects/dependencies", handleGetObjectDependencies)
	mux.HandleFunc("/api/objects/counts", handleGetObjectCounts)
	mux.HandleFunc("/api/system/hierarchy-context", handleGetHierarchyContext)
	mux.HandleFunc("/api/system/policies-context", handleGetPoliciesContext)
	mux.HandleFunc("/api/system/policies-counts", handleGetPoliciesCounts)

	// --- MULTI-LAYER MIDDLEWARE STACK ---
	protectedMux := authMiddleware(token, mux)
	finalHandler := globalCORSMiddleware(protectedMux)
	// ------------------------------------

	// Strictly bind to 127.0.0.1 per constraints
	port := os.Getenv("CANOPY_PORT")
	if port == "" {
		port = "8080" // Fallback for standalone terminal execution
	}
	addr := "127.0.0.1:" + port
	server := &http.Server{
		Addr:    addr,
		Handler: finalHandler,
	}

	// Start server in a background goroutine to allow the main thread to listen for termination signals
	go func() {
		slog.Info("Starting Canopy headless backend listener", slog.String("address", addr))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("Server encountered a critical error", slog.String("error", err.Error()))
			os.Exit(1)
		}
	}()

	// Wait for SIGTERM from Electron backendManager or SIGINT from standard terminal cancel
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("Termination signal received. Gracefully shutting down the Canopy backend...")

	// Create a deadline to wait for pending HTTP requests to finish (e.g., active SQLite writes)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		slog.Error("Forced server shutdown", slog.String("error", err.Error()))
	}

	vaultMutex.Lock()
	if systemDB != nil {
		systemDB.Close()
	}
	if activeDB != nil {
		activeDB.Close()
	}
	if telemetryDB != nil {
		telemetryDB.Close()
	}
	if logDB != nil {
		logDB.Close()
	}
	vaultMutex.Unlock()

	slog.Info("Server stopped cleanly. Memory structures and databases are safe.")
}

// ==========================================
// OBJECTS MODULE CRUD & VALIDATION HANDLERS
// ==========================================

func getActiveDBConn() (*sql.DB, error) {
	vaultMutex.Lock()
	defer vaultMutex.Unlock()
	if activeDB == nil {
		return nil, fmt.Errorf("Storage vault is locked.")
	}
	return activeDB.DB(), nil
}

// --- NEW OBJECTS MODULE CRUD HANDLERS ---

func handleCLIGenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req cli.CLIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Malformed JSON payload", http.StatusBadRequest)
		return
	}

	dbConn, err := getActiveDBConn()
	if err != nil {
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	generator := cli.NewGenerator(dbConn)
	commands, err := generator.Generate(req)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to generate CLI commands: " + err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cli.CLIResponse{Commands: commands})
}
