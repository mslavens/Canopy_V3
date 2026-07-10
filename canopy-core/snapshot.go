package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

type SnapshotState struct {
	Tags           map[string]TagSnapshot           `json:"tags"`
	AddressObjects map[string]AddressObjectSnapshot `json:"address_objects"`
	AddressGroups  map[string]AddressGroupSnapshot  `json:"address_groups"`
	Services       map[string]ServiceSnapshot       `json:"services"`
}

type EntityRef struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Type string `json:"type,omitempty"`
}

type TagSnapshot struct {
	DeviceUUID string `json:"device_uuid"`
	Scope      string `json:"scope"`
	Name       string `json:"name"`
	Color      string `json:"color"`
	Comments   string `json:"comments"`
}

type AddressObjectSnapshot struct {
	DeviceUUID  string   `json:"device_uuid"`
	Scope       string   `json:"scope"`
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Value       string   `json:"value"`
	Description string      `json:"description"`
	Tags        []EntityRef `json:"tags"`
}

type AddressGroupSnapshot struct {
	DeviceUUID  string   `json:"device_uuid"`
	Scope       string   `json:"scope"`
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Filter      string   `json:"filter"`
	Description string      `json:"description"`
	Members     []EntityRef `json:"members"`
	Tags        []EntityRef `json:"tags"`
}

type ServiceSnapshot struct {
	DeviceUUID  string   `json:"device_uuid"`
	Scope       string   `json:"scope"`
	Name        string   `json:"name"`
	Protocol    string   `json:"protocol"`
	Port        string   `json:"port"`
	Description string      `json:"description"`
	Tags        []EntityRef `json:"tags"`
}

// DiffResult holds the structured differences between two snapshots
type DiffResult struct {
	Tags           ObjectDiff `json:"tags"`
	AddressObjects ObjectDiff `json:"address_objects"`
	AddressGroups  ObjectDiff `json:"address_groups"`
	Services       ObjectDiff `json:"services"`
}

type ObjectDiff struct {
	Added    []map[string]interface{} `json:"added"`
	Modified []map[string]interface{} `json:"modified"`
	Deleted  []map[string]interface{} `json:"deleted"`
}

