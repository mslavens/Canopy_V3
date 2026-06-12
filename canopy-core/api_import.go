package main

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
)

// -----------------------------------------------------------------------------
// Centralized Data Import API
// -----------------------------------------------------------------------------

func handleObjectsImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		DeviceUUID string                   `json:"device_uuid"`
		Scope      string                   `json:"scope"`
		Type       string                   `json:"type"` // e.g., 'address_objects', 'service_objects', 'tags'
		Data       []map[string]interface{} `json:"data"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Malformed JSON payload", http.StatusBadRequest)
		return
	}

	if req.DeviceUUID == "" || req.Scope == "" || req.Type == "" {
		http.Error(w, "Missing required payload fields", http.StatusBadRequest)
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

	insertedCount := 0
	var currentStmt *sql.Stmt

	switch req.Type {
	case "address_objects":
		currentStmt, err = tx.Prepare(`
			INSERT INTO address_objects (device_uuid, scope, name, type, value, description)
			VALUES (?, ?, ?, ?, ?, ?)
		`)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Failed to prepare statement", http.StatusInternalServerError)
			return
		}
		defer currentStmt.Close()

		for _, row := range req.Data {
			name, _ := row["name"].(string)
			addrType, _ := row["type"].(string)
			value, _ := row["value"].(string)
			desc, _ := row["description"].(string)
			tagsStr, _ := row["tags"].(string)

			if name == "" || value == "" {
				continue // Skip invalid rows
			}
			if addrType == "" {
				addrType = "ip-netmask"
			}

			res, err := currentStmt.Exec(req.DeviceUUID, req.Scope, name, addrType, value, desc)
			if err == nil {
				insertedCount++

				if tagsStr != "" {
					id, err := res.LastInsertId()
					if err == nil {
						// Parse comma-separated tags
						rawTags := strings.Split(tagsStr, ",")
						var parsedTags []string
						for _, t := range rawTags {
							trimmed := strings.TrimSpace(t)
							if trimmed != "" {
								parsedTags = append(parsedTags, trimmed)
							}
						}

						if len(parsedTags) > 0 {
							// Using saveEntityTags handles removing old tags and mapping the new ones.
							if err := saveEntityTags(tx, "address_object", id, req.DeviceUUID, parsedTags); err != nil {
								slog.Error("Failed to save entity tags during bulk import", slog.String("error", err.Error()), slog.Int64("entity_id", id))
							}
						}
					}
				}
			}
		}

	case "service_objects":
		currentStmt, err = tx.Prepare(`
			INSERT INTO service_objects (device_uuid, scope, name, protocol, destination_port, description)
			VALUES (?, ?, ?, ?, ?, ?)
		`)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Failed to prepare statement", http.StatusInternalServerError)
			return
		}
		defer currentStmt.Close()

		for _, row := range req.Data {
			name, _ := row["name"].(string)
			protocol, _ := row["protocol"].(string)
			port, _ := row["destination_port"].(string)
			desc, _ := row["description"].(string)

			if name == "" || protocol == "" || port == "" {
				continue
			}

			_, err = currentStmt.Exec(req.DeviceUUID, req.Scope, name, protocol, port, desc)
			if err == nil {
				insertedCount++
			}
		}

	case "tags":
		currentStmt, err = tx.Prepare(`
			INSERT INTO tags (device_uuid, scope, name, color, comments)
			VALUES (?, ?, ?, ?, ?)
		`)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Failed to prepare statement", http.StatusInternalServerError)
			return
		}
		defer currentStmt.Close()

		for _, row := range req.Data {
			name, _ := row["name"].(string)
			color, _ := row["color"].(string)
			desc, _ := row["comments"].(string)

			if name == "" {
				continue
			}

			_, err = currentStmt.Exec(req.DeviceUUID, req.Scope, name, color, desc)
			if err == nil {
				insertedCount++
			}
		}

	default:
		tx.Rollback()
		http.Error(w, "Unsupported import object type: "+req.Type, http.StatusBadRequest)
		return
	}

	if err := MaterializeDynamicGroups(tx, req.DeviceUUID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to materialize dynamic groups during import: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to commit imported records"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"inserted_count": insertedCount,
		"total_count":    len(req.Data),
	})
}
