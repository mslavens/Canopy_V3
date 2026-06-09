package paloalto

import (
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"strings"

	"canopy-core/storage"
)

// Adapter provides a structural ingestion bridge for Palo Alto configurations.
type Adapter struct {
	store *storage.AppStateDB
}

// NewAdapter initializes a new Palo Alto parser adapter with the provided storage engine.
func NewAdapter(store *storage.AppStateDB) *Adapter {
	return &Adapter{
		store: store,
	}
}

// VendorMetadata structure for the JSON blob column.
type VendorMetadata struct {
	VirtualRouter string   `json:"vr"`
	Tags          []string `json:"tags,omitempty"`
}

// XML entry structs
type XMLAddressEntry struct {
	Name        string `xml:"name,attr"`
	IPNetmask   string `xml:"ip-netmask"`
	IPRange     string `xml:"ip-range"`
	FQDN        string `xml:"fqdn"`
	Description string `xml:"description"`
}

type XMLAddressGroupEntry struct {
	Name        string   `xml:"name,attr"`
	Static      []string `xml:"static>member"`
	Description string   `xml:"description"`
}

type XMLServiceEntry struct {
	Name        string `xml:"name,attr"`
	TCP         *struct {
		Port       string `xml:"port"`
		SourcePort string `xml:"source-port"`
	} `xml:"protocol>tcp"`
	UDP         *struct {
		Port       string `xml:"port"`
		SourcePort string `xml:"source-port"`
	} `xml:"protocol>udp"`
	Description string `xml:"description"`
}

type XMLServiceGroupEntry struct {
	Name        string   `xml:"name,attr"`
	Members     []string `xml:"members>member"`
	Description string   `xml:"description"`
}

type XMLSecurityRuleEntry struct {
	Name        string   `xml:"name,attr"`
	From        []string `xml:"from>member"`
	To          []string `xml:"to>member"`
	Source      []string `xml:"source>member"`
	Destination []string `xml:"destination>member"`
	Service     []string `xml:"service>member"`
	Application []string `xml:"application>member"`
	Action      string   `xml:"action"`
	Disabled    string   `xml:"disabled"`
	Description string   `xml:"description"`
}

type XMLNATRuleEntry struct {
	Name        string   `xml:"name,attr"`
	From        []string `xml:"from>member"`
	To          []string `xml:"to>member"`
	Source      []string `xml:"source>member"`
	Destination []string `xml:"destination>member"`
	Service     string   `xml:"service"`
	Disabled    string   `xml:"disabled"`
	Description string   `xml:"description"`

	SourceTranslation struct {
		DynamicIPPort *struct {
			TranslatedAddress []string `xml:"translated-address>member"`
		} `xml:"dynamic-ip-port"`
		StaticIP *struct {
			TranslatedAddress string `xml:"translated-address"`
		} `xml:"static-ip"`
	} `xml:"source-translation"`

	DestinationTranslation struct {
		TranslatedAddress string `xml:"translated-address"`
		TranslatedPort    string `xml:"translated-port"`
	} `xml:"destination-translation"`
}

type XMLStaticRouteEntry struct {
	Name        string `xml:"name,attr"`
	Destination string `xml:"destination"`
	Interface   string `xml:"interface"`
	Nexthop     struct {
		IPAddress string `xml:"ip-address"`
	} `xml:"nexthop"`
	Metric      int    `xml:"metric"`
}

type XMLTagEntry struct {
	Name     string `xml:"name,attr"`
	Color    string `xml:"color"`
	Comments string `xml:"comments"`
}

type XMLProfiles struct {
	URLFiltering []struct {
		Name string `xml:"name,attr"`
	} `xml:"url-filtering>entry"`
	Antivirus []struct {
		Name string `xml:"name,attr"`
	} `xml:"antivirus>entry"`
	Vulnerability []struct {
		Name string `xml:"name,attr"`
	} `xml:"vulnerability>entry"`
	AntiSpyware []struct {
		Name string `xml:"name,attr"`
	} `xml:"spyware>entry"`
	WildFire []struct {
		Name string `xml:"name,attr"`
	} `xml:"wildfire-analysis>entry"`
	FileBlocking []struct {
		Name string `xml:"name,attr"`
	} `xml:"file-blocking>entry"`
}

// Structure groups
type XMLRulebase struct {
	SecurityRules []XMLSecurityRuleEntry `xml:"security>rules>entry"`
	NATRules      []XMLNATRuleEntry      `xml:"nat>rules>entry"`
}

type XMLDeviceGroup struct {
	Name         string                 `xml:"name,attr"`
	Parent       string                 `xml:"parent,attr"`
	Address      []XMLAddressEntry      `xml:"address>entry"`
	AddressGroup []XMLAddressGroupEntry `xml:"address-group>entry"`
	Service      []XMLServiceEntry      `xml:"service>entry"`
	ServiceGroup []XMLServiceGroupEntry `xml:"service-group>entry"`
	PreRulebase  XMLRulebase            `xml:"pre-rulebase"`
	PostRulebase XMLRulebase            `xml:"post-rulebase"`
	Tags         []XMLTagEntry          `xml:"tag>entry"`
	Profiles     XMLProfiles            `xml:"profiles"`
	Devices      []struct {
		Name string `xml:"name,attr"`
	} `xml:"devices>entry"`
}

// Interface, VR, Zone definitions (network settings inside templates/standalone)
type InterfaceNode struct {
	Name string `xml:"name,attr"`
	IPs  []struct {
		Name string `xml:"name,attr"`
	} `xml:"layer3>ip>entry"`
}

type ZoneNode struct {
	Name    string `xml:"name,attr"`
	Network struct {
		Layer3 struct {
			Members []string `xml:"member"`
		} `xml:"layer3"`
	} `xml:"network"`
}

type VirtualRouterNode struct {
	Name       string `xml:"name,attr"`
	Interfaces struct {
		Members []string `xml:"member"`
	} `xml:"interface"`
	StaticRoutes []XMLStaticRouteEntry `xml:"routing-table>ip>static-route>entry"`
}

