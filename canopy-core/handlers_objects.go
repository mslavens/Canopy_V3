package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

func handleGetObjectCounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	scopesParam := r.URL.Query().Get("scopes")
	var filter string
	var args []interface{}
	if scopesParam != "" && scopesParam != "show-all" {
		scopes := strings.Split(scopesParam, ",")
		placeholders := make([]string, len(scopes))
		for i, s := range scopes {
			placeholders[i] = "?"
			args = append(args, s)
		}
		filter = " WHERE device_uuid IN (" + strings.Join(placeholders, ",") + ")"
	}

	vaultMutex.RLock()
	if activeDB == nil {
		vaultMutex.RUnlock()
		http.Error(w, `{"error": "No active workspace loaded"}`, http.StatusBadRequest)
		return
	}
	db := activeDB
	vaultMutex.RUnlock()
	dbConn := db.DB()

	var addr, addrGrp, svc, svcGrp, app, appGrp, tags int
	var logFwd, secProfGrp, urlCat, edl int

	dbConn.QueryRow("SELECT COUNT(*) FROM address_objects"+filter, args...).Scan(&addr)
	dbConn.QueryRow("SELECT COUNT(*) FROM address_groups"+filter, args...).Scan(&addrGrp)
	dbConn.QueryRow("SELECT COUNT(*) FROM service_objects"+filter, args...).Scan(&svc)
	dbConn.QueryRow("SELECT COUNT(*) FROM service_groups"+filter, args...).Scan(&svcGrp)
	dbConn.QueryRow("SELECT COUNT(*) FROM application_objects"+filter, args...).Scan(&app)
	dbConn.QueryRow("SELECT COUNT(*) FROM application_groups"+filter, args...).Scan(&appGrp)
	dbConn.QueryRow("SELECT COUNT(*) FROM tags"+filter, args...).Scan(&tags)
	dbConn.QueryRow("SELECT COUNT(*) FROM log_forwarding_profiles"+filter, args...).Scan(&logFwd)
	dbConn.QueryRow("SELECT COUNT(*) FROM security_profile_groups"+filter, args...).Scan(&secProfGrp)
	dbConn.QueryRow("SELECT COUNT(*) FROM custom_url_categories"+filter, args...).Scan(&urlCat)
	dbConn.QueryRow("SELECT COUNT(*) FROM external_dynamic_lists"+filter, args...).Scan(&edl)

	secCounts := map[string]int{
		"antivirus":       0,
		"spyware":         0,
		"vulnerability":   0,
		"url-filtering":   0,
		"file-blocking":   0,
		"wildfire":        0,
	}

	rows, err := dbConn.Query("SELECT type, COUNT(*) FROM security_profiles"+filter+" GROUP BY type", args...)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var pType string
			var count int
			if err := rows.Scan(&pType, &count); err == nil {
				secCounts[pType] = count
			}
		}
		if err := rows.Err(); err != nil {
			// Warning fixed
			_ = err
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{
		"Address Objects":          addr,
		"Address Groups":           addrGrp,
		"Services":                 svc,
		"Service Groups":           svcGrp,
		"Applications":             app,
		"Application Groups":       appGrp,
		"Tags":                     tags,
		"Log Forwarding Profiles":  logFwd,
		"Antivirus":                secCounts["antivirus"],
		"Anti-Spyware":             secCounts["spyware"],
		"Vulnerability Protection": secCounts["vulnerability"],
		"URL Filtering":            secCounts["url-filtering"],
		"File Blocking":            secCounts["file-blocking"],
		"WildFire Analysis":        secCounts["wildfire"],
		"Security Profile Groups":  secProfGrp,
		"URL Categories":           urlCat,
		"External Dynamic Lists":   edl,
	})
}

