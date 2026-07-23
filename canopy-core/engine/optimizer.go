package engine

import (
	"database/sql"
	"net/netip"
	"strings"
	"fmt"
	"sort"
	"strconv"
)

type OptimizeRequest struct {
	ScopeUUID      string   `json:"scope_uuid"`
	Domain         string   `json:"domain"`
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
	UsageCount     int                `json:"usage_count"`      // Number of policy rules using this object
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
	IPs      []netip.Addr
	CIDRs    []netip.Prefix
	IPRanges []IPRange
}

type memGroup struct {
	ID      int64
	Name    string
	Members []string // names of objects or groups
}

type IPRange struct {
	Start netip.Addr
	End   netip.Addr
}

func (r IPRange) Contains(ip netip.Addr) bool {
	return r.Start.Compare(ip) <= 0 && r.End.Compare(ip) >= 0
}

func cidrBounds(p netip.Prefix) (netip.Addr, netip.Addr) {
	p = p.Masked()
	b := p.Addr().As16()
	bits := p.Bits()
	
	if p.Addr().Is4() {
		for i := bits; i < 32; i++ {
			idx := 12 + (i / 8)
			b[idx] |= 1 << (7 - (i % 8))
		}
		return p.Addr(), netip.AddrFrom16(b).Unmap()
	} else {
		for i := bits; i < 128; i++ {
			b[i/8] |= 1 << (7 - (i % 8))
		}
		return p.Addr(), netip.AddrFrom16(b)
	}
}

func (r IPRange) ContainsCIDR(p netip.Prefix) bool {
	first, last := cidrBounds(p)
	return r.Contains(first) && r.Contains(last)
}

func (r IPRange) ContainsRange(other IPRange) bool {
	return r.Contains(other.Start) && r.Contains(other.End)
}

func cidrContainsRange(c netip.Prefix, r IPRange) bool {
	return c.Contains(r.Start) && c.Contains(r.End)
}

func parseIPRange(val string) (IPRange, bool) {
	parts := strings.SplitN(val, "-", 2)
	if len(parts) == 2 {
		start, err1 := netip.ParseAddr(strings.TrimSpace(parts[0]))
		end, err2 := netip.ParseAddr(strings.TrimSpace(parts[1]))
		if err1 == nil && err2 == nil {
			return IPRange{Start: start, End: end}, true
		}
	}
	return IPRange{}, false
}

func parseValueToNet(val string) ([]netip.Addr, []netip.Prefix, []IPRange) {
	var ips []netip.Addr
	var cidrs []netip.Prefix
	var ranges []IPRange
	
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
			if r, ok := parseIPRange(p); ok {
				ranges = append(ranges, r)
			}
		} else {
			if addr, err := netip.ParseAddr(p); err == nil {
				ips = append(ips, addr)
			}
		}
	}
	return ips, cidrs, ranges
}

func Optimize(db *sql.DB, req OptimizeRequest) ([]OptimizationInsight, error) {
	switch req.Domain {
	case "service":
		return OptimizeServices(db, req)
	case "application":
		return OptimizeApplications(db, req)
	default:
		return OptimizeAddresses(db, req)
	}
}

type PortRange struct {
	Start int
	End   int
}

type memService struct {
	ID       int64
	Name     string
	Protocol string
	RawPort  string
	Ports    []PortRange
}

func parsePorts(portStr string) []PortRange {
	var ranges []PortRange
	parts := strings.Split(portStr, ",")
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if strings.Contains(p, "-") {
			sp := strings.Split(p, "-")
			if len(sp) == 2 {
				start, _ := strconv.Atoi(strings.TrimSpace(sp[0]))
				end, _ := strconv.Atoi(strings.TrimSpace(sp[1]))
				if start > 0 && end >= start {
					ranges = append(ranges, PortRange{Start: start, End: end})
				}
			}
		} else {
			port, _ := strconv.Atoi(p)
			if port > 0 {
				ranges = append(ranges, PortRange{Start: port, End: port})
			}
		}
	}
	return ranges
}

func parseInputToService(in string) (protocol string, ports []PortRange, ok bool) {
	if strings.Contains(in, "/") {
		parts := strings.SplitN(in, "/", 2)
		protocol = strings.ToLower(strings.TrimSpace(parts[0]))
		ports = parsePorts(parts[1])
		if len(ports) > 0 {
			ok = true
		}
	} else {
		protocol = "tcp"
		ports = parsePorts(in)
		if len(ports) > 0 {
			ok = true
		}
	}
	return
}

func portRangeContains(r PortRange, port int) bool {
	return port >= r.Start && port <= r.End
}

// flatten an array of PortRanges into single port ints (if small enough) for simpler intersection math
func flattenPortRanges(ranges []PortRange) []int {
	var ports []int
	for _, r := range ranges {
		// Prevent massive range expansions blowing up memory
		if r.End - r.Start > 10000 {
			continue
		}
		for i := r.Start; i <= r.End; i++ {
			ports = append(ports, i)
		}
	}
	return ports
}

