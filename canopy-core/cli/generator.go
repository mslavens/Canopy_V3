package cli

import (
	"database/sql"
	"fmt"
	"strings"
)

type Generator struct {
	DB *sql.DB
}

func NewGenerator(db *sql.DB) *Generator {
	return &Generator{DB: db}
}

type CLIRequest struct {
	EntityType string `json:"entityType"`
	EntityIDs     []int  `json:"entityIds"`
	ScopeUUID     string `json:"scopeUuid"`
	IncludeNested bool   `json:"includeNested"`
}

type CLIResponse struct {
	Commands []string `json:"commands"`
}

// Map the scope UUID to the scope name (device group name or 'shared')
func quoteIfHasSpace(val string) string {
	if strings.Contains(val, " ") {
		return fmt.Sprintf(`"%s"`, val)
	}
	return val
}

func (g *Generator) getScopePrefix(deviceUUID string) string {
	if deviceUUID == "paloalto-panorama-global" {
		return "set shared"
	}
	var name string
	err := g.DB.QueryRow("SELECT name FROM scopes WHERE uuid = ?", deviceUUID).Scan(&name)
	if err != nil {
		return "set device-group Unknown"
	}
	return fmt.Sprintf("set device-group %s", quoteIfHasSpace(name))
}

func (g *Generator) Generate(req CLIRequest) ([]string, error) {
	var allCommands []string
	visited := make(map[string]bool)

	for _, id := range req.EntityIDs {
		cmds, err := g.generateRecursive(req.EntityType, id, visited, req.IncludeNested)
		if err != nil {
			return nil, err
		}
		allCommands = append(allCommands, cmds...)
	}

	return deduplicateCommands(allCommands), nil
}

func deduplicateCommands(commands []string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, cmd := range commands {
		if !seen[cmd] {
			seen[cmd] = true
			result = append(result, cmd)
		}
	}
	return result
}

func (g *Generator) getTags(entityType string, entityId int, scopePrefix string) ([]string, string, error) {
	rows, err := g.DB.Query(`
		SELECT t.name, t.color
		FROM entity_tag_mappings tm
		JOIN tags t ON tm.tag_id = t.id
		WHERE tm.entity_type = ? AND tm.entity_id = ?
	`, entityType, entityId)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	var tagCommands []string
	var tagNames []string

	for rows.Next() {
		var name, color sql.NullString
		if err := rows.Scan(&name, &color); err != nil {
			return nil, "", err
		}
		c := "color1"
		if color.Valid && color.String != "" {
			c = color.String
		}
		tagCommands = append(tagCommands, fmt.Sprintf("%s tag %s color %s", scopePrefix, name.String, c))
		tagNames = append(tagNames, fmt.Sprintf(`"%s"`, name.String))
	}

	tagString := ""
	if len(tagNames) > 0 {
		tagString = fmt.Sprintf(" tag [ %s ]", strings.Join(tagNames, " "))
	}
	return tagCommands, tagString, nil
}

