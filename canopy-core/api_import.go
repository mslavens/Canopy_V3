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

func resolveRowScope(tx *sql.Tx, vendor string, scopeContext string, defaultDeviceUUID string, defaultScope string) (string, string, string) {
	vendor = strings.TrimSpace(vendor)
	scopeContext = strings.TrimSpace(scopeContext)

	if vendor == "" && scopeContext == "" {
		return defaultDeviceUUID, defaultScope, ""
	}
	if vendor == "" {
		vendor = "paloalto"
	}
	if scopeContext == "" {
		return defaultDeviceUUID, defaultScope, ""
	}

	if strings.ToLower(scopeContext) == "shared" {
		if vendor == "paloalto" {
			return "paloalto-panorama-global", "Shared", ""
		}
	}

	var uuid sql.NullString
	err := tx.QueryRow("SELECT uuid FROM device_groups WHERE name = ? AND vendor = ? LIMIT 1", scopeContext, vendor).Scan(&uuid)
	if err == nil && uuid.Valid {
		return uuid.String, scopeContext, ""
	}

	err = tx.QueryRow("SELECT uuid FROM templates WHERE name = ? AND vendor = ? LIMIT 1", scopeContext, vendor).Scan(&uuid)
	if err == nil && uuid.Valid {
		return uuid.String, scopeContext, ""
	}

	err = tx.QueryRow("SELECT uuid FROM managed_devices WHERE name = ? AND vendor = ? LIMIT 1", scopeContext, vendor).Scan(&uuid)
	if err == nil && uuid.Valid {
		return uuid.String, scopeContext, ""
	}

	newUUID := vendor + "-dg-" + strings.ReplaceAll(scopeContext, " ", "-")
	
	res, err := tx.Exec("INSERT INTO device_groups (uuid, name, vendor, parent_uuid, dirty) VALUES (?, ?, ?, NULL, 1)", newUUID, scopeContext, vendor)
	if err == nil {
		id, _ := res.LastInsertId()
		tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'device-group', ?, ?, ?)", newUUID, id, scopeContext+" (Device Group)", getRootScopeForVendor(vendor))
		return newUUID, scopeContext, scopeContext
	}

	return defaultDeviceUUID, defaultScope, ""
}

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
	var autoCreatedScopes []string
	autoCreatedMap := make(map[string]bool)

	var currentStmt *sql.Stmt

	switch req.Type {
	case "address_objects":
		for _, row := range req.Data {
			name, _ := row["name"].(string)
			addrType, _ := row["type"].(string)
			value, _ := row["value"].(string)
			desc, _ := row["description"].(string)
			tagsStr, _ := row["tags"].(string)
			vendor, _ := row["vendor"].(string)
			scopeContext, _ := row["scope_context"].(string)

			if name == "" || value == "" {
				continue // Skip invalid rows
			}
			if addrType == "" {
				addrType = "ip-netmask"
			}

			rowDevUUID, rowScope, ac := resolveRowScope(tx, vendor, scopeContext, req.DeviceUUID, req.Scope)
			if ac != "" && !autoCreatedMap[ac] {
				autoCreatedScopes = append(autoCreatedScopes, ac)
				autoCreatedMap[ac] = true
			}

			res, err := tx.Exec("INSERT INTO address_objects (device_uuid, scope, name, type, value, description) VALUES (?, ?, ?, ?, ?, ?)", rowDevUUID, rowScope, name, addrType, value, desc)
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
							if err := saveEntityTags(tx, "address_object", id, rowDevUUID, parsedTags); err != nil {
								slog.Error("Failed to save entity tags during bulk import", slog.String("error", err.Error()), slog.Int64("entity_id", id))
							}
						}
					}
				}
			}
		}

	case "service_objects":
		for _, row := range req.Data {
			name, _ := row["name"].(string)
			protocol, _ := row["protocol"].(string)
			port, _ := row["destination_port"].(string)
			desc, _ := row["description"].(string)
			vendor, _ := row["vendor"].(string)
			scopeContext, _ := row["scope_context"].(string)

			if name == "" || protocol == "" || port == "" {
				continue
			}

			rowDevUUID, rowScope, ac := resolveRowScope(tx, vendor, scopeContext, req.DeviceUUID, req.Scope)
			if ac != "" && !autoCreatedMap[ac] {
				autoCreatedScopes = append(autoCreatedScopes, ac)
				autoCreatedMap[ac] = true
			}

			_, err = tx.Exec("INSERT INTO service_objects (device_uuid, scope, name, protocol, destination_port, description) VALUES (?, ?, ?, ?, ?, ?)", rowDevUUID, rowScope, name, protocol, port, desc)
			if err == nil {
				insertedCount++
			}
		}

	case "tags":
		for _, row := range req.Data {
			name, _ := row["name"].(string)
			color, _ := row["color"].(string)
			comments, _ := row["comments"].(string)
			vendor, _ := row["vendor"].(string)
			scopeContext, _ := row["scope_context"].(string)

			if name == "" {
				continue
			}

			rowDevUUID, rowScope, ac := resolveRowScope(tx, vendor, scopeContext, req.DeviceUUID, req.Scope)
			if ac != "" && !autoCreatedMap[ac] {
				autoCreatedScopes = append(autoCreatedScopes, ac)
				autoCreatedMap[ac] = true
			}

			_, err = tx.Exec("INSERT INTO tags (device_uuid, scope, name, color, comments) VALUES (?, ?, ?, ?, ?)", rowDevUUID, rowScope, name, color, comments)
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
			vendor, _ := row["vendor"].(string)

			name = strings.TrimSpace(name)
			serial = strings.TrimSpace(serial)
			ipAddr = strings.TrimSpace(ipAddr)
			vendor = strings.TrimSpace(vendor)
			if vendor == "" {
				vendor = "paloalto"
			}
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
				INSERT INTO managed_devices_raw (device_uuid, serial, name, ip_address, vendor, device_group_id, template_stack_id, template_id)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`, devUUID, serial, name, ipAddr, vendor, dgID, tsID, tmplID)
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
			vendor, _ := row["vendor"].(string)
			parentStr, _ := row["parent_group"].(string)

			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			vendor = strings.TrimSpace(vendor)
			if vendor == "" {
				vendor = "paloalto"
			}
			parentStr = strings.TrimSpace(parentStr)

			var exists int
			tx.QueryRow("SELECT COUNT(*) FROM device_groups WHERE name = ?", name).Scan(&exists)
			if exists > 0 {
				continue
			}

			var parentID interface{}
			parentUUID := getRootScopeForVendor(vendor)

			if parentStr != "" {
				var pID int
				var pUUID string
				err := tx.QueryRow("SELECT id, uuid FROM device_groups WHERE name = ?", parentStr).Scan(&pID, &pUUID)
				if err == nil {
					parentID = pID
					parentUUID = pUUID
				}
			} else {
				var rootID int
				err := tx.QueryRow("SELECT id FROM device_groups WHERE uuid = ?", parentUUID).Scan(&rootID)
				if err == nil {
					parentID = rootID
				} else {
					parentID = nil
				}
			}

			uuid := vendor + "-dg-" + name
			res, err := tx.Exec("INSERT INTO device_groups (device_uuid, uuid, name, vendor, parent_id, description) VALUES (?, ?, ?, ?, ?, ?)", getRootScopeForVendor(vendor), uuid, name, vendor, parentID, desc)
			if err == nil {
				id, err := res.LastInsertId()
				if err == nil {
					_, err = tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'device-group', ?, ?, ?)", uuid, id, name+" (Device Group)", parentUUID)
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
		for _, row := range req.Data {
			name, _ := row["name"].(string)
			agType, _ := row["type"].(string)
			filter, _ := row["filter"].(string)
			membersStr, _ := row["members"].(string)
			desc, _ := row["description"].(string)
			tagsStr, _ := row["tags"].(string)
			vendor, _ := row["vendor"].(string)
			scopeContext, _ := row["scope_context"].(string)

			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			if agType == "" {
				agType = "static"
			}

			rowDevUUID, rowScope, ac := resolveRowScope(tx, vendor, scopeContext, req.DeviceUUID, req.Scope)
			if ac != "" && !autoCreatedMap[ac] {
				autoCreatedScopes = append(autoCreatedScopes, ac)
				autoCreatedMap[ac] = true
			}

			res, err := tx.Exec("INSERT INTO address_groups (device_uuid, scope, name, type, filter, description) VALUES (?, ?, ?, ?, ?, ?)", rowDevUUID, rowScope, name, agType, filter, desc)
			if err == nil {
				groupID, _ := res.LastInsertId()
				
				if agType == "static" && membersStr != "" {
					members := strings.Split(membersStr, ",")
					for _, member := range members {
						member = strings.TrimSpace(member)
						if member == "" {
							continue
						}
						
						var addrID sql.NullInt64
						tx.QueryRow("SELECT id FROM address_objects WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&addrID)

						var grpID sql.NullInt64
						tx.QueryRow("SELECT id FROM address_groups WHERE name = ? AND (device_uuid = ? OR device_uuid = 'paloalto-panorama-global') LIMIT 1", member, req.DeviceUUID).Scan(&grpID)

						if addrID.Valid {
							tx.Exec("INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name) VALUES (?, ?, NULL, NULL)", groupID, addrID.Int64)
						} else if grpID.Valid {
							tx.Exec("INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name) VALUES (?, NULL, ?, NULL)", groupID, grpID.Int64)
						} else {
							tx.Exec("INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name) VALUES (?, NULL, NULL, ?)", groupID, member)
						}
					}
				}

				if tagsStr != "" {
					tags := []string{}
					for _, t := range strings.Split(tagsStr, ",") {
						t = strings.TrimSpace(t)
						if t != "" {
							tags = append(tags, t)
						}
					}
					saveEntityTags(tx, "address_group", groupID, rowDevUUID, tags)
				}
				insertedCount++
			}
		}

	case "service_groups":
		for _, row := range req.Data {
			name, _ := row["name"].(string)
			desc, _ := row["description"].(string)
			vendor, _ := row["vendor"].(string)
			scopeContext, _ := row["scope_context"].(string)

			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}

			rowDevUUID, rowScope, ac := resolveRowScope(tx, vendor, scopeContext, req.DeviceUUID, req.Scope)
			if ac != "" && !autoCreatedMap[ac] {
				autoCreatedScopes = append(autoCreatedScopes, ac)
				autoCreatedMap[ac] = true
			}

			_, err = tx.Exec("INSERT INTO service_groups (device_uuid, scope, name, description) VALUES (?, ?, ?, ?)", rowDevUUID, rowScope, name, desc)
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
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":             true,
		"inserted":            insertedCount,
		"auto_created_scopes": autoCreatedScopes,
	})
}
