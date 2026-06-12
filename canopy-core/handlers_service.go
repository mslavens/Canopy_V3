package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

func handleServiceCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DeviceUUID      string `json:"device_uuid"`
		Scope           string `json:"scope"`
		Name            string `json:"name"`
		Protocol        string `json:"protocol"`
		SourcePort      string `json:"source_port"`
		DestinationPort string `json:"destination_port"`
		Description     string `json:"description"`
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
	proto := strings.ToLower(strings.TrimSpace(req.Protocol))
	if proto != "tcp" && proto != "udp" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Protocol must be TCP or UDP"})
		return
	}
	if err := validatePorts(req.DestinationPort); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid destination port(s): " + err.Error()})
		return
	}
	if req.SourcePort != "" {
		if err := validatePorts(req.SourcePort); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid source port(s): " + err.Error()})
			return
		}
	}

	dbConn, err := getActiveDBConn()
	if err != nil {
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	var count int
	err = dbConn.QueryRow("SELECT COUNT(*) FROM service_objects WHERE device_uuid = ? AND name = ?", req.DeviceUUID, req.Name).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "A service object with this name already exists in the selected scope."})
		return
	}

	res, err := dbConn.Exec(`
		INSERT INTO service_objects (device_uuid, scope, name, protocol, source_port, destination_port, description, dirty)
		VALUES (?, ?, ?, ?, ?, ?, ?, 1)
	`, req.DeviceUUID, req.Scope, req.Name, proto, req.SourcePort, req.DestinationPort, req.Description)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create service: " + err.Error()})
		return
	}

	id, _ := res.LastInsertId()
	logAuditSafe("Service Object Created", "Objects", "Created service object: "+req.Name+" ("+proto+":"+req.DestinationPort+") in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": id})
}
func handleServiceUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID              int    `json:"id"`
		DeviceUUID      string `json:"device_uuid"`
		Scope           string `json:"scope"`
		Name            string `json:"name"`
		Protocol        string `json:"protocol"`
		SourcePort      string `json:"source_port"`
		DestinationPort string `json:"destination_port"`
		Description     string `json:"description"`
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
	proto := strings.ToLower(strings.TrimSpace(req.Protocol))
	if proto != "tcp" && proto != "udp" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Protocol must be TCP or UDP"})
		return
	}
	if err := validatePorts(req.DestinationPort); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid destination port(s): " + err.Error()})
		return
	}
	if req.SourcePort != "" {
		if err := validatePorts(req.SourcePort); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid source port(s): " + err.Error()})
			return
		}
	}

	dbConn, err := getActiveDBConn()
	if err != nil {
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	var count int
	err = dbConn.QueryRow("SELECT COUNT(*) FROM service_objects WHERE device_uuid = ? AND name = ? AND id != ?", req.DeviceUUID, req.Name, req.ID).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "A service object with this name already exists in the selected scope."})
		return
	}

	_, err = dbConn.Exec(`
		UPDATE service_objects
		SET device_uuid = ?, scope = ?, name = ?, protocol = ?, source_port = ?, destination_port = ?, description = ?, dirty = 1
		WHERE id = ?
	`, req.DeviceUUID, req.Scope, req.Name, proto, req.SourcePort, req.DestinationPort, req.Description, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update service: " + err.Error()})
		return
	}

	logAuditSafe("Service Object Updated", "Objects", "Updated service object: "+req.Name+" ("+proto+":"+req.DestinationPort+") in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleServiceDelete(w http.ResponseWriter, r *http.Request) {
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
	dbConn.QueryRow("SELECT name FROM service_objects WHERE id = ?", req.ID).Scan(&name)

	_, err = dbConn.Exec("DELETE FROM service_objects WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete service: " + err.Error()})
		return
	}

	logAuditSafe("Service Object Deleted", "Objects", "Deleted service object: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleServiceGroupCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DeviceUUID  string   `json:"device_uuid"`
		Scope       string   `json:"scope"`
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Members     []string `json:"members"`
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
	err = tx.QueryRow("SELECT COUNT(*) FROM service_groups WHERE device_uuid = ? AND name = ?", req.DeviceUUID, req.Name).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "A service group with this name already exists in the selected scope."})
		return
	}

	res, err := tx.Exec(`
		INSERT INTO service_groups (device_uuid, scope, name, description, dirty)
		VALUES (?, ?, ?, ?, 1)
	`, req.DeviceUUID, req.Scope, req.Name, req.Description)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create service group: " + err.Error()})
		return
	}
	groupID, _ := res.LastInsertId()

	for _, member := range req.Members {
		member = strings.TrimSpace(member)
		if member == "" {
			continue
		}

		var svcID sql.NullInt64
		tx.QueryRow("SELECT id FROM service_objects WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&svcID)

		var grpID sql.NullInt64
		tx.QueryRow("SELECT id FROM service_groups WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&grpID)

		if svcID.Valid {
			_, err = tx.Exec("INSERT INTO service_group_members (group_id, member_service_id, member_group_id, member_name) VALUES (?, ?, NULL, NULL)", groupID, svcID.Int64)
		} else if grpID.Valid {
			_, err = tx.Exec("INSERT INTO service_group_members (group_id, member_service_id, member_group_id, member_name) VALUES (?, NULL, ?, NULL)", groupID, grpID.Int64)
		} else {
			_, err = tx.Exec("INSERT INTO service_group_members (group_id, member_service_id, member_group_id, member_name) VALUES (?, NULL, NULL, ?)", groupID, member)
		}
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to add member to service group: " + err.Error()})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to commit transaction"})
		return
	}

	logAuditSafe("Service Group Created", "Objects", "Created service group: "+req.Name+" in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": groupID})
}
func handleServiceGroupUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID          int      `json:"id"`
		DeviceUUID  string   `json:"device_uuid"`
		Scope       string   `json:"scope"`
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Members     []string `json:"members"`
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
	err = tx.QueryRow("SELECT COUNT(*) FROM service_groups WHERE device_uuid = ? AND name = ? AND id != ?", req.DeviceUUID, req.Name, req.ID).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "A service group with this name already exists in the selected scope."})
		return
	}

	_, err = tx.Exec(`
		UPDATE service_groups
		SET device_uuid = ?, scope = ?, name = ?, description = ?, dirty = 1
		WHERE id = ?
	`, req.DeviceUUID, req.Scope, req.Name, req.Description, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update service group: " + err.Error()})
		return
	}

	_, err = tx.Exec("DELETE FROM service_group_members WHERE group_id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update service group members: " + err.Error()})
		return
	}

	for _, member := range req.Members {
		member = strings.TrimSpace(member)
		if member == "" {
			continue
		}

		var svcID sql.NullInt64
		tx.QueryRow("SELECT id FROM service_objects WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&svcID)

		var grpID sql.NullInt64
		tx.QueryRow("SELECT id FROM service_groups WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&grpID)

		if svcID.Valid {
			_, err = tx.Exec("INSERT INTO service_group_members (group_id, member_service_id, member_group_id, member_name) VALUES (?, ?, NULL, NULL)", req.ID, svcID.Int64)
		} else if grpID.Valid {
			_, err = tx.Exec("INSERT INTO service_group_members (group_id, member_service_id, member_group_id, member_name) VALUES (?, NULL, ?, NULL)", req.ID, grpID.Int64)
		} else {
			_, err = tx.Exec("INSERT INTO service_group_members (group_id, member_service_id, member_group_id, member_name) VALUES (?, NULL, NULL, ?)", req.ID, member)
		}
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to add member to service group: " + err.Error()})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to commit transaction"})
		return
	}

	logAuditSafe("Service Group Updated", "Objects", "Updated service group: "+req.Name+" in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleServiceGroupDelete(w http.ResponseWriter, r *http.Request) {
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
	dbConn.QueryRow("SELECT name FROM service_groups WHERE id = ?", req.ID).Scan(&name)

	_, err = dbConn.Exec("DELETE FROM service_groups WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete service group: " + err.Error()})
		return
	}

	logAuditSafe("Service Group Deleted", "Objects", "Deleted service group: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
