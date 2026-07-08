package cisco

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
	return "cisco"
}

func (p *Plugin) ParseConfig(tx *sql.Tx, fileContent []byte) error {
	// Future implementation
	return nil
}

func (p *Plugin) GenerateAddressObjectCLI(scopePrefix, name, addrType, value, description string, tags []string) []string {
	var cmds []string

	cmds = append(cmds, fmt.Sprintf("object network %s", name))
	if addrType == "ip-netmask" {
		parts := strings.Split(value, "/")
		if len(parts) == 2 {
			cmds = append(cmds, fmt.Sprintf("    subnet %s %s", parts[0], parts[1]))
		} else {
			cmds = append(cmds, fmt.Sprintf("    host %s", value))
		}
	} else if addrType == "fqdn" {
		cmds = append(cmds, fmt.Sprintf("    fqdn %s", value))
	}
	if description != "" {
		cmds = append(cmds, fmt.Sprintf(`    description "%s"`, description))
	}

	return cmds
}

func (p *Plugin) GenerateAddressGroupCLI(scopePrefix, name, grpType, filter string, members []string, description string, tags []string) []string {
	var cmds []string

	if grpType == "static" {
		cmds = append(cmds, fmt.Sprintf("object-group network %s", name))
		if description != "" {
			cmds = append(cmds, fmt.Sprintf(`    description "%s"`, description))
		}
		for _, m := range members {
			cmds = append(cmds, fmt.Sprintf("    network-object object %s", strings.Trim(m, `"`)))
		}
	}

	return cmds
}
