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
)

func handleSystemHealth(w http.ResponseWriter, r *http.Request) {
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
}

func handleSystemLoglevel(w http.ResponseWriter, r *http.Request) {
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
}

func handleSystemPatch(w http.ResponseWriter, r *http.Request) {
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
}

func handleSystemPatchInspect(w http.ResponseWriter, r *http.Request) {
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
}

func handleSystemRollback(w http.ResponseWriter, r *http.Request) {
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
}
