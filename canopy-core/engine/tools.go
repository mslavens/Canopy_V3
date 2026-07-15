package engine

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
)

type SandboxMatch struct {
	DeviceUUID string `json:"device_uuid"`
	DeviceName string `json:"device_name"`
	Type       string `json:"type"`      // "Direct Interface" or "Routing Table"
	Interface  string `json:"interface"` // The name of the interface
	RouteName  string `json:"route_name,omitempty"`
	Zone       string `json:"zone"`
	VirtualRouter string `json:"virtual_router"`
}

type SandboxResolveResult struct {
	Matches []SandboxMatch `json:"matches"`
}

// SandboxResolveIP queries all devices to find which interfaces or routes match the requested IP.
func SandboxResolveIP(db *sql.DB, ipAddress string, deviceUUIDFilter string) (*SandboxResolveResult, error) {
	result := &SandboxResolveResult{
		Matches: make([]SandboxMatch, 0),
	}

	targetIP := net.ParseIP(ipAddress)
	if targetIP == nil {
		return nil, fmt.Errorf("invalid IP address format")
	}
	targetIP4 := targetIP.To4()

	// 1. Fetch all managed devices (if no filter, fetch all)
	query := `SELECT d.device_uuid, d.name, d.id FROM managed_devices_raw d`
	var args []interface{}
	if deviceUUIDFilter != "" {
		query += ` WHERE d.device_uuid = ?`
		args = append(args, deviceUUIDFilter)
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

	// 2. For each device, resolve the path
	for _, dev := range devices {
		ancestry := GetScopeLineage(db, dev.uuid)
		vars := ResolveVariables(db, ancestry)

		// First, check local interfaces directly
		// Interfaces are attached to the device or its templates
		ifaceRows, err := db.Query(`
			SELECT i.name, i.ip_address, i.zone, i.virtual_router 
			FROM network_interfaces i 
			WHERE i.device_uuid IN (SELECT value FROM json_each(?))
		`, toJSONStringArray(ancestry))

		if err == nil {
			for ifaceRows.Next() {
				var iName, iIP, iZone, iVR sql.NullString
				ifaceRows.Scan(&iName, &iIP, &iZone, &iVR)
				
				if iIP.Valid && iIP.String != "" {
					resolvedIP := ApplyVariables(iIP.String, vars)
					if isIPInSubnet(targetIP4, resolvedIP) {
						result.Matches = append(result.Matches, SandboxMatch{
							DeviceUUID:    dev.uuid,
							DeviceName:    dev.name,
							Type:          "Direct (Local Interface)",
							Interface:     iName.String,
							Zone:          iZone.String,
							VirtualRouter: iVR.String,
						})
						goto NextDevice // Found direct interface, skip routing table for this device
					}
				}
			}
			ifaceRows.Close()
		}

		// Second, check routing table
		{
			routeRows, err := db.Query(`
				SELECT r.name, r.destination, r.interface, r.virtual_router 
				FROM routes r 
				WHERE r.device_uuid IN (SELECT value FROM json_each(?))
			`, toJSONStringArray(ancestry))

			if err == nil {
				// We need to find the most specific route match
				var bestMatch *SandboxMatch
				var maxPrefixLen int = -1

				for routeRows.Next() {
					var rName, rDest, rIface, rVR sql.NullString
					routeRows.Scan(&rName, &rDest, &rIface, &rVR)

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

							if prefixLen > maxPrefixLen {
								maxPrefixLen = prefixLen
								
								// Resolve zone from interface
								var zone string
								db.QueryRow(`
									SELECT zone FROM network_interfaces 
									WHERE name = ? AND device_uuid IN (SELECT value FROM json_each(?))
								`, rIface.String, toJSONStringArray(ancestry)).Scan(&zone)

								bestMatch = &SandboxMatch{
									DeviceUUID:    dev.uuid,
									DeviceName:    dev.name,
									Type:          "Routing Table",
									Interface:     rIface.String,
									RouteName:     rName.String,
									Zone:          zone,
									VirtualRouter: rVR.String,
								}
							}
						}
					}
				}
				routeRows.Close()

				if bestMatch != nil {
					result.Matches = append(result.Matches, *bestMatch)
				}
			}
		}

	NextDevice:
	}

	return result, nil
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
