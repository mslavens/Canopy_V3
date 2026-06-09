package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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

	"canopy-core/engine"
	"canopy-core/storage"
	"canopy-core/adapters/paloalto"

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
	CREATE TABLE IF NOT EXISTS devices (
		uuid TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		vendor TEXT NOT NULL,
		parent_uuid TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (parent_uuid) REFERENCES devices(uuid) ON DELETE SET NULL
	);
	CREATE TABLE IF NOT EXISTS network_topology (
		device_uuid TEXT,
		interface_name TEXT,
		network_cidr TEXT,
		zone_name TEXT,
		vendor_metadata TEXT,
		PRIMARY KEY (device_uuid, interface_name)
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
	CREATE TABLE IF NOT EXISTS template_stacks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		name TEXT NOT NULL,
		FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS template_stack_members (
		stack_id INTEGER NOT NULL,
		template_name TEXT NOT NULL,
		sequence INTEGER NOT NULL,
		PRIMARY KEY (stack_id, template_name),
		FOREIGN KEY (stack_id) REFERENCES template_stacks(id) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS address_objects (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		value TEXT NOT NULL,
		description TEXT,
		FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS address_groups (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		description TEXT,
		FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS address_group_members (
		group_id INTEGER,
		member_name TEXT NOT NULL,
		PRIMARY KEY (group_id, member_name),
		FOREIGN KEY (group_id) REFERENCES address_groups(id) ON DELETE CASCADE
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
		FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS service_groups (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		description TEXT,
		FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS service_group_members (
		group_id INTEGER,
		member_name TEXT NOT NULL,
		PRIMARY KEY (group_id, member_name),
		FOREIGN KEY (group_id) REFERENCES service_groups(id) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS security_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		rule_name TEXT NOT NULL,
		description TEXT,
		action TEXT NOT NULL,
		disabled INTEGER DEFAULT 0,
		from_zones TEXT,
		to_zones TEXT,
		source_addresses TEXT,
		destination_addresses TEXT,
		services TEXT,
		applications TEXT,
		FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS nat_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		rule_name TEXT NOT NULL,
		description TEXT,
		disabled INTEGER DEFAULT 0,
		from_zones TEXT,
		to_zone TEXT,
		source_addresses TEXT,
		destination_addresses TEXT,
		service TEXT,
		source_translation_type TEXT,
		source_translation_address TEXT,
		destination_translation_address TEXT,
		destination_translation_port TEXT,
		FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
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
		FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS managed_devices (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		serial TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		ip_address TEXT,
		device_group TEXT,
		template_stack TEXT,
		FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		color TEXT,
		description TEXT,
		FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS security_profiles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT NOT NULL,
		scope TEXT NOT NULL,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
	);`

// globalCORSMiddleware guarantees that all loopback traffic receives proper CORS headers.
func globalCORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		// Allow local development server and Electron packaging protocols securely
		if origin == "http://localhost:5173" || strings.HasPrefix(origin, "file://") || strings.HasPrefix(origin, "app://") {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		} else {
			// Browsers strictly reject wildcard origins (*) when Allow-Credentials is true.
			// Safely echo the requested origin dynamically to prevent CORS preflight failures.
			if origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
		}

		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")
		w.Header().Set("Access-Control-Allow-Credentials", "true")

		// Instantly short-circuit browser preflight checks safely at the absolute edge
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// authMiddleware inspects incoming requests for the cryptographically secure session token.
func authMiddleware(expectedToken string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			slog.Warn("Missing Authorization header", slog.String("path", r.URL.Path), slog.String("ip", r.RemoteAddr))
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] != expectedToken {
			slog.Warn("Invalid Authorization token", slog.String("path", r.URL.Path), slog.String("ip", r.RemoteAddr))
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// generateToken creates a secure random 32-byte cryptographic hex token.
func generateToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// logAuditSafe securely inserts a human-readable audit trail event into the encrypted SQLite vault.
func logAuditSafe(action, module, details string) {
	go func() {
		vaultMutex.RLock()
		if telemetryDB == nil {
			vaultMutex.RUnlock()
			return
		}
		db := telemetryDB.DB()
		vaultMutex.RUnlock()

		if _, err := db.Exec("INSERT INTO audit_logs (action, module, details) VALUES (?, ?, ?)", action, module, details); err != nil {
			slog.Error("Failed to write audit log", slog.String("error", err.Error()))
		}
	}()
}

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
	// Migration: Add parent_uuid to devices table if it doesn't exist
	_, _ = activeDB.DB().Exec("ALTER TABLE devices ADD COLUMN parent_uuid TEXT;")

	if _, err := activeDB.DB().Exec(actSchema); err != nil {
		slog.Error("Failed to initialize workspace schema", slog.String("error", err.Error()))
	}
	activeDB.DB().Exec(fmt.Sprintf("INSERT OR IGNORE INTO framework_metadata (app_id, schema_version) VALUES ('%s', 1)", AppBundleID))
	activeDB.WriteUnlock()

	var entryCount int
	err = activeDB.DB().QueryRow("SELECT COUNT(*) FROM network_topology").Scan(&entryCount)
	if err == nil && entryCount == 0 {
		slog.Info("Empty database configuration discovered. Auto-seeding Calgary topology records...")
		activeDB.WriteLock()
		seedSQL := "INSERT OR IGNORE INTO devices (uuid, name, vendor) VALUES ('fw-calgary-edge', 'fw-calgary-edge', 'PaloAlto'); INSERT OR IGNORE INTO network_topology (device_uuid, interface_name, network_cidr, zone_name, vendor_metadata) VALUES ('fw-calgary-edge', 'ethernet1/1', '10.99.3.0/24', 'Outside', '{\"speed\": \"10G\"}'), ('fw-calgary-edge', 'ethernet1/2', '192.168.50.0/24', 'Inside', '{\"speed\": \"10G\"}');"
		if _, seedErr := activeDB.DB().Exec(seedSQL); seedErr != nil {
			slog.Error("Failed to apply automated schema seeds", slog.String("error", seedErr.Error()))
		}
		activeDB.WriteUnlock()
	}
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
		newSpoke.DB().Exec(actSchema)
		newSpoke.DB().Exec(fmt.Sprintf("INSERT OR IGNORE INTO framework_metadata (app_id, schema_version) VALUES ('%s', 1)", AppBundleID))
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
		// Migration: Add parent_uuid to devices table if it doesn't exist
		_, _ = newSpoke.DB().Exec("ALTER TABLE devices ADD COLUMN parent_uuid TEXT;")
		if _, err := newSpoke.DB().Exec(actSchema); err != nil {
			slog.Error("Failed to initialize workspace schema on switch", slog.String("error", err.Error()))
		}
		newSpoke.DB().Exec(fmt.Sprintf("INSERT OR IGNORE INTO framework_metadata (app_id, schema_version) VALUES ('%s', 1)", AppBundleID))
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

		// Basic safety guardrail: only allow SELECT or PRAGMA for troubleshooting
		upperQuery := strings.ToUpper(strings.TrimSpace(req.Query))
		if !strings.HasPrefix(upperQuery, "SELECT") && !strings.HasPrefix(upperQuery, "PRAGMA") {
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

		// 1. Search Devices
		devRows, err := dbConn.Query("SELECT uuid, name, vendor FROM devices WHERE name LIKE ? OR vendor LIKE ? LIMIT 5", searchTerm, searchTerm)
		if err != nil {
			slog.Error("Search query failed on devices", slog.String("error", err.Error()))
		} else {
			defer devRows.Close()
			for devRows.Next() {
				var uuid string
				var name, vendor sql.NullString
				if err := devRows.Scan(&uuid, &name, &vendor); err == nil {
					n := ""
					v := ""
					if name.Valid {
						n = name.String
					}
					if vendor.Valid {
						v = vendor.String
					}
					results = append(results, SearchResult{ID: uuid, Type: "device", Label: fmt.Sprintf("%s (%s)", n, v), Module: "System", Submodule: "Database Browser"})
				} else {
					slog.Error("Search row scan failed on devices", slog.String("error", err.Error()))
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

		preview := r.URL.Query().Get("preview") == "true"
		if preview {
			var combinedStats paloalto.IngestionStats
			combinedStats.Devices = []string{}
			validConfigsCount := 0

			for _, f := range xmlFiles {
				stats, err := adapter.Analyze(f.Data, f.Name)
				if err != nil || (stats.DevicesCount == 0 && stats.TemplatesCount == 0 && len(stats.Devices) == 0) {
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
				"stats": map[string]int{
					"templates_count":       combinedStats.TemplatesCount,
					"devices_count":         combinedStats.DevicesCount,
					"interfaces_count":      combinedStats.InterfacesCount,
					"zones_count":           combinedStats.ZonesCount,
					"virtual_routers_count": combinedStats.VirtualRoutersCount,
				},
			})
			return
		}

		totalDevCount := 0
		totalTopoCount := 0
		validConfigsCount := 0

		for _, f := range xmlFiles {
			stats, err := adapter.Analyze(f.Data, f.Name)
			if err != nil || (stats.DevicesCount == 0 && stats.TemplatesCount == 0 && len(stats.Devices) == 0) {
				continue
			}

			devCount, topoCount, err := adapter.ParseAndStore(f.Data, f.Name)
			if err != nil {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("Import failure: %v", err)})
				return
			}
			totalDevCount += devCount
			totalTopoCount += topoCount
			validConfigsCount++
		}

		if validConfigsCount == 0 {
			w.WriteHeader(http.StatusUnprocessableEntity)
			json.NewEncoder(w).Encode(map[string]string{"error": "No valid configurations found to import."})
			return
		}

		logAuditSafe("Device XML Imported", "Network", fmt.Sprintf("Imported %d devices/templates and %d interface topology routes.", totalDevCount, totalTopoCount))

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":             true,
			"devices_imported":   totalDevCount,
			"topologies_imported": totalTopoCount,
		})
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