func OptimizeServices(db *sql.DB, req OptimizeRequest) ([]OptimizationInsight, error) {
	insights := []OptimizationInsight{}
	
	lineage := GetPolicyScopeLineage(db, req.ScopeUUID)
	if len(lineage) == 0 {
		lineage = append(lineage, "paloalto-panorama-global", "fortinet-global-adom", "cisco-global-domain")
	}

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

	// Load service_objects
	objQuery := fmt.Sprintf(`SELECT id, name, protocol, destination_port FROM service_objects WHERE device_uuid IN (%s) ORDER BY %s`, inClause, orderClauseObj)
	rows, err := db.Query(objQuery, args...)
	if err != nil {
		return nil, err
	}

	services := make(map[string]*memService)
	var serviceList []*memService
	for rows.Next() {
		var id int64
		var name, protocol, portStr sql.NullString
		if err := rows.Scan(&id, &name, &protocol, &portStr); err == nil {
			if !name.Valid { continue }
			p := "tcp"
			if protocol.Valid && protocol.String != "" {
				p = strings.ToLower(protocol.String)
			}
			rawPort := ""
			if portStr.Valid {
				rawPort = portStr.String
			}
			
			svc := &memService{
				ID: id,
				Name: name.String,
				Protocol: p,
				RawPort: rawPort,
				Ports: parsePorts(rawPort),
			}
			
			// Override if exists
			replaced := false
			for i, existing := range serviceList {
				if existing.Name == svc.Name {
					serviceList[i] = svc
					replaced = true
					break
				}
			}
			if !replaced {
				serviceList = append(serviceList, svc)
			}
			services[svc.Name] = svc
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	// Load service_groups
	grpQuery := fmt.Sprintf(`
		SELECT g.id, g.name, COALESCE(gm.member_name, so.name, nested.name) as member_name
		FROM service_groups g 
		LEFT JOIN service_group_members gm ON g.id = gm.group_id
		LEFT JOIN service_objects so ON gm.member_service_id = so.id
		LEFT JOIN service_groups nested ON gm.member_group_id = nested.id
		WHERE g.device_uuid IN (%s) 
		ORDER BY %s`, inClause, orderClauseGrp)
	
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

	// Recursively resolve group leaves
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
				if _, isObj := services[mName]; isObj {
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
	inputLeafMap := make(map[string][]string)
	
	// Map to track explicit raw ports inputted
	type rawPortKey struct {
		protocol string
		port     int
	}
	inputPortMap := make(map[rawPortKey]string)
	var rawPortInputs []rawPortKey
	
	// To perform CIDR-like threshold aggregations, we track ALL flattened ports
	// We'll map them by protocol
	allFlattenedPorts := make(map[string][]int)

	for _, in := range req.Inputs {
		inputMap[in] = true
		
		if prot, pRanges, ok := parseInputToService(in); ok {
			flat := flattenPortRanges(pRanges)
			allFlattenedPorts[prot] = append(allFlattenedPorts[prot], flat...)
			
			for _, p := range flat {
				k := rawPortKey{protocol: prot, port: p}
				rawPortInputs = append(rawPortInputs, k)
				inputPortMap[k] = in
			}
		} else {
			// If input is an object name
			if obj, ok := services[in]; ok {
				allFlattenedPorts[obj.Protocol] = append(allFlattenedPorts[obj.Protocol], flattenPortRanges(obj.Ports)...)
				inputLeafMap[in] = append(inputLeafMap[in], in)
			}
			// If input is a group name
			if leaves, ok := resolvedGroupLeaves[in]; ok {
				for leaf := range leaves {
					inputLeafMap[leaf] = append(inputLeafMap[leaf], in)
					if obj, isObj := services[leaf]; isObj {
						allFlattenedPorts[obj.Protocol] = append(allFlattenedPorts[obj.Protocol], flattenPortRanges(obj.Ports)...)
					}
				}
			}
		}
	}

	// 1. Port to Object (Exact Match / 1:1)
	// We only swap EXPLICITLY provided raw ports
	for key, origStr := range inputPortMap {
		for _, obj := range serviceList {
			// Exact match if object has 1 port and it matches
			if len(obj.Ports) == 1 && obj.Ports[0].Start == obj.Ports[0].End && obj.Ports[0].Start == key.port && obj.Protocol == key.protocol {
				if !inputMap[obj.Name] {
					insights = append(insights, OptimizationInsight{
						Type:          "object",
						MatchedItems:  []string{origStr},
						TargetName:    obj.Name,
						TargetValue:   fmt.Sprintf("%s/%s", obj.Protocol, obj.RawPort),
						MissingCount:  0,
						CoverageCount: 1,
					})
				}
			}
		}
	}

	// 2. Port Ranges (CIDR equivalent)
	// Suggest objects that contain multiple ports, IF the threshold is met
	// And ONLY suggest swapping inputs that are fully covered by the object
	portRangeMap := make(map[string]*OptimizationInsight)
	for _, obj := range serviceList {
		// Only consider objects that are ranges or multi-ports
		if len(obj.Ports) > 1 || (len(obj.Ports) == 1 && obj.Ports[0].Start != obj.Ports[0].End) {
			
			totalCoveredPorts := 0
			// Count how many of all flattened ports fall into this object
			for _, p := range allFlattenedPorts[obj.Protocol] {
				covered := false
				for _, r := range obj.Ports {
					if portRangeContains(r, p) {
						covered = true
						break
					}
				}
				if covered {
					totalCoveredPorts++
				}
			}
			
			// If we meet the math threshold (e.g. 3 ports)
			if totalCoveredPorts >= req.CIDRThreshold && req.CIDRThreshold > 0 {
				matched := []string{}
				
				// Evaluate which explicit inputs are FULLY covered by this object
				for _, in := range req.Inputs {
					isFullyCovered := true
					hasAnyPorts := false
					
					if prot, pRanges, ok := parseInputToService(in); ok {
						if prot != obj.Protocol {
							isFullyCovered = false
						} else {
							flat := flattenPortRanges(pRanges)
							for _, p := range flat {
								hasAnyPorts = true
								covered := false
								for _, r := range obj.Ports {
									if portRangeContains(r, p) {
										covered = true
										break
									}
								}
								if !covered {
									isFullyCovered = false
								}
							}
						}
					} else if inObj, ok := services[in]; ok {
						if inObj.Protocol != obj.Protocol {
							isFullyCovered = false
						} else {
							flat := flattenPortRanges(inObj.Ports)
							for _, p := range flat {
								hasAnyPorts = true
								covered := false
								for _, r := range obj.Ports {
									if portRangeContains(r, p) {
										covered = true
										break
									}
								}
								if !covered {
									isFullyCovered = false
								}
							}
						}
					} else if leaves, ok := resolvedGroupLeaves[in]; ok {
						for leaf := range leaves {
							if inObj, isObj := services[leaf]; isObj {
								if inObj.Protocol != obj.Protocol {
									isFullyCovered = false
								} else {
									flat := flattenPortRanges(inObj.Ports)
									for _, p := range flat {
										hasAnyPorts = true
										covered := false
										for _, r := range obj.Ports {
											if portRangeContains(r, p) {
												covered = true
												break
											}
										}
										if !covered {
											isFullyCovered = false
										}
									}
								}
							}
						}
					}
					
					if hasAnyPorts && isFullyCovered {
						matched = append(matched, in)
					}
				}
				
				if len(matched) > 0 {
					portRangeMap[obj.Name] = &OptimizationInsight{
						Type:          "network", // 'network' type renders with the hash icon
						MatchedItems:  matched,
						TargetName:    obj.Name,
						TargetValue:   fmt.Sprintf("%s/%s", obj.Protocol, obj.RawPort),
						MissingCount:  0,
						CoverageCount: len(matched),
					}
				}
			}
		}
	}
	
	for _, v := range portRangeMap {
		insights = append(insights, *v)
	}

	// 3. Service Groups
	for gName, leaves := range resolvedGroupLeaves {
		if len(leaves) == 0 {
			continue
		}

		matchedInputSet := make(map[string]bool)
		coveredLeavesMap := make(map[string]bool)
		coverage := 0
		
		for leaf := range leaves {
			matchedThisLeaf := false
			
			if origInputs, exists := inputLeafMap[leaf]; exists {
				for _, origInput := range origInputs {
					matchedInputSet[origInput] = true
				}
				matchedThisLeaf = true
			} else if obj, isObj := services[leaf]; isObj {
				// Check if any provided input port matches this object's ports
				for k, origInput := range inputPortMap {
					if k.protocol == obj.Protocol {
						for _, r := range obj.Ports {
							if portRangeContains(r, k.port) {
								matchedInputSet[origInput] = true
								matchedThisLeaf = true
								break
							}
						}
					}
				}
			}
			
			if matchedThisLeaf {
				coverage++
				coveredLeavesMap[leaf] = true
			}
		}
		
		totalLeaves := len(leaves)
		if coverage > 0 {
			toleranceRatio := float64(coverage) / float64(totalLeaves)
			fmt.Printf("Evaluating group: %s, coverage: %d, total: %d, ratio: %f, reqTolerance: %f\n", gName, coverage, totalLeaves, toleranceRatio, req.GroupTolerance)
			if toleranceRatio >= req.GroupTolerance {
				// Filter matchedInputSet to ensure inputted groups are fully covered
				for m := range matchedInputSet {
					if origLeaves, ok := resolvedGroupLeaves[m]; ok {
						for l := range origLeaves {
							if !coveredLeavesMap[l] {
								delete(matchedInputSet, m)
								break
							}
						}
					}
				}

				matched := []string{}
				for m := range matchedInputSet {
					matched = append(matched, m)
				}
				if len(matched) == 0 {
					continue
				}
				if len(matched) == 1 && matched[0] == gName {
					continue
				}
				
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
								node.IsCovered = allCovered
							} else {
								node.Type = "object"
								node.IsCovered = coveredLeavesMap[mName]
								if svcObj, ok := services[mName]; ok {
									node.Value = fmt.Sprintf("%s/%s", svcObj.Protocol, svcObj.RawPort)
								}
							}
							nodes = append(nodes, node)
						}
					}
					return nodes
				}
				
				missingCount := totalLeaves - coverage
				insights = append(insights, OptimizationInsight{
					Type:          "group",
					MatchedItems:  matched,
					TargetName:    gName,
					TargetValue:   fmt.Sprintf("%d members", len(groups[gName].Members)),
					MissingCount:  missingCount,
					CoverageCount: len(matched),
					CoveredMembers: coverage,
					TotalMembers:   totalLeaves,
					NestedTree:    buildNested(gName, make(map[string]bool)),
				})
			}
		}
	}

	// Sort insights: Group > Object > Network, then by coverage desc
	sort.Slice(insights, func(i, j int) bool {
		typeWeight := map[string]int{"group": 3, "object": 2, "network": 1}
		if typeWeight[insights[i].Type] != typeWeight[insights[j].Type] {
			return typeWeight[insights[i].Type] > typeWeight[insights[j].Type]
		}
		return insights[i].CoverageCount > insights[j].CoverageCount
	})

	usageMap := fetchUsageCounts(db, inClause, args, "service")
	for i := range insights {
		insights[i].UsageCount = usageMap[insights[i].TargetName]
	}
	return insights, nil
}