type XMLTemplate struct {
	Name   string `xml:"name,attr"`
	Config struct {
		Devices []struct {
			Name    string `xml:"name,attr"`
			Network struct {
				Interface struct {
					Ethernet []InterfaceNode `xml:"ethernet>entry"`
				} `xml:"interface"`
				VirtualRouter []VirtualRouterNode `xml:"virtual-router>entry"`
			} `xml:"network"`
			Vsys []struct {
				Name string     `xml:"name,attr"`
				Zone []ZoneNode `xml:"zone>entry"`
			} `xml:"vsys>entry"`
		} `xml:"devices>entry"`
	} `xml:"config"`
}

type XMLTemplateStack struct {
	Name      string   `xml:"name,attr"`
	Templates []string `xml:"templates>member"`
	Devices   []string `xml:"devices>member"`
	DevicesEntries []struct {
		Name string `xml:"name,attr"`
	} `xml:"devices>entry"`
}

type XMLDeviceConfig struct {
	System struct {
		IPAddress    string `xml:"ip-address"`
		IP           string `xml:"ip"`
		Hostname     string `xml:"hostname"`
		Serial       string `xml:"serial"`
		SerialNumber string `xml:"serial-number"`
	} `xml:"system"`
}

type XMLManagedDeviceEntry struct {
	Serial        string `xml:"name,attr"`
	IPAddress     string `xml:"ip-address"`
	IP            string `xml:"ip"`
	Hostname      string `xml:"hostname"`
	TemplateStack string `xml:"template-stack"`
	Template      string `xml:"template"`
}

type XMLMgtConfig struct {
	Devices []XMLManagedDeviceEntry `xml:"devices>entry"`
}

type XMLReadOnly struct {
	Devices []XMLManagedDeviceEntry `xml:"devices>entry"`
}

// Unified PaloAltoConfig representing the full XML root
type PaloAltoConfig struct {
	XMLName        xml.Name           `xml:"config"`
	Templates      []XMLTemplate      `xml:"template>entry"`
	TemplateStacks []XMLTemplateStack `xml:"template-stack>entry"`
	MgtConfig      *XMLMgtConfig      `xml:"mgt-config"`
	ReadOnly       *XMLReadOnly       `xml:"readonly"`
	DeviceConfig   *XMLDeviceConfig   `xml:"deviceconfig"`
	
	// Shared Configuration (Panorama or Standalone Global)
	Shared struct {
		Address        []XMLAddressEntry       `xml:"address>entry"`
		AddressGroup   []XMLAddressGroupEntry  `xml:"address-group>entry"`
		Service        []XMLServiceEntry       `xml:"service>entry"`
		ServiceGroup   []XMLServiceGroupEntry  `xml:"service-group>entry"`
		PreRulebase    XMLRulebase             `xml:"pre-rulebase"`
		PostRulebase   XMLRulebase             `xml:"post-rulebase"`
		Tags           []XMLTagEntry           `xml:"tag>entry"`
		Profiles       XMLProfiles             `xml:"profiles"`
		ManagedDevices []XMLManagedDeviceEntry `xml:"managed-devices>entry"`
	} `xml:"shared"`
	
	// Device Groups (Panorama)
	DeviceGroups []XMLDeviceGroup `xml:"device-group>entry"`
	
	// Standalone Firewall local Devices
	Devices []struct {
		Name           string             `xml:"name,attr"`
		Templates      []XMLTemplate      `xml:"template>entry"`
		TemplateStacks []XMLTemplateStack `xml:"template-stack>entry"`
		DeviceGroups   []XMLDeviceGroup   `xml:"device-group>entry"`
		DeviceConfig   *XMLDeviceConfig   `xml:"deviceconfig"`
		Network struct {
			Interface struct {
				Ethernet []InterfaceNode `xml:"ethernet>entry"`
			} `xml:"interface"`
			VirtualRouter []VirtualRouterNode `xml:"virtual-router>entry"`
		} `xml:"network"`
		Vsys []struct {
			Name          string                 `xml:"name,attr"`
			Zone          []ZoneNode             `xml:"zone>entry"`
			Address       []XMLAddressEntry      `xml:"address>entry"`
			AddressGroup  []XMLAddressGroupEntry `xml:"address-group>entry"`
			Service       []XMLServiceEntry      `xml:"service>entry"`
			ServiceGroup  []XMLServiceGroupEntry `xml:"service-group>entry"`
			SecurityRules []XMLSecurityRuleEntry `xml:"rulebase>security>rules>entry"`
			NATRules      []XMLNATRuleEntry      `xml:"rulebase>nat>rules>entry"`
			Tags          []XMLTagEntry          `xml:"tag>entry"`
			Profiles      XMLProfiles            `xml:"profiles"`
		} `xml:"vsys>entry"`
	} `xml:"devices>entry"`
}

// IngestionStats holds parsed metrics for pre-flight import preview.
type IngestionStats struct {
	ConfigType          string   `json:"config_type"`
	Devices             []string `json:"devices"`
	TemplatesCount      int      `json:"templates_count"`
	DevicesCount        int      `json:"devices_count"`
	InterfacesCount     int      `json:"interfaces_count"`
	ZonesCount          int      `json:"zones_count"`
	VirtualRoutersCount int      `json:"virtual_routers_count"`
}

func parseFirewallFilename(filename string) (string, string) {
	if filename == "" {
		return "", ""
	}
	base := filename
	if idx := strings.LastIndex(base, "/"); idx != -1 {
		base = base[idx+1:]
	}
	if idx := strings.LastIndex(base, "\\"); idx != -1 {
		base = base[idx+1:]
	}
	base = strings.TrimSuffix(base, ".xml")
	base = strings.TrimSuffix(base, ".XML")

	idx := strings.LastIndex(base, "_")
	if idx == -1 {
		return base, ""
	}
	fwName := base[:idx]
	serial := base[idx+1:]
	return fwName, serial
}

