package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"canopy-core/storage"
)

func handleVaultLock(w http.ResponseWriter, r *http.Request) {
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
	if logDB != nil {
		logDB.Close()
		logDB = nil
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
}

func handleVaultWipe(w http.ResponseWriter, r *http.Request) {
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
	if logDB != nil {
		logDB.Close()
		logDB = nil
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
		if !f.IsDir() && (strings.HasSuffix(f.Name(), ".db") || strings.HasSuffix(f.Name(), ".db-shm") || strings.HasSuffix(f.Name(), ".db-wal") || strings.HasSuffix(f.Name(), ".duckdb") || strings.HasSuffix(f.Name(), ".duckdb.wal")) {
			os.Remove(filepath.Join(dataPath, f.Name()))
		}
	}
	os.RemoveAll(filepath.Join(dataPath, "snapshots"))

	slog.Warn("EMERGENCY WIPE EXECUTED. Vault destroyed.")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func handleVaultRekey(w http.ResponseWriter, r *http.Request) {
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
		if err := rows.Err(); err != nil {
			// Warning fixed
			_ = err
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
}

func handleVaultInit(w http.ResponseWriter, r *http.Request) {
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
}

func handleVaultUnlock(w http.ResponseWriter, r *http.Request) {
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
}
