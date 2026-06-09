package engine

import (
	"database/sql"
	"errors"
	"fmt"
	"net"
)

// CanopyIntentPayload represents a platform-blind network transit chain calculation.
type CanopyIntentPayload struct {
	SourceIP          string   `json:"source_ip"`
	DestinationIP     string   `json:"destination_ip"`
	IngressDeviceUUID string   `json:"ingress_device_uuid"`
	EgressDeviceUUID  string   `json:"egress_device_uuid"`
	HopDeviceUUIDs    []string `json:"hop_device_uuids"`
}

// FindPath maps the Source and Destination IPs to their governing network_topology interfaces
// via bitwise subnet masking, subsequently resolving the matching transit device chain.
func FindPath(db *sql.DB, sourceIP, destIP string) (CanopyIntentPayload, error) {
	payload := CanopyIntentPayload{
		SourceIP:       sourceIP,
		DestinationIP:  destIP,
		HopDeviceUUIDs: make([]string, 0),
	}

	// Parse IPs to native representations for bitwise comparison
	src := net.ParseIP(sourceIP)
	if src == nil {
		return payload, fmt.Errorf("invalid source IP address provided: %s", sourceIP)
	}

	dst := net.ParseIP(destIP)
	if dst == nil {
		return payload, fmt.Errorf("invalid destination IP address provided: %s", destIP)
	}

	// Query the interface layout (Scalable Parallel Read from SQLite)
	rows, err := db.Query("SELECT device_uuid, network_cidr FROM network_topology")
	if err != nil {
		return payload, fmt.Errorf("failed to query network topology: %w", err)
	}
	defer rows.Close()

	var ingressMatch, egressMatch string

	for rows.Next() {
		var deviceUUID, networkCIDR string
		if err := rows.Scan(&deviceUUID, &networkCIDR); err != nil {
			return payload, fmt.Errorf("failed to scan topology row: %w", err)
		}

		// Decode the subnet block to access native masking capabilities
		_, subnet, err := net.ParseCIDR(networkCIDR)
		if err != nil {
			continue // Skip malformed configurations silently
		}

		// Evaluate bitwise intersection to determine ingress and egress control
		if subnet.Contains(src) {
			ingressMatch = deviceUUID
		}
		if subnet.Contains(dst) {
			egressMatch = deviceUUID
		}
	}

	if err := rows.Err(); err != nil {
		return payload, fmt.Errorf("error iterating topology rows: %w", err)
	}

	if ingressMatch == "" || egressMatch == "" {
		return payload, errors.New("incomplete path: unable to resolve both ingress and egress interfaces within the current topology")
	}

	payload.IngressDeviceUUID = ingressMatch
	payload.EgressDeviceUUID = egressMatch

	// Construct the hop chain. If ingress and egress reside on the same device, it's a single intra-device hop.
	if ingressMatch == egressMatch {
		payload.HopDeviceUUIDs = []string{ingressMatch}
	} else {
		// Inter-device routing boundary calculation
		payload.HopDeviceUUIDs = []string{ingressMatch, egressMatch}
	}

	return payload, nil
}
