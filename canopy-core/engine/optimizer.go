package engine

import (
	"database/sql"
	"net/netip"
	"strings"
	"fmt"
	"sort"
)

type OptimizeRequest struct {
	ScopeUUID      string   `json:"scope_uuid"`
	Inputs         []string `json:"inputs"`
	CIDRThreshold  int      `json:"cidr_threshold"`
	GroupTolerance float64  `json:"group_tolerance"`
}

type OptimizationInsight struct {
	Type          string   `json:"type"`             // "object", "network", "group"
	MatchedItems  []string `json:"matched_items"`    // Inputs that are covered
	TargetName    string   `json:"target_name"`      // Object name or group name to replace with
	TargetUUID    string   `json:"target_uuid"`      // UUID of the object/group
	TargetValue   string   `json:"target_value"`     // e.g. "10.0.0.0/24"
	MissingCount   int                `json:"missing_count"`    // How many items are inside the target but NOT in the input list
	CoverageCount  int                `json:"coverage_count"`   // How many items from the input list are covered
	CoveredMembers int                `json:"covered_members"`  // How many actual members of the group are covered
	TotalMembers   int                `json:"total_members"`    // Total leaves/members in the group
	NestedTree     []NestedMemberNode `json:"nested_tree,omitempty"` // Full hierarchical group structure
}

type NestedMemberNode struct {
	Name      string             `json:"name"`
	Value     string             `json:"value"`
	Type      string             `json:"type"` // "object", "group", "unknown"
	IsCovered bool               `json:"is_covered"`
	Children  []NestedMemberNode `json:"children,omitempty"`
}

// Internal structs for mapping
type memAddress struct {
	ID    int64
	UUID  string
	Name  string
	Value string
	Type  string
	IPs   []netip.Addr
	CIDRs []netip.Prefix
}

type memGroup struct {
	ID      int64
	Name    string
	Members []string // names of objects or groups
}

func parseValueToNet(val string) ([]netip.Addr, []netip.Prefix) {
	var ips []netip.Addr
	var cidrs []netip.Prefix
	
	parts := strings.Split(val, ",")
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if strings.Contains(p, "/") {
			if prefix, err := netip.ParsePrefix(p); err == nil {
				cidrs = append(cidrs, prefix)
			}
		} else if strings.Contains(p, "-") {
			// Range - skip for now or implement range logic
		} else {
			if addr, err := netip.ParseAddr(p); err == nil {
				ips = append(ips, addr)
			}
		}
	}
	return ips, cidrs
}

