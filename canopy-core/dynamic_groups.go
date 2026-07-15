package main

import (
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
)

// MaterializeDynamicGroups re-evaluates all dynamic groups in the given scope
// and rewrites their memberships in the address_group_members table.
func MaterializeDynamicGroups(tx *sql.Tx, deviceUUID string) error {
	// Precompute valid candidate scopes for each scope
	validCandidateScopes := make(map[string]map[string]bool)
	type scopeRec struct {
		uuid       string
		parentUUID sql.NullString
	}
	var allScopes []scopeRec
	rows, err := tx.Query("SELECT uuid, parent_uuid FROM scopes")
	if err == nil {
		for rows.Next() {
			var r scopeRec
			rows.Scan(&r.uuid, &r.parentUUID)
			allScopes = append(allScopes, r)
		}
		rows.Close()
	}

	for _, s := range allScopes {
		valid := make(map[string]bool)
		curr := s.uuid
		for curr != "" {
			valid[curr] = true
			var parent string
			for _, p := range allScopes {
				if p.uuid == curr && p.parentUUID.Valid {
					parent = p.parentUUID.String
					break
				}
			}
			curr = parent
		}
		valid["paloalto-panorama-global"] = true
		validCandidateScopes[s.uuid] = valid
	}
	validCandidateScopes["paloalto-panorama-global"] = map[string]bool{"paloalto-panorama-global": true}

	var groupScopes []string
	var candidateScopes []string

	if deviceUUID == "" {
		for _, s := range allScopes {
			groupScopes = append(groupScopes, s.uuid)
			candidateScopes = append(candidateScopes, s.uuid)
		}
		groupScopes = append(groupScopes, "paloalto-panorama-global")
		candidateScopes = append(candidateScopes, "paloalto-panorama-global")
	} else {
		affectedMap := make(map[string]bool)
		affectedMap[deviceUUID] = true
		
		changed := true
		for changed {
			changed = false
			for _, s := range allScopes {
				if s.parentUUID.Valid && affectedMap[s.parentUUID.String] && !affectedMap[s.uuid] {
					affectedMap[s.uuid] = true
					changed = true
				}
			}
		}

		for s := range affectedMap {
			groupScopes = append(groupScopes, s)
			for c := range validCandidateScopes[s] {
				candidateScopes = append(candidateScopes, c)
			}
		}
		
		if deviceUUID == "paloalto-panorama-global" {
		    groupScopes = append(groupScopes, "paloalto-panorama-global")
		    candidateScopes = append(candidateScopes, "paloalto-panorama-global")
		}
	}

	cMap := make(map[string]bool)
	var finalCandidateScopes []string
	for _, s := range candidateScopes {
		if !cMap[s] {
			cMap[s] = true
			finalCandidateScopes = append(finalCandidateScopes, s)
		}
	}

	groupScopeFilter := "device_uuid IN ("
	for i, s := range groupScopes {
		if i > 0 {
			groupScopeFilter += ", "
		}
		groupScopeFilter += fmt.Sprintf("'%s'", s)
	}
	groupScopeFilter += ")"
	if len(groupScopes) == 0 {
	    groupScopeFilter = "1=0"
	}

	candScopeFilter := "device_uuid IN ("
	for i, s := range finalCandidateScopes {
		if i > 0 {
			candScopeFilter += ", "
		}
		candScopeFilter += fmt.Sprintf("'%s'", s)
	}
	candScopeFilter += ")"
    if len(finalCandidateScopes) == 0 {
        candScopeFilter = "1=0"
    }

	// 1. Clear existing memberships for ALL dynamic groups in affected scopes
	_, err = tx.Exec(fmt.Sprintf(`
		DELETE FROM address_group_members 
		WHERE group_id IN (
			SELECT id FROM address_groups WHERE type = 'dynamic' AND %s
		)`, groupScopeFilter))
	if err != nil {
		return err
	}

	// 2. Load all Dynamic Groups in affected scopes
	grpRows, err := tx.Query(fmt.Sprintf("SELECT id, filter, device_uuid FROM address_groups WHERE type = 'dynamic' AND %s", groupScopeFilter))
	if err != nil {
		return err
	}
	defer grpRows.Close()

	type dynGroup struct {
		id     int64
		filter string
		scope  string
		ast    Expr
	}
	var groups []dynGroup
	for grpRows.Next() {
		var g dynGroup
		if err := grpRows.Scan(&g.id, &g.filter, &g.scope); err == nil {
			if g.filter != "" {
				g.ast = ParseFilter(g.filter)
			}
			groups = append(groups, g)
		}
	}
	grpRows.Close()

	if len(groups) == 0 {
		return nil
	}

	// 3. Load all candidate objects and their tags
	tagMap := make(map[string]map[int64][]string)
	tagMap["address_object"] = make(map[int64][]string)
	tagMap["address_group"] = make(map[int64][]string)

	tagScopeFilter := "t." + candScopeFilter
	tagRows, err := tx.Query(fmt.Sprintf(`
		SELECT e.entity_type, e.entity_id, t.name 
		FROM entity_tag_mappings e
		JOIN tags t ON e.tag_id = t.id
		WHERE %s OR e.entity_id IN (
			SELECT id FROM address_objects WHERE %s
			UNION
			SELECT id FROM address_groups WHERE %s
		)`, tagScopeFilter, candScopeFilter, candScopeFilter))
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

	aoRows, err := tx.Query(fmt.Sprintf("SELECT id, device_uuid FROM address_objects WHERE %s", candScopeFilter))
	if err == nil {
		for aoRows.Next() {
			var c candidate
			c.eType = "address_object"
			aoRows.Scan(&c.id, &c.scope)
			candidates = append(candidates, c)
		}
		aoRows.Close()
	}

	agRows, err := tx.Query(fmt.Sprintf("SELECT id, device_uuid FROM address_groups WHERE %s", candScopeFilter))
	if err == nil {
		for agRows.Next() {
			var c candidate
			c.eType = "address_group"
			agRows.Scan(&c.id, &c.scope)
			candidates = append(candidates, c)
		}
		agRows.Close()
	}

	candidateTagMaps := make(map[string]map[int64]map[string]bool)
	candidateTagMaps["address_object"] = make(map[int64]map[string]bool)
	candidateTagMaps["address_group"] = make(map[int64]map[string]bool)

	for _, c := range candidates {
		tags := tagMap[c.eType][c.id]
		tmap := make(map[string]bool)
		for _, t := range tags {
			tmap[strings.ToLower(strings.TrimSpace(t))] = true
		}
		candidateTagMaps[c.eType][c.id] = tmap
	}

	// 5. Evaluate and Insert
	for _, g := range groups {
		if g.filter == "" || g.ast == nil {
			continue
		}

		for _, c := range candidates {
			if c.eType == "address_group" && c.id == g.id {
				continue // Can't contain itself
			}

			// Determine if candidate scope is valid for this group
			if valid := validCandidateScopes[g.scope]; !valid[c.scope] {
				continue
			}

			cMap := candidateTagMaps[c.eType][c.id]
			if g.ast.Eval(cMap) {
				if c.eType == "address_object" {
					_, err := tx.Exec("INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name) VALUES (?, ?, NULL, NULL)", g.id, c.id)
					if err != nil {
						slog.Error("Failed to insert dynamic member object", slog.String("err", err.Error()))
					}
				} else {
					_, err := tx.Exec("INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name) VALUES (?, NULL, ?, NULL)", g.id, c.id)
					if err != nil {
						slog.Error("Failed to insert dynamic member group", slog.String("err", err.Error()))
					}
				}
			}
		}
	}

	slog.Debug("Materialized dynamic group memberships", slog.String("scope", deviceUUID), slog.Int("groups_evaluated", len(groups)))
	return nil
}
