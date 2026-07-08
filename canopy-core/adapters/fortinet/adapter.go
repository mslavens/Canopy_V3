package fortinet

import (
	"database/sql"
	"fmt"
	"strings"

	"canopy-core/adapters/registry"
)

type Plugin struct{}

func init() {
	registry.Register(&Plugin{})
}

func (p *Plugin) GetVendorID() string {
	return "fortinet"
}

func (p *Plugin) ParseConfig(tx *sql.Tx, fileContent []byte) error {
	// Future implementation
	return nil
}

func (p *Plugin) GenerateAddressObjectCLI(scopePrefix, name, addrType, value, description string, tags []string) []string {
	var cmds []string

	cmds = append(cmds, "config firewall address", fmt.Sprintf(`    edit "%s"`, name))
	if addrType == "ip-netmask" {
		cmds = append(cmds, "        set type ipmask", fmt.Sprintf("        set subnet %s", value))
	} else if addrType == "fqdn" {
		cmds = append(cmds, "        set type fqdn", fmt.Sprintf("        set fqdn %s", value))
	} else if addrType == "ip-range" {
		parts := strings.Split(value, "-")
		if len(parts) == 2 {
			cmds = append(cmds, "        set type iprange", fmt.Sprintf("        set start-ip %s", parts[0]), fmt.Sprintf("        set end-ip %s", parts[1]))
		}
	}
	if description != "" {
		cmds = append(cmds, fmt.Sprintf(`        set comment "%s"`, description))
	}
	cmds = append(cmds, "    next", "end")

	return cmds
}

func (p *Plugin) GenerateAddressGroupCLI(scopePrefix, name, grpType, filter string, members []string, description string, tags []string) []string {
	var cmds []string

	if grpType == "static" {
		var formattedMembers []string
		for _, m := range members {
			formattedMembers = append(formattedMembers, fmt.Sprintf(`"%s"`, m))
		}

		cmds = append(cmds, "config firewall addrgrp", fmt.Sprintf(`    edit "%s"`, name))
		if len(formattedMembers) > 0 {
			cmds = append(cmds, fmt.Sprintf(`        set member %s`, strings.Join(formattedMembers, " ")))
		}
		if description != "" {
			cmds = append(cmds, fmt.Sprintf(`        set comment "%s"`, description))
		}
		cmds = append(cmds, "    next", "end")
	}

	return cmds
}