func OptimizeApplications(db *sql.DB, req OptimizeRequest) ([]OptimizationInsight, error) {
	insights := []OptimizationInsight{}
	
	lineage := GetPolicyScopeLineage(db, req.ScopeUUID)
	if len(lineage) == 0 {
		lineage = append(lineage, "paloalto-panorama-global", "fortinet-global-adom", "cisco-global-domain")
	}

	placeholders := make([]string, len(lineage))
	args := make([]interface{}, len(lineage))
	orderCases := ""
	for i, l := range lineage {
		placeholders[i] = "?"
		args[i] = l
		orderCases += fmt.Sprintf("WHEN '%s' THEN %d ", l, i)
	}
	inClause := strings.Join(placeholders, ",")
	orderClauseGrp := fmt.Sprintf("CASE g.device_uuid %s END DESC", orderCases)

	// We only need groups and members
	grpQuery := fmt.Sprintf(`
		SELECT g.id, g.name, COALESCE(gm.member_name, ao.name, nested.name) as member_name
		FROM application_groups g 
		LEFT JOIN application_group_members gm ON g.id = gm.group_id
		LEFT JOIN application_objects ao ON gm.member_application_id = ao.id
		LEFT JOIN application_groups nested ON gm.member_group_id = nested.id
		WHERE g.device_uuid IN (%s) 
		ORDER BY %s`, inClause, orderClauseGrp)
	
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
				if _, isGrp := groups[mName]; isGrp {
					sub := resolveGroup(mName, visited)
					for k := range sub {
						leaves[k] = true
					}
				} else {
					leaves[mName] = true
				}
			}
		}
		
		resolvedGroupLeaves[name] = leaves
		return leaves
	}

	for gName := range groups {
		resolveGroup(gName, make(map[string]bool))
	}

	inputMap := make(map[string]bool)
	inputLeafMap := make(map[string][]string)
	
	for _, in := range req.Inputs {
		inputMap[in] = true
		if leaves, ok := resolvedGroupLeaves[in]; ok {
			for leaf := range leaves {
				inputLeafMap[leaf] = append(inputLeafMap[leaf], in)
			}
		} else {
			inputLeafMap[in] = append(inputLeafMap[in], in)
		}
	}

	for gName, leaves := range resolvedGroupLeaves {
		if len(leaves) == 0 {
			continue
		}

		matchedInputSet := make(map[string]bool)
		coveredLeavesMap := make(map[string]bool)
		coverage := 0
		
		for leaf := range leaves {
			if origInputs, exists := inputLeafMap[leaf]; exists {
				for _, origInput := range origInputs {
					matchedInputSet[origInput] = true
				}
				coverage++
				coveredLeavesMap[leaf] = true
			}
		}
		
		totalLeaves := len(leaves)
		if coverage > 0 {
			toleranceRatio := float64(coverage) / float64(totalLeaves)
			if toleranceRatio >= req.GroupTolerance {
				// Filter matchedInputSet to ensure inputted groups are fully covered
				for m := range matchedInputSet {
					if origLeaves, ok := resolvedGroupLeaves[m]; ok {
						for l := range origLeaves {
							if !coveredLeavesMap[l] {
								delete(matchedInputSet, m)
								break
							}
						}
					}
				}

				matched := []string{}
				for m := range matchedInputSet {
					matched = append(matched, m)
				}
				if len(matched) == 0 {
					continue
				}
				if len(matched) == 1 && matched[0] == gName {
					continue
				}
				
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
								node.IsCovered = allCovered
							} else {
								node.Type = "object"
								node.IsCovered = coveredLeavesMap[mName]
							}
							nodes = append(nodes, node)
						}
					}
					return nodes
				}
				
				missingCount := totalLeaves - coverage
				insights = append(insights, OptimizationInsight{
					Type:          "group",
					MatchedItems:  matched,
					TargetName:    gName,
					TargetValue:   fmt.Sprintf("%d members", len(groups[gName].Members)),
					MissingCount:  missingCount,
					CoverageCount: len(matched),
					CoveredMembers: coverage,
					TotalMembers:   totalLeaves,
					NestedTree:    buildNested(gName, make(map[string]bool)),
				})
			}
		}
	}

	// Sort insights: Group > Object > Network, then by coverage desc
	sort.Slice(insights, func(i, j int) bool {
		typeWeight := map[string]int{"group": 3, "object": 2, "network": 1}
		if typeWeight[insights[i].Type] != typeWeight[insights[j].Type] {
			return typeWeight[insights[i].Type] > typeWeight[insights[j].Type]
		}
		return insights[i].CoverageCount > insights[j].CoverageCount
	})

	usageMap := fetchUsageCounts(db, inClause, args, "application")
	for i := range insights {
		insights[i].UsageCount = usageMap[insights[i].TargetName]
	}
	return insights, nil
}

