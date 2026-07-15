package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"sort"
)

type SnapshotState struct {
	Tables map[string][]map[string]interface{} `json:"tables"`
}

type DiffResult struct {
	Tables map[string]ObjectDiff `json:"tables"`
}

type ObjectDiff struct {
	Added    []map[string]interface{} `json:"added"`
	Modified []map[string]interface{} `json:"modified"`
	Deleted  []map[string]interface{} `json:"deleted"`
}

func EnsureBaselineCommit(db *sql.DB) {
	var count int
	db.QueryRow("SELECT COUNT(*) FROM commit_history").Scan(&count)
	if count == 0 {
		tx, err := db.Begin()
		if err == nil {
			state, _ := GenerateSnapshot(tx)
			jsonBytes, _ := json.Marshal(state)
			tx.Exec("INSERT INTO commit_history (message, snapshot_json) VALUES (?, ?)", "Initial Baseline", jsonBytes)
			tx.Commit()
		}
	}
}

func GenerateSnapshot(tx *sql.Tx) (*SnapshotState, error) {
	state := &SnapshotState{
		Tables: make(map[string][]map[string]interface{}),
	}

	rows, err := tx.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('workspaces', 'commit_history', 'framework_metadata', 'license_vault')")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			tables = append(tables, name)
		}
	}
	rows.Close()

	for _, table := range tables {
		tableRows, err := tx.Query(fmt.Sprintf("SELECT * FROM %s", table))
		if err != nil {
			continue
		}
		
		cols, _ := tableRows.Columns()
		
		var tableData []map[string]interface{}
		for tableRows.Next() {
			columns := make([]interface{}, len(cols))
			columnPointers := make([]interface{}, len(cols))
			for i := range columns {
				columnPointers[i] = &columns[i]
			}

			if err := tableRows.Scan(columnPointers...); err == nil {
				rowMap := make(map[string]interface{})
				for i, colName := range cols {
					if colName == "dirty" {
						rowMap[colName] = 0
						continue
					}
					
					val := columnPointers[i].(*interface{})
					if val == nil || *val == nil {
						rowMap[colName] = nil
						continue
					}
					if b, ok := (*val).([]byte); ok {
						rowMap[colName] = string(b)
					} else {
						rowMap[colName] = *val
					}
				}
				tableData = append(tableData, rowMap)
			}
		}
		tableRows.Close()
		state.Tables[table] = tableData
	}

	return state, nil
}

func getUniqueIdentifier(tableName string, row map[string]interface{}) string {
	if tableName != "address_group_members" && tableName != "service_group_members" && tableName != "application_group_members" && tableName != "entity_tag_mappings" {
		if id, ok := row["id"]; ok {
			return fmt.Sprintf("%v", id)
		}
	}
	var keys []string
	if etype, ok := row["entity_type"]; ok {
		keys = append(keys, fmt.Sprintf("%v", etype))
	}
	if eid, ok := row["entity_id"]; ok {
		keys = append(keys, fmt.Sprintf("%v", eid))
	}
	if tid, ok := row["tag_id"]; ok {
		keys = append(keys, fmt.Sprintf("%v", tid))
	}
	if gid, ok := row["group_id"]; ok {
		keys = append(keys, fmt.Sprintf("%v", gid))
	}
	if mid, ok := row["member_address_id"]; ok && mid != nil {
		keys = append(keys, fmt.Sprintf("addr_%v", mid))
	}
	if mid, ok := row["member_service_id"]; ok && mid != nil {
		keys = append(keys, fmt.Sprintf("svc_%v", mid))
	}
	if mid, ok := row["member_application_id"]; ok && mid != nil {
		keys = append(keys, fmt.Sprintf("app_%v", mid))
	}
	if mgid, ok := row["member_group_id"]; ok && mgid != nil {
		keys = append(keys, fmt.Sprintf("group_%v", mgid))
	}
	if mname, ok := row["member_name"]; ok && mname != nil {
		keys = append(keys, fmt.Sprintf("name_%v", mname))
	}
	if len(keys) > 0 {
		return strings.Join(keys, "_")
	}
	bytes, _ := json.Marshal(row)
	return string(bytes)
}