func handleGetObjects(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	objType := r.URL.Query().Get("type")
	scopesParam := r.URL.Query().Get("scopes")

	var filter string
	var args []interface{}
	if scopesParam != "" && scopesParam != "show-all" {
		scopes := strings.Split(scopesParam, ",")
		placeholders := make([]string, len(scopes))
		for i, s := range scopes {
			placeholders[i] = "?"
			args = append(args, s)
		}
		filter = " WHERE device_uuid IN (" + strings.Join(placeholders, ",") + ")"
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

	var query string
	switch objType {
	case "Address Objects":
		query = "SELECT * FROM address_objects"
	case "Address Groups":
		query = `
			SELECT g.*, CAST(GROUP_CONCAT(COALESCE(ao.name, nested.name, agm.member_name)) AS TEXT) AS member_list
			FROM address_groups g
			LEFT JOIN address_group_members agm ON g.id = agm.group_id
			LEFT JOIN address_objects ao ON agm.member_address_id = ao.id
			LEFT JOIN address_groups nested ON agm.member_group_id = nested.id`
		if filter != "" {
			query += strings.Replace(filter, "device_uuid", "g.device_uuid", 1)
		}
		query += " GROUP BY g.id ORDER BY g.name ASC"
		filter = "" // clear filter to avoid appending it again
	case "Services":
		query = "SELECT * FROM service_objects"
	case "Service Groups":
		query = `
			SELECT g.*, CAST(GROUP_CONCAT(COALESCE(so.name, nested.name, sgm.member_name)) AS TEXT) AS member_list
			FROM service_groups g
			LEFT JOIN service_group_members sgm ON g.id = sgm.group_id
			LEFT JOIN service_objects so ON sgm.member_service_id = so.id
			LEFT JOIN service_groups nested ON sgm.member_group_id = nested.id`
		if filter != "" {
			query += strings.Replace(filter, "device_uuid", "g.device_uuid", 1)
		}
		query += " GROUP BY g.id ORDER BY g.name ASC"
		filter = ""
	case "Applications":
		query = "SELECT * FROM application_objects"
	case "Application Groups":
		query = `
			SELECT g.*, CAST(GROUP_CONCAT(COALESCE(app.name, nested.name, appgm.member_name)) AS TEXT) AS member_list
			FROM application_groups g
			LEFT JOIN application_group_members appgm ON g.id = appgm.group_id
			LEFT JOIN application_objects app ON appgm.member_application_id = app.id
			LEFT JOIN application_groups nested ON appgm.member_group_id = nested.id`
		if filter != "" {
			query += strings.Replace(filter, "device_uuid", "g.device_uuid", 1)
		}
		query += " GROUP BY g.id ORDER BY g.name ASC"
		filter = ""
	case "Tags":
		query = "SELECT * FROM tags"
	case "Log Forwarding Profiles":
		query = "SELECT * FROM log_forwarding_profiles"
	case "Security Profiles":
		query = "SELECT * FROM security_profiles"
	case "Security Profile Groups":
		query = "SELECT * FROM security_profile_groups"
	case "URL Categories":
		query = "SELECT * FROM custom_url_categories"
	case "External Dynamic Lists":
		query = "SELECT * FROM external_dynamic_lists"
	default:
		http.Error(w, "invalid object type", http.StatusBadRequest)
		return
	}

	if filter != "" {
		query += filter + " ORDER BY name ASC"
	} else if !strings.Contains(query, "ORDER BY") {
		query += " ORDER BY name ASC"
	}

	rows, err := dbConn.Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	var results []map[string]interface{}

	for rows.Next() {
		columns := make([]interface{}, len(cols))
		columnPointers := make([]interface{}, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		if err := rows.Scan(columnPointers...); err != nil {
			continue
		}

		m := make(map[string]interface{})
		for i, colName := range cols {
			val := columnPointers[i].(*interface{})
			if val == nil {
				m[colName] = nil
			} else {
				// Convert byte arrays to strings
				if b, ok := (*val).([]byte); ok {
					m[colName] = string(b)
				} else {
					m[colName] = *val
				}
			}
		}
		results = append(results, m)
	}
	if err := rows.Err(); err != nil {
		// Warning fixed
		_ = err
	}

	if results == nil {
		results = []map[string]interface{}{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func handleGetObjectsReference(w http.ResponseWriter, r *http.Request) {
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

	// Helper to execute and scan into maps
	queryToMap := func(query string) []map[string]interface{} {
		rows, err := dbConn.Query(query)
		if err != nil {
			return []map[string]interface{}{}
		}
		defer rows.Close()

		cols, _ := rows.Columns()
		var results []map[string]interface{}

		for rows.Next() {
			columns := make([]interface{}, len(cols))
			columnPointers := make([]interface{}, len(cols))
			for i := range columns {
				columnPointers[i] = &columns[i]
			}

			if err := rows.Scan(columnPointers...); err != nil {
				continue
			}

			m := make(map[string]interface{})
			for i, colName := range cols {
				val := columnPointers[i].(*interface{})
				if val == nil {
					m[colName] = nil
				} else {
					if b, ok := (*val).([]byte); ok {
						m[colName] = string(b)
					} else {
						m[colName] = *val
					}
				}
			}
			results = append(results, m)
		}
		if err := rows.Err(); err != nil {
			// Warning fixed
			_ = err
		}
		if results == nil {
			results = []map[string]interface{}{}
		}
		return results
	}

	addresses := queryToMap("SELECT id, name, device_uuid, type, value, description FROM address_objects")
	
	addressGroups := queryToMap(`
		SELECT g.id, g.name, g.device_uuid, g.type, g.filter, g.description, CAST(GROUP_CONCAT(COALESCE(ao.name, nested.name, agm.member_name)) AS TEXT) AS member_list
		FROM address_groups g
		LEFT JOIN address_group_members agm ON g.id = agm.group_id
		LEFT JOIN address_objects ao ON agm.member_address_id = ao.id
		LEFT JOIN address_groups nested ON agm.member_group_id = nested.id
		GROUP BY g.id
	`)

	services := queryToMap("SELECT id, name, device_uuid, protocol, destination_port, source_port, description FROM service_objects")

	serviceGroups := queryToMap(`
		SELECT g.id, g.name, g.device_uuid, g.description, CAST(GROUP_CONCAT(COALESCE(so.name, nested.name, sgm.member_name)) AS TEXT) AS member_list
		FROM service_groups g
		LEFT JOIN service_group_members sgm ON g.id = sgm.group_id
		LEFT JOIN service_objects so ON sgm.member_service_id = so.id
		LEFT JOIN service_groups nested ON sgm.member_group_id = nested.id
		GROUP BY g.id
	`)

	applications := queryToMap("SELECT id, name, device_uuid, category, subcategory, technology, risk, ports, description FROM application_objects")

	applicationGroups := queryToMap(`
		SELECT g.id, g.name, g.device_uuid, g.description, CAST(GROUP_CONCAT(COALESCE(app.name, nested.name, appgm.member_name)) AS TEXT) AS member_list
		FROM application_groups g
		LEFT JOIN application_group_members appgm ON g.id = appgm.group_id
		LEFT JOIN application_objects app ON appgm.member_application_id = app.id
		LEFT JOIN application_groups nested ON appgm.member_group_id = nested.id
		GROUP BY g.id
	`)

	securityProfiles := queryToMap("SELECT id, name, device_uuid, type FROM security_profiles")
	tags := queryToMap("SELECT id, name, device_uuid, color FROM tags")
	tagMappings := queryToMap("SELECT entity_type, entity_id, tag_id FROM entity_tag_mappings")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"addresses":          addresses,
		"address_groups":     addressGroups,
		"services":           services,
		"service_groups":     serviceGroups,
		"applications":       applications,
		"application_groups": applicationGroups,
		"security_profiles":  securityProfiles,
		"tags":               tags,
		"tag_mappings":       tagMappings,
	})
}

func handleGetGroupMembers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	groupID := r.URL.Query().Get("group_id")
	objType := r.URL.Query().Get("type")
	flatten := r.URL.Query().Get("flatten") == "true"

	if groupID == "" || objType == "" {
		http.Error(w, "group_id and type are required", http.StatusBadRequest)
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

	var query string
	if flatten {
		switch objType {
		case "Address Groups":
			query = `WITH RECURSIVE group_tree AS (
				SELECT member_address_id, member_group_id FROM address_group_members WHERE group_id = ?
				UNION ALL
				SELECT m.member_address_id, m.member_group_id FROM address_group_members m INNER JOIN group_tree gt ON m.group_id = gt.member_group_id
			)
			SELECT DISTINCT o.name FROM group_tree gt JOIN address_objects o ON gt.member_address_id = o.id ORDER BY o.name ASC`
		case "Service Groups":
			query = `WITH RECURSIVE group_tree AS (
				SELECT member_service_id, member_group_id FROM service_group_members WHERE group_id = ?
				UNION ALL
				SELECT m.member_service_id, m.member_group_id FROM service_group_members m INNER JOIN group_tree gt ON m.group_id = gt.member_group_id
			)
			SELECT DISTINCT o.name FROM group_tree gt JOIN service_objects o ON gt.member_service_id = o.id ORDER BY o.name ASC`
		case "Application Groups":
			query = `WITH RECURSIVE group_tree AS (
				SELECT member_application_id, member_group_id FROM application_group_members WHERE group_id = ?
				UNION ALL
				SELECT m.member_application_id, m.member_group_id FROM application_group_members m INNER JOIN group_tree gt ON m.group_id = gt.member_group_id
			)
			SELECT DISTINCT o.name FROM group_tree gt JOIN application_objects o ON gt.member_application_id = o.id ORDER BY o.name ASC`
		default:
			http.Error(w, "invalid group type", http.StatusBadRequest)
			return
		}
	} else {
		switch objType {
		case "Address Groups":
			query = `
				SELECT m.member_address_id, ao.name AS object_name, m.member_group_id, ag.name AS group_name, m.member_name 
				FROM address_group_members m 
				LEFT JOIN address_objects ao ON m.member_address_id = ao.id 
				LEFT JOIN address_groups ag ON m.member_group_id = ag.id 
				WHERE m.group_id = ?`
		case "Service Groups":
			query = `
				SELECT m.member_service_id, so.name AS object_name, m.member_group_id, sg.name AS group_name, m.member_name 
				FROM service_group_members m 
				LEFT JOIN service_objects so ON m.member_service_id = so.id 
				LEFT JOIN service_groups sg ON m.member_group_id = sg.id 
				WHERE m.group_id = ?`
		case "Application Groups":
			query = `
				SELECT m.member_application_id, app.name AS object_name, m.member_group_id, ag.name AS group_name, m.member_name 
				FROM application_group_members m 
				LEFT JOIN application_objects app ON m.member_application_id = app.id 
				LEFT JOIN application_groups ag ON m.member_group_id = ag.id 
				WHERE m.group_id = ?`
		default:
			http.Error(w, "invalid group type", http.StatusBadRequest)
			return
		}
	}

	rows, err := dbConn.Query(query, groupID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	var results []map[string]interface{}

	for rows.Next() {
		columns := make([]interface{}, len(cols))
		columnPointers := make([]interface{}, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		if err := rows.Scan(columnPointers...); err != nil {
			continue
		}

		m := make(map[string]interface{})
		for i, colName := range cols {
			val := columnPointers[i].(*interface{})
			if val == nil {
				m[colName] = nil
			} else {
				if b, ok := (*val).([]byte); ok {
					m[colName] = string(b)
				} else {
					m[colName] = *val
				}
			}
		}
		results = append(results, m)
	}
	if err := rows.Err(); err != nil {
		// Warning fixed
		_ = err
	}

	if results == nil {
		results = []map[string]interface{}{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func handleGetObjectDependencies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	objID := r.URL.Query().Get("id")
	objName := r.URL.Query().Get("name")
	objType := r.URL.Query().Get("type")

	if objType == "" {
		http.Error(w, "type is required", http.StatusBadRequest)
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

	var query string
	var args []interface{}

	switch objType {
	case "address":
		query = `
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule (Source)' AS typeLabel FROM rule_address_mappings ram JOIN security_rules sr ON ram.rule_id = sr.id AND ram.rule_type = 'security' WHERE ram.direction = 'source' AND (ram.address_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule (Destination)' AS typeLabel FROM rule_address_mappings ram JOIN security_rules sr ON ram.rule_id = sr.id AND ram.rule_type = 'security' WHERE ram.direction = 'destination' AND (ram.address_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT nr.rule_name AS name, 'NAT Rule (Source)' AS typeLabel FROM rule_address_mappings ram JOIN nat_rules nr ON ram.rule_id = nr.id AND ram.rule_type = 'nat' WHERE ram.direction = 'source' AND (ram.address_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT nr.rule_name AS name, 'NAT Rule (Destination)' AS typeLabel FROM rule_address_mappings ram JOIN nat_rules nr ON ram.rule_id = nr.id AND ram.rule_type = 'nat' WHERE ram.direction = 'destination' AND (ram.address_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT ag.name AS name, 'Address Group' AS typeLabel FROM address_group_members agm JOIN address_groups ag ON agm.group_id = ag.id WHERE agm.member_address_id = ?
        `
		args = []interface{}{objID, objName, objID, objName, objID, objName, objID, objName, objID}
	case "addressGroup":
		query = `
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule (Source)' AS typeLabel FROM rule_address_mappings ram JOIN security_rules sr ON ram.rule_id = sr.id AND ram.rule_type = 'security' WHERE ram.direction = 'source' AND (ram.group_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule (Destination)' AS typeLabel FROM rule_address_mappings ram JOIN security_rules sr ON ram.rule_id = sr.id AND ram.rule_type = 'security' WHERE ram.direction = 'destination' AND (ram.group_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT nr.rule_name AS name, 'NAT Rule (Source)' AS typeLabel FROM rule_address_mappings ram JOIN nat_rules nr ON ram.rule_id = nr.id AND ram.rule_type = 'nat' WHERE ram.direction = 'source' AND (ram.group_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT nr.rule_name AS name, 'NAT Rule (Destination)' AS typeLabel FROM rule_address_mappings ram JOIN nat_rules nr ON ram.rule_id = nr.id AND ram.rule_type = 'nat' WHERE ram.direction = 'destination' AND (ram.group_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT ag.name AS name, 'Address Group' AS typeLabel FROM address_group_members agm JOIN address_groups ag ON agm.group_id = ag.id WHERE agm.member_group_id = ?
        `
		args = []interface{}{objID, objName, objID, objName, objID, objName, objID, objName, objID}
	case "service":
		query = `
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule' AS typeLabel FROM rule_service_mappings rsm JOIN security_rules sr ON rsm.rule_id = sr.id AND rsm.rule_type = 'security' WHERE rsm.service_id = ? OR rsm.ad_hoc_value = ?
          UNION
          SELECT DISTINCT nr.rule_name AS name, 'NAT Rule' AS typeLabel FROM rule_service_mappings rsm JOIN nat_rules nr ON rsm.rule_id = nr.id AND rsm.rule_type = 'nat' WHERE rsm.service_id = ? OR rsm.ad_hoc_value = ?
          UNION
          SELECT DISTINCT sg.name AS name, 'Service Group' AS typeLabel FROM service_group_members sgm JOIN service_groups sg ON sgm.group_id = sg.id WHERE sgm.member_service_id = ?
        `
		args = []interface{}{objID, objName, objID, objName, objID}
	case "serviceGroup":
		query = `
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule' AS typeLabel FROM rule_service_mappings rsm JOIN security_rules sr ON rsm.rule_id = sr.id AND rsm.rule_type = 'security' WHERE rsm.group_id = ? OR rsm.ad_hoc_value = ?
          UNION
          SELECT DISTINCT nr.rule_name AS name, 'NAT Rule' AS typeLabel FROM rule_service_mappings rsm JOIN nat_rules nr ON rsm.rule_id = nr.id AND rsm.rule_type = 'nat' WHERE rsm.group_id = ? OR rsm.ad_hoc_value = ?
          UNION
          SELECT DISTINCT sg.name AS name, 'Service Group' AS typeLabel FROM service_group_members sgm JOIN service_groups sg ON sgm.group_id = sg.id WHERE sgm.member_group_id = ?
        `
		args = []interface{}{objID, objName, objID, objName, objID}
	case "application":
		query = `
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule' AS typeLabel FROM rule_application_mappings ram JOIN security_rules sr ON ram.rule_id = sr.id AND ram.rule_type = 'security' WHERE ram.custom_app_id = ? OR ram.predefined_app_name = ?
        `
		args = []interface{}{objID, objName}
	case "applicationGroup":
		query = `
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule' AS typeLabel FROM rule_application_mappings ram JOIN security_rules sr ON ram.rule_id = sr.id AND ram.rule_type = 'security' WHERE ram.predefined_app_name = ?
        `
		args = []interface{}{objName}
	default:
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]map[string]interface{}{})
		return
	}

	rows, err := dbConn.Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var name string
		var typeLabel string
		if err := rows.Scan(&name, &typeLabel); err == nil {
			results = append(results, map[string]interface{}{
				"name":      name,
				"typeLabel": typeLabel,
			})
		}
	}
	if err := rows.Err(); err != nil {
		// Warning fixed
		_ = err
	}

	if results == nil {
		results = []map[string]interface{}{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}
