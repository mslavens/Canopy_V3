package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

func handleAddressCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DeviceUUID  string   `json:"device_uuid"`
		Scope       string   `json:"scope"`
		Name        string   `json:"name"`
		Type        string   `json:"type"`
		Value       string   `json:"value"`
		Description string   `json:"description"`
		Tags        []string `json:"tags"`
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
	if err := validateAddressValue(req.Type, req.Value); err != nil {
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

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction"})
		return
	}
	defer tx.Rollback()

	var count int
	err = tx.QueryRow("SELECT COUNT(*) FROM address_objects WHERE device_uuid = ? AND name = ?", req.DeviceUUID, req.Name).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "An address object with this name already exists in the selected scope."})
		return
	}

	res, err := tx.Exec(`
		INSERT INTO address_objects (device_uuid, scope, name, type, value, description, dirty)
		VALUES (?, ?, ?, ?, ?, ?, 1)
	`, req.DeviceUUID, req.Scope, req.Name, req.Type, req.Value, req.Description)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create object: " + err.Error()})
		return
	}

	id, _ := res.LastInsertId()
	if err := saveEntityTags(tx, "address_object", id, req.DeviceUUID, req.Tags); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to save object tags: " + err.Error()})
		return
	}

	if err := MaterializeDynamicGroups(tx, req.DeviceUUID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to materialize dynamic groups: " + err.Error()})
		return
	}

	if err := MaterializeDynamicGroups(tx, req.DeviceUUID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to materialize dynamic groups: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to commit transaction"})
		return
	}

	logAuditSafe("Address Object Created", "Objects", "Created address object: "+req.Name+" ("+req.Value+") in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": id})
}
func handleAddressUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID          int      `json:"id"`
		DeviceUUID  string   `json:"device_uuid"`
		Scope       string   `json:"scope"`
		Name        string   `json:"name"`
		Type        string   `json:"type"`
		Value       string   `json:"value"`
		Description string   `json:"description"`
		Tags        []string `json:"tags"`
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
	if err := validateAddressValue(req.Type, req.Value); err != nil {
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

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction"})
		return
	}
	defer tx.Rollback()

	var count int
	err = tx.QueryRow("SELECT COUNT(*) FROM address_objects WHERE device_uuid = ? AND name = ? AND id != ?", req.DeviceUUID, req.Name, req.ID).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "An address object with this name already exists in the selected scope."})
		return
	}

	_, err = tx.Exec(`
		UPDATE address_objects
		SET device_uuid = ?, scope = ?, name = ?, type = ?, value = ?, description = ?, dirty = 1
		WHERE id = ?
	`, req.DeviceUUID, req.Scope, req.Name, req.Type, req.Value, req.Description, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update object: " + err.Error()})
		return
	}

	if err := saveEntityTags(tx, "address_object", int64(req.ID), req.DeviceUUID, req.Tags); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to save object tags: " + err.Error()})
		return
	}

	if err := MaterializeDynamicGroups(tx, req.DeviceUUID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to materialize dynamic groups: " + err.Error()})
		return
	}

	if err := MaterializeDynamicGroups(tx, req.DeviceUUID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to materialize dynamic groups: " + err.Error()})
		return
	}

	if err := MaterializeDynamicGroups(tx, req.DeviceUUID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to materialize dynamic groups: " + err.Error()})
		return
	}

	if err := MaterializeDynamicGroups(tx, req.DeviceUUID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to materialize dynamic groups: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to commit transaction"})
		return
	}

	logAuditSafe("Address Object Updated", "Objects", "Updated address object: "+req.Name+" ("+req.Value+") in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleAddressDelete(w http.ResponseWriter, r *http.Request) {
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
	dbConn.QueryRow("SELECT name FROM address_objects WHERE id = ?", req.ID).Scan(&name)

	_, err = dbConn.Exec("DELETE FROM address_objects WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete object: " + err.Error()})
		return
	}

	logAuditSafe("Address Object Deleted", "Objects", "Deleted address object: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleAddressGroupCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DeviceUUID  string   `json:"device_uuid"`
		Scope       string   `json:"scope"`
		Name        string   `json:"name"`
		Type        string   `json:"type"`
		Filter      string   `json:"filter"`
		Description string   `json:"description"`
		Members     []string `json:"members"`
		Tags        []string `json:"tags"`
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

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction"})
		return
	}
	defer tx.Rollback()

	var count int
	err = tx.QueryRow("SELECT COUNT(*) FROM address_groups WHERE device_uuid = ? AND name = ?", req.DeviceUUID, req.Name).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "An address group with this name already exists in the selected scope."})
		return
	}

	res, err := tx.Exec(`
		INSERT INTO address_groups (device_uuid, scope, name, type, filter, description, dirty)
		VALUES (?, ?, ?, ?, ?, ?, 1)
	`, req.DeviceUUID, req.Scope, req.Name, req.Type, req.Filter, req.Description)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create group: " + err.Error()})
		return
	}
	groupID, _ := res.LastInsertId()

	if req.Type == "static" {
		for _, member := range req.Members {
			member = strings.TrimSpace(member)
			if member == "" {
				continue
			}

			var addrID sql.NullInt64
			tx.QueryRow("SELECT id FROM address_objects WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&addrID)

			var grpID sql.NullInt64
			tx.QueryRow("SELECT id FROM address_groups WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&grpID)

			if addrID.Valid {
				_, err = tx.Exec("INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name) VALUES (?, ?, NULL, NULL)", groupID, addrID.Int64)
			} else if grpID.Valid {
				_, err = tx.Exec("INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name) VALUES (?, NULL, ?, NULL)", groupID, grpID.Int64)
			} else {
				_, err = tx.Exec("INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name) VALUES (?, NULL, NULL, ?)", groupID, member)
			}
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": "Failed to add member: " + err.Error()})
				return
			}
		}
	}

	if err := saveEntityTags(tx, "address_group", groupID, req.DeviceUUID, req.Tags); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to save group tags: " + err.Error()})
		return
	}

	if err := MaterializeDynamicGroups(tx, req.DeviceUUID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to materialize dynamic groups: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to commit transaction"})
		return
	}

	logAuditSafe("Address Group Created", "Objects", "Created address group: "+req.Name+" (type: "+req.Type+") in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": groupID})
}
func handleAddressGroupUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID          int      `json:"id"`
		DeviceUUID  string   `json:"device_uuid"`
		Scope       string   `json:"scope"`
		Name        string   `json:"name"`
		Type        string   `json:"type"`
		Filter      string   `json:"filter"`
		Description string   `json:"description"`
		Members     []string `json:"members"`
		Tags        []string `json:"tags"`
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

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction"})
		return
	}
	defer tx.Rollback()

	var count int
	err = tx.QueryRow("SELECT COUNT(*) FROM address_groups WHERE device_uuid = ? AND name = ? AND id != ?", req.DeviceUUID, req.Name, req.ID).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "An address group with this name already exists in the selected scope."})
		return
	}

	_, err = tx.Exec(`
		UPDATE address_groups
		SET device_uuid = ?, scope = ?, name = ?, type = ?, filter = ?, description = ?, dirty = 1
		WHERE id = ?
	`, req.DeviceUUID, req.Scope, req.Name, req.Type, req.Filter, req.Description, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update group: " + err.Error()})
		return
	}

	_, err = tx.Exec("DELETE FROM address_group_members WHERE group_id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update group members: " + err.Error()})
		return
	}

	if req.Type == "static" {
		for _, member := range req.Members {
			member = strings.TrimSpace(member)
			if member == "" {
				continue
			}

			var addrID sql.NullInt64
			tx.QueryRow("SELECT id FROM address_objects WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&addrID)

			var grpID sql.NullInt64
			tx.QueryRow("SELECT id FROM address_groups WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&grpID)

			if addrID.Valid {
				_, err = tx.Exec("INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name) VALUES (?, ?, NULL, NULL)", req.ID, addrID.Int64)
			} else if grpID.Valid {
				_, err = tx.Exec("INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name) VALUES (?, NULL, ?, NULL)", req.ID, grpID.Int64)
			} else {
				_, err = tx.Exec("INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name) VALUES (?, NULL, NULL, ?)", req.ID, member)
			}
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": "Failed to add member: " + err.Error()})
				return
			}
		}
	}

	if err := saveEntityTags(tx, "address_group", int64(req.ID), req.DeviceUUID, req.Tags); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to save group tags: " + err.Error()})
		return
	}

	if err := MaterializeDynamicGroups(tx, req.DeviceUUID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to materialize dynamic groups: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to commit transaction"})
		return
	}

	logAuditSafe("Address Group Updated", "Objects", "Updated address group: "+req.Name+" (type: "+req.Type+") in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleAddressGroupDelete(w http.ResponseWriter, r *http.Request) {
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
	dbConn.QueryRow("SELECT name FROM address_groups WHERE id = ?", req.ID).Scan(&name)

	_, err = dbConn.Exec("DELETE FROM address_groups WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete group: " + err.Error()})
		return
	}

	logAuditSafe("Address Group Deleted", "Objects", "Deleted address group: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