func (g *Generator) generateRecursive(entityType string, id int, visited map[string]bool, includeNested bool) ([]string, error) {
	var cmds []string

	switch entityType {
	case "Address Objects":
		var name, devUUID, addrType, value, desc sql.NullString
		err := g.DB.QueryRow("SELECT name, device_uuid, type, value, description FROM address_objects WHERE id = ?", id).Scan(&name, &devUUID, &addrType, &value, &desc)
		if err != nil {
			return nil, err
		}
		if visited[name.String] {
			return nil, nil
		}
		visited[name.String] = true
		scopePrefix := g.getScopePrefix(devUUID.String)

		tagCmds, tagStr, _ := g.getTags("address_object", id, scopePrefix)
		cmds = append(cmds, tagCmds...)
		cmds = append(cmds, fmt.Sprintf("%s address %s %s %s%s", scopePrefix, name.String, addrType.String, value.String, tagStr))
		if desc.Valid && desc.String != "" {
			cmds = append(cmds, fmt.Sprintf(`%s address %s description "%s"`, scopePrefix, name.String, desc.String))
		}

	case "Address Groups":
		var name, devUUID, grpType, filter, desc sql.NullString
		err := g.DB.QueryRow("SELECT name, device_uuid, type, filter, description FROM address_groups WHERE id = ?", id).Scan(&name, &devUUID, &grpType, &filter, &desc)
		if err != nil {
			return nil, err
		}
		if visited[name.String] {
			return nil, nil
		}
		visited[name.String] = true
		scopePrefix := g.getScopePrefix(devUUID.String)

		// Resolve children recursively first for both static and dynamic members
		var members []string
		if includeNested {
			rows, _ := g.DB.Query("SELECT member_address_id, member_group_id, member_name FROM address_group_members WHERE group_id = ?", id)
			for rows.Next() {
				var addrID, grpID sql.NullInt64
				var memberName sql.NullString
				rows.Scan(&addrID, &grpID, &memberName)
				if addrID.Valid {
					childCmds, _ := g.generateRecursive("Address Objects", int(addrID.Int64), visited, includeNested)
					cmds = append(cmds, childCmds...)
					var n string
					g.DB.QueryRow("SELECT name FROM address_objects WHERE id = ?", addrID.Int64).Scan(&n)
					members = append(members, n)
				} else if grpID.Valid {
					childCmds, _ := g.generateRecursive("Address Groups", int(grpID.Int64), visited, includeNested)
					cmds = append(cmds, childCmds...)
					var n string
					g.DB.QueryRow("SELECT name FROM address_groups WHERE id = ?", grpID.Int64).Scan(&n)
					members = append(members, n)
				} else if memberName.Valid {
					members = append(members, memberName.String)
				}
			}
			rows.Close()
		} else {
			// If not nesting, we still need the member names for static group syntax
			if grpType.String == "static" {
				rows, _ := g.DB.Query("SELECT member_address_id, member_group_id, member_name FROM address_group_members WHERE group_id = ?", id)
				for rows.Next() {
					var addrID, grpID sql.NullInt64
					var memberName sql.NullString
					rows.Scan(&addrID, &grpID, &memberName)
					if addrID.Valid {
						var n string
						g.DB.QueryRow("SELECT name FROM address_objects WHERE id = ?", addrID.Int64).Scan(&n)
						members = append(members, n)
					} else if grpID.Valid {
						var n string
						g.DB.QueryRow("SELECT name FROM address_groups WHERE id = ?", grpID.Int64).Scan(&n)
						members = append(members, n)
					} else if memberName.Valid {
						members = append(members, memberName.String)
					}
				}
				rows.Close()
			}
		}

		if grpType.String == "static" {
			tagCmds, tagStr, _ := g.getTags("address_group", id, scopePrefix)
			cmds = append(cmds, tagCmds...)
			for _, m := range members {
				cmds = append(cmds, fmt.Sprintf("%s address-group %s static %s", scopePrefix, name.String, m))
			}
			if tagStr != "" {
				cmds = append(cmds, fmt.Sprintf("%s address-group %s%s", scopePrefix, name.String, tagStr))
			}
		} else {
			tagCmds, tagStr, _ := g.getTags("address_group", id, scopePrefix)
			cmds = append(cmds, tagCmds...)
			cmds = append(cmds, fmt.Sprintf(`%s address-group %s dynamic filter "%s"%s`, scopePrefix, name.String, filter.String, tagStr))
		}

		if desc.Valid && desc.String != "" {
			cmds = append(cmds, fmt.Sprintf(`%s address-group %s description "%s"`, scopePrefix, name.String, desc.String))
		}

	case "Services":
		var name, devUUID, proto, dPort, sPort, desc sql.NullString
		err := g.DB.QueryRow("SELECT name, device_uuid, protocol, destination_port, source_port, description FROM services WHERE id = ?", id).Scan(&name, &devUUID, &proto, &dPort, &sPort, &desc)
		if err != nil {
			return nil, err
		}
		if visited[name.String] {
			return nil, nil
		}
		visited[name.String] = true
		scopePrefix := g.getScopePrefix(devUUID.String)

		tagCmds, tagStr, _ := g.getTags("service", id, scopePrefix)
		cmds = append(cmds, tagCmds...)
		cmds = append(cmds, fmt.Sprintf("%s service %s protocol %s port %s%s", scopePrefix, name.String, proto.String, dPort.String, tagStr))
		if sPort.Valid && sPort.String != "" {
			cmds = append(cmds, fmt.Sprintf("%s service %s protocol %s source-port %s", scopePrefix, name.String, proto.String, sPort.String))
		}
		if desc.Valid && desc.String != "" {
			cmds = append(cmds, fmt.Sprintf(`%s service %s description "%s"`, scopePrefix, name.String, desc.String))
		}

	case "Service Groups":
		var name, devUUID, desc sql.NullString
		err := g.DB.QueryRow("SELECT name, device_uuid, description FROM service_groups WHERE id = ?", id).Scan(&name, &devUUID, &desc)
		if err != nil {
			return nil, err
		}
		if visited[name.String] {
			return nil, nil
		}
		visited[name.String] = true
		scopePrefix := g.getScopePrefix(devUUID.String)

		var members []string
		if includeNested {
			rows, _ := g.DB.Query("SELECT member_service_id, member_group_id, member_name FROM service_group_members WHERE group_id = ?", id)
			for rows.Next() {
				var svcID, grpID sql.NullInt64
				var memberName sql.NullString
				rows.Scan(&svcID, &grpID, &memberName)
				if svcID.Valid {
					childCmds, _ := g.generateRecursive("Services", int(svcID.Int64), visited, includeNested)
					cmds = append(cmds, childCmds...)
					var n string
					g.DB.QueryRow("SELECT name FROM services WHERE id = ?", svcID.Int64).Scan(&n)
					members = append(members, n)
				} else if grpID.Valid {
					childCmds, _ := g.generateRecursive("Service Groups", int(grpID.Int64), visited, includeNested)
					cmds = append(cmds, childCmds...)
					var n string
					g.DB.QueryRow("SELECT name FROM service_groups WHERE id = ?", grpID.Int64).Scan(&n)
					members = append(members, n)
				} else if memberName.Valid {
					members = append(members, memberName.String)
				}
			}
			rows.Close()
		} else {
			rows, _ := g.DB.Query("SELECT member_service_id, member_group_id, member_name FROM service_group_members WHERE group_id = ?", id)
			for rows.Next() {
				var svcID, grpID sql.NullInt64
				var memberName sql.NullString
				rows.Scan(&svcID, &grpID, &memberName)
				if svcID.Valid {
					var n string
					g.DB.QueryRow("SELECT name FROM services WHERE id = ?", svcID.Int64).Scan(&n)
					members = append(members, n)
				} else if grpID.Valid {
					var n string
					g.DB.QueryRow("SELECT name FROM service_groups WHERE id = ?", grpID.Int64).Scan(&n)
					members = append(members, n)
				} else if memberName.Valid {
					members = append(members, memberName.String)
				}
			}
			rows.Close()
		}

		tagCmds, tagStr, _ := g.getTags("service_group", id, scopePrefix)
		cmds = append(cmds, tagCmds...)
		for _, m := range members {
			cmds = append(cmds, fmt.Sprintf("%s service-group %s members %s", scopePrefix, name.String, m))
		}
		if tagStr != "" {
			cmds = append(cmds, fmt.Sprintf("%s service-group %s%s", scopePrefix, name.String, tagStr))
		}
		if desc.Valid && desc.String != "" {
			cmds = append(cmds, fmt.Sprintf(`%s service-group %s description "%s"`, scopePrefix, name.String, desc.String))
		}

	case "Applications":
		var name, devUUID, cat, subcat, tech, risk, ports, desc sql.NullString
		err := g.DB.QueryRow("SELECT name, device_uuid, category, subcategory, technology, risk, ports, description FROM applications WHERE id = ?", id).Scan(&name, &devUUID, &cat, &subcat, &tech, &risk, &ports, &desc)
		if err != nil {
			return nil, err
		}
		if visited[name.String] {
			return nil, nil
		}
		visited[name.String] = true
		scopePrefix := g.getScopePrefix(devUUID.String)

		tagCmds, tagStr, _ := g.getTags("application", id, scopePrefix)
		cmds = append(cmds, tagCmds...)
		cmds = append(cmds, fmt.Sprintf("%s application %s category %s subcategory %s technology %s risk %s%s", scopePrefix, name.String, cat.String, subcat.String, tech.String, risk.String, tagStr))
		if ports.Valid && ports.String != "" {
			cmds = append(cmds, fmt.Sprintf("%s application %s ports %s", scopePrefix, name.String, ports.String))
		}
		if desc.Valid && desc.String != "" {
			cmds = append(cmds, fmt.Sprintf(`%s application %s description "%s"`, scopePrefix, name.String, desc.String))
		}

	case "Application Groups":
		var name, devUUID, desc sql.NullString
		err := g.DB.QueryRow("SELECT name, device_uuid, description FROM application_groups WHERE id = ?", id).Scan(&name, &devUUID, &desc)
		if err != nil {
			return nil, err
		}
		if visited[name.String] {
			return nil, nil
		}
		visited[name.String] = true
		scopePrefix := g.getScopePrefix(devUUID.String)

		var members []string
		if includeNested {
			rows, _ := g.DB.Query("SELECT member_application_id, member_group_id, member_name FROM application_group_members WHERE group_id = ?", id)
			for rows.Next() {
				var appID, grpID sql.NullInt64
				var memberName sql.NullString
				rows.Scan(&appID, &grpID, &memberName)
				if appID.Valid {
					childCmds, _ := g.generateRecursive("Applications", int(appID.Int64), visited, includeNested)
					cmds = append(cmds, childCmds...)
					var n string
					g.DB.QueryRow("SELECT name FROM applications WHERE id = ?", appID.Int64).Scan(&n)
					members = append(members, n)
				} else if grpID.Valid {
					childCmds, _ := g.generateRecursive("Application Groups", int(grpID.Int64), visited, includeNested)
					cmds = append(cmds, childCmds...)
					var n string
					g.DB.QueryRow("SELECT name FROM application_groups WHERE id = ?", grpID.Int64).Scan(&n)
					members = append(members, n)
				} else if memberName.Valid {
					members = append(members, memberName.String)
				}
			}
			rows.Close()
		} else {
			rows, _ := g.DB.Query("SELECT member_application_id, member_group_id, member_name FROM application_group_members WHERE group_id = ?", id)
			for rows.Next() {
				var appID, grpID sql.NullInt64
				var memberName sql.NullString
				rows.Scan(&appID, &grpID, &memberName)
				if appID.Valid {
					var n string
					g.DB.QueryRow("SELECT name FROM applications WHERE id = ?", appID.Int64).Scan(&n)
					members = append(members, n)
				} else if grpID.Valid {
					var n string
					g.DB.QueryRow("SELECT name FROM application_groups WHERE id = ?", grpID.Int64).Scan(&n)
					members = append(members, n)
				} else if memberName.Valid {
					members = append(members, memberName.String)
				}
			}
			rows.Close()
		}

		tagCmds, tagStr, _ := g.getTags("application_group", id, scopePrefix)
		cmds = append(cmds, tagCmds...)
		for _, m := range members {
			cmds = append(cmds, fmt.Sprintf("%s application-group %s members %s", scopePrefix, name.String, m))
		}
		if tagStr != "" {
			cmds = append(cmds, fmt.Sprintf("%s application-group %s%s", scopePrefix, name.String, tagStr))
		}
		if desc.Valid && desc.String != "" {
			cmds = append(cmds, fmt.Sprintf(`%s application-group %s description "%s"`, scopePrefix, name.String, desc.String))
		}

	case "Tags":
		var name, devUUID, color, desc sql.NullString
		err := g.DB.QueryRow("SELECT name, device_uuid, color, description FROM tags WHERE id = ?", id).Scan(&name, &devUUID, &color, &desc)
		if err != nil {
			return nil, err
		}
		if visited[name.String] {
			return nil, nil
		}
		visited[name.String] = true
		scopePrefix := g.getScopePrefix(devUUID.String)

		c := "color1"
		if color.Valid && color.String != "" {
			c = color.String
		}
		cmds = append(cmds, fmt.Sprintf("%s tag %s color %s", scopePrefix, name.String, c))
		if desc.Valid && desc.String != "" {
			cmds = append(cmds, fmt.Sprintf(`%s tag %s comments "%s"`, scopePrefix, name.String, desc.String))
		}

	case "URL Categories":
		var name, devUUID, urlList sql.NullString
		err := g.DB.QueryRow("SELECT name, device_uuid, url_list FROM custom_url_categories WHERE id = ?", id).Scan(&name, &devUUID, &urlList)
		if err != nil {
			return nil, err
		}
		if visited[name.String] {
			return nil, nil
		}
		visited[name.String] = true
		scopePrefix := g.getScopePrefix(devUUID.String)
		list := ""
		if urlList.Valid && urlList.String != "" {
			list = strings.ReplaceAll(urlList.String, ",", " ")
		}
		cmds = append(cmds, fmt.Sprintf("%s profiles custom-url-category %s list [ %s ]", scopePrefix, name.String, list))

	case "External Dynamic Lists":
		var name, devUUID, listType, sourceUrl sql.NullString
		err := g.DB.QueryRow("SELECT name, device_uuid, type, source_url FROM external_dynamic_lists WHERE id = ?", id).Scan(&name, &devUUID, &listType, &sourceUrl)
		if err != nil {
			return nil, err
		}
		if visited[name.String] {
			return nil, nil
		}
		visited[name.String] = true
		scopePrefix := g.getScopePrefix(devUUID.String)
		cmds = append(cmds, fmt.Sprintf(`%s external-list %s type %s source "%s"`, scopePrefix, name.String, listType.String, sourceUrl.String))

	case "Log Forwarding Profiles":
		var name, devUUID sql.NullString
		err := g.DB.QueryRow("SELECT name, device_uuid FROM log_forwarding_profiles WHERE id = ?", id).Scan(&name, &devUUID)
		if err != nil {
			return nil, err
		}
		if visited[name.String] {
			return nil, nil
		}
		visited[name.String] = true
		scopePrefix := g.getScopePrefix(devUUID.String)
		cmds = append(cmds, fmt.Sprintf("%s log-settings profiles %s", scopePrefix, name.String))

	case "Antivirus", "Anti-Spyware", "Vulnerability Protection", "URL Filtering", "File Blocking", "WildFire Analysis":
		var name, devUUID, profType sql.NullString
		err := g.DB.QueryRow("SELECT name, device_uuid, type FROM security_profiles WHERE id = ?", id).Scan(&name, &devUUID, &profType)
		if err != nil {
			return nil, err
		}
		if visited[name.String] {
			return nil, nil
		}
		visited[name.String] = true
		scopePrefix := g.getScopePrefix(devUUID.String)

		typeMapping := map[string]string{
			"url-filtering": "url-filtering",
			"antivirus":     "virus",
			"vulnerability": "vulnerability",
			"spyware":       "spyware",
			"wildfire":      "wildfire-analysis",
			"file-blocking": "file-blocking",
		}
		resolvedType := "virus"
		if t, ok := typeMapping[profType.String]; ok {
			resolvedType = t
		}
		cmds = append(cmds, fmt.Sprintf("%s profiles %s %s", scopePrefix, resolvedType, name.String))

	case "Security Profile Groups":
		var name, devUUID, av, spy, vuln, url, fb, wf sql.NullString
		err := g.DB.QueryRow("SELECT name, device_uuid, antivirus, spyware, vulnerability, url_filtering, file_blocking, wildfire_analysis FROM security_profile_groups WHERE id = ?", id).Scan(&name, &devUUID, &av, &spy, &vuln, &url, &fb, &wf)
		if err != nil {
			return nil, err
		}
		if visited[name.String] {
			return nil, nil
		}
		visited[name.String] = true
		scopePrefix := g.getScopePrefix(devUUID.String)

		cmds = append(cmds, fmt.Sprintf("%s profiles profile-group %s", scopePrefix, name.String))
		if av.Valid && av.String != "" {
			cmds = append(cmds, fmt.Sprintf("%s profiles profile-group %s virus %s", scopePrefix, name.String, av.String))
		}
		if spy.Valid && spy.String != "" {
			cmds = append(cmds, fmt.Sprintf("%s profiles profile-group %s spyware %s", scopePrefix, name.String, spy.String))
		}
		if vuln.Valid && vuln.String != "" {
			cmds = append(cmds, fmt.Sprintf("%s profiles profile-group %s vulnerability %s", scopePrefix, name.String, vuln.String))
		}
		if url.Valid && url.String != "" {
			cmds = append(cmds, fmt.Sprintf("%s profiles profile-group %s url-filtering %s", scopePrefix, name.String, url.String))
		}
		if fb.Valid && fb.String != "" {
			cmds = append(cmds, fmt.Sprintf("%s profiles profile-group %s file-blocking %s", scopePrefix, name.String, fb.String))
		}
		if wf.Valid && wf.String != "" {
			cmds = append(cmds, fmt.Sprintf("%s profiles profile-group %s wildfire-analysis %s", scopePrefix, name.String, wf.String))
		}

	case "Device Groups":
		var name, desc sql.NullString
		err := g.DB.QueryRow("SELECT name, description FROM device_groups WHERE id = ?", id).Scan(&name, &desc)
		if err != nil {
			return nil, err
		}
		if visited["dg-"+name.String] {
			return nil, nil
		}
		visited["dg-"+name.String] = true

		qName := quoteIfHasSpace(name.String)
		cmds = append(cmds, fmt.Sprintf("set device-group %s", qName))
		if desc.Valid && desc.String != "" {
			cmds = append(cmds, fmt.Sprintf(`set device-group %s description "%s"`, qName, desc.String))
		}

	case "Base Templates":
		var name, desc sql.NullString
		err := g.DB.QueryRow("SELECT name, description FROM templates WHERE id = ?", id).Scan(&name, &desc)
		if err != nil {
			return nil, err
		}
		if visited["tmpl-"+name.String] {
			return nil, nil
		}
		visited["tmpl-"+name.String] = true

		qName := quoteIfHasSpace(name.String)
		cmds = append(cmds, fmt.Sprintf("set template %s", qName))
		if desc.Valid && desc.String != "" {
			cmds = append(cmds, fmt.Sprintf(`set template %s description "%s"`, qName, desc.String))
		}

	case "Template Stacks":
		var name, desc sql.NullString
		err := g.DB.QueryRow("SELECT name, description FROM template_stacks WHERE id = ?", id).Scan(&name, &desc)
		if err != nil {
			return nil, err
		}
		if visited["stack-"+name.String] {
			return nil, nil
		}
		visited["stack-"+name.String] = true

		qName := quoteIfHasSpace(name.String)
		cmds = append(cmds, fmt.Sprintf("set template-stack %s", qName))
		if desc.Valid && desc.String != "" {
			cmds = append(cmds, fmt.Sprintf(`set template-stack %s description "%s"`, qName, desc.String))
		}

		rows, err := g.DB.Query(`
			SELECT t.name
			FROM template_stack_members_raw tsm
			JOIN templates t ON tsm.template_id = t.id
			WHERE tsm.stack_id = ?
			ORDER BY tsm.sequence ASC
		`, id)
		if err == nil {
			var members []string
			for rows.Next() {
				var tName string
				if err := rows.Scan(&tName); err == nil {
					members = append(members, quoteIfHasSpace(tName))
				}
			}
			rows.Close()
			if len(members) > 0 {
				cmds = append(cmds, fmt.Sprintf("set template-stack %s templates [ %s ]", qName, strings.Join(members, " ")))
			}
		}
	}

	return cmds, nil
}