// GenerateSnapshot builds a complete memory state of the core configuration objects
func GenerateSnapshot(tx *sql.Tx) (*SnapshotState, error) {
	state := &SnapshotState{
		Tags:           make(map[string]TagSnapshot),
		AddressObjects: make(map[string]AddressObjectSnapshot),
		AddressGroups:  make(map[string]AddressGroupSnapshot),
		Services:       make(map[string]ServiceSnapshot),
	}

	// Load Tags
	tagRows, err := tx.Query("SELECT CAST(id AS TEXT), device_uuid, scope, name, COALESCE(color, ''), COALESCE(comments, '') FROM tags")
	if err == nil {
		defer tagRows.Close()
		for tagRows.Next() {
			var id, du, sc, nm, cl, cm sql.NullString
			if err := tagRows.Scan(&id, &du, &sc, &nm, &cl, &cm); err == nil {
				var t TagSnapshot
				t.DeviceUUID = du.String
				t.Scope = sc.String
				t.Name = nm.String
				t.Color = cl.String
				t.Comments = cm.String
				state.Tags[id.String] = t
			} else {
				fmt.Printf("tagRows.Scan error: %v\n", err)
			}
		}
	}

	// Load Address Objects
	aoRows, err := tx.Query(`
		SELECT CAST(a.id AS TEXT), a.device_uuid, a.scope, a.name, a.type, COALESCE(a.value, ''), COALESCE(a.description, ''),
		       (SELECT GROUP_CONCAT(t.id || '::' || t.name, '||') FROM entity_tag_mappings e JOIN tags t ON e.tag_id = t.id WHERE e.entity_type = 'address_object' AND e.entity_id = a.id)
		FROM address_objects a`)
	if err != nil {
		fmt.Printf("SQL_ERROR_AO: %v\n", err)
	} else {
		defer aoRows.Close()
		for aoRows.Next() {
			var id, du, sc, nm, ty, vl, ds, tg sql.NullString
			if err := aoRows.Scan(&id, &du, &sc, &nm, &ty, &vl, &ds, &tg); err == nil {
				var ao AddressObjectSnapshot
				ao.DeviceUUID = du.String
				ao.Scope = sc.String
				ao.Name = nm.String
				ao.Type = ty.String
				ao.Value = vl.String
				ao.Description = ds.String
				ao.Tags = []EntityRef{}
				if tg.Valid && tg.String != "" {
					parts := strings.Split(tg.String, "||")
					for _, p := range parts {
						kv := strings.SplitN(p, "::", 2)
						if len(kv) == 2 {
							tid, _ := strconv.ParseInt(kv[0], 10, 64)
							ao.Tags = append(ao.Tags, EntityRef{ID: tid, Name: kv[1]})
						}
					}
				}
				state.AddressObjects[id.String] = ao
			} else {
				fmt.Printf("SCAN_ERROR_AO: %v\n", err)
			}
		}
	}

	// Load Address Groups
	agRows, err := tx.Query(`
		SELECT CAST(g.id AS TEXT), g.device_uuid, g.scope, g.name, g.type, COALESCE(g.filter, ''), COALESCE(g.description, ''),
		       (SELECT GROUP_CONCAT(COALESCE(ao.id, nested.id, 0) || '::' || COALESCE(ao.name, nested.name, m.member_name) || '::' || CASE WHEN ao.id IS NOT NULL THEN 'address_object' WHEN nested.id IS NOT NULL THEN 'address_group' ELSE '' END, '||') 
		        FROM address_group_members m 
		        LEFT JOIN address_objects ao ON m.member_address_id = ao.id 
		        LEFT JOIN address_groups nested ON m.member_group_id = nested.id 
		        WHERE m.group_id = g.id),
		       (SELECT GROUP_CONCAT(t.id || '::' || t.name, '||') FROM entity_tag_mappings e JOIN tags t ON e.tag_id = t.id WHERE e.entity_type = 'address_group' AND e.entity_id = g.id)
		FROM address_groups g`)
	if err == nil {
		defer agRows.Close()
		for agRows.Next() {
			var id, du, sc, nm, ty, fl, ds, mb, tg sql.NullString
			if err := agRows.Scan(&id, &du, &sc, &nm, &ty, &fl, &ds, &mb, &tg); err == nil {
				var ag AddressGroupSnapshot
				ag.DeviceUUID = du.String
				ag.Scope = sc.String
				ag.Name = nm.String
				ag.Type = ty.String
				ag.Filter = fl.String
				ag.Description = ds.String
				ag.Members = []EntityRef{}
				ag.Tags = []EntityRef{}
				if mb.Valid && mb.String != "" {
					parts := strings.Split(mb.String, "||")
					for _, p := range parts {
						kv := strings.SplitN(p, "::", 3)
						if len(kv) == 3 {
							mid, _ := strconv.ParseInt(kv[0], 10, 64)
							ag.Members = append(ag.Members, EntityRef{ID: mid, Name: kv[1], Type: kv[2]})
						}
					}
				}
				if tg.Valid && tg.String != "" {
					parts := strings.Split(tg.String, "||")
					for _, p := range parts {
						kv := strings.SplitN(p, "::", 2)
						if len(kv) == 2 {
							tid, _ := strconv.ParseInt(kv[0], 10, 64)
							ag.Tags = append(ag.Tags, EntityRef{ID: tid, Name: kv[1]})
						}
					}
				}
				state.AddressGroups[id.String] = ag
			} else {
				fmt.Printf("agRows.Scan error: %v\n", err)
			}
		}
	}

	// Load Services
	svcRows, err := tx.Query(`
		SELECT CAST(s.id AS TEXT), s.device_uuid, s.scope, s.name, s.protocol, COALESCE(s.port, ''), COALESCE(s.description, ''),
		       (SELECT GROUP_CONCAT(t.id || '::' || t.name, '||') FROM entity_tag_mappings e JOIN tags t ON e.tag_id = t.id WHERE e.entity_type = 'service_object' AND e.entity_id = s.id)
		FROM service_objects s`)
	if err == nil {
		defer svcRows.Close()
		for svcRows.Next() {
			var id, du, sc, nm, pr, po, ds, tg sql.NullString
			if err := svcRows.Scan(&id, &du, &sc, &nm, &pr, &po, &ds, &tg); err == nil {
				var svc ServiceSnapshot
				svc.DeviceUUID = du.String
				svc.Scope = sc.String
				svc.Name = nm.String
				svc.Protocol = pr.String
				svc.Port = po.String
				svc.Description = ds.String
				svc.Tags = []EntityRef{}
				if tg.Valid && tg.String != "" {
					parts := strings.Split(tg.String, "||")
					for _, p := range parts {
						kv := strings.SplitN(p, "::", 2)
						if len(kv) == 2 {
							tid, _ := strconv.ParseInt(kv[0], 10, 64)
							svc.Tags = append(svc.Tags, EntityRef{ID: tid, Name: kv[1]})
						}
					}
				}
				state.Services[id.String] = svc
			} else {
				fmt.Printf("svcRows.Scan error: %v\n", err)
			}
		}
	}

	return state, nil
}