func fetchUsageCounts(db *sql.DB, inClause string, args []interface{}, domain string) map[string]int {
	usageMap := make(map[string]int)

	var objQuery, grpQuery string
	switch domain {
	case "address":
		objQuery = fmt.Sprintf(`SELECT ao.name, COUNT(m.id) FROM address_objects ao JOIN rule_address_mappings m ON ao.id = m.address_id WHERE ao.device_uuid IN (%s) GROUP BY ao.name`, inClause)
		grpQuery = fmt.Sprintf(`SELECT ag.name, COUNT(m.id) FROM address_groups ag JOIN rule_address_mappings m ON ag.id = m.group_id WHERE ag.device_uuid IN (%s) GROUP BY ag.name`, inClause)
	case "service":
		objQuery = fmt.Sprintf(`SELECT so.name, COUNT(m.id) FROM service_objects so JOIN rule_service_mappings m ON so.id = m.service_id WHERE so.device_uuid IN (%s) GROUP BY so.name`, inClause)
		grpQuery = fmt.Sprintf(`SELECT sg.name, COUNT(m.id) FROM service_groups sg JOIN rule_service_mappings m ON sg.id = m.group_id WHERE sg.device_uuid IN (%s) GROUP BY sg.name`, inClause)
	case "application":
		objQuery = fmt.Sprintf(`SELECT ao.name, COUNT(m.id) FROM application_objects ao JOIN rule_application_mappings m ON ao.id = m.application_id WHERE ao.device_uuid IN (%s) GROUP BY ao.name`, inClause)
		grpQuery = fmt.Sprintf(`SELECT ag.name, COUNT(m.id) FROM application_groups ag JOIN rule_application_mappings m ON ag.id = m.group_id WHERE ag.device_uuid IN (%s) GROUP BY ag.name`, inClause)
	default:
		return usageMap
	}

	rows, err := db.Query(objQuery, args...)
	if err == nil {
		for rows.Next() {
			var name string
			var count int
			if err := rows.Scan(&name, &count); err == nil {
				usageMap[name] = count
			}
		}
		if err := rows.Err(); err != nil {
			// Optional: log error
		}
		rows.Close()
	}

	rows2, err := db.Query(grpQuery, args...)
	if err == nil {
		for rows2.Next() {
			var name string
			var count int
			if err := rows2.Scan(&name, &count); err == nil {
				usageMap[name] = count
			}
		}
		if err := rows2.Err(); err != nil {
			// Optional: log error
		}
		rows2.Close()
	}

	return usageMap
}

