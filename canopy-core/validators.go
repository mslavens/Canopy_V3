package main

import (
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
)

func validateObjectName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("name cannot be empty")
	}
	matched, _ := regexp.MatchString(`^[a-zA-Z0-9_\-\.]+$`, name)
	if !matched {
		return fmt.Errorf("name contains illegal characters; only alphanumeric, underscores, hyphens, and dots are allowed")
	}
	return nil
}
func validateAddressValue(addrType, value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("value cannot be empty")
	}
	switch addrType {
	case "ip-netmask":
		if _, _, err := net.ParseCIDR(value); err == nil {
			return nil
		}
		if ip := net.ParseIP(value); ip != nil {
			return nil
		}
		return fmt.Errorf("invalid IP address or netmask CIDR format: %s", value)
	case "ip-range":
		parts := strings.Split(value, "-")
		if len(parts) != 2 {
			return fmt.Errorf("invalid IP range format; must be <start-ip>-<end-ip>")
		}
		ipStart := net.ParseIP(strings.TrimSpace(parts[0]))
		ipEnd := net.ParseIP(strings.TrimSpace(parts[1]))
		if ipStart == nil || ipEnd == nil {
			return fmt.Errorf("invalid IP address in range: %s", value)
		}
		if (ipStart.To4() != nil) != (ipEnd.To4() != nil) {
			return fmt.Errorf("IP range start and end must be of the same IP family (IPv4 or IPv6)")
		}
		return nil
	case "fqdn":
		matched, _ := regexp.MatchString(`^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$`, value)
		if !matched {
			return fmt.Errorf("invalid FQDN / hostname format: %s", value)
		}
		return nil
	default:
		return fmt.Errorf("unsupported address type: %s", addrType)
	}
}
func validatePorts(ports string) error {
	ports = strings.TrimSpace(ports)
	if ports == "" {
		return nil
	}
	parts := strings.Split(ports, ",")
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			return fmt.Errorf("empty port element in list")
		}
		if strings.Contains(p, "-") {
			rangeParts := strings.Split(p, "-")
			if len(rangeParts) != 2 {
				return fmt.Errorf("invalid port range: %s", p)
			}
			startVal, err1 := strconv.Atoi(strings.TrimSpace(rangeParts[0]))
			endVal, err2 := strconv.Atoi(strings.TrimSpace(rangeParts[1]))
			if err1 != nil || err2 != nil || startVal < 1 || startVal > 65535 || endVal < 1 || endVal > 65535 || startVal > endVal {
				return fmt.Errorf("invalid port range values: %s", p)
			}
		} else {
			val, err := strconv.Atoi(p)
			if err != nil || val < 1 || val > 65535 {
				return fmt.Errorf("invalid port number: %s", p)
			}
		}
	}
	return nil
}