// CompareSnapshots diffs an old JSON state against a new one.
func CompareSnapshots(oldJSON, newJSON []byte) (*DiffResult, error) {
	var oldState, newState SnapshotState
	
	if len(oldJSON) > 0 {
		if err := json.Unmarshal(oldJSON, &oldState); err != nil {
			return nil, err
		}
	} else {
		oldState = SnapshotState{
			Tags:           make(map[string]TagSnapshot),
			AddressObjects: make(map[string]AddressObjectSnapshot),
			AddressGroups:  make(map[string]AddressGroupSnapshot),
			Services:       make(map[string]ServiceSnapshot),
		}
	}

	if len(newJSON) > 0 {
		if err := json.Unmarshal(newJSON, &newState); err != nil {
			return nil, err
		}
	}

	diff := &DiffResult{}

	// Diff Tags
	diff.Tags = diffGenericMap(oldState.Tags, newState.Tags)
	// Diff Address Objects
	diff.AddressObjects = diffGenericMap(oldState.AddressObjects, newState.AddressObjects)
	// Diff Address Groups
	diff.AddressGroups = diffGenericMap(oldState.AddressGroups, newState.AddressGroups)
	// Diff Services
	diff.Services = diffGenericMap(oldState.Services, newState.Services)

	return diff, nil
}

// diffGenericMap is a quick helper to diff two maps of structs.
// For robust usage in production, reflection is usually used, but we convert through JSON here for simplicity.
func diffGenericMap(oldMap, newMap interface{}) ObjectDiff {
	oldBytes, _ := json.Marshal(oldMap)
	newBytes, _ := json.Marshal(newMap)

	var oldDict map[string]map[string]interface{}
	var newDict map[string]map[string]interface{}
	
	json.Unmarshal(oldBytes, &oldDict)
	json.Unmarshal(newBytes, &newDict)

	diff := ObjectDiff{
		Added:    make([]map[string]interface{}, 0),
		Modified: make([]map[string]interface{}, 0),
		Deleted:  make([]map[string]interface{}, 0),
	}

	// Find Added and Modified
	for key, newVal := range newDict {
		oldVal, exists := oldDict[key]
		if !exists {
			newVal["id"] = key
			diff.Added = append(diff.Added, newVal)
		} else {
			// Compare old and new
			isDiff := false
			objName := key
			if nameVal, ok := newVal["name"]; ok && nameVal != nil {
				objName = fmt.Sprintf("%v", nameVal)
			}
			changes := map[string]interface{}{"id": key, "name": objName}
			if devUUID, ok := newVal["device_uuid"]; ok {
				changes["device_uuid"] = devUUID
			}
			if scope, ok := newVal["scope"]; ok {
				changes["scope"] = scope
			}
			for k, v := range newVal {
				if fmt.Sprintf("%v", v) != fmt.Sprintf("%v", oldVal[k]) {
					isDiff = true
					changes[k] = map[string]interface{}{"old": oldVal[k], "new": v}
				}
			}
			if isDiff {
				diff.Modified = append(diff.Modified, changes)
			}
		}
	}

	// Find Deleted
	for key, oldVal := range oldDict {
		if _, exists := newDict[key]; !exists {
			oldVal["id"] = key
			diff.Deleted = append(diff.Deleted, oldVal)
		}
	}

	// Sort slices to ensure stable ordering across map iterations
	sortSlice := func(slice []map[string]interface{}) {
		sort.Slice(slice, func(i, j int) bool {
			nameI, _ := slice[i]["name"].(string)
			nameJ, _ := slice[j]["name"].(string)
			if nameI == nameJ {
				idI, _ := slice[i]["id"].(string)
				idJ, _ := slice[j]["id"].(string)
				return idI < idJ
			}
			return nameI < nameJ
		})
	}

	sortSlice(diff.Added)
	sortSlice(diff.Modified)
	sortSlice(diff.Deleted)

	return diff
}

