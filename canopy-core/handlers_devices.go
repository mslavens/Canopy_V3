package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"strings"

	"canopy-core/adapters/paloalto"
	"canopy-core/storage"
)

func handleDeviceGroupsCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name        string `json:"name"`
		ParentID    *int   `json:"parent_id"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Name is required."})
		return
	}
	name := strings.TrimSpace(req.Name)
	uuid := "paloalto-dg-" + name

	vaultMutex.Lock()
	if activeDB == nil {
		vaultMutex.Unlock()
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
		return
	}
	dbConn := activeDB.DB()
	vaultMutex.Unlock()

	// Verify uniqueness
	var exists int
	err := dbConn.QueryRow("SELECT COUNT(*) FROM device_groups WHERE name = ? OR uuid = ?", name, uuid).Scan(&exists)
	if err == nil && exists > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "A device group with this name or UUID already exists."})
		return
	}

	// Resolve parent details
	var parentID interface{}
	parentUUID := "paloalto-dg-shared"

	if req.ParentID != nil && *req.ParentID > 0 {
		var pUUID string
		err := dbConn.QueryRow("SELECT uuid FROM device_groups WHERE id = ?", *req.ParentID).Scan(&pUUID)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Parent device group not found."})
			return
		}
		parentID = *req.ParentID
		parentUUID = pUUID
	} else {
		// Find shared parent ID
		var sharedID int
		err := dbConn.QueryRow("SELECT id FROM device_groups WHERE uuid = 'paloalto-dg-shared'").Scan(&sharedID)
		if err == nil {
			parentID = sharedID
		} else {
			parentID = nil
		}
	}

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
		return
	}
	defer tx.Rollback()

	res, err := tx.Exec("INSERT INTO device_groups (device_uuid, uuid, name, parent_id, description) VALUES ('paloalto-panorama-global', ?, ?, ?, ?)", uuid, name, parentID, req.Description)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to insert device group: " + err.Error()})
		return
	}
	dgID, _ := res.LastInsertId()

	_, err = tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'device-group', ?, ?, ?)", uuid, dgID, name+" (Device Group)", parentUUID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to register scope: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
		return
	}

	logAuditSafe("Device Group Created", "Network", "Added new device group: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": dgID, "uuid": uuid})
}

func handleDeviceGroupsUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID          int    `json:"id"`
		Name        string `json:"name"`
		ParentID    *int   `json:"parent_id"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 || strings.TrimSpace(req.Name) == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID and Name are required."})
		return
	}
	name := strings.TrimSpace(req.Name)

	vaultMutex.Lock()
	if activeDB == nil {
		vaultMutex.Unlock()
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
		return
	}
	dbConn := activeDB.DB()
	vaultMutex.Unlock()

	// Get current group details
	var currentUUID, currentName string
	err := dbConn.QueryRow("SELECT uuid, name FROM device_groups WHERE id = ?", req.ID).Scan(&currentUUID, &currentName)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Device group not found."})
		return
	}

	// Check name collision
	if name != currentName {
		var collision int
		dbConn.QueryRow("SELECT COUNT(*) FROM device_groups WHERE name = ? AND id != ?", name, req.ID).Scan(&collision)
		if collision > 0 {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "A device group with this name already exists."})
			return
		}
	}

	// Prevent circular dependency in parent hierarchy
	if req.ParentID != nil && *req.ParentID > 0 {
		if *req.ParentID == req.ID {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "A device group cannot be its own parent."})
			return
		}
		currParent := *req.ParentID
		for {
			var nextParent *int
			err := dbConn.QueryRow("SELECT parent_id FROM device_groups WHERE id = ?", currParent).Scan(&nextParent)
			if err != nil {
				break
			}
			if nextParent == nil {
				break
			}
			if *nextParent == req.ID {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "Circular parent-child relationship detected."})
				return
			}
			currParent = *nextParent
		}
	}

	// Resolve new parent Details
	var parentID interface{}
	parentUUID := "paloalto-dg-shared"

	if req.ParentID != nil && *req.ParentID > 0 {
		var pUUID string
		err := dbConn.QueryRow("SELECT uuid FROM device_groups WHERE id = ?", *req.ParentID).Scan(&pUUID)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Parent group not found."})
			return
		}
		parentID = *req.ParentID
		parentUUID = pUUID
	} else {
		// Find shared parent ID
		var sharedID int
		err := dbConn.QueryRow("SELECT id FROM device_groups WHERE uuid = 'paloalto-dg-shared'").Scan(&sharedID)
		if err == nil {
			parentID = sharedID
		} else {
			parentID = nil
		}
	}

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
		return
	}
	defer tx.Rollback()

	// Update device group name, parent, and description
	_, err = tx.Exec("UPDATE device_groups SET name = ?, parent_id = ?, description = ? WHERE id = ?", name, parentID, req.Description, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update device group: " + err.Error()})
		return
	}

	// Update scopes name and parent_uuid
	_, err = tx.Exec("UPDATE scopes SET name = ?, parent_uuid = ? WHERE type = 'device-group' AND reference_id = ?", name+" (Device Group)", parentUUID, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update scope: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
		return
	}

	logAuditSafe("Device Group Updated", "Network", "Renamed or updated device group parent context: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func handleDeviceGroupsDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID int `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID is required."})
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

	// Get current group details
	var uuid, name string
	err := dbConn.QueryRow("SELECT uuid, name FROM device_groups WHERE id = ?", req.ID).Scan(&uuid, &name)
	if err != nil {
		// Idempotent success
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
		return
	}

	if uuid == "paloalto-dg-shared" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Cannot delete the root 'shared' device group context."})
		return
	}

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
		return
	}
	defer tx.Rollback()

	// Manually orphan child groups back to shared root rather than deleting them
	var sharedID int
	err = tx.QueryRow("SELECT id FROM device_groups WHERE uuid = 'paloalto-dg-shared'").Scan(&sharedID)
	if err == nil {
		tx.Exec("UPDATE device_groups SET parent_id = ? WHERE parent_id = ?", sharedID, req.ID)
		tx.Exec("UPDATE scopes SET parent_uuid = 'paloalto-dg-shared' WHERE parent_uuid = ?", uuid)
	} else {
		tx.Exec("UPDATE device_groups SET parent_id = NULL WHERE parent_id = ?", req.ID)
		tx.Exec("UPDATE scopes SET parent_uuid = NULL WHERE parent_uuid = ?", uuid)
	}

	// Delete the group context's scope (triggers SQLite cascading delete on objects/rules belonging to this group)
	_, err = tx.Exec("DELETE FROM scopes WHERE uuid = ?", uuid)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete scope hierarchy: " + err.Error()})
		return
	}

	// Delete from physical device groups
	_, err = tx.Exec("DELETE FROM device_groups WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete device group: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
		return
	}

	logAuditSafe("Device Group Deleted", "Network", "Removed device group: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func handleTemplatesCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Name is required."})
		return
	}
	name := strings.TrimSpace(req.Name)
	uuid := "panorama-tmpl-" + name

	vaultMutex.Lock()
	if activeDB == nil {
		vaultMutex.Unlock()
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
		return
	}
	dbConn := activeDB.DB()
	vaultMutex.Unlock()

	// Verify uniqueness
	var exists int
	err := dbConn.QueryRow("SELECT COUNT(*) FROM templates WHERE name = ? OR uuid = ?", name, uuid).Scan(&exists)
	if err == nil && exists > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "A template with this name or UUID already exists."})
		return
	}

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
		return
	}
	defer tx.Rollback()

	res, err := tx.Exec("INSERT INTO templates (device_uuid, uuid, name) VALUES ('paloalto-panorama-global', ?, ?)", uuid, name)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to insert template: " + err.Error()})
		return
	}
	tmplID, _ := res.LastInsertId()

	_, err = tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'template', ?, ?, NULL)", uuid, tmplID, name+" (Panorama)")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to register scope: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
		return
	}

	logAuditSafe("Template Created", "Network", "Added base template: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": tmplID, "uuid": uuid})
}

func handleTemplatesUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 || strings.TrimSpace(req.Name) == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID and Name are required."})
		return
	}
	name := strings.TrimSpace(req.Name)

	vaultMutex.Lock()
	if activeDB == nil {
		vaultMutex.Unlock()
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
		return
	}
	dbConn := activeDB.DB()
	vaultMutex.Unlock()

	// Verify exists
	var currentName string
	err := dbConn.QueryRow("SELECT name FROM templates WHERE id = ?", req.ID).Scan(&currentName)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Template not found."})
		return
	}

	if name != currentName {
		var collision int
		dbConn.QueryRow("SELECT COUNT(*) FROM templates WHERE name = ? AND id != ?", name, req.ID).Scan(&collision)
		if collision > 0 {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "A template with this name already exists."})
			return
		}
	}

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec("UPDATE templates SET name = ? WHERE id = ?", name, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update template: " + err.Error()})
		return
	}

	_, err = tx.Exec("UPDATE scopes SET name = ? WHERE type = 'template' AND reference_id = ?", name+" (Panorama)", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update scope: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
		return
	}

	logAuditSafe("Template Updated", "Network", "Renamed template: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func handleTemplatesDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID int `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID is required."})
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

	var uuid, name string
	err := dbConn.QueryRow("SELECT uuid, name FROM templates WHERE id = ?", req.ID).Scan(&uuid, &name)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
		return
	}

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec("DELETE FROM scopes WHERE uuid = ?", uuid)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete template scope: " + err.Error()})
		return
	}

	_, err = tx.Exec("DELETE FROM templates WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete template: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
		return
	}

	logAuditSafe("Template Deleted", "Network", "Removed template: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func handleTemplateStacksCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name        string `json:"name"`
		TemplateIDs []int  `json:"template_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Name is required."})
		return
	}
	name := strings.TrimSpace(req.Name)
	uuid := "panorama-stack-" + name

	vaultMutex.Lock()
	if activeDB == nil {
		vaultMutex.Unlock()
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
		return
	}
	dbConn := activeDB.DB()
	vaultMutex.Unlock()

	// Verify uniqueness
	var exists int
	err := dbConn.QueryRow("SELECT COUNT(*) FROM template_stacks WHERE name = ? OR uuid = ?", name, uuid).Scan(&exists)
	if err == nil && exists > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "A template stack with this name or UUID already exists."})
		return
	}

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
		return
	}
	defer tx.Rollback()

	res, err := tx.Exec("INSERT INTO template_stacks (device_uuid, uuid, name) VALUES ('paloalto-panorama-global', ?, ?)", uuid, name)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to insert template stack: " + err.Error()})
		return
	}
	stackID, _ := res.LastInsertId()

	_, err = tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'template-stack', ?, ?, NULL)", uuid, stackID, name+" (Template Stack)")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to register scope: " + err.Error()})
		return
	}

	// Insert member sequence
	for seq, tmplID := range req.TemplateIDs {
		_, err = tx.Exec("INSERT INTO template_stack_members_raw (stack_id, template_id, sequence) VALUES (?, ?, ?)", stackID, tmplID, seq+1)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to insert stack member template ID: " + err.Error()})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
		return
	}

	logAuditSafe("Template Stack Created", "Network", "Created template stack: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": stackID, "uuid": uuid})
}

func handleTemplateStacksUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID          int    `json:"id"`
		Name        string `json:"name"`
		TemplateIDs []int  `json:"template_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 || strings.TrimSpace(req.Name) == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID and Name are required."})
		return
	}
	name := strings.TrimSpace(req.Name)

	vaultMutex.Lock()
	if activeDB == nil {
		vaultMutex.Unlock()
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
		return
	}
	dbConn := activeDB.DB()
	vaultMutex.Unlock()

	// Verify exists
	var currentName string
	err := dbConn.QueryRow("SELECT name FROM template_stacks WHERE id = ?", req.ID).Scan(&currentName)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Template stack not found."})
		return
	}

	if name != currentName {
		var collision int
		dbConn.QueryRow("SELECT COUNT(*) FROM template_stacks WHERE name = ? AND id != ?", name, req.ID).Scan(&collision)
		if collision > 0 {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "A template stack with this name already exists."})
			return
		}
	}

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec("UPDATE template_stacks SET name = ? WHERE id = ?", name, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update stack: " + err.Error()})
		return
	}

	_, err = tx.Exec("UPDATE scopes SET name = ? WHERE type = 'template-stack' AND reference_id = ?", name+" (Template Stack)", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update scope: " + err.Error()})
		return
	}

	// Rebuild stack members sequence
	_, err = tx.Exec("DELETE FROM template_stack_members_raw WHERE stack_id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to clean old stack members: " + err.Error()})
		return
	}

	for seq, tmplID := range req.TemplateIDs {
		_, err = tx.Exec("INSERT INTO template_stack_members_raw (stack_id, template_id, sequence) VALUES (?, ?, ?)", req.ID, tmplID, seq+1)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to insert updated stack member: " + err.Error()})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
		return
	}

	logAuditSafe("Template Stack Updated", "Network", "Updated template stack context: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func handleTemplateStacksDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID int `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID is required."})
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

	var uuid, name string
	err := dbConn.QueryRow("SELECT uuid, name FROM template_stacks WHERE id = ?", req.ID).Scan(&uuid, &name)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
		return
	}

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec("DELETE FROM scopes WHERE uuid = ?", uuid)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete stack scope: " + err.Error()})
		return
	}

	_, err = tx.Exec("DELETE FROM template_stacks WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete stack: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
		return
	}

	logAuditSafe("Template Stack Deleted", "Network", "Removed template stack: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func handleDevicesCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name            string `json:"name"`
		Serial          string `json:"serial"`
		IPAddress       string `json:"ip_address"`
		DeviceGroupID   *int   `json:"device_group_id"`
		TemplateStackID *int   `json:"template_stack_id"`
		TemplateID      *int   `json:"template_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.Serial) == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Name and Serial Number are required."})
		return
	}
	name := strings.TrimSpace(req.Name)
	serial := strings.TrimSpace(req.Serial)
	ipAddress := strings.TrimSpace(req.IPAddress)

	vaultMutex.Lock()
	if activeDB == nil {
		vaultMutex.Unlock()
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
		return
	}
	dbConn := activeDB.DB()
	vaultMutex.Unlock()

	// Verify uniqueness of serial
	var exists int
	err := dbConn.QueryRow("SELECT COUNT(*) FROM managed_devices_raw WHERE serial = ?", serial).Scan(&exists)
	if err == nil && exists > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "A device with this serial number is already registered."})
		return
	}

	// Determine parent scope UUID
	var parentScopeUUID interface{}
	if req.DeviceGroupID != nil && *req.DeviceGroupID > 0 {
		var dgUUID string
		err = dbConn.QueryRow("SELECT uuid FROM device_groups WHERE id = ?", *req.DeviceGroupID).Scan(&dgUUID)
		if err == nil {
			parentScopeUUID = dgUUID
		}
	} else if req.TemplateStackID != nil && *req.TemplateStackID > 0 {
		var stackUUID string
		err = dbConn.QueryRow("SELECT uuid FROM template_stacks WHERE id = ?", *req.TemplateStackID).Scan(&stackUUID)
		if err == nil {
			parentScopeUUID = stackUUID
		}
	} else if req.TemplateID != nil && *req.TemplateID > 0 {
		var tmplUUID string
		err = dbConn.QueryRow("SELECT uuid FROM templates WHERE id = ?", *req.TemplateID).Scan(&tmplUUID)
		if err == nil {
			parentScopeUUID = tmplUUID
		}
	}

	deviceUUID := "paloalto-fw-" + name + "-" + serial

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
		return
	}
	defer tx.Rollback()

	// Insert into scopes first (to satisfy managed_devices_raw FK constraint on device_uuid)
	// We insert with reference_id = NULL first, and update it to the ID after insertion.
	_, err = tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'firewall', NULL, ?, ?)", deviceUUID, name, parentScopeUUID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create scope context: " + err.Error()})
		return
	}

	res, err := tx.Exec(`
		INSERT INTO managed_devices_raw (device_uuid, serial, name, ip_address, device_group_id, template_stack_id, template_id)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, deviceUUID, serial, name, ipAddress, req.DeviceGroupID, req.TemplateStackID, req.TemplateID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to insert device record: " + err.Error()})
		return
	}
	mdevID, _ := res.LastInsertId()

	// Update reference_id in scopes
	_, err = tx.Exec("UPDATE scopes SET reference_id = ? WHERE uuid = ?", mdevID, deviceUUID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update scope reference: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
		return
	}

	logAuditSafe("Device Created", "Network", "Registered managed device: "+name+" (S/N: "+serial+")")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "id": mdevID, "uuid": deviceUUID})
}

func handleDevicesUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID              int    `json:"id"`
		Name            string `json:"name"`
		Serial          string `json:"serial"`
		IPAddress       string `json:"ip_address"`
		DeviceGroupID   *int   `json:"device_group_id"`
		TemplateStackID *int   `json:"template_stack_id"`
		TemplateID      *int   `json:"template_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 || strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.Serial) == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID, Name and Serial Number are required."})
		return
	}
	name := strings.TrimSpace(req.Name)
	serial := strings.TrimSpace(req.Serial)
	ipAddress := strings.TrimSpace(req.IPAddress)

	vaultMutex.Lock()
	if activeDB == nil {
		vaultMutex.Unlock()
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
		return
	}
	dbConn := activeDB.DB()
	vaultMutex.Unlock()

	// Verify exists and check serial uniqueness
	var oldSerial, oldDeviceUUID string
	err := dbConn.QueryRow("SELECT serial, device_uuid FROM managed_devices_raw WHERE id = ?", req.ID).Scan(&oldSerial, &oldDeviceUUID)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Device not found."})
		return
	}

	if serial != oldSerial {
		var collision int
		dbConn.QueryRow("SELECT COUNT(*) FROM managed_devices_raw WHERE serial = ? AND id != ?", serial, req.ID).Scan(&collision)
		if collision > 0 {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "A device with this serial number is already registered."})
			return
		}
	}

	// Determine parent scope UUID
	var parentScopeUUID interface{}
	if req.DeviceGroupID != nil && *req.DeviceGroupID > 0 {
		var dgUUID string
		err = dbConn.QueryRow("SELECT uuid FROM device_groups WHERE id = ?", *req.DeviceGroupID).Scan(&dgUUID)
		if err == nil {
			parentScopeUUID = dgUUID
		}
	} else if req.TemplateStackID != nil && *req.TemplateStackID > 0 {
		var stackUUID string
		err = dbConn.QueryRow("SELECT uuid FROM template_stacks WHERE id = ?", *req.TemplateStackID).Scan(&stackUUID)
		if err == nil {
			parentScopeUUID = stackUUID
		}
	} else if req.TemplateID != nil && *req.TemplateID > 0 {
		var tmplUUID string
		err = dbConn.QueryRow("SELECT uuid FROM templates WHERE id = ?", *req.TemplateID).Scan(&tmplUUID)
		if err == nil {
			parentScopeUUID = tmplUUID
		}
	}

	ctx := r.Context()
	conn, err := dbConn.Conn(ctx)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to acquire database connection: " + err.Error()})
		return
	}
	defer conn.Close()

	// Temporarily disable foreign keys for this connection
	if _, err := conn.ExecContext(ctx, "PRAGMA foreign_keys = OFF;"); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to disable foreign keys: " + err.Error()})
		return
	}
	// Ensure we restore foreign keys when the connection returns to the pool
	defer conn.ExecContext(ctx, "PRAGMA foreign_keys = ON;")

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction: " + err.Error()})
		return
	}
	defer tx.Rollback()

	// If the name or serial changed, we can update the scope's UUID to reflect the new name & serial
	newDeviceUUID := "paloalto-fw-" + name + "-" + serial

	// Update managed_devices_raw
	_, err = tx.ExecContext(ctx, `
		UPDATE managed_devices_raw 
		SET device_uuid = ?, serial = ?, name = ?, ip_address = ?, device_group_id = ?, template_stack_id = ?, template_id = ?
		WHERE id = ?
	`, newDeviceUUID, serial, name, ipAddress, req.DeviceGroupID, req.TemplateStackID, req.TemplateID, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update device record: " + err.Error()})
		return
	}

	// Since scopes.uuid is UNIQUE and reference_id links them, update both UUID, name, and parent_uuid
	_, err = tx.ExecContext(ctx, `
		UPDATE scopes 
		SET uuid = ?, name = ?, parent_uuid = ?
		WHERE type = 'firewall' AND reference_id = ?
	`, newDeviceUUID, name, parentScopeUUID, req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update scope context: " + err.Error()})
		return
	}

	// Cascade device_uuid update to all referencing tables
	referencingTables := []string{
		"device_groups", "templates", "template_stacks", "network_topology",
		"address_objects", "address_groups", "service_objects", "service_groups",
		"application_objects", "regions", "schedules", "tags",
		"security_profiles", "security_rules", "nat_rules", "qos_rules",
		"pbf_rules", "decryption_rules", "application_override_rules",
		"tunnel_inspection_rules", "static_routes",
	}
	for _, table := range referencingTables {
		_, err = tx.ExecContext(ctx, fmt.Sprintf("UPDATE %s SET device_uuid = ? WHERE device_uuid = ?", table), newDeviceUUID, oldDeviceUUID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("Failed to cascade device UUID update to %s: %s", table, err.Error())})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed: " + err.Error()})
		return
	}

	logAuditSafe("Device Updated", "Network", "Updated managed device: "+name+" (S/N: "+serial+")")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func handleDevicesDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID int `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Valid ID is required."})
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

	var deviceUUID, name string
	err := dbConn.QueryRow("SELECT device_uuid, name FROM managed_devices_raw WHERE id = ?", req.ID).Scan(&deviceUUID, &name)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
		return
	}

	tx, err := dbConn.Begin()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to start database transaction."})
		return
	}
	defer tx.Rollback()

	// Delete scope first (deletes any child interfaces, static routes, zones, rules etc.)
	_, err = tx.Exec("DELETE FROM scopes WHERE uuid = ?", deviceUUID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete device scope: " + err.Error()})
		return
	}

	// Delete firewall raw record
	_, err = tx.Exec("DELETE FROM managed_devices_raw WHERE id = ?", req.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete device record: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Transaction commit failed."})
		return
	}

	logAuditSafe("Device Deleted", "Network", "Removed managed device: "+name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func handleDevicesImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
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
	dbConn := activeDB
	vaultMutex.RUnlock()

	file, header, err := r.FormFile("xml")
	if err != nil {
		// fallback to form field "file"
		file, header, err = r.FormFile("file")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "No file found in payload."})
			return
		}
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to read uploaded file."})
		return
	}

	type xmlFile struct {
		Name string
		Data []byte
	}
	var xmlFiles []xmlFile
	// Sniff gzip magic bytes: 0x1f 0x8b
	isGzip := len(fileBytes) >= 2 && fileBytes[0] == 0x1f && fileBytes[1] == 0x8b

	if isGzip {
		gzipReader, err := gzip.NewReader(bytes.NewReader(fileBytes))
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to initialize gzip decompressor: " + err.Error()})
			return
		}
		defer gzipReader.Close()

		tarReader := tar.NewReader(gzipReader)
		for {
			tarHeader, err := tarReader.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "Failed to read tar archive: " + err.Error()})
				return
			}

			if !tarHeader.FileInfo().IsDir() && strings.HasSuffix(strings.ToLower(tarHeader.Name), ".xml") {
				data, err := io.ReadAll(tarReader)
				if err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					json.NewEncoder(w).Encode(map[string]string{"error": "Failed to read XML file from tar archive: " + err.Error()})
					return
				}
				xmlFiles = append(xmlFiles, xmlFile{
					Name: tarHeader.Name,
					Data: data,
				})
				slog.Info("Extracted config file from archive bundle", slog.String("filename", tarHeader.Name))
			}
		}

		if len(xmlFiles) == 0 {
			w.WriteHeader(http.StatusUnprocessableEntity)
			json.NewEncoder(w).Encode(map[string]string{"error": "No XML configuration files found inside the tar bundle."})
			return
		}
	} else {
		var filename string
		if header != nil {
			filename = header.Filename
		} else {
			filename = "uploaded_config.xml"
		}
		xmlFiles = append(xmlFiles, xmlFile{
			Name: filename,
			Data: fileBytes,
		})
	}

	concreteDB, ok := dbConn.(*storage.AppStateDB)
	if !ok {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal database connection type mismatch."})
		return
	}

	adapter := paloalto.NewAdapter(concreteDB)

	// Sort xmlFiles so that Panorama configurations are processed first,
	// and prefer running-config.xml over candidate configs.
	sort.SliceStable(xmlFiles, func(i, j int) bool {
		pi := adapter.IsPanoramaConfig(xmlFiles[i].Data)
		pj := adapter.IsPanoramaConfig(xmlFiles[j].Data)
		if pi != pj {
			return pi
		}
		ri := strings.HasSuffix(xmlFiles[i].Name, "running-config.xml")
		rj := strings.HasSuffix(xmlFiles[j].Name, "running-config.xml")
		if ri != rj {
			return ri
		}
		return false
	})

	preview := r.URL.Query().Get("preview") == "true"
	if preview {
		var combinedStats paloalto.IngestionStats
		combinedStats.DeviceGroups = []string{}
		combinedStats.Firewalls = []string{}
		combinedStats.Warnings = []string{}
		validConfigsCount := 0

		for _, f := range xmlFiles {
			stats, err := adapter.Analyze(f.Data, f.Name)
			if err != nil {
				slog.Error("Analyze failed for file", slog.String("name", f.Name), slog.Any("error", err))
				combinedStats.Warnings = append(combinedStats.Warnings, fmt.Sprintf("Failed to parse %s: %v", f.Name, err))
				continue
			}
			if stats.DevicesCount == 0 && stats.TemplatesCount == 0 && len(stats.DeviceGroups) == 0 && len(stats.Firewalls) == 0 {
				continue
			}

			if combinedStats.ConfigType == "" || stats.ConfigType == "Panorama" {
				combinedStats.ConfigType = stats.ConfigType
			}
			combinedStats.DeviceGroups = append(combinedStats.DeviceGroups, stats.DeviceGroups...)
			combinedStats.Firewalls = append(combinedStats.Firewalls, stats.Firewalls...)
			combinedStats.TemplatesCount += stats.TemplatesCount
			combinedStats.DevicesCount += stats.DevicesCount
			combinedStats.InterfacesCount += stats.InterfacesCount
			combinedStats.ZonesCount += stats.ZonesCount
			combinedStats.VirtualRoutersCount += stats.VirtualRoutersCount
			combinedStats.AddedCount += stats.AddedCount
			combinedStats.ModifiedCount += stats.ModifiedCount
			combinedStats.UnchangedCount += stats.UnchangedCount
			combinedStats.Warnings = append(combinedStats.Warnings, stats.Warnings...)
			validConfigsCount++
		}

		if validConfigsCount == 0 {
			w.WriteHeader(http.StatusUnprocessableEntity)
			json.NewEncoder(w).Encode(map[string]string{"error": "No valid Palo Alto configurations found inside the uploaded payload."})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"preview":     true,
			"config_type":    combinedStats.ConfigType,
			"device_groups":  combinedStats.DeviceGroups,
			"firewalls":      combinedStats.Firewalls,
			"warnings":       combinedStats.Warnings,
			"stats": map[string]interface{}{
				"templates_count":       combinedStats.TemplatesCount,
				"devices_count":         combinedStats.DevicesCount,
				"interfaces_count":      combinedStats.InterfacesCount,
				"zones_count":           combinedStats.ZonesCount,
				"virtual_routers_count": combinedStats.VirtualRoutersCount,
				"added_count":           combinedStats.AddedCount,
				"modified_count":        combinedStats.ModifiedCount,
				"unchanged_count":       combinedStats.UnchangedCount,
			},
		})
		return
	}

	// Set up NDJSON streaming for live progress updates
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Transfer-Encoding", "chunked")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	flusher, ok := w.(http.Flusher)

	// Pre-filter to only include files that are valid configurations to import
	var validFiles []xmlFile
	hasPanorama := false
	localFwSerials := make(map[string]bool)

	for _, f := range xmlFiles {
		stats, err := adapter.Analyze(f.Data, f.Name)
		if err != nil || (stats.DevicesCount == 0 && stats.TemplatesCount == 0 && len(stats.DeviceGroups) == 0 && len(stats.Firewalls) == 0) {
			continue
		}

		if stats.ConfigType == "Panorama" {
			if hasPanorama {
				continue // We already have the preferred Panorama config
			}
			hasPanorama = true
		} else {
			// Naive serial extraction for local firewalls (e.g., from filename)
			// In a real scenario, this would use the parsed serial from Analyze
			serial := f.Name
			if idx := strings.LastIndex(f.Name, "_"); idx != -1 {
				serial = f.Name[idx+1:]
			}
			if localFwSerials[serial] {
				continue // We already have the preferred config for this firewall
			}
			localFwSerials[serial] = true
		}

		validFiles = append(validFiles, f)
	}

	totalFiles := len(validFiles)
	if totalFiles == 0 {
		json.NewEncoder(w).Encode(map[string]string{"error": "No valid configurations found to import."})
		return
	}

	sendProgress := func(step int, percent int, detail string, fileIndex int, filename string, fileStep int, filePercent int) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"progress":     true,
			"step":         step,
			"percent":      percent,
			"detail":       detail,
			"file_index":   fileIndex,
			"total_files":  totalFiles,
			"filename":     filename,
			"file_step":    fileStep,
			"file_percent": filePercent,
		})
		if ok {
			flusher.Flush()
		}
	}

	// Send initial setup progress event with the list of files to be processed
	var filenames []string
	for _, vf := range validFiles {
		filenames = append(filenames, vf.Name)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"progress":    true,
		"init":        true,
		"total_files": totalFiles,
		"files":       filenames,
		"percent":     0,
		"detail":      "Initializing ingestion pipeline...",
	})
	if ok {
		flusher.Flush()
	}

	totalDevCount := 0
	totalTopoCount := 0

	for i, f := range validFiles {
		devCount, topoCount, err := adapter.ParseAndStore(f.Data, f.Name, func(step int, percent int, detail string) {
			// Scale percentage based on the active file index relative to the total files
			scaledPercent := int(float64(i)*100.0/float64(totalFiles) + float64(percent)/float64(totalFiles))
			if scaledPercent > 100 {
				scaledPercent = 100
			}
			detailStr := detail
			if step < 5 {
				detailStr = fmt.Sprintf("[%d/%d] %s", i+1, totalFiles, detail)
			}
			sendProgress(step, scaledPercent, detailStr, i, f.Name, step, percent)
		})
		if err != nil {
			json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("Import failure: %v", err)})
			return
		}
		totalDevCount += devCount
		totalTopoCount += topoCount
	}

	logAuditSafe("Device XML Imported", "Network", fmt.Sprintf("Imported %d devices/templates and %d interface topology routes.", totalDevCount, totalTopoCount))

	// Write final response
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":             true,
		"devices_imported":    totalDevCount,
		"topologies_imported": totalTopoCount,
	})
	if ok {
		flusher.Flush()
	}
}

