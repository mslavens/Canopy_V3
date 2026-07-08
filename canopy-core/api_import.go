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

	case "devices":
		for _, row := range req.Data {
			name, _ := row["name"].(string)
			serial, _ := row["serial"].(string)
			ipAddr, _ := row["ip_address"].(string)
			dgName, _ := row["device_group"].(string)
			tsName, _ := row["template_stack"].(string)
			tmplName, _ := row["template"].(string)

			name = strings.TrimSpace(name)
			serial = strings.TrimSpace(serial)
			ipAddr = strings.TrimSpace(ipAddr)
			if name == "" || serial == "" {
				continue
			}

			// Check duplicate serial
			var exists int
			err := tx.QueryRow("SELECT COUNT(*) FROM managed_devices_raw WHERE serial = ?", serial).Scan(&exists)
			if err != nil || exists > 0 {
				continue
			}

			// Lookup parent ID / UUID
			var dgID, tsID, tmplID *int64
			var parentScopeUUID interface{}

			if dgName != "" {
				var id int64
				var dgUUID string
				err = tx.QueryRow("SELECT id, uuid FROM device_groups WHERE name = ?", dgName).Scan(&id, &dgUUID)
				if err == nil {
					dgID = &id
					parentScopeUUID = dgUUID
				}
			}
			if tsName != "" {
				var id int64
				var tsUUID string
				err = tx.QueryRow("SELECT id, uuid FROM template_stacks WHERE name = ?", tsName).Scan(&id, &tsUUID)
				if err == nil {
					tsID = &id
					parentScopeUUID = tsUUID
				}
			}
			if tmplName != "" && tsID == nil {
				var id int64
				var tmplUUID string
				err = tx.QueryRow("SELECT id, uuid FROM templates WHERE name = ?", tmplName).Scan(&id, &tmplUUID)
				if err == nil {
					tmplID = &id
					parentScopeUUID = tmplUUID
				}
			}

			devUUID := "paloalto-fw-" + name + "-" + serial

			// Insert scope
			_, err = tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'firewall', NULL, ?, ?)", devUUID, name, parentScopeUUID)
			if err != nil {
				continue
			}

			// Insert managed device
			res, err := tx.Exec(`
				INSERT INTO managed_devices_raw (device_uuid, serial, name, ip_address, device_group_id, template_stack_id, template_id)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`, devUUID, serial, name, ipAddr, dgID, tsID, tmplID)
			if err != nil {
				continue
			}

			mdevID, err := res.LastInsertId()
			if err == nil {
				// Update scope reference
				tx.Exec("UPDATE scopes SET reference_id = ? WHERE uuid = ?", mdevID, devUUID)
				insertedCount++
			}
		}

	case "device_groups":
		for _, row := range req.Data {
			name, _ := row["name"].(string)
			desc, _ := row["description"].(string)
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}

			var exists int
			tx.QueryRow("SELECT COUNT(*) FROM device_groups WHERE name = ?", name).Scan(&exists)
			if exists > 0 {
				continue
			}

			uuid := "paloalto-dg-" + name
			res, err := tx.Exec("INSERT INTO device_groups (uuid, name, description) VALUES (?, ?, ?)", uuid, name, desc)
			if err == nil {
				id, err := res.LastInsertId()
				if err == nil {
					_, err = tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'device-group', ?, ?, NULL)", uuid, id, name)
					if err == nil {
						insertedCount++
					}
				}
			}
		}

	case "templates":
		for _, row := range req.Data {
			name, _ := row["name"].(string)
			desc, _ := row["description"].(string)
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}

			var exists int
			tx.QueryRow("SELECT COUNT(*) FROM templates WHERE name = ?", name).Scan(&exists)
			if exists > 0 {
				continue
			}

			uuid := "paloalto-tmpl-" + name
			res, err := tx.Exec("INSERT INTO templates (uuid, name, description) VALUES (?, ?, ?)", uuid, name, desc)
			if err == nil {
				id, err := res.LastInsertId()
				if err == nil {
					_, err = tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'template', ?, ?, NULL)", uuid, id, name+" (Panorama)")
					if err == nil {
						insertedCount++
					}
				}
			}
		}

	case "template_stacks":
		for _, row := range req.Data {
			name, _ := row["name"].(string)
			desc, _ := row["description"].(string)
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}

			var exists int
			tx.QueryRow("SELECT COUNT(*) FROM template_stacks WHERE name = ?", name).Scan(&exists)
			if exists > 0 {
				continue
			}

			uuid := "paloalto-stack-" + name
			res, err := tx.Exec("INSERT INTO template_stacks (uuid, name, description) VALUES (?, ?, ?)", uuid, name, desc)
			if err == nil {
				id, err := res.LastInsertId()
				if err == nil {
					_, err = tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'template-stack', ?, ?, NULL)", uuid, id, name)
					if err == nil {
						insertedCount++
					}
				}
			}
		}

	case "zones":
		currentStmt, err = tx.Prepare(`
			INSERT INTO zones (device_uuid, name, type)
			VALUES (?, ?, ?)
		`)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Failed to prepare statement", http.StatusInternalServerError)
			return
		}
		defer currentStmt.Close()

		for _, row := range req.Data {
			name, _ := row["name"].(string)
			zType, _ := row["type"].(string)
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			if zType == "" {
				zType = "layer3"
			}

			_, err = currentStmt.Exec(req.DeviceUUID, name, zType)
			if err == nil {
				insertedCount++
			}
		}

	case "interfaces":
		currentStmt, err = tx.Prepare(`
			INSERT INTO interfaces (device_uuid, scope, name, type, ip_address, zone, vr_name, description)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Failed to prepare statement", http.StatusInternalServerError)
			return
		}
		defer currentStmt.Close()

		for _, row := range req.Data {
			name, _ := row["name"].(string)
			ifaceType, _ := row["type"].(string)
			ipAddr, _ := row["ip_address"].(string)
			zone, _ := row["zone"].(string)
			vrName, _ := row["vr_name"].(string)
			desc, _ := row["description"].(string)

			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			if ifaceType == "" {
				ifaceType = "layer3"
			}

			_, err = currentStmt.Exec(req.DeviceUUID, req.Scope, name, ifaceType, ipAddr, zone, vrName, desc)
			if err == nil {
				insertedCount++
			}
		}

	case "static_routes":
		currentStmt, err = tx.Prepare(`
			INSERT INTO static_routes (device_uuid, vr_name, route_name, destination, nexthop, interface, metric)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Failed to prepare statement", http.StatusInternalServerError)
			return
		}
		defer currentStmt.Close()

		for _, row := range req.Data {
			vrName, _ := row["vr_name"].(string)
			routeName, _ := row["route_name"].(string)
			dest, _ := row["destination"].(string)
			nexthop, _ := row["nexthop"].(string)
			iface, _ := row["interface"].(string)
			
			metricVal := 10
			if m, ok := row["metric"].(float64); ok {
				metricVal = int(m)
			} else if mStr, ok := row["metric"].(string); ok {
				var parsed int
				if err := json.Unmarshal([]byte(mStr), &parsed); err == nil {
					metricVal = parsed
				}
			}

			routeName = strings.TrimSpace(routeName)
			dest = strings.TrimSpace(dest)
			if routeName == "" || dest == "" {
				continue
			}
			if vrName == "" {
				vrName = "default"
			}

			_, err = currentStmt.Exec(req.DeviceUUID, vrName, routeName, dest, nexthop, iface, metricVal)
			if err == nil {
				insertedCount++
			}
		}

	case "variables":
		currentStmt, err = tx.Prepare(`
			INSERT INTO variables (device_uuid, scope, name, type, value, description)
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
			vType, _ := row["type"].(string)
			val, _ := row["value"].(string)
			desc, _ := row["description"].(string)

			name = strings.TrimSpace(name)
			val = strings.TrimSpace(val)
			if name == "" || val == "" {
				continue
			}
			if !strings.HasPrefix(name, "$") {
				name = "$" + name
			}
			if vType == "" {
				vType = "ip-netmask"
			}

			_, err = currentStmt.Exec(req.DeviceUUID, req.Scope, name, vType, val, desc)
			if err == nil {
				insertedCount++
			}
		}

	case "address_groups":
		currentStmt, err = tx.Prepare(`
			INSERT INTO address_groups (device_uuid, scope, name, type, description)
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
			agType, _ := row["type"].(string)
			desc, _ := row["description"].(string)

			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			if agType == "" {
				agType = "static"
			}

			_, err = currentStmt.Exec(req.DeviceUUID, req.Scope, name, agType, desc)
			if err == nil {
				insertedCount++
			}
		}

	case "service_groups":
		currentStmt, err = tx.Prepare(`
			INSERT INTO service_groups (device_uuid, scope, name, description)
			VALUES (?, ?, ?, ?)
		`)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Failed to prepare statement", http.StatusInternalServerError)
			return
		}
		defer currentStmt.Close()

		for _, row := range req.Data {
			name, _ := row["name"].(string)
			desc, _ := row["description"].(string)

			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}

			_, err = currentStmt.Exec(req.DeviceUUID, req.Scope, name, desc)
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