// Analyze parses the XML configuration and extracts stats for pre-flight preview.
func (a *Adapter) Analyze(xmlData []byte, filename string) (*IngestionStats, error) {
	var config PaloAltoConfig
	if err := xml.Unmarshal(xmlData, &config); err != nil {
		return nil, fmt.Errorf("failed to unmarshal Palo Alto config: %w", err)
	}

	allTemplates := append([]XMLTemplate{}, config.Templates...)
	allTemplateStacks := append([]XMLTemplateStack{}, config.TemplateStacks...)
	allDeviceGroups := append([]XMLDeviceGroup{}, config.DeviceGroups...)

	for _, dev := range config.Devices {
		allTemplates = append(allTemplates, dev.Templates...)
		allTemplateStacks = append(allTemplateStacks, dev.TemplateStacks...)
		allDeviceGroups = append(allDeviceGroups, dev.DeviceGroups...)
	}

	stats := &IngestionStats{
		Devices: []string{},
	}

	// Determine if this is a Panorama export or Standalone Firewall config
	hasMgtDevices := len(config.Shared.ManagedDevices) > 0 || (config.MgtConfig != nil && len(config.MgtConfig.Devices) > 0) || (config.ReadOnly != nil && len(config.ReadOnly.Devices) > 0)
	hasShared := len(config.Shared.Address) > 0 || len(config.Shared.AddressGroup) > 0 || len(config.Shared.Service) > 0 || len(config.Shared.PreRulebase.SecurityRules) > 0 || len(config.Shared.PostRulebase.SecurityRules) > 0 || hasMgtDevices
	isPanorama := len(allTemplates) > 0 || len(allDeviceGroups) > 0 || len(allTemplateStacks) > 0 || hasShared

	if isPanorama {
		stats.ConfigType = "Panorama"
		stats.TemplatesCount = len(allTemplates)

		// 1. Process templates
		for _, tmpl := range allTemplates {
			stats.Devices = append(stats.Devices, tmpl.Name)
			stats.DevicesCount += len(tmpl.Config.Devices)
			for _, dev := range tmpl.Config.Devices {
				for _, vsys := range dev.Vsys {
					stats.ZonesCount += len(vsys.Zone)
				}
				stats.VirtualRoutersCount += len(dev.Network.VirtualRouter)
				for _, eth := range dev.Network.Interface.Ethernet {
					stats.InterfacesCount += len(eth.IPs)
				}
			}
		}

		// 2. Process device groups
		for _, dg := range allDeviceGroups {
			dgName := dg.Name + " (Device Group)"
			stats.Devices = append(stats.Devices, dgName)
		}
	} else {
		// Standalone Firewall
		stats.ConfigType = "Firewall"
		stats.DevicesCount = len(config.Devices)

		for _, dev := range config.Devices {
			name := dev.Name
			if name == "" || name == "localhost.localdomain" {
				name = "standalone-firewall"
			}
			fwName, _ := parseFirewallFilename(filename)
			if fwName != "" {
				name = fwName
			}
			stats.Devices = append(stats.Devices, name)

			for _, vsys := range dev.Vsys {
				stats.ZonesCount += len(vsys.Zone)
			}
			stats.VirtualRoutersCount += len(dev.Network.VirtualRouter)
			for _, eth := range dev.Network.Interface.Ethernet {
				stats.InterfacesCount += len(eth.IPs)
			}
		}
	}

	return stats, nil
}

// Helper to clear existing tables for a given device_uuid
func clearDeviceTables(tx *sql.Tx, deviceUUID string) {
	tx.Exec("DELETE FROM network_topology WHERE device_uuid = ?", deviceUUID)
	tx.Exec("DELETE FROM address_group_members WHERE group_id IN (SELECT id FROM address_groups WHERE device_uuid = ?)", deviceUUID)
	tx.Exec("DELETE FROM address_groups WHERE device_uuid = ?", deviceUUID)
	tx.Exec("DELETE FROM address_objects WHERE device_uuid = ?", deviceUUID)
	tx.Exec("DELETE FROM service_group_members WHERE group_id IN (SELECT id FROM service_groups WHERE device_uuid = ?)", deviceUUID)
	tx.Exec("DELETE FROM service_groups WHERE device_uuid = ?", deviceUUID)
	tx.Exec("DELETE FROM service_objects WHERE device_uuid = ?", deviceUUID)
	tx.Exec("DELETE FROM security_rules WHERE device_uuid = ?", deviceUUID)
	tx.Exec("DELETE FROM nat_rules WHERE device_uuid = ?", deviceUUID)
	tx.Exec("DELETE FROM static_routes WHERE device_uuid = ?", deviceUUID)
	tx.Exec("DELETE FROM tags WHERE device_uuid = ?", deviceUUID)
	tx.Exec("DELETE FROM security_profiles WHERE device_uuid = ?", deviceUUID)
	tx.Exec("DELETE FROM template_stack_members WHERE stack_id IN (SELECT id FROM template_stacks WHERE device_uuid = ?)", deviceUUID)
	tx.Exec("DELETE FROM template_stacks WHERE device_uuid = ?", deviceUUID)
	tx.Exec("DELETE FROM managed_devices WHERE device_uuid = ?", deviceUUID)
}

func insertAddressObjects(tx *sql.Tx, deviceUUID, scope string, entries []XMLAddressEntry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO address_objects (device_uuid, scope, name, type, value, description)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range entries {
		addrType := ""
		addrVal := ""
		if entry.IPNetmask != "" {
			addrType = "ip-netmask"
			addrVal = entry.IPNetmask
		} else if entry.IPRange != "" {
			addrType = "ip-range"
			addrVal = entry.IPRange
		} else if entry.FQDN != "" {
			addrType = "fqdn"
			addrVal = entry.FQDN
		}
		if addrType == "" {
			continue // skip empty
		}
		if _, err := stmt.Exec(deviceUUID, scope, entry.Name, addrType, addrVal, entry.Description); err != nil {
			return err
		}
	}
	return nil
}

