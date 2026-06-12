package main

import (
	"database/sql"
	"fmt"
	"log/slog"
)

// MaterializeDynamicGroups re-evaluates all dynamic groups in the given scope
// and rewrites their memberships in the address_group_members table.
func MaterializeDynamicGroups(tx *sql.Tx, deviceUUID string) error {
	// We need to support the provided scope and the global shared scope
	scopes := []string{deviceUUID}
	if deviceUUID != "paloalto-panorama-global" {
		scopes = append(scopes, "paloalto-panorama-global")
	}

	scopeFilter := "device_uuid IN ("
	for i, s := range scopes {
		if i > 0 {
			scopeFilter += ", "
		}
		scopeFilter += fmt.Sprintf("'%s'", s)
	}
	scopeFilter += ")"

	// 1. Clear existing memberships for ALL dynamic groups in this scope
	// Note: We only clear dynamic groups. Static groups maintain their own manual relations.
	_, err := tx.Exec(fmt.Sprintf(`
		DELETE FROM address_group_members 
		WHERE group_id IN (
			SELECT id FROM address_groups WHERE type = 'dynamic' AND %s
		)`, scopeFilter))
	if err != nil {
		return err
	}

	// 2. Load all Dynamic Groups
	rows, err := tx.Query(fmt.Sprintf("SELECT id, filter, device_uuid FROM address_groups WHERE type = 'dynamic' AND %s", scopeFilter))
	if err != nil {
		return err
	}
	defer rows.Close()

	type dynGroup struct {
		id    int64
		filter string
		scope  string
	}
	var groups []dynGroup
	for rows.Next() {
		var g dynGroup
		if err := rows.Scan(&g.id, &g.filter, &g.scope); err == nil {
			groups = append(groups, g)
		}
	}
	rows.Close()

	if len(groups) == 0 {
		return nil // Nothing to do
	}

	// 3. Load all candidate objects and their tags
	// We map entity_type -> entity_id -> slice of tag names
	tagMap := make(map[string]map[int64][]string)
	tagMap["address_object"] = make(map[int64][]string)
	tagMap["address_group"] = make(map[int64][]string)

	tagRows, err := tx.Query(fmt.Sprintf(`
		SELECT e.entity_type, e.entity_id, t.name 
		FROM entity_tag_mappings e
		JOIN tags t ON e.tag_id = t.id
		WHERE t.%s OR e.entity_id IN (
			SELECT id FROM address_objects WHERE %s
			UNION
			SELECT id FROM address_groups WHERE %s
		)`, scopeFilter, scopeFilter, scopeFilter))
	if err == nil {
		for tagRows.Next() {
			var eType string
			var eID int64
			var tName string
			if err := tagRows.Scan(&eType, &eID, &tName); err == nil {
				if _, ok := tagMap[eType]; ok {
					tagMap[eType][eID] = append(tagMap[eType][eID], tName)
				}
			}
		}
		tagRows.Close()
	} else {
		slog.Error("Failed to query tags in MaterializeDynamicGroups", slog.String("error", err.Error()))
	}

	// 4. Load all candidates
	type candidate struct {
		id    int64
		eType string
		scope string
	}
	var candidates []candidate

	// Address Objects
	aoRows, err := tx.Query(fmt.Sprintf("SELECT id, device_uuid FROM address_objects WHERE %s", scopeFilter))
	if err == nil {
		for aoRows.Next() {
			var c candidate
			c.eType = "address_object"
			aoRows.Scan(&c.id, &c.scope)
			candidates = append(candidates, c)
		}
		aoRows.Close()
	}

	// Address Groups (both static and dynamic can be members of a dynamic group)
	agRows, err := tx.Query(fmt.Sprintf("SELECT id, device_uuid FROM address_groups WHERE %s", scopeFilter))
	if err == nil {
		for agRows.Next() {
			var c candidate
			c.eType = "address_group"
			agRows.Scan(&c.id, &c.scope)
			candidates = append(candidates, c)
		}
		agRows.Close()
	}

	// 5. Evaluate and Insert
	for _, g := range groups {
		if g.filter == "" {
			continue
		}

		for _, c := range candidates {
			if c.eType == "address_group" && c.id == g.id {
				continue // Can't contain itself
			}
			
			// Determine if candidate scope is valid for this group
			// Local groups can see local and shared candidates.
			// Shared groups can ONLY see shared candidates.
			if g.scope == "paloalto-panorama-global" && c.scope != "paloalto-panorama-global" {
				continue
			}

			tags := tagMap[c.eType][c.id]
			
			slog.Info("Evaluating candidate for dynamic group", slog.Int64("candidate_id", c.id), slog.String("eType", c.eType), slog.Int64("group_id", g.id), slog.String("filter", g.filter), slog.Any("tags", tags))
			
			if EvaluateFilter(g.filter, tags) {
				slog.Info("Candidate MATCHED filter!", slog.Int64("candidate_id", c.id), slog.Int64("group_id", g.id))
				if c.eType == "address_object" {
					_, err := tx.Exec("INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name) VALUES (?, ?, NULL, NULL)", g.id, c.id)
					if err != nil { slog.Error("Failed to insert dynamic member object", slog.String("err", err.Error())) }
				} else {
					_, err := tx.Exec("INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name) VALUES (?, NULL, ?, NULL)", g.id, c.id)
					if err != nil { slog.Error("Failed to insert dynamic member group", slog.String("err", err.Error())) }
				}
			}
		}
	}

	slog.Debug("Materialized dynamic group memberships", slog.String("scope", deviceUUID), slog.Int("groups_evaluated", len(groups)))
	return nil
}
