package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

func saveEntityTags(tx *sql.Tx, entityType string, entityID int64, deviceUUID string, tags []string) error {
	_, err := tx.Exec("DELETE FROM entity_tag_mappings WHERE entity_type = ? AND entity_id = ?", entityType, entityID)
	if err != nil {
		return err
	}
	for _, tagName := range tags {
		tagName = strings.TrimSpace(tagName)
		if tagName == "" {
			continue
		}
		var tagID int64
		err := tx.QueryRow("SELECT id FROM tags WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", tagName, deviceUUID).Scan(&tagID)
		if err == sql.ErrNoRows {
			res, err := tx.Exec("INSERT INTO tags (device_uuid, scope, name, color) VALUES (?, ?, ?, 'color1')", deviceUUID, "shared", tagName)
			if err == nil {
				tagID, _ = res.LastInsertId()
			}
		}
		if tagID > 0 {
			_, err = tx.Exec("INSERT INTO entity_tag_mappings (entity_type, entity_id, tag_id) VALUES (?, ?, ?)", entityType, entityID, tagID)
			if err != nil {
				return err
			}
		}
	}
	return nil
}
func handleTagCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DeviceUUID  string `json:"device_uuid"`
		Scope       string `json:"scope"`
		Name        string `json:"name"`
		Color       string `json:"color"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Malformed JSON payload", http.StatusBadRequest)
		return
	}
	if err := validateObjectName(req.Name); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	dbConn, err := getActiveDBConn()
	if err != nil {
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	var count int
	err = dbConn.QueryRow("SELECT COUNT(*) FROM tags WHERE device_uuid = ? AND name = ?", req.DeviceUUID, req.Name).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "A tag with this name already exists in the selected scope."})
		return
	}
	res, err := dbConn.Exec(`
		INSERT INTO tags (device_uuid, scope, name, color, description)
		VALUES (?, ?, ?, ?, ?)
	`, req.DeviceUUID, req.Scope, req.Name, req.Color, req.Description)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create tag: " + err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	logAuditSafe("Tag Created", "Objects", "Created tag: "+req.Name+" in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": id})
}
func handleTagUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID          int    `json:"id"`
		DeviceUUID  string `json:"device_uuid"`
		Scope       string `json:"scope"`
		Name        string `json:"name"`
		Color       string `json:"color"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Malformed JSON payload", http.StatusBadRequest)
		return
	}
	if err := validateObjectName(req.Name); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	dbConn, err := getActiveDBConn()
	if err != nil {
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	_, err = dbConn.Exec(`
		UPDATE tags
		SET name = ?, color = ?, description = ?
		WHERE id = ?
	`, req.Name, req.Color, req.Description, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update tag: " + err.Error()})
		return
	}
	logAuditSafe("Tag Updated", "Objects", "Updated tag: "+req.Name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleTagDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID int `json:"id"`
	}
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
	var name string
	dbConn.QueryRow("SELECT name FROM tags WHERE id = ?", req.ID).Scan(&name)
	_, err = dbConn.Exec("DELETE FROM tags WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete tag: " + err.Error()})
		return
	}
	logAuditSafe("Tag Deleted", "Objects", "Deleted tag: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
