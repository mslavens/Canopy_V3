package main

import (
	"encoding/json"
	"net/http"
)

func handleLogForwardingProfileCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DeviceUUID  string `json:"device_uuid"`
		Scope       string `json:"scope"`
		Name        string `json:"name"`
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
	err = dbConn.QueryRow("SELECT COUNT(*) FROM log_forwarding_profiles WHERE device_uuid = ? AND name = ?", req.DeviceUUID, req.Name).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "A profile with this name already exists in the selected scope."})
		return
	}
	res, err := dbConn.Exec(`
		INSERT INTO log_forwarding_profiles (device_uuid, scope, name, description)
		VALUES (?, ?, ?, ?)
	`, req.DeviceUUID, req.Scope, req.Name, req.Description)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create log forwarding profile: " + err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	logAuditSafe("Log Forwarding Profile Created", "Objects", "Created log forwarding profile: "+req.Name+" in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": id})
}
func handleLogForwardingProfileUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID          int    `json:"id"`
		DeviceUUID  string `json:"device_uuid"`
		Scope       string `json:"scope"`
		Name        string `json:"name"`
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
		UPDATE log_forwarding_profiles
		SET name = ?, description = ?
		WHERE id = ?
	`, req.Name, req.Description, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update log forwarding profile: " + err.Error()})
		return
	}
	logAuditSafe("Log Forwarding Profile Updated", "Objects", "Updated log forwarding profile: "+req.Name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleLogForwardingProfileDelete(w http.ResponseWriter, r *http.Request) {
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
	dbConn.QueryRow("SELECT name FROM log_forwarding_profiles WHERE id = ?", req.ID).Scan(&name)
	_, err = dbConn.Exec("DELETE FROM log_forwarding_profiles WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete log forwarding profile: " + err.Error()})
		return
	}
	logAuditSafe("Log Forwarding Profile Deleted", "Objects", "Deleted log forwarding profile: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleSecurityProfileCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DeviceUUID string `json:"device_uuid"`
		Scope      string `json:"scope"`
		Name       string `json:"name"`
		Type       string `json:"type"` // url-filtering, antivirus, spyware, vulnerability, wildfire, file-blocking
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
	err = dbConn.QueryRow("SELECT COUNT(*) FROM security_profiles WHERE device_uuid = ? AND name = ? AND type = ?", req.DeviceUUID, req.Name, req.Type).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "A security profile of this type and name already exists in the selected scope."})
		return
	}
	res, err := dbConn.Exec(`
		INSERT INTO security_profiles (device_uuid, scope, name, type)
		VALUES (?, ?, ?, ?)
	`, req.DeviceUUID, req.Scope, req.Name, req.Type)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create security profile: " + err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	logAuditSafe("Security Profile Created", "Objects", "Created security profile: "+req.Name+" ("+req.Type+") in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": id})
}
func handleSecurityProfileUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID         int    `json:"id"`
		DeviceUUID string `json:"device_uuid"`
		Scope      string `json:"scope"`
		Name       string `json:"name"`
		Type       string `json:"type"`
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
		UPDATE security_profiles
		SET name = ?, type = ?
		WHERE id = ?
	`, req.Name, req.Type, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update security profile: " + err.Error()})
		return
	}
	logAuditSafe("Security Profile Updated", "Objects", "Updated security profile: "+req.Name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleSecurityProfileDelete(w http.ResponseWriter, r *http.Request) {
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
	dbConn.QueryRow("SELECT name FROM security_profiles WHERE id = ?", req.ID).Scan(&name)
	_, err = dbConn.Exec("DELETE FROM security_profiles WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete security profile: " + err.Error()})
		return
	}
	logAuditSafe("Security Profile Deleted", "Objects", "Deleted security profile: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleSecurityProfileGroupCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DeviceUUID       string `json:"device_uuid"`
		Scope            string `json:"scope"`
		Name             string `json:"name"`
		Description      string `json:"description"`
		Antivirus        string `json:"antivirus"`
		Spyware          string `json:"spyware"`
		Vulnerability    string `json:"vulnerability"`
		URLFiltering     string `json:"url_filtering"`
		FileBlocking     string `json:"file_blocking"`
		WildfireAnalysis string `json:"wildfire_analysis"`
		DNSSecurity      string `json:"dns_security"`
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
	err = dbConn.QueryRow("SELECT COUNT(*) FROM security_profile_groups WHERE device_uuid = ? AND name = ?", req.DeviceUUID, req.Name).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "A security profile group with this name already exists in the selected scope."})
		return
	}
	res, err := dbConn.Exec(`
		INSERT INTO security_profile_groups (device_uuid, scope, name, description, antivirus, spyware, vulnerability, url_filtering, file_blocking, wildfire_analysis, dns_security)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, req.DeviceUUID, req.Scope, req.Name, req.Description, req.Antivirus, req.Spyware, req.Vulnerability, req.URLFiltering, req.FileBlocking, req.WildfireAnalysis, req.DNSSecurity)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create security profile group: " + err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	logAuditSafe("Security Profile Group Created", "Objects", "Created security profile group: "+req.Name+" in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": id})
}
func handleSecurityProfileGroupUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID               int    `json:"id"`
		DeviceUUID       string `json:"device_uuid"`
		Scope            string `json:"scope"`
		Name             string `json:"name"`
		Description      string `json:"description"`
		Antivirus        string `json:"antivirus"`
		Spyware          string `json:"spyware"`
		Vulnerability    string `json:"vulnerability"`
		URLFiltering     string `json:"url_filtering"`
		FileBlocking     string `json:"file_blocking"`
		WildfireAnalysis string `json:"wildfire_analysis"`
		DNSSecurity      string `json:"dns_security"`
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
		UPDATE security_profile_groups
		SET name = ?, description = ?, antivirus = ?, spyware = ?, vulnerability = ?, url_filtering = ?, file_blocking = ?, wildfire_analysis = ?, dns_security = ?
		WHERE id = ?
	`, req.Name, req.Description, req.Antivirus, req.Spyware, req.Vulnerability, req.URLFiltering, req.FileBlocking, req.WildfireAnalysis, req.DNSSecurity, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update security profile group: " + err.Error()})
		return
	}
	logAuditSafe("Security Profile Group Updated", "Objects", "Updated security profile group: "+req.Name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleSecurityProfileGroupDelete(w http.ResponseWriter, r *http.Request) {
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
	dbConn.QueryRow("SELECT name FROM security_profile_groups WHERE id = ?", req.ID).Scan(&name)
	_, err = dbConn.Exec("DELETE FROM security_profile_groups WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete security profile group: " + err.Error()})
		return
	}
	logAuditSafe("Security Profile Group Deleted", "Objects", "Deleted security profile group: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleCustomURLCategoryCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DeviceUUID  string `json:"device_uuid"`
		Scope       string `json:"scope"`
		Name        string `json:"name"`
		Description string `json:"description"`
		URLList     string `json:"url_list"`
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
	err = dbConn.QueryRow("SELECT COUNT(*) FROM custom_url_categories WHERE device_uuid = ? AND name = ?", req.DeviceUUID, req.Name).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "A custom URL category with this name already exists in the selected scope."})
		return
	}
	res, err := dbConn.Exec(`
		INSERT INTO custom_url_categories (device_uuid, scope, name, description, url_list)
		VALUES (?, ?, ?, ?, ?)
	`, req.DeviceUUID, req.Scope, req.Name, req.Description, req.URLList)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create custom URL category: " + err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	logAuditSafe("Custom URL Category Created", "Objects", "Created custom URL category: "+req.Name+" in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": id})
}
func handleCustomURLCategoryUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID          int    `json:"id"`
		DeviceUUID  string `json:"device_uuid"`
		Scope       string `json:"scope"`
		Name        string `json:"name"`
		Description string `json:"description"`
		URLList     string `json:"url_list"`
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
		UPDATE custom_url_categories
		SET name = ?, description = ?, url_list = ?
		WHERE id = ?
	`, req.Name, req.Description, req.URLList, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update custom URL category: " + err.Error()})
		return
	}
	logAuditSafe("Custom URL Category Updated", "Objects", "Updated custom URL category: "+req.Name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleCustomURLCategoryDelete(w http.ResponseWriter, r *http.Request) {
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
	dbConn.QueryRow("SELECT name FROM custom_url_categories WHERE id = ?", req.ID).Scan(&name)
	_, err = dbConn.Exec("DELETE FROM custom_url_categories WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete custom URL category: " + err.Error()})
		return
	}
	logAuditSafe("Custom URL Category Deleted", "Objects", "Deleted custom URL category: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleExternalDynamicListCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		DeviceUUID  string `json:"device_uuid"`
		Scope       string `json:"scope"`
		Name        string `json:"name"`
		Description string `json:"description"`
		ListType    string `json:"list_type"`
		SourceURL   string `json:"source_url"`
		Recurring   string `json:"recurring"`
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
	err = dbConn.QueryRow("SELECT COUNT(*) FROM external_dynamic_lists WHERE device_uuid = ? AND name = ?", req.DeviceUUID, req.Name).Scan(&count)
	if err == nil && count > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "An EDL with this name already exists in the selected scope."})
		return
	}
	res, err := dbConn.Exec(`
		INSERT INTO external_dynamic_lists (device_uuid, scope, name, description, list_type, source_url, recurring)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, req.DeviceUUID, req.Scope, req.Name, req.Description, req.ListType, req.SourceURL, req.Recurring)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create EDL: " + err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	logAuditSafe("External Dynamic List Created", "Objects", "Created EDL: "+req.Name+" in scope: "+req.Scope)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": id})
}
func handleExternalDynamicListUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID          int    `json:"id"`
		DeviceUUID  string `json:"device_uuid"`
		Scope       string `json:"scope"`
		Name        string `json:"name"`
		Description string `json:"description"`
		ListType    string `json:"list_type"`
		SourceURL   string `json:"source_url"`
		Recurring   string `json:"recurring"`
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
		UPDATE external_dynamic_lists
		SET name = ?, description = ?, list_type = ?, source_url = ?, recurring = ?
		WHERE id = ?
	`, req.Name, req.Description, req.ListType, req.SourceURL, req.Recurring, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update EDL: " + err.Error()})
		return
	}
	logAuditSafe("External Dynamic List Updated", "Objects", "Updated EDL: "+req.Name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
func handleExternalDynamicListDelete(w http.ResponseWriter, r *http.Request) {
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
	dbConn.QueryRow("SELECT name FROM external_dynamic_lists WHERE id = ?", req.ID).Scan(&name)
	_, err = dbConn.Exec("DELETE FROM external_dynamic_lists WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete EDL: " + err.Error()})
		return
	}
	logAuditSafe("External Dynamic List Deleted", "Objects", "Deleted EDL: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}
