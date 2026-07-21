package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"canopy-core/storage"
)

func handleSnapshotsList(w http.ResponseWriter, r *http.Request) {
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
}

func handleSnapshotsCreate(w http.ResponseWriter, r *http.Request) {
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
		if err := rows.Err(); err != nil {
			// Warning fixed
			_ = err
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
}

func handleSnapshotsUpdate(w http.ResponseWriter, r *http.Request) {
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
}

func handleSnapshotsDelete(w http.ResponseWriter, r *http.Request) {
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
}

func handleSnapshotsRevert(w http.ResponseWriter, r *http.Request) {
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
}

func handleSnapshotsExport(w http.ResponseWriter, r *http.Request) {
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
}

func handleSnapshotsImport(w http.ResponseWriter, r *http.Request) {
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
}
