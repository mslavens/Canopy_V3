package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
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
	"sort"
	"strings"
	"sync"
	"syscall"
	"text/tabwriter"
	"time"

	"canopy-core/adapters/paloalto"
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
	masterKey   string
	vaultMutex  sync.RWMutex
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
		predefined_app_name TEXT,
		FOREIGN KEY (custom_app_id) REFERENCES application_objects(id) ON DELETE CASCADE,
		CHECK (
			(custom_app_id IS NOT NULL AND predefined_app_name IS NULL) OR
			(custom_app_id IS NULL AND predefined_app_name IS NOT NULL)
		)
	);
	CREATE TABLE IF NOT EXISTS rule_zone_mappings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		rule_type TEXT NOT NULL,
		rule_id INTEGER NOT NULL,
		direction TEXT NOT NULL,
		zone_name TEXT NOT NULL
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
	CREATE INDEX IF NOT EXISTS idx_security_rule_profiles_profile_id ON security_rule_profiles (profile_id);
	CREATE INDEX IF NOT EXISTS idx_application_group_members_member_app_id ON application_group_members (member_application_id);
	CREATE INDEX IF NOT EXISTS idx_application_group_members_member_group_id ON application_group_members (member_group_id);
	
	CREATE INDEX IF NOT EXISTS idx_address_group_members_member_address_id ON address_group_members (member_address_id);
	CREATE INDEX IF NOT EXISTS idx_address_group_members_member_group_id ON address_group_members (member_group_id);
	CREATE INDEX IF NOT EXISTS idx_service_group_members_member_service_id ON service_group_members (member_service_id);
	CREATE INDEX IF NOT EXISTS idx_service_group_members_member_group_id ON service_group_members (member_group_id);`

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
		slog.Info("Migrating workspace database schema to version 3 (dropping legacy tables/views)")
		// Drop views first
		legacyViews := []string{"devices", "managed_devices", "template_stack_members"}
		for _, name := range legacyViews {
			db.Exec(fmt.Sprintf("DROP VIEW IF EXISTS %s", name))
		}
		// Drop tables
		legacyTables := []string{
			"template_stack_members_raw",
			"template_stacks",
			"templates",
			"device_groups",
			"managed_devices_raw",
			"scopes",
			"devices",
			"managed_devices",
			"template_stack_members",
		}
		for _, name := range legacyTables {
			db.Exec(fmt.Sprintf("DROP TABLE IF EXISTS %s", name))
		}
	}

	// Dynamic column migrations for Objects module (errors are safely ignored if columns already exist)
	db.Exec("ALTER TABLE address_objects ADD COLUMN dirty INTEGER DEFAULT 0;")
	db.Exec("ALTER TABLE address_groups ADD COLUMN dirty INTEGER DEFAULT 0;")
	db.Exec("ALTER TABLE address_groups ADD COLUMN type TEXT DEFAULT 'static';")
	db.Exec("ALTER TABLE address_groups ADD COLUMN filter TEXT;")
	db.Exec("ALTER TABLE service_objects ADD COLUMN dirty INTEGER DEFAULT 0;")
	db.Exec("ALTER TABLE service_groups ADD COLUMN dirty INTEGER DEFAULT 0;")
	db.Exec("ALTER TABLE application_objects ADD COLUMN dirty INTEGER DEFAULT 0;")

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
	programLevel := new(slog.LevelVar)

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
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		dbPath := filepath.Join(os.Getenv("CANOPY_DATA_PATH"), "canopy_system.db")
		_, err := os.Stat(dbPath)
		vaultExists := err == nil
		isPortable := os.Getenv("CANOPY_PORTABLE_MODE") == "true"
		vaultMutex.RLock()
		isLocked := systemDB == nil
		vaultMutex.RUnlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":       "authenticated",
			"engine":       "canopy-core",
			"storage":      "WAL_ready",
			"portable":     isPortable,
			"vault_locked": isLocked,
			"vault_exists": vaultExists,
		})
	})

	// Vault Lock Endpoint (Triggered by Inactivity Timer)
	mux.HandleFunc("/api/vault/lock", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		vaultMutex.Lock()
		if telemetryDB != nil {
			telemetryDB.DB().Exec("INSERT INTO audit_logs (action, module, details) VALUES (?, ?, ?)", "Vault Locked", "Security", "The vault was automatically locked due to inactivity.")
			telemetryDB.Close()
			telemetryDB = nil
		}
		if systemDB != nil {
			systemDB.Close()
			systemDB = nil
		}
		if activeDB != nil {
			activeDB.Close()
			activeDB = nil
		}
		masterKey = ""
		slog.Info("Vault automatically locked due to inactivity. Database connections severed.")
		vaultMutex.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Vault Emergency Wipe Endpoint
	mux.HandleFunc("/api/vault/wipe", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		vaultMutex.Lock()
		if telemetryDB != nil {
			telemetryDB.DB().Exec("INSERT INTO audit_logs (action, module, details) VALUES (?, ?, ?)", "Vault Wiped", "Security", "The encrypted vault was permanently destroyed via Factory Reset.")
			telemetryDB.Close()
			telemetryDB = nil
		}
		if systemDB != nil {
			systemDB.Close()
			systemDB = nil
		}
		if activeDB != nil {
			activeDB.Close()
			activeDB = nil
		}
		masterKey = ""
		vaultMutex.Unlock()

		dataPath := os.Getenv("CANOPY_DATA_PATH")
		files, _ := os.ReadDir(dataPath)
		for _, f := range files {
			if !f.IsDir() && (strings.HasSuffix(f.Name(), ".db") || strings.HasSuffix(f.Name(), ".db-shm") || strings.HasSuffix(f.Name(), ".db-wal")) {
				os.Remove(filepath.Join(dataPath, f.Name()))
			}
		}
		os.RemoveAll(filepath.Join(dataPath, "snapshots"))

		slog.Warn("EMERGENCY WIPE EXECUTED. Vault destroyed.")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Vault Rekey Endpoint
	mux.HandleFunc("/api/vault/rekey", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			CurrentPassword string `json:"current_password"`
			NewPassword     string `json:"new_password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Malformed JSON payload", http.StatusBadRequest)
			return
		}

		vaultMutex.Lock()
		defer vaultMutex.Unlock()

		if systemDB == nil {
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}

		// Verify the user knows the current passphrase before allowing modification
		if !storage.VerifyPassword("canopy_system.db", req.CurrentPassword) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid current passphrase."})
			return
		}

		// Execute PRAGMA rekey to encrypt the database with the new key on the fly
		escapedKey := strings.ReplaceAll(req.NewPassword, "'", "''")

		// Fetch all workspace filenames
		var filenames []string
		rows, err := systemDB.DB().Query("SELECT filename FROM workspaces")
		if err == nil {
			for rows.Next() {
				var fn string
				if rows.Scan(&fn) == nil {
					filenames = append(filenames, fn)
				}
			}
			rows.Close()
		}

		var rekeyErr error

		// Temporarily unmount active DB to safely rekey all files sequentially
		if activeDB != nil {
			activeDB.Close()
			activeDB = nil
		}

		// Rekey all workspaces
		for _, fn := range filenames {
			spoke, err := storage.Initialize(fn, req.CurrentPassword)
			if err == nil {
				if _, err := spoke.DB().Exec(fmt.Sprintf("PRAGMA rekey = '%s';", escapedKey)); err != nil {
					rekeyErr = err
				}
				spoke.Close()
			}
		}

		// Rekey System Hub
		if _, err := systemDB.DB().Exec(fmt.Sprintf("PRAGMA rekey = '%s';", escapedKey)); err != nil {
			rekeyErr = err
		}

		// Rekey Telemetry DB
		if telemetryDB != nil {
			if _, err := telemetryDB.DB().Exec(fmt.Sprintf("PRAGMA rekey = '%s';", escapedKey)); err != nil {
				rekeyErr = err
			}
		}

		// --- AUTO-REKEY LOCAL SNAPSHOTS ---
		snapshotsDir := filepath.Join(os.Getenv("CANOPY_DATA_PATH"), "snapshots")
		if dirs, err := os.ReadDir(snapshotsDir); err == nil {
			for _, dir := range dirs {
				if dir.IsDir() {
					snapPath := filepath.Join(snapshotsDir, dir.Name())
					if files, err := os.ReadDir(snapPath); err == nil {
						for _, f := range files {
							if strings.HasSuffix(f.Name(), ".db") {
								dbRelPath := filepath.Join("snapshots", dir.Name(), f.Name())
								if spoke, err := storage.Initialize(dbRelPath, req.CurrentPassword); err == nil {
									spoke.DB().Exec(fmt.Sprintf("PRAGMA rekey = '%s';", escapedKey))
									spoke.DB().Exec("PRAGMA wal_checkpoint(TRUNCATE);")
									spoke.Close()
								}
							}
						}
					}
				}
			}
		}

		if rekeyErr != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to encrypt database with new passphrase."})
			return
		}

		logAuditSafe("Vault Rekeyed", "Security", "Passphrase was updated successfully.")

		masterKey = req.NewPassword

		// Remount a default workspace if available to keep the UI active
		if len(filenames) > 0 {
			activeDB, _ = storage.Initialize(filenames[0], masterKey)
		}

		slog.Info("Vault passphrase successfully updated via rekey operation.")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Vault Initialization Endpoint
	mux.HandleFunc("/api/init", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Malformed JSON payload", http.StatusBadRequest)
			return
		}

		vaultMutex.Lock()
		defer vaultMutex.Unlock()

		dbPath := filepath.Join(os.Getenv("CANOPY_DATA_PATH"), "canopy_system.db")
		if _, err := os.Stat(dbPath); err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "Vault already exists. Please unlock instead."})
			return
		}

		if systemDB != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]bool{"success": true})
			return
		}

		mountAndSeedVault(req.Password, w)
	})

	// Vault Unlock Endpoint
	mux.HandleFunc("/api/vault/unlock", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Malformed JSON payload", http.StatusBadRequest)
			return
		}

		vaultMutex.Lock()
		defer vaultMutex.Unlock()

		dbPath := filepath.Join(os.Getenv("CANOPY_DATA_PATH"), "canopy_system.db")
		if _, err := os.Stat(dbPath); os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Vault not initialized. Please set up a new vault."})
			return
		}

		if systemDB != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]bool{"success": true})
			return
		}

		mountAndSeedVault(req.Password, w)
	})

	// List Workspaces Endpoint
	mux.HandleFunc("/api/workspaces", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		vaultMutex.RLock()
		if systemDB == nil {
			vaultMutex.RUnlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := systemDB.DB()
		vaultMutex.RUnlock()

		rows, err := dbConn.Query("SELECT id, name, filename, COALESCE(color, ''), strftime('%Y-%m-%dT%H:%M:%SZ', created_at) FROM workspaces ORDER BY name ASC")
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to query workspaces."})
			return
		}
		defer rows.Close()

		results := make([]map[string]interface{}, 0)
		for rows.Next() {
			var id int
			var name, filename, color, createdAt string
			if err := rows.Scan(&id, &name, &filename, &color, &createdAt); err == nil {
				results = append(results, map[string]interface{}{
					"id": id, "name": name, "filename": filename, "color": color, "created_at": createdAt,
				})
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(results)
	})

	// Create Workspace Endpoint
	mux.HandleFunc("/api/workspaces/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			Name  string `json:"name"`
			Color string `json:"color"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Workspace name is required."})
			return
		}

		vaultMutex.Lock()
		if systemDB == nil || masterKey == "" {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		sysConn := systemDB.DB()
		key := masterKey
		vaultMutex.Unlock()

		filename := fmt.Sprintf("workspace_%d.db", time.Now().UnixNano())

		res, err := sysConn.Exec("INSERT INTO workspaces (name, filename, color) VALUES (?, ?, ?)", strings.TrimSpace(req.Name), filename, req.Color)
		if err != nil {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "A workspace with this name already exists."})
			return
		}
		id, _ := res.LastInsertId()

		// Temporarily mount the new spoke to generate the schema
		newSpoke, err := storage.Initialize(filename, key)
		if err != nil {
			sysConn.Exec("DELETE FROM workspaces WHERE id = ?", id)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to initialize workspace vault."})
			return
		}

		newSpoke.WriteLock()
		migrateWorkspaceDatabase(newSpoke.DB())
		if _, err := newSpoke.DB().Exec(actSchema); err != nil {
			slog.Error("Failed to initialize workspace schema on creation", slog.String("error", err.Error()))
		}
		newSpoke.DB().Exec(fmt.Sprintf("INSERT OR REPLACE INTO framework_metadata (app_id, schema_version) VALUES ('%s', 3)", AppBundleID))
		newSpoke.WriteUnlock()
		newSpoke.Close()

		logAuditSafe("Workspace Created", "System", "Provisioned new client workspace: "+req.Name)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":  true,
			"id":       id,
			"name":     req.Name,
			"filename": filename,
			"color":    req.Color,
		})
	})

	// Switch Workspace Endpoint
	mux.HandleFunc("/api/workspaces/switch", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			ID int `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid Workspace ID is required."})
			return
		}

		vaultMutex.Lock()
		defer vaultMutex.Unlock()

		if systemDB == nil || masterKey == "" {
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}

		var filename, name string
		err := systemDB.DB().QueryRow("SELECT name, filename FROM workspaces WHERE id = ?", req.ID).Scan(&name, &filename)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Workspace not found in registry."})
			return
		}

		if activeDB != nil {
			activeDB.Close()
			activeDB = nil
		}

		newSpoke, err := storage.Initialize(filename, masterKey)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to mount target workspace database."})
			return
		}

		newSpoke.WriteLock()
		migrateWorkspaceDatabase(newSpoke.DB())
		if _, err := newSpoke.DB().Exec(actSchema); err != nil {
			slog.Error("Failed to initialize workspace schema on switch", slog.String("error", err.Error()))
		}
		newSpoke.DB().Exec(fmt.Sprintf("INSERT OR REPLACE INTO framework_metadata (app_id, schema_version) VALUES ('%s', 3)", AppBundleID))
		newSpoke.WriteUnlock()

		activeDB = newSpoke
		logAuditSafe("Workspace Switched", "System", "Switched active workspace to: "+name)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":          true,
			"active_workspace": name,
		})
	})

	// Update Workspace Endpoint
	mux.HandleFunc("/api/workspaces/update", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			ID    int    `json:"id"`
			Name  string `json:"name"`
			Color string `json:"color"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 || strings.TrimSpace(req.Name) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID and Name are required."})
			return
		}

		vaultMutex.RLock()
		if systemDB == nil {
			vaultMutex.RUnlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := systemDB.DB()
		vaultMutex.RUnlock()

		if _, err := dbConn.Exec("UPDATE workspaces SET name = ?, color = ? WHERE id = ?", strings.TrimSpace(req.Name), req.Color, req.ID); err != nil {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update workspace. Name may already be in use."})
			return
		}

		logAuditSafe("Workspace Updated", "System", fmt.Sprintf("Updated workspace ID %d", req.ID))

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Export Workspace Endpoint
	mux.HandleFunc("/api/workspaces/export", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			ID              int    `json:"id"`
			ArchivePassword string `json:"archive_password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 || req.ArchivePassword == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid Workspace ID and Archive Passphrase are required."})
			return
		}

		vaultMutex.RLock()
		if systemDB == nil {
			vaultMutex.RUnlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := systemDB.DB()
		key := masterKey // Grab the master key while locked

		var filename, name string
		if err := dbConn.QueryRow("SELECT name, filename FROM workspaces WHERE id = ?", req.ID).Scan(&name, &filename); err != nil {
			vaultMutex.RUnlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Workspace not found in registry."})
			return
		}

		// Forcefully checkpoint the active database to ensure all WAL data is safely written to the .db file before copying
		if activeDB != nil {
			activeDB.DB().Exec("PRAGMA wal_checkpoint(TRUNCATE);")
		}
		vaultMutex.RUnlock()

		dbPath := filepath.Join(os.Getenv("CANOPY_DATA_PATH"), filename)
		dbPathToStream := dbPath

		// If the user wants to securely share this DB, copy it and rekey the copy on the fly
		if req.ArchivePassword != "" {
			tempFilename := fmt.Sprintf("export_%d.db", time.Now().UnixNano())
			tempPath := filepath.Join(os.Getenv("CANOPY_DATA_PATH"), tempFilename)

			srcFile, err := os.Open(dbPath)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": "Failed to read workspace file."})
				return
			}

			dstFile, err := os.Create(tempPath)
			if err != nil {
				srcFile.Close()
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create temporary export file."})
				return
			}

			io.Copy(dstFile, srcFile)
			dstFile.Close()
			srcFile.Close()

			tempSpoke, err := storage.Initialize(tempFilename, key)
			if err != nil {
				os.Remove(tempPath)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": "Failed to initialize temporary export vault."})
				return
			}

			escapedKey := strings.ReplaceAll(req.ArchivePassword, "'", "''")
			tempSpoke.DB().Exec(fmt.Sprintf("PRAGMA rekey = '%s';", escapedKey))
			tempSpoke.DB().Exec("PRAGMA wal_checkpoint(TRUNCATE);")
			tempSpoke.Close()

			dbPathToStream = tempPath

			// Ensure the unencrypted temporary files are always purged from the host
			defer func() {
				os.Remove(tempPath)
				os.Remove(tempPath + "-shm")
				os.Remove(tempPath + "-wal")
			}()
		}

		file, err := os.Open(dbPathToStream)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to read export file."})
			return
		}
		defer file.Close()

		timestamp := time.Now().Format("2006-01-02T15-04-05")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s_%s.db\"", strings.ReplaceAll(name, " ", "_"), timestamp))
		w.Header().Set("Content-Type", "application/octet-stream")
		io.Copy(w, file)

		logAuditSafe("Workspace Exported", "System", "Exported workspace: "+name)
	})

	// Import Workspace Endpoint
	mux.HandleFunc("/api/workspaces/import", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 500<<20) // 500 MB max payload size for robust databases
		if err := r.ParseMultipartForm(500 << 20); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Payload exceeds limits."})
			return
		}

		file, header, err := r.FormFile("database")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "No database file found in payload."})
			return
		}
		defer file.Close()

		workspaceName := r.FormValue("name")
		archivePassword := r.FormValue("archive_password")
		if strings.TrimSpace(workspaceName) == "" {
			workspaceName = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
		}

		if archivePassword == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "The passphrase used to encrypt this file is required."})
			return
		}

		vaultMutex.Lock()
		if systemDB == nil || masterKey == "" {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		sysConn := systemDB.DB()
		key := masterKey
		vaultMutex.Unlock()

		newFilename := fmt.Sprintf("workspace_%d.db", time.Now().UnixNano())
		targetPath := filepath.Join(os.Getenv("CANOPY_DATA_PATH"), newFilename)

		dstFile, err := os.Create(targetPath)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to write database file."})
			return
		}
		io.Copy(dstFile, file)
		dstFile.Close()

		// Security Gate: Verify it's a valid SQLite DB encrypted with the provided archive passphrase
		if !storage.VerifyPassword(newFilename, archivePassword) {
			os.Remove(targetPath)
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid database or incorrect archive passphrase."})
			return
		}

		// Success! Instantly re-encrypt this file to match the rest of the current system
		tempSpoke, err := storage.Initialize(newFilename, archivePassword)
		if err == nil {
			escapedKey := strings.ReplaceAll(key, "'", "''")
			tempSpoke.DB().Exec(fmt.Sprintf("PRAGMA rekey = '%s';", escapedKey))
			tempSpoke.DB().Exec("PRAGMA wal_checkpoint(TRUNCATE);")
			tempSpoke.Close()
			slog.Info("Imported workspace successfully rekeyed to match current passphrase.")
		} else {
			os.Remove(targetPath)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to rekey imported workspace."})
			return
		}

		if _, err := sysConn.Exec("INSERT INTO workspaces (name, filename) VALUES (?, ?)", strings.TrimSpace(workspaceName), newFilename); err != nil {
			os.Remove(targetPath)
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "A workspace with this name already exists."})
			return
		}

		logAuditSafe("Workspace Imported", "System", "Imported external workspace: "+workspaceName)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Delete Workspace Endpoint
	mux.HandleFunc("/api/workspaces/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			ID int `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid Workspace ID is required."})
			return
		}

		vaultMutex.RLock()
		if systemDB == nil {
			vaultMutex.RUnlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := systemDB.DB()
		vaultMutex.RUnlock()

		var filename, name string
		err := dbConn.QueryRow("SELECT name, filename FROM workspaces WHERE id = ?", req.ID).Scan(&name, &filename)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Workspace not found in registry."})
			return
		}

		vaultMutex.Lock()
		if systemDB != nil {
			systemDB.DB().Exec("DELETE FROM workspaces WHERE id = ?", req.ID)
		}
		vaultMutex.Unlock()

		dbPath := filepath.Join(os.Getenv("CANOPY_DATA_PATH"), filename)
		os.Remove(dbPath)
		os.Remove(dbPath + "-shm")
		os.Remove(dbPath + "-wal")

		logAuditSafe("Workspace Deleted", "System", "Permanently deleted workspace: "+name)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Secrets Vault: List
	mux.HandleFunc("/api/secrets", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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

		rows, err := dbConn.Query("SELECT id, name, COALESCE(description, ''), strftime('%Y-%m-%dT%H:%M:%SZ', created_at) FROM secrets_vault ORDER BY name ASC")
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to query secrets."})
			return
		}
		defer rows.Close()

		results := make([]map[string]interface{}, 0)
		for rows.Next() {
			var id int
			var name, desc, createdAt string
			if err := rows.Scan(&id, &name, &desc, &createdAt); err == nil {
				results = append(results, map[string]interface{}{
					"id": id, "name": name, "description": desc, "created_at": createdAt,
				})
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(results)
	})

	// Secrets Vault: Create
	mux.HandleFunc("/api/secrets/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			SecretValue string `json:"secret_value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.SecretValue) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Name and Secret Value are required."})
			return
		}

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		res, err := dbConn.Exec("INSERT INTO secrets_vault (name, description, secret_value) VALUES (?, ?, ?)", strings.TrimSpace(req.Name), strings.TrimSpace(req.Description), req.SecretValue)
		if err != nil {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "A secret with this name already exists."})
			return
		}

		id, _ := res.LastInsertId()
		logAuditSafe("Secret Created", "Security", "Added new credential to vault: "+req.Name)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": id})
	})

	// Secrets Vault: Update
	mux.HandleFunc("/api/secrets/update", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			ID          int    `json:"id"`
			Name        string `json:"name"`
			Description string `json:"description"`
			SecretValue string `json:"secret_value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 || strings.TrimSpace(req.Name) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID and Name are required."})
			return
		}

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		var err error
		if req.SecretValue != "" {
			_, err = dbConn.Exec("UPDATE secrets_vault SET name = ?, description = ?, secret_value = ? WHERE id = ?", strings.TrimSpace(req.Name), strings.TrimSpace(req.Description), req.SecretValue, req.ID)
		} else {
			_, err = dbConn.Exec("UPDATE secrets_vault SET name = ?, description = ? WHERE id = ?", strings.TrimSpace(req.Name), strings.TrimSpace(req.Description), req.ID)
		}

		if err != nil {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update secret. Name may already be in use."})
			return
		}

		logAuditSafe("Secret Updated", "Security", "Modified credential in vault: "+req.Name)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Secrets Vault: Delete
	mux.HandleFunc("/api/secrets/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			ID int `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid Secret ID is required."})
			return
		}

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		var name string
		dbConn.QueryRow("SELECT name FROM secrets_vault WHERE id = ?", req.ID).Scan(&name)

		if _, err := dbConn.Exec("DELETE FROM secrets_vault WHERE id = ?", req.ID); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete secret."})
			return
		}

		logAuditSafe("Secret Deleted", "Security", "Removed credential from vault: "+name)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Secrets Vault: Reveal
	mux.HandleFunc("/api/secrets/reveal", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			ID int `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid Secret ID is required."})
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

		var name, secretValue string
		err := dbConn.QueryRow("SELECT name, secret_value FROM secrets_vault WHERE id = ?", req.ID).Scan(&name, &secretValue)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Secret not found."})
			return
		}

		logAuditSafe("Secret Revealed", "Security", "Viewed plaintext credential for: "+name)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"secret_value": secretValue})
	})

	// --- DEVICE MANAGEMENT CRUD ENDPOINTS ---

	// Device Groups: Create
	mux.HandleFunc("/api/device-groups/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Name     string `json:"name"`
			ParentID *int   `json:"parent_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Name is required."})
			return
		}
		name := strings.TrimSpace(req.Name)
		uuid := "paloalto-dg-" + name

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		// Verify uniqueness
		var exists int
		err := dbConn.QueryRow("SELECT COUNT(*) FROM device_groups WHERE name = ? OR uuid = ?", name, uuid).Scan(&exists)
		if err == nil && exists > 0 {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "A device group with this name or UUID already exists."})
			return
		}

		// Resolve parent details
		var parentID interface{}
		parentUUID := "paloalto-dg-shared"

		if req.ParentID != nil && *req.ParentID > 0 {
			var pUUID string
			err := dbConn.QueryRow("SELECT uuid FROM device_groups WHERE id = ?", *req.ParentID).Scan(&pUUID)
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "Parent device group not found."})
				return
			}
			parentID = *req.ParentID
			parentUUID = pUUID
		} else {
			// Find shared parent ID
			var sharedID int
			err := dbConn.QueryRow("SELECT id FROM device_groups WHERE uuid = 'paloalto-dg-shared'").Scan(&sharedID)
			if err == nil {
				parentID = sharedID
			} else {
				parentID = nil
			}
		}

		tx, err := dbConn.Begin()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
			return
		}
		defer tx.Rollback()

		res, err := tx.Exec("INSERT INTO device_groups (device_uuid, uuid, name, parent_id) VALUES ('paloalto-panorama-global', ?, ?, ?)", uuid, name, parentID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to insert device group: " + err.Error()})
			return
		}
		dgID, _ := res.LastInsertId()

		_, err = tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'device-group', ?, ?, ?)", uuid, dgID, name+" (Device Group)", parentUUID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to register scope: " + err.Error()})
			return
		}

		if err := tx.Commit(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
			return
		}

		logAuditSafe("Device Group Created", "Network", "Added new device group: "+name)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": dgID, "uuid": uuid})
	})

	// Device Groups: Update
	mux.HandleFunc("/api/device-groups/update", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			ID       int    `json:"id"`
			Name     string `json:"name"`
			ParentID *int   `json:"parent_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 || strings.TrimSpace(req.Name) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID and Name are required."})
			return
		}
		name := strings.TrimSpace(req.Name)

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		// Get current group details
		var currentUUID, currentName string
		err := dbConn.QueryRow("SELECT uuid, name FROM device_groups WHERE id = ?", req.ID).Scan(&currentUUID, &currentName)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Device group not found."})
			return
		}

		// Check name collision
		if name != currentName {
			var collision int
			dbConn.QueryRow("SELECT COUNT(*) FROM device_groups WHERE name = ? AND id != ?", name, req.ID).Scan(&collision)
			if collision > 0 {
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{"error": "A device group with this name already exists."})
				return
			}
		}

		// Prevent circular dependency in parent hierarchy
		if req.ParentID != nil && *req.ParentID > 0 {
			if *req.ParentID == req.ID {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "A device group cannot be its own parent."})
				return
			}
			currParent := *req.ParentID
			for {
				var nextParent *int
				err := dbConn.QueryRow("SELECT parent_id FROM device_groups WHERE id = ?", currParent).Scan(&nextParent)
				if err != nil {
					break
				}
				if nextParent == nil {
					break
				}
				if *nextParent == req.ID {
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]string{"error": "Circular parent-child relationship detected."})
					return
				}
				currParent = *nextParent
			}
		}

		// Resolve new parent Details
		var parentID interface{}
		parentUUID := "paloalto-dg-shared"

		if req.ParentID != nil && *req.ParentID > 0 {
			var pUUID string
			err := dbConn.QueryRow("SELECT uuid FROM device_groups WHERE id = ?", *req.ParentID).Scan(&pUUID)
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "Parent group not found."})
				return
			}
			parentID = *req.ParentID
			parentUUID = pUUID
		} else {
			// Find shared parent ID
			var sharedID int
			err := dbConn.QueryRow("SELECT id FROM device_groups WHERE uuid = 'paloalto-dg-shared'").Scan(&sharedID)
			if err == nil {
				parentID = sharedID
			} else {
				parentID = nil
			}
		}

		tx, err := dbConn.Begin()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
			return
		}
		defer tx.Rollback()

		// Update device group name and parent
		_, err = tx.Exec("UPDATE device_groups SET name = ?, parent_id = ? WHERE id = ?", name, parentID, req.ID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update device group: " + err.Error()})
			return
		}

		// Update scopes name and parent_uuid
		_, err = tx.Exec("UPDATE scopes SET name = ?, parent_uuid = ? WHERE type = 'device-group' AND reference_id = ?", name+" (Device Group)", parentUUID, req.ID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update scope: " + err.Error()})
			return
		}

		if err := tx.Commit(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
			return
		}

		logAuditSafe("Device Group Updated", "Network", "Renamed or updated device group parent context: "+name)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Device Groups: Delete
	mux.HandleFunc("/api/device-groups/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			ID int `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID is required."})
			return
		}

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		// Get current group details
		var uuid, name string
		err := dbConn.QueryRow("SELECT uuid, name FROM device_groups WHERE id = ?", req.ID).Scan(&uuid, &name)
		if err != nil {
			// Idempotent success
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]bool{"success": true})
			return
		}

		if uuid == "paloalto-dg-shared" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Cannot delete the root 'shared' device group context."})
			return
		}

		tx, err := dbConn.Begin()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
			return
		}
		defer tx.Rollback()

		// Manually orphan child groups back to shared root rather than deleting them
		var sharedID int
		err = tx.QueryRow("SELECT id FROM device_groups WHERE uuid = 'paloalto-dg-shared'").Scan(&sharedID)
		if err == nil {
			tx.Exec("UPDATE device_groups SET parent_id = ? WHERE parent_id = ?", sharedID, req.ID)
			tx.Exec("UPDATE scopes SET parent_uuid = 'paloalto-dg-shared' WHERE parent_uuid = ?", uuid)
		} else {
			tx.Exec("UPDATE device_groups SET parent_id = NULL WHERE parent_id = ?", req.ID)
			tx.Exec("UPDATE scopes SET parent_uuid = NULL WHERE parent_uuid = ?", uuid)
		}

		// Delete the group context's scope (triggers SQLite cascading delete on objects/rules belonging to this group)
		_, err = tx.Exec("DELETE FROM scopes WHERE uuid = ?", uuid)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete scope hierarchy: " + err.Error()})
			return
		}

		// Delete from physical device groups
		_, err = tx.Exec("DELETE FROM device_groups WHERE id = ?", req.ID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete device group: " + err.Error()})
			return
		}

		if err := tx.Commit(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
			return
		}

		logAuditSafe("Device Group Deleted", "Network", "Removed device group: "+name)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Base Templates: Create
	mux.HandleFunc("/api/templates/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Name is required."})
			return
		}
		name := strings.TrimSpace(req.Name)
		uuid := "panorama-tmpl-" + name

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		// Verify uniqueness
		var exists int
		err := dbConn.QueryRow("SELECT COUNT(*) FROM templates WHERE name = ? OR uuid = ?", name, uuid).Scan(&exists)
		if err == nil && exists > 0 {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "A template with this name or UUID already exists."})
			return
		}

		tx, err := dbConn.Begin()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
			return
		}
		defer tx.Rollback()

		res, err := tx.Exec("INSERT INTO templates (device_uuid, uuid, name) VALUES ('paloalto-panorama-global', ?, ?)", uuid, name)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to insert template: " + err.Error()})
			return
		}
		tmplID, _ := res.LastInsertId()

		_, err = tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'template', ?, ?, NULL)", uuid, tmplID, name+" (Panorama)")
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to register scope: " + err.Error()})
			return
		}

		if err := tx.Commit(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
			return
		}

		logAuditSafe("Template Created", "Network", "Added base template: "+name)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": tmplID, "uuid": uuid})
	})

	// Base Templates: Update
	mux.HandleFunc("/api/templates/update", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 || strings.TrimSpace(req.Name) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID and Name are required."})
			return
		}
		name := strings.TrimSpace(req.Name)

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		// Verify exists
		var currentName string
		err := dbConn.QueryRow("SELECT name FROM templates WHERE id = ?", req.ID).Scan(&currentName)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Template not found."})
			return
		}

		if name != currentName {
			var collision int
			dbConn.QueryRow("SELECT COUNT(*) FROM templates WHERE name = ? AND id != ?", name, req.ID).Scan(&collision)
			if collision > 0 {
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{"error": "A template with this name already exists."})
				return
			}
		}

		tx, err := dbConn.Begin()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
			return
		}
		defer tx.Rollback()

		_, err = tx.Exec("UPDATE templates SET name = ? WHERE id = ?", name, req.ID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update template: " + err.Error()})
			return
		}

		_, err = tx.Exec("UPDATE scopes SET name = ? WHERE type = 'template' AND reference_id = ?", name+" (Panorama)", req.ID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update scope: " + err.Error()})
			return
		}

		if err := tx.Commit(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
			return
		}

		logAuditSafe("Template Updated", "Network", "Renamed template: "+name)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Base Templates: Delete
	mux.HandleFunc("/api/templates/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			ID int `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID is required."})
			return
		}

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		var uuid, name string
		err := dbConn.QueryRow("SELECT uuid, name FROM templates WHERE id = ?", req.ID).Scan(&uuid, &name)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]bool{"success": true})
			return
		}

		tx, err := dbConn.Begin()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
			return
		}
		defer tx.Rollback()

		_, err = tx.Exec("DELETE FROM scopes WHERE uuid = ?", uuid)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete template scope: " + err.Error()})
			return
		}

		_, err = tx.Exec("DELETE FROM templates WHERE id = ?", req.ID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete template: " + err.Error()})
			return
		}

		if err := tx.Commit(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
			return
		}

		logAuditSafe("Template Deleted", "Network", "Removed template: "+name)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Template Stacks: Create
	mux.HandleFunc("/api/template-stacks/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Name        string `json:"name"`
			TemplateIDs []int  `json:"template_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Name is required."})
			return
		}
		name := strings.TrimSpace(req.Name)
		uuid := "panorama-stack-" + name

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		// Verify uniqueness
		var exists int
		err := dbConn.QueryRow("SELECT COUNT(*) FROM template_stacks WHERE name = ? OR uuid = ?", name, uuid).Scan(&exists)
		if err == nil && exists > 0 {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "A template stack with this name or UUID already exists."})
			return
		}

		tx, err := dbConn.Begin()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
			return
		}
		defer tx.Rollback()

		res, err := tx.Exec("INSERT INTO template_stacks (device_uuid, uuid, name) VALUES ('paloalto-panorama-global', ?, ?)", uuid, name)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to insert template stack: " + err.Error()})
			return
		}
		stackID, _ := res.LastInsertId()

		_, err = tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'template-stack', ?, ?, NULL)", uuid, stackID, name+" (Template Stack)")
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to register scope: " + err.Error()})
			return
		}

		// Insert member sequence
		for seq, tmplID := range req.TemplateIDs {
			_, err = tx.Exec("INSERT INTO template_stack_members_raw (stack_id, template_id, sequence) VALUES (?, ?, ?)", stackID, tmplID, seq+1)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": "Failed to insert stack member template ID: " + err.Error()})
				return
			}
		}

		if err := tx.Commit(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
			return
		}

		logAuditSafe("Template Stack Created", "Network", "Created template stack: "+name)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": stackID, "uuid": uuid})
	})

	// Template Stacks: Update
	mux.HandleFunc("/api/template-stacks/update", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			ID          int    `json:"id"`
			Name        string `json:"name"`
			TemplateIDs []int  `json:"template_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 || strings.TrimSpace(req.Name) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID and Name are required."})
			return
		}
		name := strings.TrimSpace(req.Name)

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		// Verify exists
		var currentName string
		err := dbConn.QueryRow("SELECT name FROM template_stacks WHERE id = ?", req.ID).Scan(&currentName)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Template stack not found."})
			return
		}

		if name != currentName {
			var collision int
			dbConn.QueryRow("SELECT COUNT(*) FROM template_stacks WHERE name = ? AND id != ?", name, req.ID).Scan(&collision)
			if collision > 0 {
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{"error": "A template stack with this name already exists."})
				return
			}
		}

		tx, err := dbConn.Begin()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
			return
		}
		defer tx.Rollback()

		_, err = tx.Exec("UPDATE template_stacks SET name = ? WHERE id = ?", name, req.ID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update stack: " + err.Error()})
			return
		}

		_, err = tx.Exec("UPDATE scopes SET name = ? WHERE type = 'template-stack' AND reference_id = ?", name+" (Template Stack)", req.ID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update scope: " + err.Error()})
			return
		}

		// Rebuild stack members sequence
		_, err = tx.Exec("DELETE FROM template_stack_members_raw WHERE stack_id = ?", req.ID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to clean old stack members: " + err.Error()})
			return
		}

		for seq, tmplID := range req.TemplateIDs {
			_, err = tx.Exec("INSERT INTO template_stack_members_raw (stack_id, template_id, sequence) VALUES (?, ?, ?)", req.ID, tmplID, seq+1)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": "Failed to insert updated stack member: " + err.Error()})
				return
			}
		}

		if err := tx.Commit(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
			return
		}

		logAuditSafe("Template Stack Updated", "Network", "Updated template stack context: "+name)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Template Stacks: Delete
	mux.HandleFunc("/api/template-stacks/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			ID int `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID is required."})
			return
		}

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		var uuid, name string
		err := dbConn.QueryRow("SELECT uuid, name FROM template_stacks WHERE id = ?", req.ID).Scan(&uuid, &name)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]bool{"success": true})
			return
		}

		tx, err := dbConn.Begin()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
			return
		}
		defer tx.Rollback()

		_, err = tx.Exec("DELETE FROM scopes WHERE uuid = ?", uuid)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete stack scope: " + err.Error()})
			return
		}

		_, err = tx.Exec("DELETE FROM template_stacks WHERE id = ?", req.ID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete stack: " + err.Error()})
			return
		}

		if err := tx.Commit(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
			return
		}

		logAuditSafe("Template Stack Deleted", "Network", "Removed template stack: "+name)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Devices: Create
	mux.HandleFunc("/api/devices/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Name            string `json:"name"`
			Serial          string `json:"serial"`
			IPAddress       string `json:"ip_address"`
			DeviceGroupID   *int   `json:"device_group_id"`
			TemplateStackID *int   `json:"template_stack_id"`
			TemplateID      *int   `json:"template_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.Serial) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Name and Serial Number are required."})
			return
		}
		name := strings.TrimSpace(req.Name)
		serial := strings.TrimSpace(req.Serial)
		ipAddress := strings.TrimSpace(req.IPAddress)

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		// Verify uniqueness of serial
		var exists int
		err := dbConn.QueryRow("SELECT COUNT(*) FROM managed_devices_raw WHERE serial = ?", serial).Scan(&exists)
		if err == nil && exists > 0 {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "A device with this serial number is already registered."})
			return
		}

		// Determine parent scope UUID
		var parentScopeUUID interface{}
		if req.DeviceGroupID != nil && *req.DeviceGroupID > 0 {
			var dgUUID string
			err = dbConn.QueryRow("SELECT uuid FROM device_groups WHERE id = ?", *req.DeviceGroupID).Scan(&dgUUID)
			if err == nil {
				parentScopeUUID = dgUUID
			}
		} else if req.TemplateStackID != nil && *req.TemplateStackID > 0 {
			var stackUUID string
			err = dbConn.QueryRow("SELECT uuid FROM template_stacks WHERE id = ?", *req.TemplateStackID).Scan(&stackUUID)
			if err == nil {
				parentScopeUUID = stackUUID
			}
		} else if req.TemplateID != nil && *req.TemplateID > 0 {
			var tmplUUID string
			err = dbConn.QueryRow("SELECT uuid FROM templates WHERE id = ?", *req.TemplateID).Scan(&tmplUUID)
			if err == nil {
				parentScopeUUID = tmplUUID
			}
		}

		deviceUUID := "paloalto-fw-" + name + "-" + serial

		tx, err := dbConn.Begin()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
			return
		}
		defer tx.Rollback()

		// Insert into scopes first (to satisfy managed_devices_raw FK constraint on device_uuid)
		// We insert with reference_id = NULL first, and update it to the ID after insertion.
		_, err = tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'firewall', NULL, ?, ?)", deviceUUID, name, parentScopeUUID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create scope context: " + err.Error()})
			return
		}

		res, err := tx.Exec(`
			INSERT INTO managed_devices_raw (device_uuid, serial, name, ip_address, device_group_id, template_stack_id, template_id)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, deviceUUID, serial, name, ipAddress, req.DeviceGroupID, req.TemplateStackID, req.TemplateID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to insert device record: " + err.Error()})
			return
		}
		mdevID, _ := res.LastInsertId()

		// Update reference_id in scopes
		_, err = tx.Exec("UPDATE scopes SET reference_id = ? WHERE uuid = ?", mdevID, deviceUUID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update scope reference: " + err.Error()})
			return
		}

		if err := tx.Commit(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
			return
		}

		logAuditSafe("Device Created", "Network", "Registered managed device: "+name+" (S/N: "+serial+")")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": mdevID, "uuid": deviceUUID})
	})

	// Devices: Update
	mux.HandleFunc("/api/devices/update", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			ID              int    `json:"id"`
			Name            string `json:"name"`
			Serial          string `json:"serial"`
			IPAddress       string `json:"ip_address"`
			DeviceGroupID   *int   `json:"device_group_id"`
			TemplateStackID *int   `json:"template_stack_id"`
			TemplateID      *int   `json:"template_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 || strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.Serial) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID, Name and Serial Number are required."})
			return
		}
		name := strings.TrimSpace(req.Name)
		serial := strings.TrimSpace(req.Serial)
		ipAddress := strings.TrimSpace(req.IPAddress)

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		// Verify exists and check serial uniqueness
		var oldSerial, oldDeviceUUID string
		err := dbConn.QueryRow("SELECT serial, device_uuid FROM managed_devices_raw WHERE id = ?", req.ID).Scan(&oldSerial, &oldDeviceUUID)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Device not found."})
			return
		}

		if serial != oldSerial {
			var collision int
			dbConn.QueryRow("SELECT COUNT(*) FROM managed_devices_raw WHERE serial = ? AND id != ?", serial, req.ID).Scan(&collision)
			if collision > 0 {
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{"error": "A device with this serial number is already registered."})
				return
			}
		}

		// Determine parent scope UUID
		var parentScopeUUID interface{}
		if req.DeviceGroupID != nil && *req.DeviceGroupID > 0 {
			var dgUUID string
			err = dbConn.QueryRow("SELECT uuid FROM device_groups WHERE id = ?", *req.DeviceGroupID).Scan(&dgUUID)
			if err == nil {
				parentScopeUUID = dgUUID
			}
		} else if req.TemplateStackID != nil && *req.TemplateStackID > 0 {
			var stackUUID string
			err = dbConn.QueryRow("SELECT uuid FROM template_stacks WHERE id = ?", *req.TemplateStackID).Scan(&stackUUID)
			if err == nil {
				parentScopeUUID = stackUUID
			}
		} else if req.TemplateID != nil && *req.TemplateID > 0 {
			var tmplUUID string
			err = dbConn.QueryRow("SELECT uuid FROM templates WHERE id = ?", *req.TemplateID).Scan(&tmplUUID)
			if err == nil {
				parentScopeUUID = tmplUUID
			}
		}

		ctx := r.Context()
		conn, err := dbConn.Conn(ctx)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to acquire database connection: " + err.Error()})
			return
		}
		defer conn.Close()

		// Temporarily disable foreign keys for this connection
		if _, err := conn.ExecContext(ctx, "PRAGMA foreign_keys = OFF;"); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to disable foreign keys: " + err.Error()})
			return
		}
		// Ensure we restore foreign keys when the connection returns to the pool
		defer conn.ExecContext(ctx, "PRAGMA foreign_keys = ON;")

		tx, err := conn.BeginTx(ctx, nil)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction: " + err.Error()})
			return
		}
		defer tx.Rollback()

		// If the name or serial changed, we can update the scope's UUID to reflect the new name & serial
		newDeviceUUID := "paloalto-fw-" + name + "-" + serial

		// Update managed_devices_raw
		_, err = tx.ExecContext(ctx, `
			UPDATE managed_devices_raw 
			SET device_uuid = ?, serial = ?, name = ?, ip_address = ?, device_group_id = ?, template_stack_id = ?, template_id = ?
			WHERE id = ?
		`, newDeviceUUID, serial, name, ipAddress, req.DeviceGroupID, req.TemplateStackID, req.TemplateID, req.ID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update device record: " + err.Error()})
			return
		}

		// Since scopes.uuid is UNIQUE and reference_id links them, update both UUID, name, and parent_uuid
		_, err = tx.ExecContext(ctx, `
			UPDATE scopes 
			SET uuid = ?, name = ?, parent_uuid = ?
			WHERE type = 'firewall' AND reference_id = ?
		`, newDeviceUUID, name, parentScopeUUID, req.ID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update scope context: " + err.Error()})
			return
		}

		// Cascade device_uuid update to all referencing tables
		referencingTables := []string{
			"device_groups", "templates", "template_stacks", "network_topology",
			"address_objects", "address_groups", "service_objects", "service_groups",
			"application_objects", "regions", "schedules", "tags",
			"security_profiles", "security_rules", "nat_rules", "qos_rules",
			"pbf_rules", "decryption_rules", "application_override_rules",
			"tunnel_inspection_rules", "static_routes",
		}
		for _, table := range referencingTables {
			_, err = tx.ExecContext(ctx, fmt.Sprintf("UPDATE %s SET device_uuid = ? WHERE device_uuid = ?", table), newDeviceUUID, oldDeviceUUID)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("Failed to cascade device UUID update to %s: %s", table, err.Error())})
				return
			}
		}

		if err := tx.Commit(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed: " + err.Error()})
			return
		}

		logAuditSafe("Device Updated", "Network", "Updated managed device: "+name+" (S/N: "+serial+")")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// Devices: Delete
	mux.HandleFunc("/api/devices/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			ID int `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID is required."})
			return
		}

		vaultMutex.Lock()
		if activeDB == nil {
			vaultMutex.Unlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB.DB()
		vaultMutex.Unlock()

		var deviceUUID, name string
		err := dbConn.QueryRow("SELECT device_uuid, name FROM managed_devices_raw WHERE id = ?", req.ID).Scan(&deviceUUID, &name)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]bool{"success": true})
			return
		}

		tx, err := dbConn.Begin()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
			return
		}
		defer tx.Rollback()

		// Delete scope first (deletes any child interfaces, static routes, zones, rules etc.)
		_, err = tx.Exec("DELETE FROM scopes WHERE uuid = ?", deviceUUID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete device scope: " + err.Error()})
			return
		}

		// Delete firewall raw record
		_, err = tx.Exec("DELETE FROM managed_devices_raw WHERE id = ?", req.ID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete device record: " + err.Error()})
			return
		}

		if err := tx.Commit(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
			return
		}

		logAuditSafe("Device Deleted", "Network", "Removed managed device: "+name)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

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

	// Database Troubleshooting Endpoint (Read-Only)
	mux.HandleFunc("/api/db/query", func(w http.ResponseWriter, r *http.Request) {
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
	mux.HandleFunc("/api/system/loglevel", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"level": programLevel.Level().String()})
			return
		}
		if r.Method == http.MethodPost {
			var req struct {
				Level string `json:"level"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Malformed JSON payload", http.StatusBadRequest)
				return
			}
			switch strings.ToUpper(req.Level) {
			case "DEBUG":
				programLevel.Set(slog.LevelDebug)
			case "WARN":
				programLevel.Set(slog.LevelWarn)
			case "ERROR":
				programLevel.Set(slog.LevelError)
			default:
				programLevel.Set(slog.LevelInfo)
			}

			switch programLevel.Level() {
			case slog.LevelDebug:
				slog.Debug("Log level dynamically updated", slog.String("new_level", "DEBUG"))
			case slog.LevelWarn:
				slog.Warn("Log level dynamically updated", slog.String("new_level", "WARN"))
			case slog.LevelError:
				slog.Error("Log level dynamically updated", slog.String("new_level", "ERROR"))
			default:
				slog.Info("Log level dynamically updated", slog.String("new_level", "INFO"))
			}

			logAuditSafe("Log Level Changed", "System", "Background daemon verbosity changed to "+programLevel.Level().String())

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"level": programLevel.Level().String()})
			return
		}
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	})

	// System Snapshots: List
	mux.HandleFunc("/api/system/snapshots", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		vaultMutex.RLock()
		if systemDB == nil {
			vaultMutex.RUnlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		vaultMutex.RUnlock()

		dataPath := os.Getenv("CANOPY_DATA_PATH")
		snapshotsDir := filepath.Join(dataPath, "snapshots")
		results := make([]map[string]interface{}, 0)

		if dirs, err := os.ReadDir(snapshotsDir); err == nil {
			for _, dir := range dirs {
				if dir.IsDir() {
					var totalSize int64
					var description string
					snapPath := filepath.Join(snapshotsDir, dir.Name())

					if files, err := os.ReadDir(snapPath); err == nil {
						for _, f := range files {
							if i, err := f.Info(); err == nil {
								totalSize += i.Size()
							}
						}
					}

					metaPath := filepath.Join(snapPath, "metadata.json")
					if metaBytes, err := os.ReadFile(metaPath); err == nil {
						var meta struct {
							Description string `json:"description"`
						}
						if json.Unmarshal(metaBytes, &meta) == nil {
							description = meta.Description
						}
					}

					results = append(results, map[string]interface{}{
						"id":          dir.Name(),
						"size_bytes":  totalSize,
						"description": description,
					})
				}
			}
		}

		// Sort descending so newest is at the top
		for i := 0; i < len(results)-1; i++ {
			for j := i + 1; j < len(results); j++ {
				if results[i]["id"].(string) < results[j]["id"].(string) {
					results[i], results[j] = results[j], results[i]
				}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(results)
	})

	// System Snapshots: Create
	mux.HandleFunc("/api/system/snapshots/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			Description string `json:"description"`
		}
		if r.Body != nil {
			json.NewDecoder(r.Body).Decode(&req)
		}

		vaultMutex.RLock()
		if systemDB == nil {
			vaultMutex.RUnlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}

		// Determine exactly which files to backup (System Hub + Registered Spokes only)
		var filesToBackup []string
		filesToBackup = append(filesToBackup, "canopy_system.db")

		rows, err := systemDB.DB().Query("SELECT filename FROM workspaces")
		if err == nil {
			for rows.Next() {
				var fn string
				if err := rows.Scan(&fn); err == nil {
					filesToBackup = append(filesToBackup, fn)
				}
			}
			rows.Close()
		}

		// Reset dirty flags on objects on configuration commit (snapshot creation)
		if activeDB != nil {
			activeDB.DB().Exec("UPDATE address_objects SET dirty = 0;")
			activeDB.DB().Exec("UPDATE address_groups SET dirty = 0;")
			activeDB.DB().Exec("UPDATE service_objects SET dirty = 0;")
			activeDB.DB().Exec("UPDATE service_groups SET dirty = 0;")
			activeDB.DB().Exec("UPDATE application_objects SET dirty = 0;")
			activeDB.DB().Exec("UPDATE application_groups SET dirty = 0;")
		}

		// Force WAL checkpoints to guarantee all state is flushed to the .db files before copying
		systemDB.DB().Exec("PRAGMA wal_checkpoint(TRUNCATE);")
		if activeDB != nil {
			activeDB.DB().Exec("PRAGMA wal_checkpoint(TRUNCATE);")
		}
		vaultMutex.RUnlock()

		dataPath := os.Getenv("CANOPY_DATA_PATH")
		timestamp := fmt.Sprintf("%d", time.Now().UnixMilli())
		snapDir := filepath.Join(dataPath, "snapshots", timestamp)
		os.MkdirAll(snapDir, os.ModePerm)

		for _, filename := range filesToBackup {
			srcPath := filepath.Join(dataPath, filename)
			dstPath := filepath.Join(snapDir, filename)

			srcFile, err := os.Open(srcPath)
			if err == nil {
				dstFile, _ := os.Create(dstPath)
				io.Copy(dstFile, srcFile)
				srcFile.Close()
				dstFile.Close()
			}
		}

		metaPath := filepath.Join(snapDir, "metadata.json")
		metaData, _ := json.Marshal(map[string]string{"description": req.Description})
		os.WriteFile(metaPath, metaData, 0644)

		logAuditSafe("Snapshot Created", "System", "Created local system snapshot: "+timestamp)
		slog.Info("System snapshot captured", slog.String("id", timestamp))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// System Snapshots: Update
	mux.HandleFunc("/api/system/snapshots/update", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			ID          string `json:"id"`
			Description string `json:"description"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" || strings.Contains(req.ID, "..") || strings.Contains(req.ID, "/") {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid Snapshot ID is required."})
			return
		}

		dataPath := os.Getenv("CANOPY_DATA_PATH")
		snapDir := filepath.Join(dataPath, "snapshots", req.ID)

		if _, err := os.Stat(snapDir); os.IsNotExist(err) {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Snapshot not found."})
			return
		}

		metaPath := filepath.Join(snapDir, "metadata.json")
		metaData, _ := json.Marshal(map[string]string{"description": req.Description})
		os.WriteFile(metaPath, metaData, 0644)

		logAuditSafe("Snapshot Updated", "System", "Updated description for snapshot: "+req.ID)
		slog.Info("System snapshot updated", slog.String("id", req.ID))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// System Snapshots: Delete
	mux.HandleFunc("/api/system/snapshots/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" || strings.Contains(req.ID, "..") || strings.Contains(req.ID, "/") {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid Snapshot ID is required."})
			return
		}

		dataPath := os.Getenv("CANOPY_DATA_PATH")
		os.RemoveAll(filepath.Join(dataPath, "snapshots", req.ID))

		logAuditSafe("Snapshot Deleted", "System", "Deleted local system snapshot: "+req.ID)
		slog.Info("System snapshot deleted", slog.String("id", req.ID))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// System Snapshots: Local Revert
	mux.HandleFunc("/api/system/snapshots/revert", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" || strings.Contains(req.ID, "..") || strings.Contains(req.ID, "/") {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Valid Snapshot ID is required."})
			return
		}

		dataPath := os.Getenv("CANOPY_DATA_PATH")
		snapDir := filepath.Join(dataPath, "snapshots", req.ID)

		if _, err := os.Stat(filepath.Join(snapDir, "canopy_system.db")); os.IsNotExist(err) {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Snapshot is corrupted or missing canopy_system.db."})
			return
		}

		vaultMutex.Lock()
		defer vaultMutex.Unlock()

		if systemDB != nil {
			systemDB.Close()
			systemDB = nil
		}
		if activeDB != nil {
			activeDB.Close()
			activeDB = nil
		}
		if telemetryDB != nil {
			telemetryDB.DB().Exec("INSERT INTO audit_logs (action, module, details) VALUES (?, ?, ?)", "System Reverted", "System", "Reverted to local system snapshot: "+req.ID)
			telemetryDB.DB().Exec("PRAGMA wal_checkpoint(TRUNCATE);")
			telemetryDB.Close()
			telemetryDB = nil
		}
		masterKey = ""

		files, _ := os.ReadDir(dataPath)
		for _, f := range files {
			if !f.IsDir() && (strings.HasSuffix(f.Name(), ".db") || strings.HasSuffix(f.Name(), ".db-wal") || strings.HasSuffix(f.Name(), ".db-shm")) {
				if !strings.HasPrefix(f.Name(), "canopy_telemetry.db") {
					os.Remove(filepath.Join(dataPath, f.Name()))
				}
			}
		}

		snapFiles, _ := os.ReadDir(snapDir)
		for _, f := range snapFiles {
			if !f.IsDir() && strings.HasSuffix(f.Name(), ".db") {
				// SECURITY GUARDRAIL: Never allow legacy telemetry databases to overwrite the live instance
				if strings.HasPrefix(f.Name(), "canopy_telemetry.db") {
					continue
				}
				srcPath := filepath.Join(snapDir, f.Name())
				dstPath := filepath.Join(dataPath, f.Name())
				if srcFile, err := os.Open(srcPath); err == nil {
					if dstFile, err := os.Create(dstPath); err == nil {
						io.Copy(dstFile, srcFile)
						dstFile.Close()
					}
					srcFile.Close()
				}
			}
		}

		slog.Warn("SYSTEM REVERTED TO LOCAL SNAPSHOT", slog.String("id", req.ID))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// System Snapshots: External Export
	mux.HandleFunc("/api/system/snapshots/export", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			ID              string `json:"id"`
			ArchivePassword string `json:"archive_password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" || req.ArchivePassword == "" || strings.Contains(req.ID, "..") {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Snapshot ID and Archive Passphrase are required."})
			return
		}

		vaultMutex.RLock()
		if systemDB == nil {
			vaultMutex.RUnlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		currentKey := masterKey
		vaultMutex.RUnlock()

		dataPath := os.Getenv("CANOPY_DATA_PATH")
		snapDir := filepath.Join(dataPath, "snapshots", req.ID)
		tempDirName := fmt.Sprintf("temp_export_%d", time.Now().UnixNano())
		tempDirPath := filepath.Join(dataPath, tempDirName)
		os.MkdirAll(tempDirPath, os.ModePerm)
		defer os.RemoveAll(tempDirPath)

		files, err := os.ReadDir(snapDir)
		if err == nil {
			for _, f := range files {
				if !f.IsDir() && strings.HasSuffix(f.Name(), ".db") {
					// SECURITY GUARDRAIL: Never allow telemetry to be exported into external archives
					if strings.HasPrefix(f.Name(), "canopy_telemetry.db") {
						continue
					}
					srcPath := filepath.Join(snapDir, f.Name())
					dstPath := filepath.Join(tempDirPath, f.Name())

					if srcFile, err := os.Open(srcPath); err == nil {
						if dstFile, err := os.Create(dstPath); err == nil {
							io.Copy(dstFile, srcFile)
							dstFile.Close()
						}
						srcFile.Close()

						dbRelPath := filepath.Join(tempDirName, f.Name())
						if spoke, err := storage.Initialize(dbRelPath, currentKey); err == nil {
							escapedKey := strings.ReplaceAll(req.ArchivePassword, "'", "''")
							spoke.DB().Exec(fmt.Sprintf("PRAGMA rekey = '%s';", escapedKey))
							spoke.DB().Exec("PRAGMA wal_checkpoint(TRUNCATE);")
							spoke.Close()
						}
					}
				}
			}
		}

		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"canopy_system_snapshot_%s.cbak\"", req.ID))
		w.Header().Set("Content-Type", "application/octet-stream")

		zipWriter := zip.NewWriter(w)
		defer zipWriter.Close()

		if rekeyedFiles, err := os.ReadDir(tempDirPath); err == nil {
			for _, f := range rekeyedFiles {
				if !f.IsDir() && strings.HasSuffix(f.Name(), ".db") {
					if info, err := f.Info(); err == nil {
						if file, err := os.Open(filepath.Join(tempDirPath, f.Name())); err == nil {
							header, _ := zip.FileInfoHeader(info)
							header.Name = f.Name()
							header.Method = zip.Deflate
							writer, _ := zipWriter.CreateHeader(header)
							io.Copy(writer, file)
							file.Close()
						}
					}
				}
			}
		}

		logAuditSafe("Snapshot Exported", "System", "Exported snapshot to .cbak: "+req.ID)
		slog.Info("System snapshot exported", slog.String("id", req.ID))
	})

	// System Snapshots: Import External Archive
	mux.HandleFunc("/api/system/snapshots/import", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 500<<20)
		if err := r.ParseMultipartForm(500 << 20); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Payload exceeds limits."})
			return
		}

		file, header, err := r.FormFile("backup")
		if err != nil || !strings.HasSuffix(header.Filename, ".cbak") {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "A valid .cbak archive file is required."})
			return
		}
		defer file.Close()

		archivePassword := r.FormValue("archive_password")
		if archivePassword == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "The archive passphrase is required."})
			return
		}

		buf, err := io.ReadAll(file)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to read backup payload."})
			return
		}

		zipReader, err := zip.NewReader(bytes.NewReader(buf), int64(len(buf)))
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to parse .cbak archive."})
			return
		}

		vaultMutex.RLock()
		if systemDB == nil {
			vaultMutex.RUnlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		currentKey := masterKey
		vaultMutex.RUnlock()

		dataPath := os.Getenv("CANOPY_DATA_PATH")
		tempRestorePath := filepath.Join(dataPath, fmt.Sprintf("temp_restore_%d", time.Now().UnixNano()))
		os.RemoveAll(tempRestorePath)
		os.MkdirAll(tempRestorePath, os.ModePerm)
		defer os.RemoveAll(tempRestorePath)

		var hasSystemDB bool
		for _, zf := range zipReader.File {
			if strings.Contains(zf.Name, "..") {
				continue
			}
			if zf.FileInfo().IsDir() {
				continue
			}
			if zf.Name == "canopy_system.db" {
				hasSystemDB = true
			}

			// SECURITY GUARDRAIL: Actively strip contaminated telemetry files from incoming archives
			if strings.HasPrefix(zf.Name, "canopy_telemetry.db") {
				continue
			}

			targetPath := filepath.Join(tempRestorePath, zf.Name)
			dstFile, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, zf.Mode())
			if err == nil {
				srcFile, _ := zf.Open()
				io.Copy(dstFile, srcFile)
				srcFile.Close()
				dstFile.Close()
			}
		}

		if !hasSystemDB {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Archive is invalid. Missing canopy_system.db."})
			return
		}

		// Security Gate: Verify the password against the extracted system DB
		testFilename := fmt.Sprintf("canopy_system_restore_test_%d.db", time.Now().UnixNano())
		testPathMoved := filepath.Join(dataPath, testFilename)
		testPathTemp := filepath.Join(tempRestorePath, "canopy_system.db")
		os.Rename(testPathTemp, testPathMoved)

		if !storage.VerifyPassword(testFilename, archivePassword) {
			os.Remove(testPathMoved)
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid archive passphrase."})
			return
		}

		// Move it back into the temp folder
		os.Rename(testPathMoved, testPathTemp)

		// Create snapshot directory
		timestamp := fmt.Sprintf("%d", time.Now().UnixMilli())
		snapDir := filepath.Join(dataPath, "snapshots", timestamp)
		os.MkdirAll(snapDir, os.ModePerm)

		restoreFiles, _ := os.ReadDir(tempRestorePath)
		for _, f := range restoreFiles {
			if !f.IsDir() && strings.HasSuffix(f.Name(), ".db") {
				srcPath := filepath.Join(tempRestorePath, f.Name())
				dstPath := filepath.Join(snapDir, f.Name())
				os.Rename(srcPath, dstPath)

				// Instantly rekey the imported database to match the current master key
				dbRelPath := filepath.Join("snapshots", timestamp, f.Name())
				if spoke, err := storage.Initialize(dbRelPath, archivePassword); err == nil {
					escapedKey := strings.ReplaceAll(currentKey, "'", "''")
					spoke.DB().Exec(fmt.Sprintf("PRAGMA rekey = '%s';", escapedKey))
					spoke.DB().Exec("PRAGMA wal_checkpoint(TRUNCATE);")
					spoke.Close()
				}
			}
		}

		// Embed the description tag
		description := "Imported from " + header.Filename
		metaPath := filepath.Join(snapDir, "metadata.json")
		metaData, _ := json.Marshal(map[string]string{"description": description})
		os.WriteFile(metaPath, metaData, 0644)

		logAuditSafe("Snapshot Imported", "System", "Imported and rekeyed external snapshot: "+timestamp)
		slog.Info("External snapshot imported", slog.String("id", timestamp))

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	// System Patching Ingestion Endpoint
	mux.HandleFunc("/api/system/patch", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Restrict patch payloads to 50MB max in memory to prevent daemon exhaustion
		r.Body = http.MaxBytesReader(w, r.Body, 50<<20)
		if err := r.ParseMultipartForm(50 << 20); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Patch payload exceeds memory limits or is malformed."})
			return
		}

		file, header, err := r.FormFile("patch")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "No patch file found in upload payload."})
			return
		}
		defer file.Close()

		if !strings.HasSuffix(header.Filename, ".cpatch") {
			w.WriteHeader(http.StatusUnsupportedMediaType)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid patch format. Expected a .cpatch payload archive."})
			return
		}

		// Extract the uploaded zip archive into memory
		buf, err := io.ReadAll(file)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to read patch payload into memory."})
			return
		}

		// Resolve the absolute path to the workspace root directory to apply updates across the entire stack
		basePath, err := filepath.Abs(".")
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to resolve UI directory path."})
			return
		}

		// --- AUTO-ROLLBACK BACKUP ---
		backupPath := filepath.Join(basePath, "backups", "auto-rollback.cpatch")
		slog.Info("Creating auto-rollback patch before applying updates...", slog.String("backup", backupPath))
		if err := createRollbackPatch(basePath, backupPath); err != nil {
			slog.Error("Failed to create rollback patch", slog.String("error", err.Error()))
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("Failed to safely backup workspace before patching: %v", err)})
			return
		}

		filesPatched, err := applyPatchPayload(buf, basePath)
		if err != nil {
			slog.Error("Patch extraction failed! Triggering emergency rollback.", slog.String("error", err.Error()))

			// Zero-Space Auto-Recovery: Restore the .old artifacts directly on the file system
			recoverFromOldFiles(basePath)

			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Patch application failed (e.g., out of disk space). The system automatically rolled back to its previous state."})
			return
		}

		slog.Info("System patch payload received and extracted", slog.String("filename", header.Filename), slog.Int64("size", header.Size))

		logAuditSafe("System Patch Applied", "Maintenance", "Patch payload extracted: "+header.Filename)

		// Simulate successful ingestion response
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"message":          "System patch validated and applied successfully.",
			"requires_restart": true,
			"files_patched":    filesPatched,
			"backup_created":   true,
		})
	})

	// System Patch Pre-flight Inspection Endpoint
	mux.HandleFunc("/api/system/patch/inspect", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 50<<20)
		if err := r.ParseMultipartForm(50 << 20); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Patch payload exceeds memory limits."})
			return
		}

		file, header, err := r.FormFile("patch")
		if err != nil || !strings.HasSuffix(header.Filename, ".cpatch") {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid or missing .cpatch payload."})
			return
		}
		defer file.Close()

		buf, err := io.ReadAll(file)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		zipReader, err := zip.NewReader(bytes.NewReader(buf), int64(len(buf)))
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to parse .cpatch archive."})
			return
		}

		var files []string
		for _, zf := range zipReader.File {
			if cleanPath := normalizeZipPath(zf.Name); cleanPath != "" && !zf.FileInfo().IsDir() {
				files = append(files, cleanPath)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{"files": files})
	})

	// Device Configuration XML Import Endpoint
	mux.HandleFunc("/api/devices/import", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		vaultMutex.RLock()
		if activeDB == nil {
			vaultMutex.RUnlock()
			w.WriteHeader(http.StatusLocked)
			json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
			return
		}
		dbConn := activeDB
		vaultMutex.RUnlock()

		file, header, err := r.FormFile("xml")
		if err != nil {
			// fallback to form field "file"
			file, header, err = r.FormFile("file")
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "No file found in payload."})
				return
			}
		}
		defer file.Close()

		fileBytes, err := io.ReadAll(file)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to read uploaded file."})
			return
		}

		type xmlFile struct {
			Name string
			Data []byte
		}
		var xmlFiles []xmlFile
		// Sniff gzip magic bytes: 0x1f 0x8b
		isGzip := len(fileBytes) >= 2 && fileBytes[0] == 0x1f && fileBytes[1] == 0x8b

		if isGzip {
			gzipReader, err := gzip.NewReader(bytes.NewReader(fileBytes))
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "Failed to initialize gzip decompressor: " + err.Error()})
				return
			}
			defer gzipReader.Close()

			tarReader := tar.NewReader(gzipReader)
			for {
				tarHeader, err := tarReader.Next()
				if err == io.EOF {
					break
				}
				if err != nil {
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]string{"error": "Failed to read tar archive: " + err.Error()})
					return
				}

				if !tarHeader.FileInfo().IsDir() && strings.HasSuffix(strings.ToLower(tarHeader.Name), ".xml") {
					data, err := io.ReadAll(tarReader)
					if err != nil {
						w.WriteHeader(http.StatusInternalServerError)
						json.NewEncoder(w).Encode(map[string]string{"error": "Failed to read XML file from tar archive: " + err.Error()})
						return
					}
					xmlFiles = append(xmlFiles, xmlFile{
						Name: tarHeader.Name,
						Data: data,
					})
					slog.Info("Extracted config file from archive bundle", slog.String("filename", tarHeader.Name))
				}
			}

			if len(xmlFiles) == 0 {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]string{"error": "No XML configuration files found inside the tar bundle."})
				return
			}
		} else {
			var filename string
			if header != nil {
				filename = header.Filename
			} else {
				filename = "uploaded_config.xml"
			}
			xmlFiles = append(xmlFiles, xmlFile{
				Name: filename,
				Data: fileBytes,
			})
		}

		concreteDB, ok := dbConn.(*storage.AppStateDB)
		if !ok {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Internal database connection type mismatch."})
			return
		}

		adapter := paloalto.NewAdapter(concreteDB)

		// Sort xmlFiles so that Panorama configurations are processed first
		sort.SliceStable(xmlFiles, func(i, j int) bool {
			return adapter.IsPanoramaConfig(xmlFiles[i].Data) && !adapter.IsPanoramaConfig(xmlFiles[j].Data)
		})

		preview := r.URL.Query().Get("preview") == "true"
		if preview {
			var combinedStats paloalto.IngestionStats
			combinedStats.Devices = []string{}
			combinedStats.Warnings = []string{}
			validConfigsCount := 0

			for _, f := range xmlFiles {
				stats, err := adapter.Analyze(f.Data, f.Name)
				if err != nil {
					slog.Error("Analyze failed for file", slog.String("name", f.Name), slog.Any("error", err))
					continue
				}
				if stats.DevicesCount == 0 && stats.TemplatesCount == 0 && len(stats.Devices) == 0 {
					continue
				}

				if combinedStats.ConfigType == "" || stats.ConfigType == "Panorama" {
					combinedStats.ConfigType = stats.ConfigType
				}
				combinedStats.Devices = append(combinedStats.Devices, stats.Devices...)
				combinedStats.TemplatesCount += stats.TemplatesCount
				combinedStats.DevicesCount += stats.DevicesCount
				combinedStats.InterfacesCount += stats.InterfacesCount
				combinedStats.ZonesCount += stats.ZonesCount
				combinedStats.VirtualRoutersCount += stats.VirtualRoutersCount
				combinedStats.AddedCount += stats.AddedCount
				combinedStats.ModifiedCount += stats.ModifiedCount
				combinedStats.UnchangedCount += stats.UnchangedCount
				combinedStats.Warnings = append(combinedStats.Warnings, stats.Warnings...)
				validConfigsCount++
			}

			if validConfigsCount == 0 {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]string{"error": "No valid Palo Alto configurations found inside the uploaded payload."})
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"preview":     true,
				"config_type": combinedStats.ConfigType,
				"devices":     combinedStats.Devices,
				"warnings":    combinedStats.Warnings,
				"stats": map[string]interface{}{
					"templates_count":       combinedStats.TemplatesCount,
					"devices_count":         combinedStats.DevicesCount,
					"interfaces_count":      combinedStats.InterfacesCount,
					"zones_count":           combinedStats.ZonesCount,
					"virtual_routers_count": combinedStats.VirtualRoutersCount,
					"added_count":           combinedStats.AddedCount,
					"modified_count":        combinedStats.ModifiedCount,
					"unchanged_count":       combinedStats.UnchangedCount,
				},
			})
			return
		}

		// Set up NDJSON streaming for live progress updates
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Transfer-Encoding", "chunked")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		flusher, ok := w.(http.Flusher)

		// Pre-filter to only include files that are valid configurations to import
		var validFiles []xmlFile
		for _, f := range xmlFiles {
			stats, err := adapter.Analyze(f.Data, f.Name)
			if err != nil || (stats.DevicesCount == 0 && stats.TemplatesCount == 0 && len(stats.Devices) == 0) {
				continue
			}
			validFiles = append(validFiles, f)
		}

		totalFiles := len(validFiles)
		if totalFiles == 0 {
			json.NewEncoder(w).Encode(map[string]string{"error": "No valid configurations found to import."})
			return
		}

		sendProgress := func(step int, percent int, detail string, fileIndex int, filename string, fileStep int, filePercent int) {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"progress":     true,
				"step":         step,
				"percent":      percent,
				"detail":       detail,
				"file_index":   fileIndex,
				"total_files":  totalFiles,
				"filename":     filename,
				"file_step":    fileStep,
				"file_percent": filePercent,
			})
			if ok {
				flusher.Flush()
			}
		}

		// Send initial setup progress event with the list of files to be processed
		var filenames []string
		for _, vf := range validFiles {
			filenames = append(filenames, vf.Name)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"progress":    true,
			"init":        true,
			"total_files": totalFiles,
			"files":       filenames,
			"percent":     0,
			"detail":      "Initializing ingestion pipeline...",
		})
		if ok {
			flusher.Flush()
		}

		totalDevCount := 0
		totalTopoCount := 0

		for i, f := range validFiles {
			devCount, topoCount, err := adapter.ParseAndStore(f.Data, f.Name, func(step int, percent int, detail string) {
				// Scale percentage based on the active file index relative to the total files
				scaledPercent := int(float64(i)*100.0/float64(totalFiles) + float64(percent)/float64(totalFiles))
				if scaledPercent > 100 {
					scaledPercent = 100
				}
				detailStr := detail
				if step < 5 {
					detailStr = fmt.Sprintf("[%d/%d] %s", i+1, totalFiles, detail)
				}
				sendProgress(step, scaledPercent, detailStr, i, f.Name, step, percent)
			})
			if err != nil {
				json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("Import failure: %v", err)})
				return
			}
			totalDevCount += devCount
			totalTopoCount += topoCount
		}

		logAuditSafe("Device XML Imported", "Network", fmt.Sprintf("Imported %d devices/templates and %d interface topology routes.", totalDevCount, totalTopoCount))

		// Write final response
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":             true,
			"devices_imported":    totalDevCount,
			"topologies_imported": totalTopoCount,
		})
		if ok {
			flusher.Flush()
		}
	})

	// System Rollback Endpoint
	mux.HandleFunc("/api/system/rollback", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		basePath, err := filepath.Abs(".")
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to resolve workspace directory path."})
			return
		}

		backupPath := filepath.Join(basePath, "backups", "auto-rollback.cpatch")
		buf, err := os.ReadFile(backupPath)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "No rollback snapshot found on disk."})
			return
		}

		filesPatched, err := applyPatchPayload(buf, basePath)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"message":          "System successfully restored to previous snapshot.",
			"requires_restart": true,
			"files_patched":    filesPatched,
		})

		logAuditSafe("Emergency Rollback", "Maintenance", "System successfully restored to previous snapshot.")
	})

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

	mux.HandleFunc("/api/objects/security-profile-group/create", handleSecurityProfileGroupCreate)
	mux.HandleFunc("/api/objects/security-profile-group/update", handleSecurityProfileGroupUpdate)
	mux.HandleFunc("/api/objects/security-profile-group/delete", handleSecurityProfileGroupDelete)

	mux.HandleFunc("/api/objects/custom-url-category/create", handleCustomURLCategoryCreate)
	mux.HandleFunc("/api/objects/custom-url-category/update", handleCustomURLCategoryUpdate)
	mux.HandleFunc("/api/objects/custom-url-category/delete", handleCustomURLCategoryDelete)

	mux.HandleFunc("/api/objects/external-dynamic-list/create", handleExternalDynamicListCreate)
	mux.HandleFunc("/api/objects/external-dynamic-list/update", handleExternalDynamicListUpdate)
	mux.HandleFunc("/api/objects/external-dynamic-list/delete", handleExternalDynamicListDelete)

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
