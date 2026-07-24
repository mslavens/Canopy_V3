package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"canopy-core/engine"
)

// PolicyObjectRef represents a reference to a firewall object in a policy
type PolicyObjectRef struct {
	ID         *int   `json:"id,omitempty"`
	Name       string `json:"name"`
	ObjectType string `json:"object_type"`
}

// PolicyTagRef represents a tag attached to a policy
type PolicyTagRef struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// PolicyRule represents a fully hydrated security rule ready for the UI
type PolicyRule struct {
	ID                 int      `json:"id"`
	DeviceUUID         string   `json:"device_uuid"`
	Scope              string   `json:"scope"`
	RuleName           string   `json:"rule_name"`
	Description        *string  `json:"description"`
	Disabled           int      `json:"disabled"`
	Action             *string  `json:"action"`
	ScheduleID         *int     `json:"schedule_id"`
	CreatedAt          *string  `json:"created_at"`
	UpdatedAt          *string  `json:"updated_at"`

	// Shared Arrays
	SourceZone         []string          `json:"source_zone"`
	DestinationZone    []string          `json:"destination_zone"`
	SourceAddress      []PolicyObjectRef `json:"source_address"`
	DestinationAddress []PolicyObjectRef `json:"destination_address"`
	Service            []PolicyObjectRef `json:"service"`
	Application        []PolicyObjectRef `json:"application"`
	Tags               []PolicyTagRef    `json:"tags"`

	// Security specific
	ProfileType        *string  `json:"profile_type"`
	ProfileGroup       *string  `json:"profile_group"`
	Category           []string `json:"category"`
	Profiles           []string `json:"profiles"`

	// NAT specific
	ToZone                        *string `json:"to_zone"`
	SourceTranslationType         *string `json:"source_translation_type"`
	SourceTranslationAddress      *string `json:"source_translation_address"`
	DestinationTranslationAddress *string `json:"destination_translation_address"`
	DestinationTranslationPort    *string `json:"destination_translation_port"`

	// QoS specific
	QoSClass      *string `json:"qos_class"`
	DSCPTOS       *string `json:"dscp_tos_marking"`

	// PBF specific
	ForwardInterface *string `json:"forward_interface"`
	ForwardNextHop   *string `json:"forward_next_hop"`
	MonitorProfile   *string `json:"monitor_profile"`

	// Decryption specific
	DecryptionType    *string `json:"decryption_type"`
	DecryptionProfile *string `json:"decryption_profile"`

	// App Override specific
	Protocol          *string `json:"protocol"`
	Port              *string `json:"port"`

	// Tunnel specific
	Protocols     *string `json:"protocols"`
	ActionProfile *string `json:"action_profile"`

	// Authentication specific
	AuthenticationProfile *string `json:"authentication_profile"`
	LogSetting            *string `json:"log_setting"`

	// DoS specific
	AggregateProfile      *string `json:"aggregate_profile"`
	ClassifiedProfile     *string `json:"classified_profile"`

	// Internal references for single-value hydration
	ServiceID        *int    `json:"-"`
	ServiceGroupID   *int    `json:"-"`
	ServiceAdHoc     *string `json:"-"`
	CustomAppID      *int    `json:"-"`
	PredefinedApp    *string `json:"-"`

	// Hierarchy metadata
	IsInherited        bool     `json:"_isInherited"`
	HierarchyLevel     int      `json:"_hierarchyLevel"`
	Stack              string   `json:"_stack"`
	StackOrder         int      `json:"_stackOrder"`
}

