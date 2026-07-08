package paloalto

import (
	"database/sql"
	"fmt"
	"strings"

	pluginRegistry "canopy-core/adapters/registry"
)

type Plugin struct{}

func init() {
	pluginRegistry.Register(&Plugin{})
}

func (p *Plugin) GetVendorID() string {
	return "paloalto"
}

func (p *Plugin) ParseConfig(tx *sql.Tx, fileContent []byte) error {
	// Future implementation
	return nil
}

func (p *Plugin) GenerateAddressObjectCLI(scopePrefix, name, addrType, value, description string, tags []string) []string {
	var cmds []string
	
	// Create tag string
	tagStr := ""
	if len(tags) > 0 {
		tagStr = fmt.Sprintf(" tag [ %s ]", strings.Join(tags, " "))
	}

	cmds = append(cmds, fmt.Sprintf("%s address %s %s %s%s", scopePrefix, name, addrType, value, tagStr))
	if description != "" {
		cmds = append(cmds, fmt.Sprintf(`%s address %s description "%s"`, scopePrefix, name, description))
	}

	return cmds
}

func (p *Plugin) GenerateAddressGroupCLI(scopePrefix, name, grpType, filter string, members []string, description string, tags []string) []string {
	var cmds []string
	
	// Create tag string
	tagStr := ""
	if len(tags) > 0 {
		tagStr = fmt.Sprintf(" tag [ %s ]", strings.Join(tags, " "))
	}

	if grpType == "static" {
		cmds = append(cmds, fmt.Sprintf("%s address-group %s static [ %s ]%s", scopePrefix, name, strings.Join(members, " "), tagStr))
		if description != "" {
			cmds = append(cmds, fmt.Sprintf(`%s address-group %s description "%s"`, scopePrefix, name, description))
		}
	} else {
		cmds = append(cmds, fmt.Sprintf(`%s address-group %s dynamic filter "%s"%s`, scopePrefix, name, filter, tagStr))
		if description != "" {
			cmds = append(cmds, fmt.Sprintf(`%s address-group %s description "%s"`, scopePrefix, name, description))
		}
	}

	return cmds
}