func OptimizeAddresses(db *sql.DB, req OptimizeRequest) ([]OptimizationInsight, error) {
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
			ips, cidrs, ranges := parseValueToNet(val)
			obj := &memAddress{ID: id, Name: name, Value: val, Type: typ, IPs: ips, CIDRs: cidrs, IPRanges: ranges}
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
	var inputCIDRs []netip.Prefix
	var inputRanges []IPRange
	
	// inputLeafMap maps a leaf object name to the original user input that provided it
	inputLeafMap := make(map[string][]string)
	// inputIPMap maps an IP to the original user input that provided it
	inputIPMap := make(map[netip.Addr]string)
	// inputCIDRMap maps a CIDR to the original user input that provided it
	inputCIDRMap := make(map[netip.Prefix]string)
	// inputRangeMap maps a Range to the original user input that provided it
	inputRangeMap := make(map[IPRange]string)

	for _, in := range req.Inputs {
		inputMap[in] = true
		if addr, err := netip.ParseAddr(in); err == nil {
			inputAddrs = append(inputAddrs, addr)
			inputIPMap[addr] = in
		} else if prefix, err := netip.ParsePrefix(in); err == nil {
			inputCIDRs = append(inputCIDRs, prefix)
			inputCIDRMap[prefix] = in
		} else if r, ok := parseIPRange(in); ok {
			inputRanges = append(inputRanges, r)
			inputRangeMap[r] = in
		} else {
			// If input is an object name
			if obj, ok := addresses[in]; ok {
				inputAddrs = append(inputAddrs, obj.IPs...)
				inputCIDRs = append(inputCIDRs, obj.CIDRs...)
				inputRanges = append(inputRanges, obj.IPRanges...)
				inputLeafMap[in] = append(inputLeafMap[in], in)
			}
			// If input is a group name, map all its leaves back to this group input
			if leaves, ok := resolvedGroupLeaves[in]; ok {
				for leaf := range leaves {
					inputLeafMap[leaf] = append(inputLeafMap[leaf], in)
					if obj, isObj := addresses[leaf]; isObj {
						inputAddrs = append(inputAddrs, obj.IPs...)
						inputCIDRs = append(inputCIDRs, obj.CIDRs...)
						inputRanges = append(inputRanges, obj.IPRanges...)
					}
				}
			}
		}
	}

	// 1. IP to Object (Exact Match)
	for _, inputIP := range inputAddrs {
		var origStr string
		if s, ok := inputIPMap[inputIP]; ok {
			origStr = s
		} else {
			for name, obj := range addresses {
				if inputMap[name] && len(obj.IPs) > 0 {
					for _, ip := range obj.IPs {
						if ip == inputIP {
							origStr = name
							break
						}
					}
				}
				if origStr != "" {
					break
				}
			}
		}

		if origStr == "" {
			continue
		}

		for _, obj := range addressList {
			if len(obj.IPs) == 1 && len(obj.CIDRs) == 0 && obj.IPs[0] == inputIP {
				if origStr == obj.Name {
					continue
				}
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

	// 1b. CIDR to Object (Exact Match)
	for _, inputCIDR := range inputCIDRs {
		var origStr string
		if s, ok := inputCIDRMap[inputCIDR]; ok {
			origStr = s
		} else {
			for name, obj := range addresses {
				if inputMap[name] && len(obj.CIDRs) > 0 {
					for _, c := range obj.CIDRs {
						if c == inputCIDR {
							origStr = name
							break
						}
					}
				}
				if origStr != "" {
					break
				}
			}
		}

		if origStr == "" {
			continue
		}

		for _, obj := range addressList {
			if len(obj.CIDRs) == 1 && len(obj.IPs) == 0 && len(obj.IPRanges) == 0 && obj.CIDRs[0] == inputCIDR {
				if origStr == obj.Name {
					continue
				}
				insights = append(insights, OptimizationInsight{
					Type:          "network",
					MatchedItems:  []string{origStr},
					TargetName:    obj.Name,
					TargetValue:   obj.Value,
					MissingCount:  0,
					CoverageCount: 1,
				})
			}
		}
	}

	// 1c. IP Range to Object (Exact Match)
	for _, inputRange := range inputRanges {
		var origStr string
		if s, ok := inputRangeMap[inputRange]; ok {
			origStr = s
		} else {
			for name, obj := range addresses {
				if inputMap[name] && len(obj.IPRanges) > 0 {
					for _, r := range obj.IPRanges {
						if r.Start == inputRange.Start && r.End == inputRange.End {
							origStr = name
							break
						}
					}
				}
				if origStr != "" {
					break
				}
			}
		}

		if origStr == "" {
			continue
		}

		for _, obj := range addressList {
			if len(obj.IPRanges) == 1 && len(obj.IPs) == 0 && len(obj.CIDRs) == 0 && obj.IPRanges[0].Start == inputRange.Start && obj.IPRanges[0].End == inputRange.End {
				if origStr == obj.Name {
					continue
				}
				insights = append(insights, OptimizationInsight{
					Type:          "network",
					MatchedItems:  []string{origStr},
					TargetName:    obj.Name,
					TargetValue:   obj.Value,
					MissingCount:  0,
					CoverageCount: 1,
				})
			}
		}
	}

	// 2. Subnet/Range Aggregation
	networkMap := make(map[string]*OptimizationInsight)
	
	for _, obj := range addressList {
		// a. Target is a CIDR
		if len(obj.CIDRs) == 1 {
			cidr := obj.CIDRs[0]
			
			totalCoveredItems := 0
			for _, inputIP := range inputAddrs {
				if cidr.Contains(inputIP) {
					totalCoveredItems++
				}
			}
			for _, inputCIDR := range inputCIDRs {
				// A CIDR is covered if its base IP is in the broader CIDR, and its prefix is >= broader prefix length
				if cidr.Contains(inputCIDR.Addr()) && cidr.Bits() <= inputCIDR.Bits() {
					totalCoveredItems++
				}
			}
			for _, inputR := range inputRanges {
				if cidrContainsRange(cidr, inputR) {
					totalCoveredItems++
				}
			}
			
			if totalCoveredItems >= req.CIDRThreshold && req.CIDRThreshold > 0 {
				matched := []string{}
				
				for _, in := range req.Inputs {
					isFullyCovered := true
					hasAnyItems := false
			
					if addr, err := netip.ParseAddr(in); err == nil {
						hasAnyItems = true
						if !cidr.Contains(addr) {
							isFullyCovered = false
						}
					} else if prefix, err := netip.ParsePrefix(in); err == nil {
						hasAnyItems = true
						if !(cidr.Contains(prefix.Addr()) && cidr.Bits() <= prefix.Bits()) {
							isFullyCovered = false
						}
					} else if r, ok := parseIPRange(in); ok {
						hasAnyItems = true
						if !cidrContainsRange(cidr, r) {
							isFullyCovered = false
						}
					} else if inObj, ok := addresses[in]; ok {
						for _, ip := range inObj.IPs {
							hasAnyItems = true
							if !cidr.Contains(ip) {
								isFullyCovered = false
							}
						}
						for _, pref := range inObj.CIDRs {
							hasAnyItems = true
							if !(cidr.Contains(pref.Addr()) && cidr.Bits() <= pref.Bits()) {
								isFullyCovered = false
							}
						}
						for _, r := range inObj.IPRanges {
							hasAnyItems = true
							if !cidrContainsRange(cidr, r) {
								isFullyCovered = false
							}
						}
					} else if leaves, ok := resolvedGroupLeaves[in]; ok {
						for leaf := range leaves {
							if inObj, isObj := addresses[leaf]; isObj {
								for _, ip := range inObj.IPs {
									hasAnyItems = true
									if !cidr.Contains(ip) {
										isFullyCovered = false
									}
								}
								for _, pref := range inObj.CIDRs {
									hasAnyItems = true
									if !(cidr.Contains(pref.Addr()) && cidr.Bits() <= pref.Bits()) {
										isFullyCovered = false
									}
								}
								for _, r := range inObj.IPRanges {
									hasAnyItems = true
									if !cidrContainsRange(cidr, r) {
										isFullyCovered = false
									}
								}
							}
						}
					}
			
					if hasAnyItems && isFullyCovered {
						matched = append(matched, in)
					}
				}

				if len(matched) > 0 {
					networkMap[obj.Name] = &OptimizationInsight{
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

		// b. Target is an IPRange
		if len(obj.IPRanges) == 1 {
			targetR := obj.IPRanges[0]
			
			totalCoveredItems := 0
			for _, inputIP := range inputAddrs {
				if targetR.Contains(inputIP) {
					totalCoveredItems++
				}
			}
			for _, inputCIDR := range inputCIDRs {
				if targetR.ContainsCIDR(inputCIDR) {
					totalCoveredItems++
				}
			}
			for _, inputR := range inputRanges {
				if targetR.ContainsRange(inputR) {
					totalCoveredItems++
				}
			}
			
			if totalCoveredItems >= req.CIDRThreshold && req.CIDRThreshold > 0 {
				matched := []string{}
				
				for _, in := range req.Inputs {
					isFullyCovered := true
					hasAnyItems := false
			
					if addr, err := netip.ParseAddr(in); err == nil {
						hasAnyItems = true
						if !targetR.Contains(addr) {
							isFullyCovered = false
						}
					} else if prefix, err := netip.ParsePrefix(in); err == nil {
						hasAnyItems = true
						if !targetR.ContainsCIDR(prefix) {
							isFullyCovered = false
						}
					} else if r, ok := parseIPRange(in); ok {
						hasAnyItems = true
						if !targetR.ContainsRange(r) {
							isFullyCovered = false
						}
					} else if inObj, ok := addresses[in]; ok {
						for _, ip := range inObj.IPs {
							hasAnyItems = true
							if !targetR.Contains(ip) {
								isFullyCovered = false
							}
						}
						for _, pref := range inObj.CIDRs {
							hasAnyItems = true
							if !targetR.ContainsCIDR(pref) {
								isFullyCovered = false
							}
						}
						for _, r := range inObj.IPRanges {
							hasAnyItems = true
							if !targetR.ContainsRange(r) {
								isFullyCovered = false
							}
						}
					} else if leaves, ok := resolvedGroupLeaves[in]; ok {
						for leaf := range leaves {
							if inObj, isObj := addresses[leaf]; isObj {
								for _, ip := range inObj.IPs {
									hasAnyItems = true
									if !targetR.Contains(ip) {
										isFullyCovered = false
									}
								}
								for _, pref := range inObj.CIDRs {
									hasAnyItems = true
									if !targetR.ContainsCIDR(pref) {
										isFullyCovered = false
									}
								}
								for _, r := range inObj.IPRanges {
									hasAnyItems = true
									if !targetR.ContainsRange(r) {
										isFullyCovered = false
									}
								}
							}
						}
					}
			
					if hasAnyItems && isFullyCovered {
						matched = append(matched, in)
					}
				}

				if len(matched) > 0 {
					networkMap[obj.Name] = &OptimizationInsight{
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
	}
	for _, v := range networkMap {
		insights = append(insights, *v)
	}

	// 3. Inputs to Group
	for gName, leaves := range resolvedGroupLeaves {
		if len(leaves) == 0 {
			continue
		}

		matchedInputSet := make(map[string]bool)
		coveredLeavesMap := make(map[string]bool)
		coverage := 0
		ipHitsForCIDRs := 0

		for leaf := range leaves {
			matchedThisLeaf := false
			
			if origInputs, exists := inputLeafMap[leaf]; exists {
				for _, origInput := range origInputs {
					matchedInputSet[origInput] = true
				}
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
					for _, inputCIDR := range inputCIDRs {
						if cidr.Contains(inputCIDR.Addr()) && cidr.Bits() <= inputCIDR.Bits() {
							if origInput, exists := inputCIDRMap[inputCIDR]; exists {
								matchedInputSet[origInput] = true
								matchedThisLeaf = true
								leafCIDRHits++
							}
						}
					}
					for _, inputR := range inputRanges {
						if cidrContainsRange(cidr, inputR) {
							if origInput, exists := inputRangeMap[inputR]; exists {
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
				// Check Ranges
				for _, r := range obj.IPRanges {
					leafRangeHits := 0
					for _, inputIP := range inputAddrs {
						if r.Contains(inputIP) {
							if origInput, exists := inputIPMap[inputIP]; exists {
								matchedInputSet[origInput] = true
								matchedThisLeaf = true
								leafRangeHits++
							}
						}
					}
					for _, inputCIDR := range inputCIDRs {
						if r.ContainsCIDR(inputCIDR) {
							if origInput, exists := inputCIDRMap[inputCIDR]; exists {
								matchedInputSet[origInput] = true
								matchedThisLeaf = true
								leafRangeHits++
							}
						}
					}
					for _, inputR := range inputRanges {
						if r.ContainsRange(inputR) {
							if origInput, exists := inputRangeMap[inputR]; exists {
								matchedInputSet[origInput] = true
								matchedThisLeaf = true
								leafRangeHits++
							}
						}
					}
					if leafRangeHits >= req.CIDRThreshold && req.CIDRThreshold > 0 {
						ipHitsForCIDRs += leafRangeHits
					} else if leafRangeHits > 0 {
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
				// Filter matchedInputSet to ensure inputted groups are fully covered
				for m := range matchedInputSet {
					if origLeaves, ok := resolvedGroupLeaves[m]; ok {
						for l := range origLeaves {
							if !coveredLeavesMap[l] {
								delete(matchedInputSet, m)
								break
							}
						}
					}
				}

				matched := []string{}
				for m := range matchedInputSet {
					matched = append(matched, m)
				}
				if len(matched) == 0 {
					continue
				}
				if len(matched) == 1 && matched[0] == gName {
					continue
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

	// Sort insights: Group > Object > Network, then by coverage desc
	sort.Slice(insights, func(i, j int) bool {
		typeWeight := map[string]int{"group": 3, "object": 2, "network": 1}
		if typeWeight[insights[i].Type] != typeWeight[insights[j].Type] {
			return typeWeight[insights[i].Type] > typeWeight[insights[j].Type]
		}
		return insights[i].CoverageCount > insights[j].CoverageCount
	})

	usageMap := fetchUsageCounts(db, inClause, args, "address")
	for i := range insights {
		insights[i].UsageCount = usageMap[insights[i].TargetName]
	}
	return insights, nil
}