func handleGetInventory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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

	// 1. Inventory Devices
	invRows, err := dbConn.Query(`SELECT m.id, m.serial, m.name, m.ip_address, m.device_group_id, m.template_stack_id, m.template_id, dg.name AS device_group, COALESCE(ts.name, t.name) AS template_stack FROM managed_devices_raw m LEFT JOIN device_groups dg ON m.device_group_id = dg.id LEFT JOIN template_stacks ts ON m.template_stack_id = ts.id LEFT JOIN templates t ON m.template_id = t.id ORDER BY m.name ASC`)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to query inventory: " + err.Error()})
		return
	}
	defer invRows.Close()

	var inventory []map[string]interface{}
	for invRows.Next() {
		var id int
		var serial, name, ipAddress string
		var deviceGroupID, templateStackID, templateID *int
		var deviceGroup, templateStack *string
		err := invRows.Scan(&id, &serial, &name, &ipAddress, &deviceGroupID, &templateStackID, &templateID, &deviceGroup, &templateStack)
		if err == nil {
			inventory = append(inventory, map[string]interface{}{
				"id":                id,
				"serial":            serial,
				"name":              name,
				"ip_address":        ipAddress,
				"device_group_id":   deviceGroupID,
				"template_stack_id": templateStackID,
				"template_id":       templateID,
				"device_group":      deviceGroup,
				"template_stack":    templateStack,
			})
		}
	}

	// 2. Device Groups
	dgRows, err := dbConn.Query("SELECT dg.id, dg.uuid, dg.name, parent.uuid AS parent_uuid, dg.description FROM device_groups dg LEFT JOIN device_groups parent ON dg.parent_id = parent.id ORDER BY dg.name ASC")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to query device groups: " + err.Error()})
		return
	}
	defer dgRows.Close()

	var deviceGroups []map[string]interface{}
	for dgRows.Next() {
		var id int
		var uuid, name string
		var parentUUID, description *string
		if err := dgRows.Scan(&id, &uuid, &name, &parentUUID, &description); err == nil {
			deviceGroups = append(deviceGroups, map[string]interface{}{
				"id":          id,
				"uuid":        uuid,
				"name":        name,
				"parent_uuid": parentUUID,
				"description": description,
			})
		}
	}

	// 3. Templates
	tmplRows, err := dbConn.Query("SELECT id, uuid, name FROM templates ORDER BY name ASC")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to query templates: " + err.Error()})
		return
	}
	defer tmplRows.Close()

	var templates []map[string]interface{}
	for tmplRows.Next() {
		var id int
		var uuid, name string
		err := tmplRows.Scan(&id, &uuid, &name)
		if err == nil {
			templates = append(templates, map[string]interface{}{
				"id":   id,
				"uuid": uuid,
				"name": name,
			})
		}
	}

	// 4. Template Stacks
	stackRows, err := dbConn.Query("SELECT id, uuid, name, device_uuid FROM template_stacks ORDER BY name ASC")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to query template stacks: " + err.Error()})
		return
	}
	defer stackRows.Close()

	var templateStacks []map[string]interface{}
	for stackRows.Next() {
		var id int
		var uuid, name, deviceUUID string
		err := stackRows.Scan(&id, &uuid, &name, &deviceUUID)
		if err == nil {
			templateStacks = append(templateStacks, map[string]interface{}{
				"id":          id,
				"uuid":        uuid,
				"name":        name,
				"device_uuid": deviceUUID,
			})
		}
	}

	// 5. Stack Members
	memberRows, err := dbConn.Query("SELECT stack_id, template_name, sequence FROM template_stack_members ORDER BY stack_id, sequence ASC")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to query stack members: " + err.Error()})
		return
	}
	defer memberRows.Close()

	var stackMembers []map[string]interface{}
	for memberRows.Next() {
		var stackID, sequence int
		var templateName string
		err := memberRows.Scan(&stackID, &templateName, &sequence)
		if err == nil {
			stackMembers = append(stackMembers, map[string]interface{}{
				"stack_id":      stackID,
				"template_name": templateName,
				"sequence":      sequence,
			})
		}
	}

	if inventory == nil {
		inventory = []map[string]interface{}{}
	}
	if deviceGroups == nil {
		deviceGroups = []map[string]interface{}{}
	}
	if templates == nil {
		templates = []map[string]interface{}{}
	}
	if templateStacks == nil {
		templateStacks = []map[string]interface{}{}
	}
	if stackMembers == nil {
		stackMembers = []map[string]interface{}{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"inventory":       inventory,
		"device_groups":   deviceGroups,
		"templates":       templates,
		"template_stacks": templateStacks,
		"stack_members":   stackMembers,
	})
}