func handleGetPolicies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	db, err := getActiveDBConn()
	if err != nil {
		http.Error(w, "Storage vault is locked", http.StatusLocked)
		return
	}

	scopeID := r.URL.Query().Get("scope")
	rulebase := r.URL.Query().Get("rulebase") // pre, post, device
	policyType := r.URL.Query().Get("type")
	if policyType == "" {
		policyType = "security"
	}
	tableName := policyType + "_rules"

	validTables := map[string]bool{
		"security_rules": true, "nat_rules": true, "qos_rules": true,
		"pbf_rules": true, "decryption_rules": true,
		"application_override_rules": true, "tunnel_inspection_rules": true,
		"authentication_rules": true, "dos_rules": true,
	}
	if !validTables[tableName] {
		http.Error(w, "invalid policy type", http.StatusBadRequest)
		return
	}

	if scopeID == "" {
		http.Error(w, "scope parameter is required", http.StatusBadRequest)
		return
	}

	// 1. Determine Scope Type and get Ancestry
	var scopeType string
	hierarchyUUIDs := []string{}
	hierarchyMap := make(map[string]int) // uuid -> level (0=target, 1=parent, etc.)

	if scopeID == "show-all" {
		scopeType = "show-all"
	} else {
		err = db.QueryRow("SELECT type FROM scopes WHERE uuid = ?", scopeID).Scan(&scopeType)
		if err != nil {
			if err == sql.ErrNoRows {
				http.Error(w, "scope not found", http.StatusNotFound)
			} else {
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		currUUID := scopeID
		level := 0
		for currUUID != "" {
			hierarchyUUIDs = append(hierarchyUUIDs, currUUID)
			hierarchyMap[currUUID] = level

			var parentUUID sql.NullString
			err = db.QueryRow("SELECT parent_uuid FROM scopes WHERE uuid = ?", currUUID).Scan(&parentUUID)
			if err != nil || !parentUUID.Valid {
				break
			}
			currUUID = parentUUID.String
			level++
		}

		// If the scope is a firewall, we still want to grab shared if it's not directly parented (though it usually is)
		hasShared := false
		for _, u := range hierarchyUUIDs {
			if u == "paloalto-panorama-global" {
				hasShared = true
				break
			}
		}
		if !hasShared {
			hierarchyUUIDs = append(hierarchyUUIDs, "paloalto-panorama-global")
			level++
			hierarchyMap["paloalto-panorama-global"] = level
		}
	}

	// 2. Fetch Rules Based on Rulebase & ScopeType
	var rules []PolicyRule
	
	fetchRules := func(targetUUIDs []string, matchSuffix string, stack string, stackOrder int) error {
		if scopeType != "show-all" && len(targetUUIDs) == 0 {
			return nil
		}
		
		var query string
		var args []interface{}
		
		var cols string
		switch policyType {
		case "security":
			cols = "id, device_uuid, scope, rule_name, description, disabled, action, profile_type, profile_group, log_setting, schedule_id, created_at, updated_at"
		case "nat":
			cols = "id, device_uuid, scope, rule_name, description, disabled, to_zone, service_id, service_group_id, service_ad_hoc, source_translation_type, source_translation_address, destination_translation_address, destination_translation_port, created_at, updated_at"
		case "qos":
			cols = "id, device_uuid, scope, rule_name, description, disabled, qos_class, dscp_tos_marking, schedule_id, created_at, updated_at"
		case "pbf":
			cols = "id, device_uuid, scope, rule_name, description, disabled, action, forward_interface, forward_next_hop, monitor_profile, schedule_id, created_at, updated_at"
		case "decryption":
			cols = "id, device_uuid, scope, rule_name, description, disabled, action, decryption_type, decryption_profile, schedule_id, created_at, updated_at"
		case "application_override":
			cols = "id, device_uuid, scope, rule_name, description, disabled, protocol, port, custom_app_id, predefined_app_name, created_at, updated_at"
		case "tunnel_inspection":
			cols = "id, device_uuid, scope, rule_name, description, disabled, protocols, action_profile, created_at, updated_at"
		case "authentication":
			cols = "id, device_uuid, scope, rule_name, description, disabled, action, authentication_profile, log_setting, schedule_id, created_at, updated_at"
		case "dos":
			cols = "id, device_uuid, scope, rule_name, description, disabled, action, aggregate_profile, classified_profile, schedule_id, created_at, updated_at"
		}

		if scopeType == "show-all" {
			query = fmt.Sprintf("SELECT %s FROM %s WHERE 1=1", cols, tableName)
		} else {
			placeholders := make([]string, len(targetUUIDs))
			args = make([]interface{}, len(targetUUIDs))
			for i, u := range targetUUIDs {
				placeholders[i] = "?"
				args[i] = u
			}
			query = fmt.Sprintf("SELECT %s FROM %s WHERE device_uuid IN (%s)", cols, tableName, strings.Join(placeholders, ","))
		}
		
		// Optional suffix matching for Pre/Post
		if matchSuffix != "" {
			query += " AND scope LIKE ?"
			args = append(args, matchSuffix)
		} else {
			// For local device rules, exclude anything that has :pre or :post
			query += " AND scope NOT LIKE '%:pre' AND scope NOT LIKE '%:post'"
		}
		
		// Ensure stable ordering by ID (which maps to parser order)
		if scopeType == "show-all" {
			query += " ORDER BY device_uuid, id ASC"
		} else {
			query += " ORDER BY id ASC"
		}

		rows, err := db.Query(query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()

		var batch []PolicyRule
		for rows.Next() {
			var r PolicyRule
			var errScan error
			switch policyType {
			case "security":
				errScan = rows.Scan(&r.ID, &r.DeviceUUID, &r.Scope, &r.RuleName, &r.Description, &r.Disabled, &r.Action, &r.ProfileType, &r.ProfileGroup, &r.LogSetting, &r.ScheduleID, &r.CreatedAt, &r.UpdatedAt)
			case "nat":
				errScan = rows.Scan(&r.ID, &r.DeviceUUID, &r.Scope, &r.RuleName, &r.Description, &r.Disabled, &r.ToZone, &r.ServiceID, &r.ServiceGroupID, &r.ServiceAdHoc, &r.SourceTranslationType, &r.SourceTranslationAddress, &r.DestinationTranslationAddress, &r.DestinationTranslationPort, &r.CreatedAt, &r.UpdatedAt)
			case "qos":
				errScan = rows.Scan(&r.ID, &r.DeviceUUID, &r.Scope, &r.RuleName, &r.Description, &r.Disabled, &r.QoSClass, &r.DSCPTOS, &r.ScheduleID, &r.CreatedAt, &r.UpdatedAt)
			case "pbf":
				errScan = rows.Scan(&r.ID, &r.DeviceUUID, &r.Scope, &r.RuleName, &r.Description, &r.Disabled, &r.Action, &r.ForwardInterface, &r.ForwardNextHop, &r.MonitorProfile, &r.ScheduleID, &r.CreatedAt, &r.UpdatedAt)
			case "decryption":
				errScan = rows.Scan(&r.ID, &r.DeviceUUID, &r.Scope, &r.RuleName, &r.Description, &r.Disabled, &r.Action, &r.DecryptionType, &r.DecryptionProfile, &r.ScheduleID, &r.CreatedAt, &r.UpdatedAt)
			case "application_override":
				errScan = rows.Scan(&r.ID, &r.DeviceUUID, &r.Scope, &r.RuleName, &r.Description, &r.Disabled, &r.Protocol, &r.Port, &r.CustomAppID, &r.PredefinedApp, &r.CreatedAt, &r.UpdatedAt)
			case "tunnel_inspection":
				errScan = rows.Scan(&r.ID, &r.DeviceUUID, &r.Scope, &r.RuleName, &r.Description, &r.Disabled, &r.Protocols, &r.ActionProfile, &r.CreatedAt, &r.UpdatedAt)
			case "authentication":
				errScan = rows.Scan(&r.ID, &r.DeviceUUID, &r.Scope, &r.RuleName, &r.Description, &r.Disabled, &r.Action, &r.AuthenticationProfile, &r.LogSetting, &r.ScheduleID, &r.CreatedAt, &r.UpdatedAt)
			case "dos":
				errScan = rows.Scan(&r.ID, &r.DeviceUUID, &r.Scope, &r.RuleName, &r.Description, &r.Disabled, &r.Action, &r.AggregateProfile, &r.ClassifiedProfile, &r.ScheduleID, &r.CreatedAt, &r.UpdatedAt)
			}
			if errScan != nil {
				return errScan
			}
			if scopeType == "show-all" {
				r.IsInherited = false
				r.HierarchyLevel = 0
			} else {
				r.IsInherited = (r.DeviceUUID != scopeID)
				r.HierarchyLevel = hierarchyMap[r.DeviceUUID]
			}
			r.Stack = stack
			r.StackOrder = stackOrder
			batch = append(batch, r)
		}
		if err := rows.Err(); err != nil {
			return err
		}

		// Sort the batch to respect hierarchy evaluation order
		sort.Slice(batch, func(i, j int) bool {
			// If show-all, we rely on the DB's ORDER BY device_uuid, id ASC
			if scopeType == "show-all" {
				if batch[i].DeviceUUID != batch[j].DeviceUUID {
					return batch[i].DeviceUUID < batch[j].DeviceUUID
				}
				return batch[i].ID < batch[j].ID
			}

			// Pre rules: evaluated top-down (Root -> Leaf). Root has highest level, Leaf has level 0.
			if matchSuffix == "%:pre" && batch[i].HierarchyLevel != batch[j].HierarchyLevel {
				return batch[i].HierarchyLevel > batch[j].HierarchyLevel
			}

			// Post rules: evaluated bottom-up (Leaf -> Root).
			if matchSuffix == "%:post" && batch[i].HierarchyLevel != batch[j].HierarchyLevel {
				return batch[i].HierarchyLevel < batch[j].HierarchyLevel
			}

			// For same level (or local rules), respect insertion/DB order
			return batch[i].ID < batch[j].ID
		})

		rules = append(rules, batch...)
		return nil
	}

	if scopeType == "show-all" {
		var suffix string
		var stackName string
		
		switch rulebase {
		case "post":
			suffix = "%:post"
			stackName = "Post Rules"
		case "device":
			suffix = ""
			stackName = "Local Rules"
		default: // "pre"
			suffix = "%:pre"
			stackName = "Pre Rules"
		}

		if err := fetchRules(nil, suffix, stackName, 1); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else if scopeType == "firewall" && rulebase == "device" {
		// Device Rules View: Pre (Inherited) -> Local -> Post (Inherited)
		dgUUIDs := []string{}
		for _, u := range hierarchyUUIDs {
			if u != scopeID {
				dgUUIDs = append(dgUUIDs, u)
			}
		}
		// 1. Pre Rules
		if err := fetchRules(dgUUIDs, "%:pre", "Pre Rules", 1); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// 2. Local Rules
		if err := fetchRules([]string{scopeID}, "", "Device Rules", 2); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// 3. Post Rules
		if err := fetchRules(dgUUIDs, "%:post", "Post Rules", 3); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else if rulebase == "device" {
		// Device Rules View (Device Group Context)
		// Fetch Pre Rules
		if err := fetchRules(hierarchyUUIDs, "%:pre", "Pre Rules", 1); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Fetch Post Rules
		if err := fetchRules(hierarchyUUIDs, "%:post", "Post Rules", 3); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		// Pre or Post Rules View (Device Group Context)
		suffix := "%:pre"
		if rulebase == "post" {
			suffix = "%:post"
		}
		if err := fetchRules(hierarchyUUIDs, suffix, strings.Title(rulebase)+" Rules", 1); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// 3. Hydrate Rules with Addresses, Services, Apps, Zones, Tags
	if len(rules) > 0 {
		ruleIDs := make([]string, len(rules))
		ruleMap := make(map[int]*PolicyRule)
		for i := range rules {
			ruleIDs[i] = fmt.Sprintf("%d", rules[i].ID)
			ruleMap[rules[i].ID] = &rules[i]
			// Initialize arrays
			ruleMap[rules[i].ID].SourceAddress = []PolicyObjectRef{}
			ruleMap[rules[i].ID].DestinationAddress = []PolicyObjectRef{}
			ruleMap[rules[i].ID].SourceZone = []string{}
			ruleMap[rules[i].ID].DestinationZone = []string{}
			ruleMap[rules[i].ID].Service = []PolicyObjectRef{}
			ruleMap[rules[i].ID].Application = []PolicyObjectRef{}
			ruleMap[rules[i].ID].Tags = []PolicyTagRef{}
		}
		inClause := strings.Join(ruleIDs, ",")

		// Helper to execute hydration queries
		hydrate := func(query string, scanFunc func(*sql.Rows) error) error {
			rows, err := db.Query(query)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				if err := scanFunc(rows); err != nil {
					return err
				}
			}
			return nil
		}

		// Zones
		err = hydrate(fmt.Sprintf("SELECT rule_id, direction, zone_name FROM rule_zone_mappings WHERE rule_type = '%s' AND rule_id IN (%s)", policyType, inClause), func(rows *sql.Rows) error {
			var rid int
			var dir, zname string
			if err := rows.Scan(&rid, &dir, &zname); err != nil { return err }
			if r, ok := ruleMap[rid]; ok {
				if dir == "source" { r.SourceZone = append(r.SourceZone, zname) } else { r.DestinationZone = append(r.DestinationZone, zname) }
			}
			return nil
		})
		if err != nil { log.Printf("Error hydrating zones: %v", err) }

		// Determine the correct singular entity type for tags
		entityType := policyType + "_rule"
		if policyType == "application_override" {
			entityType = "app_override_rule"
		}

		// Tags
		err = hydrate(fmt.Sprintf(`
			SELECT m.entity_id, t.id, t.name, COALESCE(t.color, '')
			FROM entity_tag_mappings m 
			JOIN tags t ON m.tag_id = t.id 
			WHERE m.entity_type = '%s' AND m.entity_id IN (%s)
		`, entityType, inClause), func(rows *sql.Rows) error {
			var rid int
			var tid int
			var tname, tcolor string
			if err := rows.Scan(&rid, &tid, &tname, &tcolor); err != nil { return err }
			if r, ok := ruleMap[rid]; ok { r.Tags = append(r.Tags, PolicyTagRef{ID: tid, Name: tname, Color: tcolor}) }
			return nil
		})
		if err != nil { log.Printf("Error hydrating tags: %v", err) }

		// Categories
		err = hydrate(fmt.Sprintf(`
			SELECT rule_id, category FROM rule_category_mappings
			WHERE rule_id IN (%s)
		`, inClause), func(rows *sql.Rows) error {
			var rid int
			var cat string
			if err := rows.Scan(&rid, &cat); err != nil { return err }
			if r, ok := ruleMap[rid]; ok { r.Category = append(r.Category, cat) }
			return nil
		})
		if err != nil { log.Printf("Error hydrating categories: %v", err) }

		// Profiles
		err = hydrate(fmt.Sprintf(`
			SELECT rp.rule_id, p.name 
			FROM security_rule_profiles rp
			JOIN security_profiles p ON rp.profile_id = p.id
			WHERE rp.rule_id IN (%s)
		`, inClause), func(rows *sql.Rows) error {
			var rid int
			var pname string
			if err := rows.Scan(&rid, &pname); err != nil { return err }
			if r, ok := ruleMap[rid]; ok { r.Profiles = append(r.Profiles, pname) }
			return nil
		})
		if err != nil { log.Printf("Error hydrating profiles: %v", err) }

		// Addresses
		err = hydrate(fmt.Sprintf(`
			SELECT rule_id, direction, 
			       m.address_id, a.name AS address_name, 
			       m.group_id, g.name AS group_name, 
			       m.ad_hoc_value
			FROM rule_address_mappings m
			LEFT JOIN address_objects a ON m.address_id = a.id
			LEFT JOIN address_groups g ON m.group_id = g.id
			WHERE rule_type = '%s' AND rule_id IN (%s)
		`, policyType, inClause), func(rows *sql.Rows) error {
			var rid int
			var dir string
			var addrId sql.NullInt64
			var addrName sql.NullString
			var groupId sql.NullInt64
			var groupName sql.NullString
			var adHoc sql.NullString

			if err := rows.Scan(&rid, &dir, &addrId, &addrName, &groupId, &groupName, &adHoc); err != nil { return err }

			if r, ok := ruleMap[rid]; ok {
				var ref PolicyObjectRef
				if addrId.Valid && addrName.Valid {
					id := int(addrId.Int64)
					ref = PolicyObjectRef{ID: &id, Name: addrName.String, ObjectType: "address_object"}
				} else if groupId.Valid && groupName.Valid {
					id := int(groupId.Int64)
					ref = PolicyObjectRef{ID: &id, Name: groupName.String, ObjectType: "address_group"}
				} else if adHoc.Valid {
					if strings.ToLower(adHoc.String) == "any" {
						ref = PolicyObjectRef{Name: adHoc.String, ObjectType: "predefined"}
					} else {
						ref = PolicyObjectRef{Name: adHoc.String, ObjectType: "ad_hoc"}
					}
				} else {
					return nil
				}

				if dir == "source" {
					r.SourceAddress = append(r.SourceAddress, ref)
				} else {
					r.DestinationAddress = append(r.DestinationAddress, ref)
				}
			}
			return nil
		})
		if err != nil { log.Printf("Error hydrating addresses: %v", err) }

		// Services
		err = hydrate(fmt.Sprintf(`
			SELECT rule_id, 
			       m.service_id, s.name AS service_name, 
			       m.group_id, g.name AS group_name, 
			       m.ad_hoc_value
			FROM rule_service_mappings m
			LEFT JOIN service_objects s ON m.service_id = s.id
			LEFT JOIN service_groups g ON m.group_id = g.id
			WHERE rule_type = '%s' AND rule_id IN (%s)
		`, policyType, inClause), func(rows *sql.Rows) error {
			var rid int
			var svcId sql.NullInt64
			var svcName sql.NullString
			var groupId sql.NullInt64
			var groupName sql.NullString
			var adHoc sql.NullString

			if err := rows.Scan(&rid, &svcId, &svcName, &groupId, &groupName, &adHoc); err != nil { return err }

			if r, ok := ruleMap[rid]; ok {
				var ref PolicyObjectRef
				if svcId.Valid && svcName.Valid {
					id := int(svcId.Int64)
					ref = PolicyObjectRef{ID: &id, Name: svcName.String, ObjectType: "service_object"}
				} else if groupId.Valid && groupName.Valid {
					id := int(groupId.Int64)
					ref = PolicyObjectRef{ID: &id, Name: groupName.String, ObjectType: "service_group"}
				} else if adHoc.Valid {
					if strings.ToLower(adHoc.String) == "any" || strings.ToLower(adHoc.String) == "application-default" {
						ref = PolicyObjectRef{Name: adHoc.String, ObjectType: "predefined"}
					} else {
						ref = PolicyObjectRef{Name: adHoc.String, ObjectType: "ad_hoc"}
					}
				} else {
					return nil
				}
				r.Service = append(r.Service, ref)
			}
			return nil
		})
		if err != nil { log.Printf("Error hydrating services: %v", err) }

		// Applications
		err = hydrate(fmt.Sprintf(`
			SELECT rule_id, 
			       m.custom_app_id, a.name AS custom_app_name, 
			       m.group_id, g.name AS group_name,
			       m.predefined_app_name
			FROM rule_application_mappings m
			LEFT JOIN application_objects a ON m.custom_app_id = a.id
			LEFT JOIN application_groups g ON m.group_id = g.id
			WHERE rule_type = '%s' AND rule_id IN (%s)
		`, policyType, inClause), func(rows *sql.Rows) error {
			var rid int
			var appId sql.NullInt64
			var appName sql.NullString
			var groupId sql.NullInt64
			var groupName sql.NullString
			var predefined sql.NullString

			if err := rows.Scan(&rid, &appId, &appName, &groupId, &groupName, &predefined); err != nil { return err }

			if r, ok := ruleMap[rid]; ok {
				var ref PolicyObjectRef
				if appId.Valid && appName.Valid {
					id := int(appId.Int64)
					ref = PolicyObjectRef{ID: &id, Name: appName.String, ObjectType: "application_object"}
				} else if groupId.Valid && groupName.Valid {
					id := int(groupId.Int64)
					ref = PolicyObjectRef{ID: &id, Name: groupName.String, ObjectType: "application_group"}
				} else if predefined.Valid {
					if strings.ToLower(predefined.String) == "any" {
						ref = PolicyObjectRef{Name: predefined.String, ObjectType: "predefined"}
					} else {
						ref = PolicyObjectRef{Name: predefined.String, ObjectType: "predefined_app"}
					}
				} else {
					return nil
				}
				r.Application = append(r.Application, ref)
			}
			return nil
		})
		if err != nil { log.Printf("Error hydrating applications: %v", err) }

		// Post-hydration for single-value embedded fields (like NAT services or App Override apps)
		if policyType == "nat" || policyType == "application_override" {
			for _, r := range ruleMap {
				if policyType == "nat" {
					if r.ServiceAdHoc != nil && *r.ServiceAdHoc != "" {
						r.Service = append(r.Service, PolicyObjectRef{Name: *r.ServiceAdHoc, ObjectType: "ad_hoc"})
					} else if r.ServiceID != nil || r.ServiceGroupID != nil {
						// These could be fetched here. For a baseline, we'll leave it as we just need strings, but typically you'd join them in the original SELECT or do a bulk fetch.
					}
				}
				if policyType == "application_override" {
					if r.PredefinedApp != nil && *r.PredefinedApp != "" {
						r.Application = append(r.Application, PolicyObjectRef{Name: *r.PredefinedApp, ObjectType: "predefined"})
					}
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(rules); err != nil {
		log.Printf("Failed to encode policies: %v", err)
	}
}

func handleGetPoliciesCounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	scopesParam := r.URL.Query().Get("scopes")
	var scopes []string
	if scopesParam != "" {
		scopes = strings.Split(scopesParam, ",")
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

	validTables := []string{
		"security_rules", "nat_rules", "qos_rules", "pbf_rules", "decryption_rules",
		"application_override_rules", "tunnel_inspection_rules", "authentication_rules", "dos_rules",
	}

	tableToPrefix := map[string]string{
		"security_rules":             "Security",
		"nat_rules":                  "NAT",
		"qos_rules":                  "QoS",
		"pbf_rules":                  "Policy Based Forwarding",
		"decryption_rules":           "Decryption",
		"application_override_rules": "Application Override",
		"tunnel_inspection_rules":    "Tunnel Inspection",
		"authentication_rules":       "Authentication",
		"dos_rules":                  "DoS Protection",
	}

	counts := make(map[string]int)

	scopeFilter := ""
	var args []interface{}
	if len(scopes) > 0 && scopes[0] != "show-all" {
		placeholders := make([]string, len(scopes))
		for i, s := range scopes {
			placeholders[i] = "?"
			args = append(args, s)
		}
		scopeFilter = " WHERE device_uuid IN (" + strings.Join(placeholders, ",") + ")"
	}

	for _, table := range validTables {
		query := fmt.Sprintf("SELECT scope, COUNT(id) FROM %s%s GROUP BY scope", table, scopeFilter)
		
		rows, err := dbConn.Query(query, args...)
		if err != nil {
			log.Printf("Failed to query counts for %s: %v", table, err)
			continue
		}

		pre := 0
		post := 0
		dev := 0

		for rows.Next() {
			var scopeName string
			var count int
			if err := rows.Scan(&scopeName, &count); err == nil {
				if strings.HasSuffix(scopeName, ":pre") {
					pre += count
				} else if strings.HasSuffix(scopeName, ":post") {
					post += count
				} else {
					dev += count
				}
			}
		}
		if err := rows.Err(); err != nil {
			log.Printf("Failed to iterate counts for %s: %v", table, err)
		}
		rows.Close()

		prefix := tableToPrefix[table]
		counts[fmt.Sprintf("%s - Pre Rules", prefix)] = pre
		counts[fmt.Sprintf("%s - Device Rules", prefix)] = dev
		counts[fmt.Sprintf("%s - Post Rules", prefix)] = post
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(counts)
}

type PolicyUsage struct {
	ID        int    `json:"id"`
	RuleName  string `json:"rule_name"`
	RuleType  string `json:"rule_type"`
	Direction string `json:"direction"`
}

func handleGetPolicyUsages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	db, err := getActiveDBConn()
	if err != nil {
		http.Error(w, "Storage vault is locked", http.StatusLocked)
		return
	}

	scopeID := r.URL.Query().Get("scope")
	domain := r.URL.Query().Get("domain") // "address", "service", "application"
	objectName := r.URL.Query().Get("object_name")

	if scopeID == "" || domain == "" || objectName == "" {
		http.Error(w, "scope, domain, and object_name are required", http.StatusBadRequest)
		return
	}

	lineage := engine.GetPolicyScopeLineage(db, scopeID)
	if len(lineage) == 0 {
		lineage = append(lineage, "paloalto-panorama-global", "fortinet-global-adom", "cisco-global-domain")
	}

	placeholders := make([]string, len(lineage))
	args := make([]interface{}, len(lineage))
	for i, l := range lineage {
		placeholders[i] = "?"
		args[i] = l
	}
	inClause := strings.Join(placeholders, ",")

	var objQuery, grpQuery string
	
	switch domain {
	case "address":
		objQuery = fmt.Sprintf(`
			SELECT m.rule_id, m.rule_type, m.direction
			FROM rule_address_mappings m
			JOIN address_objects ao ON m.address_id = ao.id
			WHERE ao.name = ? AND ao.device_uuid IN (%s)
			GROUP BY m.rule_id, m.rule_type, m.direction
		`, inClause)
		grpQuery = fmt.Sprintf(`
			SELECT m.rule_id, m.rule_type, m.direction
			FROM rule_address_mappings m
			JOIN address_groups ag ON m.group_id = ag.id
			WHERE ag.name = ? AND ag.device_uuid IN (%s)
			GROUP BY m.rule_id, m.rule_type, m.direction
		`, inClause)
	case "service":
		objQuery = fmt.Sprintf(`
			SELECT m.rule_id, m.rule_type, '' as direction
			FROM rule_service_mappings m
			JOIN service_objects so ON m.service_id = so.id
			WHERE so.name = ? AND so.device_uuid IN (%s)
			GROUP BY m.rule_id, m.rule_type
		`, inClause)
		grpQuery = fmt.Sprintf(`
			SELECT m.rule_id, m.rule_type, '' as direction
			FROM rule_service_mappings m
			JOIN service_groups sg ON m.group_id = sg.id
			WHERE sg.name = ? AND sg.device_uuid IN (%s)
			GROUP BY m.rule_id, m.rule_type
		`, inClause)
	case "application":
		objQuery = fmt.Sprintf(`
			SELECT m.rule_id, m.rule_type, '' as direction
			FROM rule_application_mappings m
			JOIN application_objects ao ON m.application_id = ao.id
			WHERE ao.name = ? AND ao.device_uuid IN (%s)
			GROUP BY m.rule_id, m.rule_type
		`, inClause)
		grpQuery = fmt.Sprintf(`
			SELECT m.rule_id, m.rule_type, '' as direction
			FROM rule_application_mappings m
			JOIN application_groups ag ON m.group_id = ag.id
			WHERE ag.name = ? AND ag.device_uuid IN (%s)
			GROUP BY m.rule_id, m.rule_type
		`, inClause)
	default:
		http.Error(w, "invalid domain", http.StatusBadRequest)
		return
	}

	fullArgs := []interface{}{objectName}
	fullArgs = append(fullArgs, args...)

	type usageMatch struct {
		RuleID    int
		RuleType  string
		Direction string
	}
	var matches []usageMatch
	
	// Query Objects
	objRows, err := db.Query(objQuery, fullArgs...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer objRows.Close()

	for objRows.Next() {
		var m usageMatch
		if err := objRows.Scan(&m.RuleID, &m.RuleType, &m.Direction); err == nil {
			matches = append(matches, m)
		}
	}
	if err := objRows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Query Groups
	grpRows, err := db.Query(grpQuery, fullArgs...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer grpRows.Close()

	for grpRows.Next() {
		var m usageMatch
		if err := grpRows.Scan(&m.RuleID, &m.RuleType, &m.Direction); err == nil {
			matches = append(matches, m)
		}
	}
	if err := grpRows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	usages := []PolicyUsage{}
	
	typeMap := make(map[string][]int)
	for _, m := range matches {
		typeMap[m.RuleType] = append(typeMap[m.RuleType], m.RuleID)
	}
	
	nameMap := make(map[string]map[int]string)
	
	for rType, ids := range typeMap {
		if len(ids) == 0 { continue }
		idStrs := make([]string, len(ids))
		idArgs := make([]interface{}, len(ids))
		for i, id := range ids {
			idStrs[i] = "?"
			idArgs[i] = id
		}
		
		validTables := map[string]bool{
			"security": true, "nat": true, "qos": true, "pbf": true,
			"decryption": true, "application_override": true,
			"tunnel_inspection": true, "authentication": true, "dos": true,
		}
		
		normalizedType := strings.ToLower(rType)
		if validTables[normalizedType] {
			tableName := normalizedType + "_rules"
			rQuery := fmt.Sprintf("SELECT id, rule_name FROM %s WHERE id IN (%s)", tableName, strings.Join(idStrs, ","))
			rRows, err := db.Query(rQuery, idArgs...)
			if err == nil {
				nameMap[rType] = make(map[int]string)
				for rRows.Next() {
					var id int
					var name string
					if err := rRows.Scan(&id, &name); err == nil {
						nameMap[rType][id] = name
					}
				}
				if err := rRows.Err(); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				rRows.Close()
			}
		}
	}
	
	for _, m := range matches {
		name := nameMap[m.RuleType][m.RuleID]
		if name == "" {
			name = "Unknown Rule"
		}
		usages = append(usages, PolicyUsage{
			ID:        m.RuleID,
			RuleName:  name,
			RuleType:  m.RuleType,
			Direction: m.Direction,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(usages)
}
