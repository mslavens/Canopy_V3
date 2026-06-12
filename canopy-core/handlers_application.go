package main

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

func handleApplicationCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DeviceUUID  string `json:"device_uuid"`
		Scope       string `json:"scope"`
		Name        string `json:"name"`
		Category    string `json:"category"`
		Subcategory string `json:"subcategory"`
		Technology  string `json:"technology"`
		Risk        int    `json:"risk"`
		Ports       string `json:"ports"`
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
	err = dbConn.QueryRow("SELECT COUNT(*) FROM application_objects WHERE device_uuid = ? AND name = ?", req.DeviceUUID, req.Name).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "An application signature with this name already exists in the selected scope."})
		return
	}

	res, err := dbConn.Exec(`
		INSERT INTO application_objects (device_uuid, scope, name, category, subcategory, technology, risk, ports, description, dirty)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
	`, req.DeviceUUID, req.Scope, req.Name, req.Category, req.Subcategory, req.Technology, req.Risk, req.Ports, req.Description)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create application: " + err.Error()})
		return
	}

	id, _ := res.LastInsertId()
	logAuditSafe("Application Created", "Objects", "Created application object: "+req.Name+" in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": id})
}
func handleApplicationUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID          int    `json:"id"`
		DeviceUUID  string `json:"device_uuid"`
		Scope       string `json:"scope"`
		Name        string `json:"name"`
		Category    string `json:"category"`
		Subcategory string `json:"subcategory"`
		Technology  string `json:"technology"`
		Risk        int    `json:"risk"`
		Ports       string `json:"ports"`
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
	err = dbConn.QueryRow("SELECT COUNT(*) FROM application_objects WHERE device_uuid = ? AND name = ? AND id != ?", req.DeviceUUID, req.Name, req.ID).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "An application signature with this name already exists in the selected scope."})
		return
	}

	_, err = dbConn.Exec(`
		UPDATE application_objects
		SET device_uuid = ?, scope = ?, name = ?, category = ?, subcategory = ?, technology = ?, risk = ?, ports = ?, description = ?, dirty = 1
		WHERE id = ?
	`, req.DeviceUUID, req.Scope, req.Name, req.Category, req.Subcategory, req.Technology, req.Risk, req.Ports, req.Description, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update application: " + err.Error()})
		return
	}

	logAuditSafe("Application Updated", "Objects", "Updated application object: "+req.Name+" in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleApplicationDelete(w http.ResponseWriter, r *http.Request) {
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
	dbConn.QueryRow("SELECT name FROM application_objects WHERE id = ?", req.ID).Scan(&name)

	_, err = dbConn.Exec("DELETE FROM application_objects WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete application: " + err.Error()})
		return
	}

	logAuditSafe("Application Deleted", "Objects", "Deleted application object: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleApplicationGroupCreate(w http.ResponseWriter, r *http.Request) {
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
	err = tx.QueryRow("SELECT COUNT(*) FROM application_groups WHERE device_uuid = ? AND name = ?", req.DeviceUUID, req.Name).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "An application group with this name already exists in the selected scope."})
		return
	}

	res, err := tx.Exec(`
		INSERT INTO application_groups (device_uuid, scope, name, description, dirty)
		VALUES (?, ?, ?, ?, 1)
	`, req.DeviceUUID, req.Scope, req.Name, req.Description)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create application group: " + err.Error()})
		return
	}
	groupID, _ := res.LastInsertId()

	for _, member := range req.Members {
		member = strings.TrimSpace(member)
		if member == "" {
			continue
		}

		var appID sql.NullInt64
		tx.QueryRow("SELECT id FROM application_objects WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&appID)

		var grpID sql.NullInt64
		tx.QueryRow("SELECT id FROM application_groups WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&grpID)

		if appID.Valid {
			_, err = tx.Exec("INSERT INTO application_group_members (group_id, member_application_id, member_group_id, member_name) VALUES (?, ?, NULL, NULL)", groupID, appID.Int64)
		} else if grpID.Valid {
			_, err = tx.Exec("INSERT INTO application_group_members (group_id, member_application_id, member_group_id, member_name) VALUES (?, NULL, ?, NULL)", groupID, grpID.Int64)
		} else {
			_, err = tx.Exec("INSERT INTO application_group_members (group_id, member_application_id, member_group_id, member_name) VALUES (?, NULL, NULL, ?)", groupID, member)
		}
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to add member to application group: " + err.Error()})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to commit transaction"})
		return
	}

	logAuditSafe("Application Group Created", "Objects", "Created application group: "+req.Name+" in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": groupID})
}
func handleApplicationGroupUpdate(w http.ResponseWriter, r *http.Request) {
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
	err = tx.QueryRow("SELECT COUNT(*) FROM application_groups WHERE device_uuid = ? AND name = ? AND id != ?", req.DeviceUUID, req.Name, req.ID).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "An application group with this name already exists in the selected scope."})
		return
	}

	_, err = tx.Exec(`
		UPDATE application_groups
		SET device_uuid = ?, scope = ?, name = ?, description = ?, dirty = 1
		WHERE id = ?
	`, req.DeviceUUID, req.Scope, req.Name, req.Description, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update application group: " + err.Error()})
		return
	}

	_, err = tx.Exec("DELETE FROM application_group_members WHERE group_id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update application group members: " + err.Error()})
		return
	}

	for _, member := range req.Members {
		member = strings.TrimSpace(member)
		if member == "" {
			continue
		}

		var appID sql.NullInt64
		tx.QueryRow("SELECT id FROM application_objects WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&appID)

		var grpID sql.NullInt64
		tx.QueryRow("SELECT id FROM application_groups WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&grpID)

		if appID.Valid {
			_, err = tx.Exec("INSERT INTO application_group_members (group_id, member_application_id, member_group_id, member_name) VALUES (?, ?, NULL, NULL)", req.ID, appID.Int64)
		} else if grpID.Valid {
			_, err = tx.Exec("INSERT INTO application_group_members (group_id, member_application_id, member_group_id, member_name) VALUES (?, NULL, ?, NULL)", req.ID, grpID.Int64)
		} else {
			_, err = tx.Exec("INSERT INTO application_group_members (group_id, member_application_id, member_group_id, member_name) VALUES (?, NULL, NULL, ?)", req.ID, member)
		}
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to add member to application group: " + err.Error()})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to commit transaction"})
		return
	}

	logAuditSafe("Application Group Updated", "Objects", "Updated application group: "+req.Name+" in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleApplicationGroupDelete(w http.ResponseWriter, r *http.Request) {
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
	dbConn.QueryRow("SELECT name FROM application_groups WHERE id = ?", req.ID).Scan(&name)

	_, err = dbConn.Exec("DELETE FROM application_groups WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete application group: " + err.Error()})
		return
	}

	logAuditSafe("Application Group Deleted", "Objects", "Deleted application group: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleApplicationImportCSV(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.ParseMultipartForm(20 << 20)
	file, _, err := r.FormFile("file")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to retrieve uploaded file: " + err.Error()})
		return
	}
	defer file.Close()

	deviceUUID := r.FormValue("device_uuid")
	scope := r.FormValue("scope")
	if deviceUUID == "" {
		deviceUUID = "paloalto-panorama-global"
		scope = "shared"
	}

	dbConn, err := getActiveDBConn()
	if err != nil {
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	reader := csv.NewReader(file)
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true

	headers, err := reader.Read()
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to read CSV headers: " + err.Error()})
		return
	}

	colMap := make(map[string]int)
	for i, h := range headers {
		cleanHeader := strings.ToLower(strings.TrimSpace(h))
		cleanHeader = strings.ReplaceAll(cleanHeader, " ", "_")
		cleanHeader = strings.ReplaceAll(cleanHeader, "-", "_")
		colMap[cleanHeader] = i
	}

	nameIdx, hasName := colMap["name"]
	categoryIdx, hasCategory := colMap["category"]
	subcategoryIdx, hasSubcategory := colMap["subcategory"]
	if !hasSubcategory {
		subcategoryIdx, hasSubcategory = colMap["sub_category"]
	}
	technologyIdx, hasTechnology := colMap["technology"]
	riskIdx, hasRisk := colMap["risk"]
	portsIdx, hasPorts := colMap["ports"]
	if !hasPorts {
		portsIdx, hasPorts = colMap["standard_ports"]
	}
	descIdx, hasDesc := colMap["description"]

	if !hasName {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "CSV is missing the required 'name' column."})
		return
	}

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction"})
		return
	}
	defer tx.Rollback()

	inserted := 0
	updated := 0

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		if nameIdx >= len(record) {
			continue
		}
		name := strings.TrimSpace(record[nameIdx])
		if name == "" {
			continue
		}

		category := "general-internet"
		if hasCategory && categoryIdx < len(record) {
			if val := strings.TrimSpace(record[categoryIdx]); val != "" {
				category = val
			}
		}

		subcategory := "internet-utility"
		if hasSubcategory && subcategoryIdx < len(record) {
			if val := strings.TrimSpace(record[subcategoryIdx]); val != "" {
				subcategory = val
			}
		}

		technology := "browser-based"
		if hasTechnology && technologyIdx < len(record) {
			if val := strings.TrimSpace(record[technologyIdx]); val != "" {
				technology = val
			}
		}

		risk := 1
		if hasRisk && riskIdx < len(record) {
			if val := strings.TrimSpace(record[riskIdx]); val != "" {
				if rVal, err := strconv.Atoi(val); err == nil {
					risk = rVal
				}
			}
		}

		ports := ""
		if hasPorts && portsIdx < len(record) {
			ports = strings.TrimSpace(record[portsIdx])
		}

		description := ""
		if hasDesc && descIdx < len(record) {
			description = strings.TrimSpace(record[descIdx])
		}

		var existingID int
		err = tx.QueryRow("SELECT id FROM application_objects WHERE device_uuid = ? AND name = ?", deviceUUID, name).Scan(&existingID)
		switch err {
		case sql.ErrNoRows:
			_, err = tx.Exec(`
				INSERT INTO application_objects (device_uuid, scope, name, category, subcategory, technology, risk, ports, description, dirty)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
			`, deviceUUID, scope, name, category, subcategory, technology, risk, ports, description)
			if err == nil {
				inserted++
			}
		case nil:
			_, err = tx.Exec(`
				UPDATE application_objects
				SET category = ?, subcategory = ?, technology = ?, risk = ?, ports = ?, description = ?, dirty = 1
				WHERE id = ?
			`, category, subcategory, technology, risk, ports, description, existingID)
			if err == nil {
				updated++
			}
		}
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to commit database transaction"})
		return
	}

	details := fmt.Sprintf("Imported %d new applications and updated %d existing ones.", inserted, updated)
	logAuditSafe("Imported Application CSV Package", "Objects", details)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"inserted": inserted,
		"updated":  updated,
	})
}