func handleGetHierarchyContext(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	countTable := r.URL.Query().Get("count_table")

	vaultMutex.Lock()
	if activeDB == nil {
		vaultMutex.Unlock()
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
		return
	}
	dbConn := activeDB.DB()
	vaultMutex.Unlock()

	// 1. Templates
	tmplRows, err := dbConn.Query("SELECT id, uuid, name FROM templates ORDER BY name ASC")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to query templates: " + err.Error()})
		return
	}
	defer tmplRows.Close()

	var templates []map[string]interface{}
	for tmplRows.Next() {
		var id int
		var uuid, name string
		if err := tmplRows.Scan(&id, &uuid, &name); err == nil {
			templates = append(templates, map[string]interface{}{"id": id, "uuid": uuid, "name": name})
		}
	}

	// 2. Template Stacks
	stackRows, err := dbConn.Query("SELECT id, uuid, name FROM template_stacks ORDER BY name ASC")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to query stacks: " + err.Error()})
		return
	}
	defer stackRows.Close()

	var templateStacks []map[string]interface{}
	for stackRows.Next() {
		var id int
		var uuid, name string
		if err := stackRows.Scan(&id, &uuid, &name); err == nil {
			templateStacks = append(templateStacks, map[string]interface{}{"id": id, "uuid": uuid, "name": name})
		}
	}

	// 3. Stack Members
	memberRows, err := dbConn.Query("SELECT tsm.stack_id, tsm.template_id, t.uuid as template_uuid, tsm.sequence FROM template_stack_members_raw tsm JOIN templates t ON tsm.template_id = t.id ORDER BY tsm.sequence ASC")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to query stack members: " + err.Error()})
		return
	}
	defer memberRows.Close()

	var stackMembers []map[string]interface{}
	for memberRows.Next() {
		var stackID, templateID, sequence int
		var templateUUID string
		if err := memberRows.Scan(&stackID, &templateID, &templateUUID, &sequence); err == nil {
			stackMembers = append(stackMembers, map[string]interface{}{
				"stack_id":      stackID,
				"template_id":   templateID,
				"template_uuid": templateUUID,
				"sequence":      sequence,
			})
		}
	}

	// 4. Devices with Scopes
	fwRows, err := dbConn.Query("SELECT m.id, s.uuid, m.serial, m.name, m.template_stack_id, m.template_id FROM managed_devices_raw m JOIN scopes s ON m.device_uuid = s.uuid ORDER BY m.name ASC")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to query devices: " + err.Error()})
		return
	}
	defer fwRows.Close()

	var devices []map[string]interface{}
	for fwRows.Next() {
		var id int
		var uuid, serial, name string
		var stackID, tmplID sql.NullInt64
		if err := fwRows.Scan(&id, &uuid, &serial, &name, &stackID, &tmplID); err == nil {
			var parsedStackID, parsedTmplID *int64
			if stackID.Valid {
				parsedStackID = &stackID.Int64
			}
			if tmplID.Valid {
				parsedTmplID = &tmplID.Int64
			}

			devices = append(devices, map[string]interface{}{
				"id":                id,
				"uuid":              uuid,
				"serial":            serial,
				"name":              name,
				"template_stack_id": parsedStackID,
				"template_id":       parsedTmplID,
			})
		}
	}

	// 5. Counts (if requested)
	hasValuesMap := make(map[string]bool)
	if countTable != "" {
		// Validating table name to prevent SQL injection
		validTables := map[string]bool{
			"zones":         true,
			"interfaces":    true,
			"static_routes": true,
			"variables":     true,
		}
		if validTables[countTable] {
			countRows, err := dbConn.Query("SELECT device_uuid FROM " + countTable + " GROUP BY device_uuid")
			if err == nil {
				defer countRows.Close()
				for countRows.Next() {
					var deviceUUID string
					if err := countRows.Scan(&deviceUUID); err == nil {
						hasValuesMap[deviceUUID] = true
					}
				}
			}
		}
	}

	if templates == nil {
		templates = []map[string]interface{}{}
	}
	if templateStacks == nil {
		templateStacks = []map[string]interface{}{}
	}
	if stackMembers == nil {
		stackMembers = []map[string]interface{}{}
	}
	if devices == nil {
		devices = []map[string]interface{}{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"templates":              templates,
		"template_stacks":        templateStacks,
		"template_stack_members": stackMembers,
		"devices":                devices,
		"has_values_map":         hasValuesMap,
	})
}