func CompareSnapshots(oldJSON, newJSON []byte) (*DiffResult, error) {
	var oldState, newState SnapshotState
	
	if len(oldJSON) > 0 {
		if err := json.Unmarshal(oldJSON, &oldState); err != nil {
			return nil, err
		}
	} else {
		oldState = SnapshotState{
			Tables: make(map[string][]map[string]interface{}),
		}
	}

	if len(newJSON) > 0 {
		if err := json.Unmarshal(newJSON, &newState); err != nil {
			return nil, err
		}
	} else {
		newState = SnapshotState{
			Tables: make(map[string][]map[string]interface{}),
		}
	}

	diff := &DiffResult{
		Tables: make(map[string]ObjectDiff),
	}
	
	allTables := make(map[string]bool)
	for k := range oldState.Tables {
		allTables[k] = true
	}
	for k := range newState.Tables {
		allTables[k] = true
	}

	idToName := make(map[string]string)
	indexTable := func(state *SnapshotState, table string) {
		for _, row := range state.Tables[table] {
			if id, ok := row["id"]; ok {
				if name, ok := row["name"].(string); ok {
					idToName[fmt.Sprintf("%s:%v", table, id)] = name
				}
			}
		}
	}
	for _, t := range []string{"address_objects", "address_groups", "service_objects", "service_groups", "application_objects", "application_groups", "tags"} {
		indexTable(&oldState, t)
		indexTable(&newState, t)
	}

	resolveName := func(table string, id interface{}) string {
		if id == nil {
			return ""
		}
		if name, ok := idToName[fmt.Sprintf("%s:%v", table, id)]; ok {
			return name
		}
		return ""
	}

	enrichRow := func(tableName string, row map[string]interface{}) map[string]interface{} {
		if tableName != "address_group_members" && tableName != "service_group_members" && tableName != "application_group_members" && tableName != "entity_tag_mappings" {
			return row
		}
		
		enriched := make(map[string]interface{})
		for k, v := range row {
			enriched[k] = v
		}
		
		if gid, ok := enriched["group_id"]; ok && gid != nil {
			switch tableName {
			case "address_group_members":
				enriched["_group_name"] = resolveName("address_groups", gid)
			case "service_group_members":
				enriched["_group_name"] = resolveName("service_groups", gid)
			case "application_group_members":
				enriched["_group_name"] = resolveName("application_groups", gid)
			}
		}
		
		switch tableName {
		case "address_group_members":
			if mid, ok := enriched["member_address_id"]; ok && mid != nil {
				enriched["_member_name"] = resolveName("address_objects", mid)
			} else if mid, ok := enriched["member_group_id"]; ok && mid != nil {
				enriched["_member_name"] = resolveName("address_groups", mid)
			}
		case "service_group_members":
			if mid, ok := enriched["member_service_id"]; ok && mid != nil {
				enriched["_member_name"] = resolveName("service_objects", mid)
			} else if mid, ok := enriched["member_group_id"]; ok && mid != nil {
				enriched["_member_name"] = resolveName("service_groups", mid)
			}
		case "application_group_members":
			if mid, ok := enriched["member_application_id"]; ok && mid != nil {
				enriched["_member_name"] = resolveName("application_objects", mid)
			} else if mid, ok := enriched["member_group_id"]; ok && mid != nil {
				enriched["_member_name"] = resolveName("application_groups", mid)
			}
		case "entity_tag_mappings":
			if tid, ok := enriched["tag_id"]; ok && tid != nil {
				enriched["_tag_name"] = resolveName("tags", tid)
			}
		}
		
		return enriched
	}
	
	for table := range allTables {
		oldRows := oldState.Tables[table]
		newRows := newState.Tables[table]
		
		oldDict := make(map[string]map[string]interface{})
		for _, row := range oldRows {
			oldDict[getUniqueIdentifier(table, row)] = row
		}
		
		newDict := make(map[string]map[string]interface{})
		for _, row := range newRows {
			newDict[getUniqueIdentifier(table, row)] = row
		}
		
		tableDiff := ObjectDiff{
			Added:    make([]map[string]interface{}, 0),
			Modified: make([]map[string]interface{}, 0),
			Deleted:  make([]map[string]interface{}, 0),
		}
		
		var newKeys []string
		for key := range newDict {
			newKeys = append(newKeys, key)
		}
		sort.Strings(newKeys)

		for _, key := range newKeys {
			newVal := newDict[key]
			oldVal, exists := oldDict[key]
			if !exists {
				tableDiff.Added = append(tableDiff.Added, enrichRow(table, newVal))
			} else {
				isDiff := false
				changes := map[string]interface{}{}
				for k, v := range newVal {
					if k == "dirty" || k == "created_at" || k == "updated_at" {
						continue
					}
					if fmt.Sprintf("%v", v) != fmt.Sprintf("%v", oldVal[k]) {
						isDiff = true
						changes[k] = map[string]interface{}{"old": oldVal[k], "new": v}
					}
				}
				if isDiff {
					for k, v := range newVal {
						if k == "id" || k == "name" || strings.HasPrefix(k, "member_") || k == "group_id" || k == "entity_id" || k == "device_uuid" || k == "scope" {
							if _, exists := changes[k]; !exists {
								changes[k] = v
							}
						}
					}
					// Also include any enriched virtual fields so the UI can display them
					enriched := enrichRow(table, newVal)
					for k, v := range enriched {
						if strings.HasPrefix(k, "_") {
							changes[k] = v
						}
					}
					tableDiff.Modified = append(tableDiff.Modified, changes)
				}
			}
		}
		
		var oldKeys []string
		for key := range oldDict {
			oldKeys = append(oldKeys, key)
		}
		sort.Strings(oldKeys)
		
		for _, key := range oldKeys {
			oldVal := oldDict[key]
			if _, exists := newDict[key]; !exists {
				tableDiff.Deleted = append(tableDiff.Deleted, enrichRow(table, oldVal))
			}
		}
		
		if len(tableDiff.Added) > 0 || len(tableDiff.Modified) > 0 || len(tableDiff.Deleted) > 0 {
			diff.Tables[table] = tableDiff
		}
	}
	
	return diff, nil
}

func RestoreSnapshot(tx *sql.Tx, snapshotJSON []byte) error {
	var state SnapshotState
	if err := json.Unmarshal(snapshotJSON, &state); err != nil {
		return err
	}

	// Defer foreign keys so we can insert tables in any order without failing constraints
	tx.Exec("PRAGMA defer_foreign_keys = ON")

	for tableName, rows := range state.Tables {
		// Wipe the table before inserting snapshot state
		if _, err := tx.Exec("DELETE FROM " + tableName); err != nil {
			return err
		}

		for _, row := range rows {
			if len(row) == 0 {
				continue
			}

			var cols []string
			var placeholders []string
			var vals []interface{}

			for k, v := range row {
				cols = append(cols, k)
				placeholders = append(placeholders, "?")
				if k == "dirty" {
					vals = append(vals, 0)
				} else {
					vals = append(vals, v)
				}
			}

			query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", tableName, strings.Join(cols, ", "), strings.Join(placeholders, ", "))
			if _, err := tx.Exec(query, vals...); err != nil {
				return err
			}
		}
	}

	return nil
}