func Optimize(db *sql.DB, req OptimizeRequest) ([]OptimizationInsight, error) {
	insights := []OptimizationInsight{}
	if len(req.Inputs) == 0 {
		return insights, nil
	}

	lineage := GetPolicyScopeLineage(db, req.ScopeUUID)
	if len(lineage) == 0 {
		lineage = append(lineage, "paloalto-panorama-global", "fortinet-global-adom", "cisco-global-domain")
	}

	// Build IN clause and ORDER BY clause for scopes
	placeholders := make([]string, len(lineage))
	args := make([]interface{}, len(lineage))
	orderCases := ""
	for i, l := range lineage {
		placeholders[i] = "?"
		args[i] = l
		orderCases += fmt.Sprintf("WHEN '%s' THEN %d ", l, i)
	}
	inClause := strings.Join(placeholders, ",")
	orderClauseObj := fmt.Sprintf("CASE device_uuid %s END DESC", orderCases)
	orderClauseGrp := fmt.Sprintf("CASE g.device_uuid %s END DESC", orderCases)

	// Load all address objects
	objQuery := fmt.Sprintf(`SELECT id, name, type, value FROM address_objects WHERE device_uuid IN (%s) ORDER BY %s`, inClause, orderClauseObj)
	rows, err := db.Query(objQuery, args...)
	if err != nil {
		return nil, err
	}

	addresses := make(map[string]*memAddress)
	var addressList []*memAddress
	for rows.Next() {
		var id int64
		var name, typ, val string
		if err := rows.Scan(&id, &name, &typ, &val); err == nil {
			ips, cidrs := parseValueToNet(val)
			obj := &memAddress{ID: id, Name: name, Value: val, Type: typ, IPs: ips, CIDRs: cidrs}
			// If it already exists, replace it in the list (inheritance override)
			if _, exists := addresses[name]; exists {
				for i, a := range addressList {
					if a.Name == name {
						addressList[i] = obj
						break
					}
				}
			} else {
				addressList = append(addressList, obj)
			}
			addresses[name] = obj
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	grpQuery := fmt.Sprintf(`
		SELECT g.id, g.name, COALESCE(m.member_name, ao.name, ag.name) as member_name
		FROM address_groups g
		LEFT JOIN address_group_members m ON g.id = m.group_id
		LEFT JOIN address_objects ao ON m.member_address_id = ao.id
		LEFT JOIN address_groups ag ON m.member_group_id = ag.id
		WHERE g.device_uuid IN (%s)
		ORDER BY %s
	`, inClause, orderClauseGrp)
	gRows, err := db.Query(grpQuery, args...)
	if err != nil {
		return nil, err
	}

	groups := make(map[string]*memGroup)
	for gRows.Next() {
		var id int64
		var name string
		var member sql.NullString
		if err := gRows.Scan(&id, &name, &member); err == nil {
			grp, ok := groups[name]
			// If group doesn't exist yet, OR if the ID changed (meaning it's an override from a more specific scope)
			if !ok || grp.ID != id {
				grp = &memGroup{ID: id, Name: name, Members: make([]string, 0)}
				groups[name] = grp
			}
			if member.Valid && member.String != "" {
				grp.Members = append(grp.Members, member.String)
			}
		}
	}
	if err := gRows.Err(); err != nil {
		return nil, err
	}
	gRows.Close()

	// Recursively resolve a group to its leaf objects
	resolvedGroupLeaves := make(map[string]map[string]bool)
	var resolveGroup func(name string, visited map[string]bool) map[string]bool
	resolveGroup = func(name string, visited map[string]bool) map[string]bool {
		if leaves, ok := resolvedGroupLeaves[name]; ok {
			return leaves
		}
		if visited[name] {
			return make(map[string]bool)
		}
		visited[name] = true
		
		leaves := make(map[string]bool)
		
		if grp, ok := groups[name]; ok {
			for _, mName := range grp.Members {
				if _, isObj := addresses[mName]; isObj {
					leaves[mName] = true
				} else if _, isGrp := groups[mName]; isGrp {
					sub := resolveGroup(mName, visited)
					for k := range sub {
						leaves[k] = true
					}
				}
			}
		}
		
		resolvedGroupLeaves[name] = leaves
		return leaves
	}

	for gName := range groups {
		resolveGroup(gName, make(map[string]bool))
	}

	// Parse inputs
	inputMap := make(map[string]bool)
	var inputAddrs []netip.Addr
	
	// inputLeafMap maps a leaf object name to the original user input that provided it
	inputLeafMap := make(map[string]string)
	// inputIPMap maps an IP to the original user input that provided it
	inputIPMap := make(map[netip.Addr]string)

	for _, in := range req.Inputs {
		inputMap[in] = true
		if addr, err := netip.ParseAddr(in); err == nil {
			inputAddrs = append(inputAddrs, addr)
			inputIPMap[addr] = in
		} else {
			// If input is an object name
			if obj, ok := addresses[in]; ok {
				inputAddrs = append(inputAddrs, obj.IPs...)
				inputLeafMap[in] = in
			}
			// If input is a group name, map all its leaves back to this group input
			if leaves, ok := resolvedGroupLeaves[in]; ok {
				for leaf := range leaves {
					inputLeafMap[leaf] = in
					if obj, isObj := addresses[leaf]; isObj {
						inputAddrs = append(inputAddrs, obj.IPs...)
					}
				}
			}
		}
	}

	// 1. IP to Object (Exact Match)
	for inputIP, origStr := range inputIPMap {
		for _, obj := range addressList {
			if len(obj.IPs) == 1 && len(obj.CIDRs) == 0 && obj.IPs[0] == inputIP {
				if !inputMap[obj.Name] {
					insights = append(insights, OptimizationInsight{
						Type:          "object",
						MatchedItems:  []string{origStr},
						TargetName:    obj.Name,
						TargetValue:   obj.Value,
						MissingCount:  0,
						CoverageCount: 1,
					})
				}
			}
		}
	}

	// 2. IP to CIDR
	cidrMap := make(map[string]*OptimizationInsight)
	for _, obj := range addressList {
		if len(obj.CIDRs) == 1 {
			cidr := obj.CIDRs[0]
			
			totalCoveredIPs := 0
			for _, inputIP := range inputAddrs {
				if cidr.Contains(inputIP) {
					totalCoveredIPs++
				}
			}
			
			if totalCoveredIPs >= req.CIDRThreshold && req.CIDRThreshold > 0 {
				var matched []string
				
				for _, in := range req.Inputs {
					isFullyCovered := true
					hasAnyIPs := false
			
					if addr, err := netip.ParseAddr(in); err == nil {
						hasAnyIPs = true
						if !cidr.Contains(addr) {
							isFullyCovered = false
						}
					} else if inObj, ok := addresses[in]; ok {
						for _, ip := range inObj.IPs {
							hasAnyIPs = true
							if !cidr.Contains(ip) {
								isFullyCovered = false
							}
						}
					} else if leaves, ok := resolvedGroupLeaves[in]; ok {
						for leaf := range leaves {
							if inObj, isObj := addresses[leaf]; isObj {
								for _, ip := range inObj.IPs {
									hasAnyIPs = true
									if !cidr.Contains(ip) {
										isFullyCovered = false
									}
								}
							}
						}
					}
			
					if hasAnyIPs && isFullyCovered {
						matched = append(matched, in)
					}
				}

				cidrMap[obj.Name] = &OptimizationInsight{
					Type:          "network",
					MatchedItems:  matched,
					TargetName:    obj.Name,
					TargetValue:   obj.Value,
					MissingCount:  0,
					CoverageCount: len(matched),
				}
			}
		}
	}
	for _, v := range cidrMap {
		insights = append(insights, *v)
	}

	// 3. Inputs to Group
	for gName, leaves := range resolvedGroupLeaves {
		if len(leaves) == 0 {
			continue
		}
		
		// If the user already provided this exact group, don't suggest it
		if inputMap[gName] {
			continue
		}

		matchedInputSet := make(map[string]bool)
		coveredLeavesMap := make(map[string]bool)
		coverage := 0
		ipHitsForCIDRs := 0

		for leaf := range leaves {
			matchedThisLeaf := false
			
			if origInput, exists := inputLeafMap[leaf]; exists {
				matchedInputSet[origInput] = true
				matchedThisLeaf = true
			} else if obj, isObj := addresses[leaf]; isObj {
				// Check exact IPs
				for _, ip := range obj.IPs {
					if origInput, exists := inputIPMap[ip]; exists {
						matchedInputSet[origInput] = true
						matchedThisLeaf = true
					}
				}
				// Check CIDRs
				for _, cidr := range obj.CIDRs {
					leafCIDRHits := 0
					for _, inputIP := range inputAddrs {
						if cidr.Contains(inputIP) {
							if origInput, exists := inputIPMap[inputIP]; exists {
								matchedInputSet[origInput] = true
								matchedThisLeaf = true
								leafCIDRHits++
							}
						}
					}
					// If the CIDR threshold is met, this leaf is validly covered
					if leafCIDRHits >= req.CIDRThreshold && req.CIDRThreshold > 0 {
						ipHitsForCIDRs += leafCIDRHits
					} else if leafCIDRHits > 0 {
						// It matched IPs, but not enough to meet the threshold for this CIDR object!
						// We should probably NOT count it as matched for the group either to be consistent.
						matchedThisLeaf = false
					}
				}
			}
			
			if matchedThisLeaf {
				coverage++
				coveredLeavesMap[leaf] = true
			}
		}
		
		totalLeaves := len(leaves)
		
		// If the group covers anything and meets tolerance
		if coverage > 0 {
			toleranceRatio := float64(coverage) / float64(totalLeaves)
			if toleranceRatio >= req.GroupTolerance {
				var matched []string
				for m := range matchedInputSet {
					matched = append(matched, m)
				}
				
				// Optional: coverageCount could be the number of items replaced in the UI, 
				// which is len(matched). But MissingCount is based on leaf objects.
				// For consistency with how UI displays it, coverageCount should be items replaced.
				
				var buildNested func(name string, visited map[string]bool) []NestedMemberNode
				buildNested = func(name string, visited map[string]bool) []NestedMemberNode {
					if visited[name] {
						return nil
					}
					visited[name] = true
					var nodes []NestedMemberNode
					if grp, ok := groups[name]; ok {
						for _, mName := range grp.Members {
							node := NestedMemberNode{
								Name: mName,
							}
							if _, isGrp := groups[mName]; isGrp {
								node.Type = "group"
								node.Children = buildNested(mName, visited)
								allCovered := true
								for _, child := range node.Children {
									if !child.IsCovered {
										allCovered = false
										break
									}
								}
								node.IsCovered = len(node.Children) > 0 && allCovered
							} else if obj, isObj := addresses[mName]; isObj {
								node.Type = "object"
								node.Value = obj.Value
								node.IsCovered = coveredLeavesMap[mName]
							} else {
								node.Type = "unknown"
							}
							nodes = append(nodes, node)
						}
					}
					return nodes
				}

				tree := buildNested(gName, make(map[string]bool))

				insights = append(insights, OptimizationInsight{
					Type:           "group",
					MatchedItems:   matched,
					TargetName:     gName,
					MissingCount:   totalLeaves - coverage,
					CoverageCount:  len(matched),
					CoveredMembers: coverage,
					TotalMembers:   totalLeaves,
					NestedTree:     tree,
				})
			}
		}
	}

	// Sort insights: Group > Network > Object, then by coverage desc
	sort.Slice(insights, func(i, j int) bool {
		typeWeight := map[string]int{"group": 3, "network": 2, "object": 1}
		if typeWeight[insights[i].Type] != typeWeight[insights[j].Type] {
			return typeWeight[insights[i].Type] > typeWeight[insights[j].Type]
		}
		return insights[i].CoverageCount > insights[j].CoverageCount
	})

	return insights, nil
}
