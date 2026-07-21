package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

func handleSecretsList(w http.ResponseWriter, r *http.Request) {
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
	if err := rows.Err(); err != nil {
		// Warning fixed
		_ = err
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func handleSecretsCreate(w http.ResponseWriter, r *http.Request) {
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
}

func handleSecretsUpdate(w http.ResponseWriter, r *http.Request) {
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
}

func handleSecretsDelete(w http.ResponseWriter, r *http.Request) {
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
}

func handleSecretsReveal(w http.ResponseWriter, r *http.Request) {
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
}