func insertAddressGroups(tx *sql.Tx, deviceUUID, scope string, entries []XMLAddressGroupEntry) error {
	groupStmt, err := tx.Prepare(`
		INSERT INTO address_groups (device_uuid, scope, name, description)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer groupStmt.Close()

	memberStmt, err := tx.Prepare(`
		INSERT OR IGNORE INTO address_group_members (group_id, member_name)
		VALUES (?, ?)
	`)
	if err != nil {
		return err
	}
	defer memberStmt.Close()

	for _, entry := range entries {
		res, err := groupStmt.Exec(deviceUUID, scope, entry.Name, entry.Description)
		if err != nil {
			return err
		}
		groupID, err := res.LastInsertId()
		if err != nil {
			return err
		}
		for _, member := range entry.Static {
			if _, err := memberStmt.Exec(groupID, member); err != nil {
				return err
			}
		}
	}
	return nil
}

func insertServiceObjects(tx *sql.Tx, deviceUUID, scope string, entries []XMLServiceEntry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO service_objects (device_uuid, scope, name, protocol, source_port, destination_port, description)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range entries {
		var proto, srcPort, destPort string
		if entry.TCP != nil {
			proto = "tcp"
			srcPort = entry.TCP.SourcePort
			destPort = entry.TCP.Port
		} else if entry.UDP != nil {
			proto = "udp"
			srcPort = entry.UDP.SourcePort
			destPort = entry.UDP.Port
		} else {
			continue
		}
		if _, err := stmt.Exec(deviceUUID, scope, entry.Name, proto, srcPort, destPort, entry.Description); err != nil {
			return err
		}
	}
	return nil
}

func insertServiceGroups(tx *sql.Tx, deviceUUID, scope string, entries []XMLServiceGroupEntry) error {
	groupStmt, err := tx.Prepare(`
		INSERT INTO service_groups (device_uuid, scope, name, description)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer groupStmt.Close()

	memberStmt, err := tx.Prepare(`
		INSERT OR IGNORE INTO service_group_members (group_id, member_name)
		VALUES (?, ?)
	`)
	if err != nil {
		return err
	}
	defer memberStmt.Close()

	for _, entry := range entries {
		res, err := groupStmt.Exec(deviceUUID, scope, entry.Name, entry.Description)
		if err != nil {
			return err
		}
		groupID, err := res.LastInsertId()
		if err != nil {
			return err
		}
		for _, member := range entry.Members {
			if _, err := memberStmt.Exec(groupID, member); err != nil {
				return err
			}
		}
	}
	return nil
}

func insertSecurityRules(tx *sql.Tx, deviceUUID, scope string, entries []XMLSecurityRuleEntry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO security_rules (device_uuid, scope, rule_name, description, action, disabled, from_zones, to_zones, source_addresses, destination_addresses, services, applications)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range entries {
		disabled := 0
		if strings.ToLower(entry.Disabled) == "yes" || entry.Disabled == "true" {
			disabled = 1
		}
		action := entry.Action
		if action == "" {
			action = "allow"
		}
		_, err := stmt.Exec(
			deviceUUID,
			scope,
			entry.Name,
			entry.Description,
			action,
			disabled,
			strings.Join(entry.From, ","),
			strings.Join(entry.To, ","),
			strings.Join(entry.Source, ","),
			strings.Join(entry.Destination, ","),
			strings.Join(entry.Service, ","),
			strings.Join(entry.Application, ","),
		)
		if err != nil {
			return err
		}
	}
	return nil
}

func insertNATRules(tx *sql.Tx, deviceUUID, scope string, entries []XMLNATRuleEntry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO nat_rules (device_uuid, scope, rule_name, description, disabled, from_zones, to_zone, source_addresses, destination_addresses, service, source_translation_type, source_translation_address, destination_translation_address, destination_translation_port)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range entries {
		disabled := 0
		if strings.ToLower(entry.Disabled) == "yes" || entry.Disabled == "true" {
			disabled = 1
		}

		toZone := ""
		if len(entry.To) > 0 {
			toZone = entry.To[0]
		}

		srcTransType := ""
		srcTransAddr := ""
		if entry.SourceTranslation.DynamicIPPort != nil && len(entry.SourceTranslation.DynamicIPPort.TranslatedAddress) > 0 {
			srcTransType = "dynamic-ip-port"
			srcTransAddr = strings.Join(entry.SourceTranslation.DynamicIPPort.TranslatedAddress, ",")
		} else if entry.SourceTranslation.StaticIP != nil {
			srcTransType = "static-ip"
			srcTransAddr = entry.SourceTranslation.StaticIP.TranslatedAddress
		}

		_, err := stmt.Exec(
			deviceUUID,
			scope,
			entry.Name,
			entry.Description,
			disabled,
			strings.Join(entry.From, ","),
			toZone,
			strings.Join(entry.Source, ","),
			strings.Join(entry.Destination, ","),
			entry.Service,
			srcTransType,
			srcTransAddr,
			entry.DestinationTranslation.TranslatedAddress,
			entry.DestinationTranslation.TranslatedPort,
		)
		if err != nil {
			return err
		}
	}
	return nil
}

func insertStaticRoutes(tx *sql.Tx, deviceUUID, vrName string, entries []XMLStaticRouteEntry) error {
	stmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO static_routes (device_uuid, vr_name, route_name, destination, nexthop, interface, metric)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, route := range entries {
		if _, err := stmt.Exec(deviceUUID, vrName, route.Name, route.Destination, route.Nexthop.IPAddress, route.Interface, route.Metric); err != nil {
			return err
		}
	}
	return nil
}

func insertTags(tx *sql.Tx, deviceUUID, scope string, entries []XMLTagEntry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO tags (device_uuid, scope, name, color, description)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range entries {
		if _, err := stmt.Exec(deviceUUID, scope, entry.Name, entry.Color, entry.Comments); err != nil {
			return err
		}
	}
	return nil
}

func insertSecurityProfiles(tx *sql.Tx, deviceUUID, scope string, profiles XMLProfiles) error {
	stmt, err := tx.Prepare(`
		INSERT INTO security_profiles (device_uuid, scope, name, type)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	insertSlice := func(typeStr string, entries []struct{ Name string `xml:"name,attr"` }) error {
		for _, entry := range entries {
			if _, err := stmt.Exec(deviceUUID, scope, entry.Name, typeStr); err != nil {
				return err
			}
		}
		return nil
	}

	if err := insertSlice("url-filtering", profiles.URLFiltering); err != nil {
		return err
	}
	if err := insertSlice("antivirus", profiles.Antivirus); err != nil {
		return err
	}
	if err := insertSlice("vulnerability", profiles.Vulnerability); err != nil {
		return err
	}
	if err := insertSlice("spyware", profiles.AntiSpyware); err != nil {
		return err
	}
	if err := insertSlice("wildfire", profiles.WildFire); err != nil {
		return err
	}
	if err := insertSlice("file-blocking", profiles.FileBlocking); err != nil {
		return err
	}

	return nil
}

// ParseAndStore processes the XML byte array, automatically detects if it is a
// Panorama or standalone configuration, extracts topological features, objects, and policies,
// and writes them into devices, network_topology, rules, static routes, and profile tables.
// Returns the number of devices and topology rows imported.
func (a *Adapter) ParseAndStore(xmlData []byte, filename string) (int, int, error) {
	var config PaloAltoConfig
	if err := xml.Unmarshal(xmlData, &config); err != nil {
		return 0, 0, fmt.Errorf("failed to unmarshal Palo Alto XML: %w", err)
	}

	allTemplates := append([]XMLTemplate{}, config.Templates...)
	allTemplateStacks := append([]XMLTemplateStack{}, config.TemplateStacks...)
	allDeviceGroups := append([]XMLDeviceGroup{}, config.DeviceGroups...)

	for _, dev := range config.Devices {
		allTemplates = append(allTemplates, dev.Templates...)
		allTemplateStacks = append(allTemplateStacks, dev.TemplateStacks...)
		allDeviceGroups = append(allDeviceGroups, dev.DeviceGroups...)
	}

	hasMgtDevices := len(config.Shared.ManagedDevices) > 0 || (config.MgtConfig != nil && len(config.MgtConfig.Devices) > 0) || (config.ReadOnly != nil && len(config.ReadOnly.Devices) > 0)
	hasShared := len(config.Shared.Address) > 0 || len(config.Shared.AddressGroup) > 0 || len(config.Shared.Service) > 0 || len(config.Shared.PreRulebase.SecurityRules) > 0 || len(config.Shared.PostRulebase.SecurityRules) > 0 || hasMgtDevices
	isPanorama := len(allTemplates) > 0 || len(allDeviceGroups) > 0 || len(allTemplateStacks) > 0 || hasShared

	a.store.WriteLock()
	defer a.store.WriteUnlock()

	tx, err := a.store.DB().Begin()
	if err != nil {
		return 0, 0, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	deviceStmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO devices (uuid, name, vendor, parent_uuid)
		VALUES (?, ?, 'PaloAlto', ?)
	`)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to prepare device statement: %w", err)
	}
	defer deviceStmt.Close()

	topologyStmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO network_topology (device_uuid, interface_name, network_cidr, zone_name, vendor_metadata)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to prepare topology statement: %w", err)
	}
	defer topologyStmt.Close()

	devicesImported := 0
	topologyImported := 0

	if isPanorama {
		// --- PANORAMA PIPELINE ---

		sharedUUID := "paloalto-panorama-global"
		clearDeviceTables(tx, sharedUUID)
		if _, err := deviceStmt.Exec(sharedUUID, "Panorama Global / Shared", nil); err != nil {
			return 0, 0, fmt.Errorf("failed to register shared panorama global: %w", err)
		}
		devicesImported++

		// 1. Process templates
		for _, tmpl := range allTemplates {
			deviceUUID := "panorama-tmpl-" + tmpl.Name
			deviceName := tmpl.Name + " (Panorama)"

			clearDeviceTables(tx, deviceUUID)

			if _, err := deviceStmt.Exec(deviceUUID, deviceName, nil); err != nil {
				return 0, 0, fmt.Errorf("failed to register panorama template device %s: %w", tmpl.Name, err)
			}
			devicesImported++

			for _, dev := range tmpl.Config.Devices {
				interfaceToZone := make(map[string]string)
				for _, vsys := range dev.Vsys {
					for _, zone := range vsys.Zone {
						for _, member := range zone.Network.Layer3.Members {
							interfaceToZone[member] = zone.Name
						}
					}
				}

				interfaceToVR := make(map[string]string)
				for _, vr := range dev.Network.VirtualRouter {
					for _, member := range vr.Interfaces.Members {
						interfaceToVR[member] = vr.Name
					}
					if err := insertStaticRoutes(tx, deviceUUID, vr.Name, vr.StaticRoutes); err != nil {
						return 0, 0, fmt.Errorf("failed to insert static routes: %w", err)
					}
				}

				for _, eth := range dev.Network.Interface.Ethernet {
					zoneName, ok := interfaceToZone[eth.Name]
					if !ok {
						zoneName = "untrusted"
					}

					vrName, ok := interfaceToVR[eth.Name]
					if !ok {
						vrName = "default"
					}

					metadata := VendorMetadata{
						VirtualRouter: vrName,
						Tags:          []string{"panorama-import", "template:" + tmpl.Name},
					}
					metaBytes, err := json.Marshal(metadata)
					if err != nil {
						return 0, 0, fmt.Errorf("failed to marshal metadata: %w", err)
					}

					for _, ip := range eth.IPs {
						if _, err := topologyStmt.Exec(deviceUUID, eth.Name, ip.Name, zoneName, string(metaBytes)); err != nil {
							return 0, 0, fmt.Errorf("failed to insert network topology: %w", err)
						}
						topologyImported++
					}
				}
			}
		}

		// 2. Process template stacks
		for _, stack := range allTemplateStacks {
			stackUUID := "panorama-stack-" + stack.Name
			stackName := stack.Name + " (Template Stack)"

			clearDeviceTables(tx, stackUUID)

			if _, err := deviceStmt.Exec(stackUUID, stackName, nil); err != nil {
				return 0, 0, fmt.Errorf("failed to register template stack: %w", err)
			}
			devicesImported++

			res, err := tx.Exec("INSERT INTO template_stacks (device_uuid, name) VALUES ('paloalto-panorama-global', ?)", stack.Name)
			if err != nil {
				return 0, 0, fmt.Errorf("failed to insert template stack record: %w", err)
			}
			stackID, _ := res.LastInsertId()

			for idx, tmplMember := range stack.Templates {
				if _, err := tx.Exec("INSERT INTO template_stack_members (stack_id, template_name, sequence) VALUES (?, ?, ?)", stackID, tmplMember, idx); err != nil {
					return 0, 0, fmt.Errorf("failed to insert template stack member: %w", err)
				}
			}
		}

		// 3. Process Shared / Global
		// Write shared objects
		if err := insertAddressObjects(tx, sharedUUID, "shared", config.Shared.Address); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared address objects: %w", err)
		}
		if err := insertAddressGroups(tx, sharedUUID, "shared", config.Shared.AddressGroup); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared address groups: %w", err)
		}
		if err := insertServiceObjects(tx, sharedUUID, "shared", config.Shared.Service); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared service objects: %w", err)
		}
		if err := insertServiceGroups(tx, sharedUUID, "shared", config.Shared.ServiceGroup); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared service groups: %w", err)
		}
		if err := insertTags(tx, sharedUUID, "shared", config.Shared.Tags); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared tags: %w", err)
		}
		if err := insertSecurityProfiles(tx, sharedUUID, "shared", config.Shared.Profiles); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared profiles: %w", err)
		}

		// Write shared rules
		if err := insertSecurityRules(tx, sharedUUID, "shared:pre", config.Shared.PreRulebase.SecurityRules); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared pre-security rules: %w", err)
		}
		if err := insertSecurityRules(tx, sharedUUID, "shared:post", config.Shared.PostRulebase.SecurityRules); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared post-security rules: %w", err)
		}
		if err := insertNATRules(tx, sharedUUID, "shared:pre", config.Shared.PreRulebase.NATRules); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared pre-nat rules: %w", err)
		}
		if err := insertNATRules(tx, sharedUUID, "shared:post", config.Shared.PostRulebase.NATRules); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared post-nat rules: %w", err)
		}

		// Write managed devices ledger
		allManagedDevices := make(map[string]XMLManagedDeviceEntry)
		for _, md := range config.Shared.ManagedDevices {
			if md.Serial != "" && md.Serial != "localhost.localdomain" {
				allManagedDevices[md.Serial] = md
			}
		}
		if config.MgtConfig != nil {
			for _, md := range config.MgtConfig.Devices {
				if md.Serial != "" && md.Serial != "localhost.localdomain" {
					existing, exists := allManagedDevices[md.Serial]
					if exists {
						if existing.Hostname == "" {
							existing.Hostname = md.Hostname
						}
						if existing.IPAddress == "" {
							existing.IPAddress = md.IPAddress
						}
						if existing.IP == "" {
							existing.IP = md.IP
						}
						if existing.TemplateStack == "" {
							existing.TemplateStack = md.TemplateStack
						}
						if existing.Template == "" {
							existing.Template = md.Template
						}
						allManagedDevices[md.Serial] = existing
					} else {
						allManagedDevices[md.Serial] = md
					}
				}
			}
		}
		if config.ReadOnly != nil {
			for _, md := range config.ReadOnly.Devices {
				if md.Serial != "" && md.Serial != "localhost.localdomain" {
					existing, exists := allManagedDevices[md.Serial]
					if exists {
						if existing.Hostname == "" {
							existing.Hostname = md.Hostname
						}
						if existing.IPAddress == "" {
							existing.IPAddress = md.IPAddress
						}
						if existing.IP == "" {
							existing.IP = md.IP
						}
						if existing.TemplateStack == "" {
							existing.TemplateStack = md.TemplateStack
						}
						if existing.Template == "" {
							existing.Template = md.Template
						}
						allManagedDevices[md.Serial] = existing
					} else {
						allManagedDevices[md.Serial] = md
					}
				}
			}
		}

		// Collect serials from device groups and template stacks to ensure all referenced firewalls are in the managed devices inventory
		for _, dg := range allDeviceGroups {
			for _, d := range dg.Devices {
				if d.Name != "" && d.Name != "localhost.localdomain" {
					if _, exists := allManagedDevices[d.Name]; !exists {
						allManagedDevices[d.Name] = XMLManagedDeviceEntry{
							Serial: d.Name,
						}
					}
				}
			}
		}
		for _, stack := range allTemplateStacks {
			for _, devMember := range stack.Devices {
				if devMember != "" && devMember != "localhost.localdomain" {
					if _, exists := allManagedDevices[devMember]; !exists {
						allManagedDevices[devMember] = XMLManagedDeviceEntry{
							Serial: devMember,
						}
					}
				}
			}
			for _, devEntry := range stack.DevicesEntries {
				if devEntry.Name != "" && devEntry.Name != "localhost.localdomain" {
					if _, exists := allManagedDevices[devEntry.Name]; !exists {
						allManagedDevices[devEntry.Name] = XMLManagedDeviceEntry{
							Serial: devEntry.Name,
						}
					}
				}
			}
		}

		managedDevStmt, err := tx.Prepare(`
			INSERT OR REPLACE INTO managed_devices (device_uuid, serial, name, ip_address, device_group, template_stack)
			VALUES (?, ?, ?, ?, ?, ?)
		`)
		if err == nil {
			defer managedDevStmt.Close()
			for _, mdev := range allManagedDevices {
				dgName := ""
				for _, dg := range allDeviceGroups {
					for _, d := range dg.Devices {
						if d.Name == mdev.Serial {
							dgName = dg.Name
							break
						}
					}
					if dgName != "" {
						break
					}
				}

				stackName := mdev.TemplateStack
				if stackName == "" {
					stackName = mdev.Template
				}
				if stackName == "" {
					for _, stack := range allTemplateStacks {
						for _, devMember := range stack.Devices {
							if devMember == mdev.Serial {
								stackName = stack.Name
								break
							}
						}
						if stackName != "" {
							break
						}
						for _, devEntry := range stack.DevicesEntries {
							if devEntry.Name == mdev.Serial {
								stackName = stack.Name
								break
							}
						}
						if stackName != "" {
							break
						}
					}
				}

				name := mdev.Hostname
				if name == "" {
					// Check if a standalone firewall has already been imported for this serial
					var existingName string
					err := tx.QueryRow("SELECT name FROM devices WHERE uuid LIKE ?", "%-"+mdev.Serial).Scan(&existingName)
					if err == nil && existingName != "" {
						name = existingName
					} else {
						name = mdev.Serial
					}
				}

				ipAddr := mdev.IPAddress
				if ipAddr == "" {
					ipAddr = mdev.IP
				}
				if ipAddr == "" {
					// Check if there is an existing IP in the DB for this serial (e.g. from standalone import first)
					var existingIP string
					err := tx.QueryRow("SELECT ip_address FROM managed_devices WHERE serial = ?", mdev.Serial).Scan(&existingIP)
					if err == nil && existingIP != "" {
						ipAddr = existingIP
					}
				}
				managedDevStmt.Exec(sharedUUID, mdev.Serial, name, ipAddr, dgName, stackName)
			}
		}

		// 4. Process device groups
		for _, dg := range allDeviceGroups {
			dgUUID := "paloalto-dg-" + dg.Name
			dgName := dg.Name + " (Device Group)"

			clearDeviceTables(tx, dgUUID)

			var parentUUID interface{}
			if dg.Parent != "" {
				parentUUID = "paloalto-dg-" + dg.Parent
			}

			if _, err := deviceStmt.Exec(dgUUID, dgName, parentUUID); err != nil {
				return 0, 0, fmt.Errorf("failed to register device group %s: %w", dg.Name, err)
			}
			devicesImported++

			// Write device group objects
			if err := insertAddressObjects(tx, dgUUID, "device-group", dg.Address); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg address objects for %s: %w", dg.Name, err)
			}
			if err := insertAddressGroups(tx, dgUUID, "device-group", dg.AddressGroup); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg address groups for %s: %w", dg.Name, err)
			}
			if err := insertServiceObjects(tx, dgUUID, "device-group", dg.Service); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg service objects for %s: %w", dg.Name, err)
			}
			if err := insertServiceGroups(tx, dgUUID, "device-group", dg.ServiceGroup); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg service groups for %s: %w", dg.Name, err)
			}
			if err := insertTags(tx, dgUUID, "device-group", dg.Tags); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg tags for %s: %w", dg.Name, err)
			}
			if err := insertSecurityProfiles(tx, dgUUID, "device-group", dg.Profiles); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg profiles for %s: %w", dg.Name, err)
			}

			// Write device group rules
			if err := insertSecurityRules(tx, dgUUID, "device-group:pre", dg.PreRulebase.SecurityRules); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg pre-security rules for %s: %w", dg.Name, err)
			}
			if err := insertSecurityRules(tx, dgUUID, "device-group:post", dg.PostRulebase.SecurityRules); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg post-security rules for %s: %w", dg.Name, err)
			}
			if err := insertNATRules(tx, dgUUID, "device-group:pre", dg.PreRulebase.NATRules); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg pre-nat rules for %s: %w", dg.Name, err)
			}
			if err := insertNATRules(tx, dgUUID, "device-group:post", dg.PostRulebase.NATRules); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg post-nat rules for %s: %w", dg.Name, err)
			}
		}

		// Link all already imported standalone devices in the devices table to their Device Groups / Template Stacks
		for _, mdev := range allManagedDevices {
			dgName := ""
			for _, dg := range allDeviceGroups {
				for _, d := range dg.Devices {
					if d.Name == mdev.Serial {
						dgName = dg.Name
						break
					}
				}
				if dgName != "" {
					break
				}
			}

			stackName := mdev.TemplateStack
			if stackName == "" {
				for _, stack := range allTemplateStacks {
					for _, devMember := range stack.Devices {
						if devMember == mdev.Serial {
							stackName = stack.Name
							break
						}
					}
					if stackName != "" {
						break
					}
					for _, devEntry := range stack.DevicesEntries {
						if devEntry.Name == mdev.Serial {
							stackName = stack.Name
							break
						}
					}
					if stackName != "" {
						break
					}
				}
			}

			var parentUUID interface{}
			if dgName != "" {
				parentUUID = "paloalto-dg-" + dgName
			} else if stackName != "" {
				parentUUID = "panorama-stack-" + stackName
			}
			if parentUUID != nil {
				tx.Exec("UPDATE devices SET parent_uuid = ? WHERE uuid LIKE ?", parentUUID, "%-"+mdev.Serial)
			}
		}

	} else {
		// --- STANDALONE PIPELINE ---
		for _, dev := range config.Devices {
			deviceUUID := "paloalto-fw-" + dev.Name
			if dev.Name == "" || dev.Name == "localhost.localdomain" {
				deviceUUID = "paloalto-fw-standalone"
			}
			deviceName := dev.Name
			if deviceName == "" {
				deviceName = "Palo Alto Firewall"
			}

			fwName, serial := parseFirewallFilename(filename)
			
			// Extract system config if available
			var xmlSerial string
			var mgmtIP string
			var xmlHostname string
			if dev.DeviceConfig != nil {
				mgmtIP = dev.DeviceConfig.System.IPAddress
				if mgmtIP == "" {
					mgmtIP = dev.DeviceConfig.System.IP
				}
				xmlSerial = dev.DeviceConfig.System.Serial
				if xmlSerial == "" {
					xmlSerial = dev.DeviceConfig.System.SerialNumber
				}
				xmlHostname = dev.DeviceConfig.System.Hostname
			}
			if mgmtIP == "" && config.DeviceConfig != nil {
				mgmtIP = config.DeviceConfig.System.IPAddress
				if mgmtIP == "" {
					mgmtIP = config.DeviceConfig.System.IP
				}
			}
			if xmlSerial == "" && config.DeviceConfig != nil {
				xmlSerial = config.DeviceConfig.System.Serial
				if xmlSerial == "" {
					xmlSerial = config.DeviceConfig.System.SerialNumber
				}
			}
			if xmlHostname == "" && config.DeviceConfig != nil {
				xmlHostname = config.DeviceConfig.System.Hostname
			}

			if serial == "" {
				serial = xmlSerial
			}

			if xmlHostname != "" && (deviceName == "" || deviceName == "Palo Alto Firewall" || deviceName == "localhost.localdomain") {
				deviceName = xmlHostname
			}

			if fwName != "" {
				deviceName = fwName
				if serial != "" {
					deviceUUID = "paloalto-fw-" + fwName + "-" + serial
				} else {
					deviceUUID = "paloalto-fw-" + fwName
				}
			} else if serial != "" {
				deviceUUID = "paloalto-fw-" + deviceName + "-" + serial
			}

			clearDeviceTables(tx, deviceUUID)

			var parentUUID interface{}
			if serial != "" {
				var dgName, stackName string
				err := tx.QueryRow("SELECT device_group, template_stack FROM managed_devices WHERE serial = ?", serial).Scan(&dgName, &stackName)
				if err == nil {
					if dgName != "" {
						parentUUID = "paloalto-dg-" + dgName
					} else if stackName != "" {
						parentUUID = "panorama-stack-" + stackName
					}
				}
			}

			if _, err := deviceStmt.Exec(deviceUUID, deviceName, parentUUID); err != nil {
				return 0, 0, fmt.Errorf("failed to register standalone firewall device %s: %w", deviceName, err)
			}
			devicesImported++

			if serial != "" {
				var existingDeviceUUID string
				err := tx.QueryRow("SELECT device_uuid FROM managed_devices WHERE serial = ?", serial).Scan(&existingDeviceUUID)
				if err == nil {
					// Entry exists! Update the ip_address and name
					if mgmtIP != "" {
						tx.Exec("UPDATE managed_devices SET name = ?, ip_address = ? WHERE serial = ?", deviceName, mgmtIP, serial)
					} else {
						tx.Exec("UPDATE managed_devices SET name = ? WHERE serial = ?", deviceName, serial)
					}
				} else {
					// No entry exists yet in managed_devices! Let's insert a new one for this standalone firewall
					parentCtxUUID := deviceUUID
					var existsGlobal int
					tx.QueryRow("SELECT COUNT(*) FROM devices WHERE uuid = 'paloalto-panorama-global'").Scan(&existsGlobal)
					if existsGlobal > 0 {
						parentCtxUUID = "paloalto-panorama-global"
					}
					
					_, err := tx.Exec(`
						INSERT OR REPLACE INTO managed_devices (device_uuid, serial, name, ip_address, device_group, template_stack)
						VALUES (?, ?, ?, ?, NULL, NULL)
					`, parentCtxUUID, serial, deviceName, mgmtIP)
					if err != nil {
						return 0, 0, fmt.Errorf("failed to insert managed device: %w", err)
					}
				}
			}

			interfaceToZone := make(map[string]string)
			for _, vsys := range dev.Vsys {
				for _, zone := range vsys.Zone {
					for _, member := range zone.Network.Layer3.Members {
						interfaceToZone[member] = zone.Name
					}
				}
			}

			interfaceToVR := make(map[string]string)
			for _, vr := range dev.Network.VirtualRouter {
				for _, member := range vr.Interfaces.Members {
					interfaceToVR[member] = vr.Name
				}
				if err := insertStaticRoutes(tx, deviceUUID, vr.Name, vr.StaticRoutes); err != nil {
					return 0, 0, fmt.Errorf("failed to insert static routes: %w", err)
				}
			}

			for _, eth := range dev.Network.Interface.Ethernet {
				zoneName, ok := interfaceToZone[eth.Name]
				if !ok {
					zoneName = "untrusted"
				}

				vrName, ok := interfaceToVR[eth.Name]
				if !ok {
					vrName = "default"
				}

				metadata := VendorMetadata{
					VirtualRouter: vrName,
					Tags:          []string{"firewall-import"},
				}
				metaBytes, err := json.Marshal(metadata)
				if err != nil {
					return 0, 0, fmt.Errorf("failed to marshal metadata: %w", err)
				}

				for _, ip := range eth.IPs {
					if _, err := topologyStmt.Exec(deviceUUID, eth.Name, ip.Name, zoneName, string(metaBytes)); err != nil {
						return 0, 0, fmt.Errorf("failed to insert topology entry: %w", err)
					}
					topologyImported++
				}
			}

			for _, vsys := range dev.Vsys {
				scope := "vsys:" + vsys.Name
				
				if err := insertAddressObjects(tx, deviceUUID, scope, vsys.Address); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys address objects: %w", err)
				}
				if err := insertAddressGroups(tx, deviceUUID, scope, vsys.AddressGroup); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys address groups: %w", err)
				}
				if err := insertServiceObjects(tx, deviceUUID, scope, vsys.Service); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys service objects: %w", err)
				}
				if err := insertServiceGroups(tx, deviceUUID, scope, vsys.ServiceGroup); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys service groups: %w", err)
				}
				if err := insertTags(tx, deviceUUID, scope, vsys.Tags); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys tags: %w", err)
				}
				if err := insertSecurityProfiles(tx, deviceUUID, scope, vsys.Profiles); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys profiles: %w", err)
				}

				if err := insertSecurityRules(tx, deviceUUID, scope, vsys.SecurityRules); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys security rules: %w", err)
				}
				if err := insertNATRules(tx, deviceUUID, scope, vsys.NATRules); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys nat rules: %w", err)
				}
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return devicesImported, topologyImported, nil
}