func handleGetPoliciesContext(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	countTable := r.URL.Query().Get("count_table")

	vaultMutex.Lock()
	if activeDB == nil {
		vaultMutex.Unlock()
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
		return
	}
	dbConn := activeDB.DB()
	vaultMutex.Unlock()

	// 1. Device Groups
	dgRows, err := dbConn.Query("SELECT id, uuid, name, parent_id FROM device_groups ORDER BY name ASC")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to query device groups: " + err.Error()})
		return
	}
	defer dgRows.Close()

	var deviceGroups []map[string]interface{}
	for dgRows.Next() {
		var id int
		var uuid, name string
		var parentID sql.NullInt64
		if err := dgRows.Scan(&id, &uuid, &name, &parentID); err == nil {
			var parsedParentID *int64
			if parentID.Valid {
				parsedParentID = &parentID.Int64
			}
			deviceGroups = append(deviceGroups, map[string]interface{}{
				"id":        id,
				"uuid":      uuid,
				"name":      name,
				"parent_id": parsedParentID,
			})
		}
	}

	// 2. Devices with Scopes
	fwRows, err := dbConn.Query("SELECT m.id, s.uuid, m.serial, m.name, m.device_group_id FROM managed_devices_raw m JOIN scopes s ON m.device_uuid = s.uuid ORDER BY m.name ASC")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to query devices: " + err.Error()})
		return
	}
	defer fwRows.Close()

	var devices []map[string]interface{}
	for fwRows.Next() {
		var id int
		var uuid, serial, name string
		var dgID sql.NullInt64
		if err := fwRows.Scan(&id, &uuid, &serial, &name, &dgID); err == nil {
			var parsedDgID *int64
			if dgID.Valid {
				parsedDgID = &dgID.Int64
			}
			devices = append(devices, map[string]interface{}{
				"id":              id,
				"uuid":            uuid,
				"serial":          serial,
				"name":            name,
				"device_group_id": parsedDgID,
			})
		}
	}

	// 3. Counts (if requested)
	hasValuesMap := make(map[string]bool)
	ruleCountsMap := make(map[string]int)
	if countTable != "" {
		validTables := map[string]bool{
			"security_rules": true, "nat_rules": true, "qos_rules": true,
			"pbf_rules": true, "decryption_rules": true, "application_override_rules": true,
			"tunnel_inspection_rules": true, "authentication_rules": true, "dos_rules": true,
			"address_objects": true, "address_groups": true, "service_objects": true,
			"service_groups": true, "application_objects": true, "application_groups": true,
			"tags": true, "log_forwarding_profiles": true, "security_profiles": true,
			"security_profile_groups": true, "custom_url_categories": true, "external_dynamic_lists": true,
		}
		if validTables[countTable] {
			rulebase := r.URL.Query().Get("rulebase")
			scopeFilter := ""
			switch rulebase {
			case "pre":
				scopeFilter = " WHERE scope LIKE '%:pre'"
			case "post":
				scopeFilter = " WHERE scope LIKE '%:post'"
			case "device":
				scopeFilter = " WHERE scope NOT LIKE '%:pre' AND scope NOT LIKE '%:post'"
			}

			countRows, err := dbConn.Query("SELECT device_uuid, COUNT(*) FROM " + countTable + scopeFilter + " GROUP BY device_uuid")
			if err == nil {
				defer countRows.Close()
				for countRows.Next() {
					var deviceUUID string
					var count int
					if err := countRows.Scan(&deviceUUID, &count); err == nil {
						hasValuesMap[deviceUUID] = true
						ruleCountsMap[deviceUUID] = count
					}
				}
			}
		}
	}

	if deviceGroups == nil {
		deviceGroups = []map[string]interface{}{}
	}
	if devices == nil {
		devices = []map[string]interface{}{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"device_groups":   deviceGroups,
		"devices":         devices,
		"has_values_map":  hasValuesMap,
		"rule_counts_map": ruleCountsMap,
	})
}
