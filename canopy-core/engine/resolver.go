package engine

import (
	"database/sql"
	"sort"
	"strings"
)

// GetPolicyScopeLineage computes the bottom-up inheritance path for Policies and Objects (Device Groups / Firewalls)
func GetPolicyScopeLineage(db *sql.DB, scopeUUID string) []string {
	var ancestry []string
	if scopeUUID == "" {
		return ancestry
	}

	currUUID := scopeUUID
	for currUUID != "" {
		ancestry = append(ancestry, currUUID)
		var parentUUID sql.NullString
		err := db.QueryRow("SELECT parent_uuid FROM scopes WHERE uuid = ?", currUUID).Scan(&parentUUID)
		if err != nil || !parentUUID.Valid {
			break
		}
		currUUID = parentUUID.String
	}

	return ancestry
}

// GetScopeLineage computes the bottom-up inheritance path for a given scope
func GetScopeLineage(db *sql.DB, deviceUUID string) []string {
	var ancestry []string
	
	if deviceUUID == "" {
		return ancestry
	}

	// 1. Check if the deviceUUID is explicitly a firewall (in managed_devices)
	var stackID sql.NullInt64
	var tmplID sql.NullInt64
	err := db.QueryRow("SELECT template_stack_id, template_id FROM managed_devices_raw WHERE device_uuid = ?", deviceUUID).Scan(&stackID, &tmplID)
	
	if err == nil {
		if stackID.Valid {
			// Find the stack uuid
			var stackUUID string
			db.QueryRow("SELECT uuid FROM template_stacks WHERE id = ?", stackID.Int64).Scan(&stackUUID)
			
			// Find all template uuids in sequence
			rows, err := db.Query(`
				SELECT t.uuid 
				FROM template_stack_members_raw m
				JOIN templates t ON m.template_id = t.id
				WHERE m.stack_id = ?
				ORDER BY m.sequence DESC
			`, stackID.Int64)
			if err == nil {
				defer rows.Close()
				for rows.Next() {
					var tUUID string
					rows.Scan(&tUUID)
					ancestry = append(ancestry, tUUID)
				}
				if err := rows.Err(); err != nil {
					// Handle error or just ignore based on current error handling pattern
				}
			}
			ancestry = append(ancestry, stackUUID)
		} else if tmplID.Valid {
			var tUUID string
			db.QueryRow("SELECT uuid FROM templates WHERE id = ?", tmplID.Int64).Scan(&tUUID)
			ancestry = append(ancestry, tUUID)
		}
		
		// The device itself is the most specific
		ancestry = append(ancestry, deviceUUID)
	} else {
		// If it's not a firewall, check if it's a stack
		var sID int64
		errStack := db.QueryRow("SELECT id FROM template_stacks WHERE uuid = ?", deviceUUID).Scan(&sID)
		if errStack == nil {
			rows, err := db.Query(`
				SELECT t.uuid 
				FROM template_stack_members_raw m
				JOIN templates t ON m.template_id = t.id
				WHERE m.stack_id = ?
				ORDER BY m.sequence DESC
			`, sID)
			if err == nil {
				defer rows.Close()
				for rows.Next() {
					var tUUID string
					rows.Scan(&tUUID)
					ancestry = append(ancestry, tUUID)
				}
				if err := rows.Err(); err != nil {
					// handle error
				}
			}
			ancestry = append(ancestry, deviceUUID)
		} else {
			// Just a raw template or other scope
			ancestry = append(ancestry, deviceUUID)
		}
	}
	
	return ancestry
}

// ResolveVariables retrieves the consolidated map of variables for the given lineage
func ResolveVariables(db *sql.DB, ancestry []string) map[string]string {
	resolved := make(map[string]string)
	if len(ancestry) == 0 {
		return resolved
	}
	for _, devUUID := range ancestry {
		rows, err := db.Query("SELECT name, value FROM variables WHERE device_uuid = ?", devUUID)
		if err == nil {
			for rows.Next() {
				var name, value string
				rows.Scan(&name, &value)
				resolved[name] = value
			}
			if err := rows.Err(); err != nil {
				// handle error
			}
			rows.Close()
		}
	}
	return resolved
}

// ApplyVariables substitutes any variables found in the raw text with their resolved values
func ApplyVariables(rawText string, vars map[string]string) string {
	resolved := rawText
	
	// Sort variable keys by length descending to prevent partial replacements
	// e.g. replacing $fw_outside before $fw_outside_next_hop
	var keys []string
	for k := range vars {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		return len(keys[i]) > len(keys[j])
	})

	for _, vName := range keys {
		resolved = strings.ReplaceAll(resolved, vName, vars[vName])
	}
	return resolved
}