func getSnapshotDeviceUUID(tx *sql.Tx, deviceUUID, scope string) string {
	if deviceUUID != "" {
		return deviceUUID
	}
	if strings.ToLower(scope) == "shared" {
		return "paloalto-panorama-global"
	}
	var u string
	tx.QueryRow("SELECT uuid FROM scopes WHERE name = ?", scope).Scan(&u)
	if u != "" {
		return u
	}
	return "paloalto-panorama-global" // Safe fallback
}

// RestoreSnapshot wipes current config and inserts state from JSON
func RestoreSnapshot(tx *sql.Tx, snapshotJSON []byte) error {
	var state SnapshotState
	if err := json.Unmarshal(snapshotJSON, &state); err != nil {
		return err
	}

	// For v1, we wipe the core tables
	tables := []string{
		"address_group_members", "address_groups", "address_objects",
		"service_group_members", "service_groups", "service_objects",
		"entity_tag_mappings", "tags",
	}
	for _, t := range tables {
		if _, err := tx.Exec("DELETE FROM " + t); err != nil {
			return err
		}
	}

	// Insert Tags
	for idStr, t := range state.Tags {
		id, _ := strconv.Atoi(idStr)
		_, err := tx.Exec("INSERT INTO tags (id, device_uuid, scope, name, color, comments) VALUES (?, ?, ?, ?, ?, ?)", id, t.DeviceUUID, t.Scope, t.Name, t.Color, t.Comments)
		if err != nil {
			return err
		}
	}

	// Insert Address Objects
	for idStr, ao := range state.AddressObjects {
		id, _ := strconv.Atoi(idStr)
		_, err := tx.Exec("INSERT INTO address_objects (id, device_uuid, scope, name, type, value, description, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, 0)", id, ao.DeviceUUID, ao.Scope, ao.Name, ao.Type, ao.Value, ao.Description)
		if err != nil {
			return err
		}

		// Tags
		for _, tag := range ao.Tags {
			tx.Exec("INSERT INTO entity_tag_mappings (entity_type, entity_id, tag_id) VALUES ('address_object', ?, ?)", id, tag.ID)
		}
	}

	// Insert Address Groups
	for idStr, ag := range state.AddressGroups {
		id, _ := strconv.Atoi(idStr)
		_, err := tx.Exec("INSERT INTO address_groups (id, device_uuid, scope, name, type, filter, description, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, 0)", id, ag.DeviceUUID, ag.Scope, ag.Name, ag.Type, ag.Filter, ag.Description)
		if err != nil {
			return err
		}

		// Tags
		for _, tag := range ag.Tags {
			tx.Exec("INSERT INTO entity_tag_mappings (entity_type, entity_id, tag_id) VALUES ('address_group', ?, ?)", id, tag.ID)
		}

		// Members
		for _, m := range ag.Members {
			if m.ID > 0 {
				switch m.Type {
				case "address_object":
					tx.Exec("INSERT INTO address_group_members (group_id, member_address_id) VALUES (?, ?)", id, m.ID)
				case "address_group":
					tx.Exec("INSERT INTO address_group_members (group_id, member_group_id) VALUES (?, ?)", id, m.ID)
				}
			} else {
				tx.Exec("INSERT INTO address_group_members (group_id, member_name) VALUES (?, ?)", id, m.Name)
			}
		}
	}

	// Insert Services
	for idStr, svc := range state.Services {
		id, _ := strconv.Atoi(idStr)
		_, err := tx.Exec("INSERT INTO service_objects (id, device_uuid, scope, name, protocol, port, description, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, 0)", id, svc.DeviceUUID, svc.Scope, svc.Name, svc.Protocol, svc.Port, svc.Description)
		if err != nil {
			return err
		}

		for _, tag := range svc.Tags {
			tx.Exec("INSERT INTO entity_tag_mappings (entity_type, entity_id, tag_id) VALUES ('service_object', ?, ?)", id, tag.ID)
		}
	}

	return nil
}
