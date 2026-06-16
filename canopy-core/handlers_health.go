package main

import (
	"encoding/json"
	"net/http"
)

type HealResponse struct {
	AddressesHealed    int `json:"addresses_healed"`
	ServicesHealed     int `json:"services_healed"`
	ApplicationsHealed int `json:"applications_healed"`
}

func healWorkspaceHandler(w http.ResponseWriter, _ *http.Request) {
	// Healing process uses pure SQLite recursive CTEs to bulk map orphaned objects 
	// while perfectly respecting the device group scope hierarchy.

	// 1. Heal Addresses
	addressQuery := `
		WITH RECURSIVE
		scope_lineage (start_uuid, current_uuid, depth) AS (
			SELECT uuid, uuid, 0 FROM scopes
			UNION ALL
			SELECT sl.start_uuid, s.parent_uuid, sl.depth + 1
			FROM scope_lineage sl
			JOIN scopes s ON sl.current_uuid = s.uuid
			WHERE s.parent_uuid IS NOT NULL
		),
		rule_scopes AS (
			SELECT 'security' AS rule_type, id AS rule_id, device_uuid FROM security_rules
			UNION ALL
			SELECT 'nat', id, device_uuid FROM nat_rules
			UNION ALL
			SELECT 'pbf', id, device_uuid FROM pbf_rules
			UNION ALL
			SELECT 'decryption', id, device_uuid FROM decryption_rules
			UNION ALL
			SELECT 'application_override', id, device_uuid FROM application_override_rules
			UNION ALL
			SELECT 'qos', id, device_uuid FROM qos_rules
			UNION ALL
			SELECT 'dos', id, device_uuid FROM dos_rules
			UNION ALL
			SELECT 'authentication', id, device_uuid FROM authentication_rules
		),
		orphan_mappings AS (
			SELECT m.id AS mapping_id, m.ad_hoc_value, rs.device_uuid AS rule_scope_uuid
			FROM rule_address_mappings m
			JOIN rule_scopes rs ON m.rule_type = rs.rule_type AND m.rule_id = rs.rule_id
			WHERE m.address_id IS NULL AND m.group_id IS NULL AND m.ad_hoc_value IS NOT NULL
		),
		candidate_objects AS (
			SELECT id, name, device_uuid, 'object' AS type FROM address_objects
			UNION ALL
			SELECT id, name, device_uuid, 'group' AS type FROM address_groups
		),
		ranked_matches AS (
			SELECT 
				om.mapping_id, 
				co.id AS candidate_id, 
				co.type AS candidate_type,
				ROW_NUMBER() OVER (PARTITION BY om.mapping_id ORDER BY sl.depth ASC) AS rnk
			FROM orphan_mappings om
			JOIN candidate_objects co ON om.ad_hoc_value = co.name
			JOIN scope_lineage sl ON om.rule_scope_uuid = sl.start_uuid AND co.device_uuid = sl.current_uuid
		)
		UPDATE rule_address_mappings
		SET address_id = CASE WHEN rm.candidate_type = 'object' THEN rm.candidate_id ELSE NULL END,
			group_id = CASE WHEN rm.candidate_type = 'group' THEN rm.candidate_id ELSE NULL END,
			ad_hoc_value = NULL
		FROM ranked_matches rm
		WHERE rule_address_mappings.id = rm.mapping_id AND rm.rnk = 1;
	`

	// 2. Heal Services
	serviceQuery := `
		WITH RECURSIVE
		scope_lineage (start_uuid, current_uuid, depth) AS (
			SELECT uuid, uuid, 0 FROM scopes
			UNION ALL
			SELECT sl.start_uuid, s.parent_uuid, sl.depth + 1
			FROM scope_lineage sl
			JOIN scopes s ON sl.current_uuid = s.uuid
			WHERE s.parent_uuid IS NOT NULL
		),
		rule_scopes AS (
			SELECT 'security' AS rule_type, id AS rule_id, device_uuid FROM security_rules
			UNION ALL
			SELECT 'nat', id, device_uuid FROM nat_rules
			UNION ALL
			SELECT 'pbf', id, device_uuid FROM pbf_rules
			UNION ALL
			SELECT 'decryption', id, device_uuid FROM decryption_rules
			UNION ALL
			SELECT 'application_override', id, device_uuid FROM application_override_rules
			UNION ALL
			SELECT 'qos', id, device_uuid FROM qos_rules
			UNION ALL
			SELECT 'dos', id, device_uuid FROM dos_rules
			UNION ALL
			SELECT 'authentication', id, device_uuid FROM authentication_rules
		),
		orphan_mappings AS (
			SELECT m.id AS mapping_id, m.ad_hoc_value, rs.device_uuid AS rule_scope_uuid
			FROM rule_service_mappings m
			JOIN rule_scopes rs ON m.rule_type = rs.rule_type AND m.rule_id = rs.rule_id
			WHERE m.service_id IS NULL AND m.group_id IS NULL AND m.ad_hoc_value IS NOT NULL
		),
		candidate_objects AS (
			SELECT id, name, device_uuid, 'object' AS type FROM service_objects
			UNION ALL
			SELECT id, name, device_uuid, 'group' AS type FROM service_groups
		),
		ranked_matches AS (
			SELECT 
				om.mapping_id, 
				co.id AS candidate_id, 
				co.type AS candidate_type,
				ROW_NUMBER() OVER (PARTITION BY om.mapping_id ORDER BY sl.depth ASC) AS rnk
			FROM orphan_mappings om
			JOIN candidate_objects co ON om.ad_hoc_value = co.name
			JOIN scope_lineage sl ON om.rule_scope_uuid = sl.start_uuid AND co.device_uuid = sl.current_uuid
		)
		UPDATE rule_service_mappings
		SET service_id = CASE WHEN rm.candidate_type = 'object' THEN rm.candidate_id ELSE NULL END,
			group_id = CASE WHEN rm.candidate_type = 'group' THEN rm.candidate_id ELSE NULL END,
			ad_hoc_value = NULL
		FROM ranked_matches rm
		WHERE rule_service_mappings.id = rm.mapping_id AND rm.rnk = 1;
	`

	// 3. Heal Applications
	applicationQuery := `
		WITH RECURSIVE
		scope_lineage (start_uuid, current_uuid, depth) AS (
			SELECT uuid, uuid, 0 FROM scopes
			UNION ALL
			SELECT sl.start_uuid, s.parent_uuid, sl.depth + 1
			FROM scope_lineage sl
			JOIN scopes s ON sl.current_uuid = s.uuid
			WHERE s.parent_uuid IS NOT NULL
		),
		rule_scopes AS (
			SELECT 'security' AS rule_type, id AS rule_id, device_uuid FROM security_rules
			UNION ALL
			SELECT 'nat', id, device_uuid FROM nat_rules
			UNION ALL
			SELECT 'pbf', id, device_uuid FROM pbf_rules
			UNION ALL
			SELECT 'decryption', id, device_uuid FROM decryption_rules
			UNION ALL
			SELECT 'application_override', id, device_uuid FROM application_override_rules
			UNION ALL
			SELECT 'qos', id, device_uuid FROM qos_rules
			UNION ALL
			SELECT 'dos', id, device_uuid FROM dos_rules
			UNION ALL
			SELECT 'authentication', id, device_uuid FROM authentication_rules
		),
		orphan_mappings AS (
			SELECT m.id AS mapping_id, m.predefined_app_name, rs.device_uuid AS rule_scope_uuid
			FROM rule_application_mappings m
			JOIN rule_scopes rs ON m.rule_type = rs.rule_type AND m.rule_id = rs.rule_id
			WHERE m.custom_app_id IS NULL AND m.group_id IS NULL AND m.predefined_app_name IS NOT NULL
		),
		candidate_objects AS (
			SELECT id, name, device_uuid, 'object' AS type FROM application_objects
			UNION ALL
			SELECT id, name, device_uuid, 'group' AS type FROM application_groups
		),
		ranked_matches AS (
			SELECT 
				om.mapping_id, 
				co.id AS candidate_id, 
				co.type AS candidate_type,
				ROW_NUMBER() OVER (PARTITION BY om.mapping_id ORDER BY sl.depth ASC) AS rnk
			FROM orphan_mappings om
			JOIN candidate_objects co ON om.predefined_app_name = co.name
			JOIN scope_lineage sl ON om.rule_scope_uuid = sl.start_uuid AND co.device_uuid = sl.current_uuid
		)
		UPDATE rule_application_mappings
		SET custom_app_id = CASE WHEN rm.candidate_type = 'object' THEN rm.candidate_id ELSE NULL END,
			group_id = CASE WHEN rm.candidate_type = 'group' THEN rm.candidate_id ELSE NULL END,
			predefined_app_name = NULL
		FROM ranked_matches rm
		WHERE rule_application_mappings.id = rm.mapping_id AND rm.rnk = 1;
	`

	var resp HealResponse

	// Execute Address Heal
	res, err := activeDB.DB().Exec(addressQuery)
	if err == nil {
		affected, _ := res.RowsAffected()
		resp.AddressesHealed = int(affected)
	}

	// Execute Service Heal
	res, err = activeDB.DB().Exec(serviceQuery)
	if err == nil {
		affected, _ := res.RowsAffected()
		resp.ServicesHealed = int(affected)
	}

	// Execute Application Heal
	res, err = activeDB.DB().Exec(applicationQuery)
	if err == nil {
		affected, _ := res.RowsAffected()
		resp.ApplicationsHealed = int(affected)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
