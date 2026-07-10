package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"canopy-core/storage"
)

func handleWorkspacesHeal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	vaultMutex.RLock()
	if activeDB == nil {
		vaultMutex.RUnlock()
		http.Error(w, "No active workspace", http.StatusBadRequest)
		return
	}
	vaultMutex.RUnlock()
	healWorkspaceHandler(w, r)
}

func handleWorkspacesList(w http.ResponseWriter, r *http.Request) {
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
}

func handleWorkspacesCreate(w http.ResponseWriter, r *http.Request) {
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
}

func handleWorkspacesSwitch(w http.ResponseWriter, r *http.Request) {
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
}

func handleWorkspacesUpdate(w http.ResponseWriter, r *http.Request) {
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
}

func handleWorkspacesExport(w http.ResponseWriter, r *http.Request) {
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
}

func handleWorkspacesImport(w http.ResponseWriter, r *http.Request) {
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
}

func handleWorkspacesDelete(w http.ResponseWriter, r *http.Request) {
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
}

// handleWorkspacesCommit generates a JSON snapshot and inserts it into commit_history
func handleWorkspacesCommit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Message = "Auto Commit"
	}

	vaultMutex.RLock()
	if activeDB == nil {
		vaultMutex.RUnlock()
		http.Error(w, "No active workspace", http.StatusBadRequest)
		return
	}
	db := activeDB
	vaultMutex.RUnlock()

	tx, err := db.DB().Begin()
	if err != nil {
		http.Error(w, "Failed to start transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	snapshot, err := GenerateSnapshot(tx)
	if err != nil {
		http.Error(w, "Failed to generate snapshot", http.StatusInternalServerError)
		return
	}

	jsonData, err := json.Marshal(snapshot)
	if err != nil {
		http.Error(w, "Failed to serialize snapshot", http.StatusInternalServerError)
		return
	}

	_, err = tx.Exec("INSERT INTO commit_history (message, snapshot_json) VALUES (?, ?)", req.Message, jsonData)
	if err != nil {
		http.Error(w, "Failed to save commit", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to commit transaction", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// handleWorkspacesDiff compares the active configuration with the last commit
func handleWorkspacesDiff(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	vaultMutex.RLock()
	if activeDB == nil {
		vaultMutex.RUnlock()
		http.Error(w, "No active workspace", http.StatusBadRequest)
		return
	}
	db := activeDB
	vaultMutex.RUnlock()

	tx, err := db.DB().Begin()
	if err != nil {
		http.Error(w, "Failed to start transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Get the last commit's JSON
	var oldJSON []byte
	err = tx.QueryRow("SELECT snapshot_json FROM commit_history ORDER BY id DESC LIMIT 1").Scan(&oldJSON)
	if err != nil && err != sql.ErrNoRows {
		http.Error(w, "Failed to fetch previous commit", http.StatusInternalServerError)
		return
	}

	// Generate the current active state
	newState, err := GenerateSnapshot(tx)
	if err != nil {
		http.Error(w, "Failed to generate current snapshot", http.StatusInternalServerError)
		return
	}

	newJSON, _ := json.Marshal(newState)

	// Diff them
	diff, err := CompareSnapshots(oldJSON, newJSON)
	if err != nil {
		http.Error(w, "Failed to diff snapshots", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(diff)
}

// handleWorkspacesCommitDiff compares a specific commit with its predecessor
func handleWorkspacesCommitDiff(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, "Missing id parameter", http.StatusBadRequest)
		return
	}

	commitID, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid id parameter", http.StatusBadRequest)
		return
	}

	vaultMutex.RLock()
	if activeDB == nil {
		vaultMutex.RUnlock()
		http.Error(w, "No active workspace", http.StatusBadRequest)
		return
	}
	db := activeDB
	vaultMutex.RUnlock()

	// Get target commit JSON
	var targetJSON []byte
	err = db.DB().QueryRow("SELECT snapshot_json FROM commit_history WHERE id = ?", commitID).Scan(&targetJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Commit not found", http.StatusNotFound)
		} else {
			http.Error(w, "Failed to fetch commit", http.StatusInternalServerError)
		}
		return
	}

	// Get previous commit JSON
	var prevJSON []byte
	err = db.DB().QueryRow("SELECT snapshot_json FROM commit_history WHERE id < ? ORDER BY id DESC LIMIT 1", commitID).Scan(&prevJSON)
	if err != nil && err != sql.ErrNoRows {
		http.Error(w, "Failed to fetch previous commit", http.StatusInternalServerError)
		return
	}

	// If there's no previous commit, we diff against an empty state (or the oldJSON is just null/empty)
	diff, err := CompareSnapshots(prevJSON, targetJSON)
	if err != nil {
		http.Error(w, "Failed to diff snapshots", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(diff)
}

// handleWorkspacesHistory returns the commit log
func handleWorkspacesHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	vaultMutex.RLock()
	if activeDB == nil {
		vaultMutex.RUnlock()
		http.Error(w, "No active workspace", http.StatusBadRequest)
		return
	}
	db := activeDB
	vaultMutex.RUnlock()

	rows, err := db.DB().Query("SELECT id, message, strftime('%Y-%m-%dT%H:%M:%SZ', timestamp) FROM commit_history ORDER BY id DESC")
	if err != nil {
		http.Error(w, "Failed to query history", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var history []map[string]interface{}
	for rows.Next() {
		var id int
		var msg, ts string
		if err := rows.Scan(&id, &msg, &ts); err == nil {
			history = append(history, map[string]interface{}{
				"id": id, "message": msg, "timestamp": ts,
			})
		}
	}

	if history == nil {
		history = make([]map[string]interface{}, 0)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

// handleWorkspacesRevert reverts the active DB state to a specific commit
func handleWorkspacesRevert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		CommitID int `json:"commit_id"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	vaultMutex.RLock()
	if activeDB == nil {
		vaultMutex.RUnlock()
		http.Error(w, "No active workspace", http.StatusBadRequest)
		return
	}
	db := activeDB
	vaultMutex.RUnlock()

	tx, err := db.DB().Begin()
	if err != nil {
		http.Error(w, "Failed to start transaction", http.StatusInternalServerError)
		return
	}

	var snapshotJSON []byte
	query := "SELECT snapshot_json FROM commit_history ORDER BY id DESC LIMIT 1"
	args := []interface{}{}
	if req.CommitID > 0 {
		query = "SELECT snapshot_json FROM commit_history WHERE id = ?"
		args = append(args, req.CommitID)
	}

	err = tx.QueryRow(query, args...).Scan(&snapshotJSON)
	if err != nil {
		tx.Rollback()
		http.Error(w, "Failed to find snapshot", http.StatusNotFound)
		return
	}

	if err := RestoreSnapshot(tx, snapshotJSON); err != nil {
		tx.Rollback()
		slog.Error("Failed to restore snapshot", slog.String("err", err.Error()))
		http.Error(w, "Failed to restore snapshot", http.StatusInternalServerError)
		return
	}

	// Create a new commit to track the reversion
	revertMsg := "Reverted to previous state"
	if req.CommitID > 0 {
		revertMsg = fmt.Sprintf("Reverted to commit %d", req.CommitID)
	}
	_, err = tx.Exec("INSERT INTO commit_history (message, snapshot_json) VALUES (?, ?)", revertMsg, snapshotJSON)
	if err != nil {
		tx.Rollback()
		http.Error(w, "Failed to save revert commit", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to commit transaction", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// handleWorkspacesRevertSingle reverts a single object to its state in the last commit
func handleWorkspacesRevertSingle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Category string `json:"category"`
		ID       string `json:"id"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	vaultMutex.RLock()
	if activeDB == nil {
		vaultMutex.RUnlock()
		http.Error(w, "No active workspace", http.StatusBadRequest)
		return
	}
	db := activeDB
	vaultMutex.RUnlock()

	tx, err := db.DB().Begin()
	if err != nil {
		http.Error(w, "Failed to start transaction", http.StatusInternalServerError)
		return
	}

	var snapshotJSON []byte
	err = tx.QueryRow("SELECT snapshot_json FROM commit_history ORDER BY id DESC LIMIT 1").Scan(&snapshotJSON)
	if err != nil {
		tx.Rollback()
		http.Error(w, "Failed to find snapshot", http.StatusNotFound)
		return
	}

	var state SnapshotState
	if err := json.Unmarshal(snapshotJSON, &state); err != nil {
		tx.Rollback()
		http.Error(w, "Failed to parse snapshot", http.StatusInternalServerError)
		return
	}

	intID, _ := strconv.Atoi(req.ID)

	switch req.Category {
	case "addressObjects":
		tx.Exec("DELETE FROM address_objects WHERE id = ?", intID)
		tx.Exec("DELETE FROM entity_tag_mappings WHERE entity_id = ? AND entity_type = 'address_object'", intID)
		
		if obj, exists := state.AddressObjects[req.ID]; exists {
			devUUID := getSnapshotDeviceUUID(tx, obj.DeviceUUID, obj.Scope)
			tx.Exec("INSERT INTO address_objects (id, device_uuid, scope, name, type, value, description, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, 0)", intID, devUUID, obj.Scope, obj.Name, obj.Type, obj.Value, obj.Description)
			for _, tag := range obj.Tags {
				tx.Exec("INSERT INTO entity_tag_mappings (entity_type, entity_id, tag_id) VALUES ('address_object', ?, (SELECT id FROM tags WHERE name = ?))", intID, tag)
			}
		}
	case "addressGroups":
		tx.Exec("DELETE FROM address_groups WHERE id = ?", intID)
		tx.Exec("DELETE FROM address_group_members WHERE group_id = ?", intID)
		tx.Exec("DELETE FROM entity_tag_mappings WHERE entity_id = ? AND entity_type = 'address_group'", intID)
		
		if obj, exists := state.AddressGroups[req.ID]; exists {
			devUUID := getSnapshotDeviceUUID(tx, obj.DeviceUUID, obj.Scope)
			tx.Exec("INSERT INTO address_groups (id, device_uuid, scope, name, type, filter, description, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, 0)", intID, devUUID, obj.Scope, obj.Name, obj.Type, obj.Filter, obj.Description)
			for _, tag := range obj.Tags {
				tx.Exec("INSERT INTO entity_tag_mappings (entity_type, entity_id, tag_id) VALUES ('address_group', ?, (SELECT id FROM tags WHERE name = ?))", intID, tag)
			}
			var missingMembers []string
			for _, m := range obj.Members {
				var objID int64
				if err := tx.QueryRow("SELECT id FROM address_objects WHERE name = ?", m).Scan(&objID); err == nil {
					tx.Exec("INSERT INTO address_group_members (group_id, member_address_id) VALUES (?, ?)", intID, objID)
				} else if err := tx.QueryRow("SELECT id FROM address_groups WHERE name = ?", m).Scan(&objID); err == nil {
					tx.Exec("INSERT INTO address_group_members (group_id, member_group_id) VALUES (?, ?)", intID, objID)
				} else {
					missingMembers = append(missingMembers, m)
				}
			}
			
			if len(missingMembers) > 0 {
				tx.Rollback()
				http.Error(w, "Cannot fully revert Address Group. The following dependent members were not found (you must revert them first): " + strings.Join(missingMembers, ", "), http.StatusBadRequest)
				return
			}
		}
	case "services":
		tx.Exec("DELETE FROM service_objects WHERE id = ?", intID)
		tx.Exec("DELETE FROM entity_tag_mappings WHERE entity_id = ? AND entity_type = 'service_object'", intID)
		
		if obj, exists := state.Services[req.ID]; exists {
			devUUID := getSnapshotDeviceUUID(tx, obj.DeviceUUID, obj.Scope)
			tx.Exec("INSERT INTO service_objects (id, device_uuid, scope, name, protocol, port, description, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, 0)", intID, devUUID, obj.Scope, obj.Name, obj.Protocol, obj.Port, obj.Description)
			for _, tag := range obj.Tags {
				tx.Exec("INSERT INTO entity_tag_mappings (entity_type, entity_id, tag_id) VALUES ('service_object', ?, (SELECT id FROM tags WHERE name = ?))", intID, tag)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to commit transaction", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}
