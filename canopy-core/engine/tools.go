package engine

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"strings"
)

type SandboxMatch struct {
	DeviceUUID     string `json:"device_uuid"`
	DeviceName     string `json:"device_name"`
	Type           string `json:"type"`      // "Direct (Local Interface)" or "Routing Table"
	Interface           string `json:"interface"` // The name of the interface
	Destination         string `json:"destination,omitempty"`
	ResolvedDest        string `json:"resolved_dest,omitempty"`
	InterfaceIP         string `json:"interface_ip,omitempty"`
	ResolvedInterfaceIP string `json:"resolved_interface_ip,omitempty"`
	RouteName           string `json:"route_name,omitempty"`
	Zone           string `json:"zone"`
	VirtualRouter  string `json:"virtual_router"`
	IsDefaultRoute  bool   `json:"is_default_route,omitempty"`
	NextHop         string `json:"next_hop,omitempty"`
	ResolvedNextHop string `json:"resolved_next_hop,omitempty"`
	OriginUUID      string `json:"origin_uuid,omitempty"`
}

type SandboxResolveResult struct {
	Matches         []SandboxMatch `json:"matches"`
	DevicesSearched int            `json:"devices_searched"`
	DebugLog        []string       `json:"debug_log"`
}

// SandboxResolveIP queries all devices to find which interfaces or routes match the requested IP.
func SandboxResolveIP(db *sql.DB, ipAddress string, deviceUUIDs []string) (*SandboxResolveResult, error) {
	result := &SandboxResolveResult{
		Matches:  make([]SandboxMatch, 0),
		DebugLog: make([]string, 0),
	}

	targetIP := net.ParseIP(ipAddress)
	if targetIP == nil {
		return nil, fmt.Errorf("invalid IP address format")
	}
	targetIP4 := targetIP.To4()
	result.DebugLog = append(result.DebugLog, fmt.Sprintf("Starting resolution for IP: %s", targetIP.String()))

	// 1. Fetch all managed devices (if no filter, fetch all)
	query := `SELECT d.device_uuid, d.name, d.id FROM managed_devices_raw d`
	var args []interface{}
	if len(deviceUUIDs) > 0 {
		placeholders := make([]string, len(deviceUUIDs))
		for i, id := range deviceUUIDs {
			placeholders[i] = "?"
			args = append(args, id)
		}
		query += fmt.Sprintf(" WHERE d.device_uuid IN (%s)", strings.Join(placeholders, ","))
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type device struct {
		uuid string
		name string
		id   int64
	}
	var devices []device
	for rows.Next() {
		var d device
		if err := rows.Scan(&d.uuid, &d.name, &d.id); err == nil {
			devices = append(devices, d)
		}
	}
	rows.Close()

	result.DevicesSearched = len(devices)
	result.DebugLog = append(result.DebugLog, fmt.Sprintf("Found %d devices matching scope criteria", len(devices)))

	// 2. For each device, resolve the path
	for _, dev := range devices {
		ancestry := GetScopeLineage(db, dev.uuid)
		vars := ResolveVariables(db, ancestry)

		match := resolveIPForDevice(db, targetIP4, dev.uuid, dev.name, ancestry, vars, 0, result)
		if match != nil {
			result.Matches = append(result.Matches, *match)
		}
	}

	return result, nil
}

func indexOf(slice []string, val string) int {
	for i, v := range slice {
		if v == val {
			return i
		}
	}
	return -1
}

func resolveIPForDevice(db *sql.DB, targetIP4 net.IP, devUUID, devName string, ancestry []string, vars map[string]string, depth int, result *SandboxResolveResult) *SandboxMatch {
	if depth > 5 {
		result.DebugLog = append(result.DebugLog, fmt.Sprintf("[%s] Recursive route lookup exceeded max depth for IP %s", devName, targetIP4.String()))
		return nil
	}

	// Build IN clause for ancestry
	placeholders := make([]string, len(ancestry))
	args := make([]interface{}, len(ancestry))
	for i, a := range ancestry {
		placeholders[i] = "?"
		args[i] = a
	}
	inClause := strings.Join(placeholders, ",")

	// 1. Direct Interfaces
	ifaceRows, err := db.Query(fmt.Sprintf(`
		SELECT i.name, i.ip_address, i.zone, i.vr_name, i.device_uuid 
		FROM interfaces i 
		WHERE i.device_uuid IN (%s)
	`, inClause), args...)

	if err != nil {
		if depth == 0 {
			result.DebugLog = append(result.DebugLog, fmt.Sprintf("[%s] Interface query failed: %v", devName, err))
		}
	} else {
		var bestIface *SandboxMatch
		var bestIfacePriority int = 9999

		for ifaceRows.Next() {
			var iName, iIP, iZone, iVR, iDeviceUUID sql.NullString
			ifaceRows.Scan(&iName, &iIP, &iZone, &iVR, &iDeviceUUID)

			if iIP.Valid && iIP.String != "" {
				resolvedIP := ApplyVariables(iIP.String, vars)
				if isIPInSubnet(targetIP4, resolvedIP) {
					// Priority: Lower is better. deviceUUID is at the END of ancestry array, so we invert the index.
					priority := len(ancestry) - indexOf(ancestry, iDeviceUUID.String)
					if priority < bestIfacePriority {
						bestIfacePriority = priority
						bestIface = &SandboxMatch{
							DeviceUUID:          devUUID,
							DeviceName:          devName,
							Type:                "Direct",
							Interface:           iName.String,
							InterfaceIP:         iIP.String,
							ResolvedInterfaceIP: resolvedIP,
							Zone:                iZone.String,
							VirtualRouter:       iVR.String,
							OriginUUID:          iDeviceUUID.String,
						}
					}
				}
			}
		}
		ifaceRows.Close()

		if bestIface != nil {
			if depth == 0 {
				result.DebugLog = append(result.DebugLog, fmt.Sprintf("[%s] Direct interface match found: %s", devName, bestIface.Interface))
			}
			return bestIface
		}
	}

	// 2. Routing Table
	routeRows, err := db.Query(fmt.Sprintf(`
		SELECT r.route_name, r.destination, r.interface, r.nexthop, r.vr_name, r.device_uuid, r.metric 
		FROM static_routes r 
		WHERE r.device_uuid IN (%s)
	`, inClause), args...)

	if err != nil {
		if depth == 0 {
			result.DebugLog = append(result.DebugLog, fmt.Sprintf("[%s] Route query failed: %v", devName, err))
		}
	} else {
		var bestRoute *SandboxMatch
		var maxPrefixLen int = -1
		var bestRoutePriority int = 9999
		var bestRouteMetric int = 9999
		var bestNextHop string

		for routeRows.Next() {
			var rName, rDest, rIface, rNextHop, rVR, rDeviceUUID sql.NullString
			var rMetric sql.NullInt64
			routeRows.Scan(&rName, &rDest, &rIface, &rNextHop, &rVR, &rDeviceUUID, &rMetric)

			if rDest.Valid && rDest.String != "" {
				resolvedDest := ApplyVariables(rDest.String, vars)
				if isIPInSubnet(targetIP4, resolvedDest) {
					// Determine prefix length
					_, ipNet, parseErr := net.ParseCIDR(resolvedDest)
					var prefixLen int
					if parseErr == nil {
						prefixLen, _ = ipNet.Mask.Size()
					} else if net.ParseIP(resolvedDest) != nil {
						prefixLen = 32 // Exact IP match
					}

					// Priority: Lower is better. deviceUUID is at the END of ancestry array, so we invert the index.
					priority := len(ancestry) - indexOf(ancestry, rDeviceUUID.String)
					metric := int(rMetric.Int64)
					if !rMetric.Valid {
						metric = 10
					}

					// We want Longest Prefix Match -> Lowest Priority (local override) -> Lowest Metric
					isBetter := false
					if prefixLen > maxPrefixLen {
						isBetter = true
					} else if prefixLen == maxPrefixLen {
						if priority < bestRoutePriority {
							isBetter = true
						} else if priority == bestRoutePriority {
							if metric < bestRouteMetric {
								isBetter = true
							}
						}
					}

					if isBetter {
						maxPrefixLen = prefixLen
						bestRoutePriority = priority
						bestRouteMetric = metric
						bestNextHop = rNextHop.String
						resolvedNextHop := ApplyVariables(bestNextHop, vars)
						isDefaultRoute := resolvedDest == "0.0.0.0/0" || resolvedDest == "::/0"

						bestRoute = &SandboxMatch{
							DeviceUUID:      devUUID,
							DeviceName:      devName,
							Type:            "Routed",
							RouteName:       rName.String,
							Interface:       rIface.String,
							Destination:     rDest.String,
							ResolvedDest:    resolvedDest,
							VirtualRouter:   rVR.String,
							IsDefaultRoute:  isDefaultRoute,
							NextHop:         bestNextHop,
							ResolvedNextHop: resolvedNextHop,
							OriginUUID:      rDeviceUUID.String,
						}
					}
				}
			}
		}
		routeRows.Close()

		if bestRoute != nil {
			// Resolve Zone and IP for the matched route interface
			if bestRoute.Interface != "" {
				var zone sql.NullString
				var ipAddr sql.NullString
				// Interface could be from anywhere in ancestry, try to find its zone. Ancestry is ordered top-down (templates -> device)
				for i := len(ancestry) - 1; i >= 0; i-- {
					errZone := db.QueryRow("SELECT zone, ip_address FROM interfaces WHERE name = ? AND device_uuid = ?", bestRoute.Interface, ancestry[i]).Scan(&zone, &ipAddr)
					if errZone == nil {
						if zone.Valid && zone.String != "" {
							bestRoute.Zone = zone.String
						}
						if ipAddr.Valid && ipAddr.String != "" {
							bestRoute.InterfaceIP = ipAddr.String
							bestRoute.ResolvedInterfaceIP = ApplyVariables(ipAddr.String, vars)
						}
						if bestRoute.Zone != "" && bestRoute.InterfaceIP != "" {
							break
						}
					}
				}
			} else if bestNextHop != "" {
				// Recursive Next Hop Resolution
				nextHopIP := net.ParseIP(bestNextHop)
				if nextHopIP != nil {
					if depth == 0 {
						result.DebugLog = append(result.DebugLog, fmt.Sprintf("[%s] Recursive route lookup for nexthop %s (from route %s)", devName, bestNextHop, bestRoute.RouteName))
					}
					recursiveMatch := resolveIPForDevice(db, nextHopIP.To4(), devUUID, devName, ancestry, vars, depth+1, result)
					if recursiveMatch != nil {
						bestRoute.Interface = recursiveMatch.Interface
						bestRoute.Zone = recursiveMatch.Zone
					} else {
						if depth == 0 {
							result.DebugLog = append(result.DebugLog, fmt.Sprintf("[%s] Nexthop %s is unreachable", devName, bestNextHop))
						}
					}
				}
			}

			if depth == 0 {
				result.DebugLog = append(result.DebugLog, fmt.Sprintf("[%s] Routing table match found: %s -> %s (Prefix /%d, Nexthop: %s)", devName, bestRoute.RouteName, bestRoute.Interface, maxPrefixLen, bestNextHop))
			}
			return bestRoute
		}
	}

	return nil
}

// isIPInSubnet checks if a target IPv4 address falls within a given CIDR or raw IP string
func isIPInSubnet(targetIP net.IP, subnetStr string) bool {
	if targetIP == nil {
		return false
	}
	
	// Handle raw IP without CIDR
	if net.ParseIP(subnetStr) != nil {
		return targetIP.Equal(net.ParseIP(subnetStr))
	}

	_, ipNet, err := net.ParseCIDR(subnetStr)
	if err != nil {
		return false
	}
	
	return ipNet.Contains(targetIP)
}

func toJSONStringArray(arr []string) string {
	b, _ := json.Marshal(arr)
	return string(b)
}
