package paloalto

import (
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"log/slog"
	"sort"
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

type XMLApplicationEntry struct {
	Name        string   `xml:"name,attr"`
	Category    string   `xml:"category"`
	Subcategory string   `xml:"subcategory"`
	Technology  string   `xml:"technology"`
	Risk        int      `xml:"risk"`
	Ports       []string `xml:"ports>member"`
	Description string   `xml:"description"`
}

type XMLApplicationGroupEntry struct {
	Name        string   `xml:"name,attr"`
	Members     []string `xml:"members>member"`
	Description string   `xml:"description"`
}

type XMLRegionEntry struct {
	Name      string   `xml:"name,attr"`
	Latitude  float64  `xml:"latitude"`
	Longitude float64  `xml:"longitude"`
	Address   []string `xml:"address>member"`
}

type XMLScheduleEntry struct {
	Name     string `xml:"name,attr"`
	InnerXML string `xml:",innerxml"`
}

type XMLTagEntry struct {
	Name     string `xml:"name,attr"`
	Color    string `xml:"color"`
	Comments string `xml:"comments"`
}

type XMLLogSettingsProfileEntry struct {
	Name        string `xml:"name,attr"`
	Description string `xml:"description"`
}

type XMLSecurityProfileGroupEntry struct {
	Name             string   `xml:"name,attr"`
	Description      string   `xml:"description"`
	Antivirus        []string `xml:"virus>member"`
	Spyware          []string `xml:"spyware>member"`
	Vulnerability    []string `xml:"vulnerability>member"`
	URLFiltering     []string `xml:"url-filtering>member"`
	FileBlocking     []string `xml:"file-blocking>member"`
	WildfireAnalysis []string `xml:"wildfire-analysis>member"`
	DNSSecurity      []string `xml:"dns-security>member"`
}

type XMLCustomURLCategoryEntry struct {
	Name        string   `xml:"name,attr"`
	Description string   `xml:"description"`
	List        []string `xml:"list>member"`
}

type XMLEDLType struct {
	IP     *struct{} `xml:"ip"`
	Domain *struct{} `xml:"domain"`
	URL    *struct{} `xml:"url"`
}

func (t XMLEDLType) String() string {
	if t.IP != nil {
		return "ip"
	}
	if t.Domain != nil {
		return "domain"
	}
	if t.URL != nil {
		return "url"
	}
	return "ip"
}

type XMLEDLRecurring struct {
	FiveMinute *struct{} `xml:"five-minute"`
	Hourly     *struct{} `xml:"hourly"`
	Daily      *struct{} `xml:"daily"`
	Weekly     *struct{} `xml:"weekly"`
	Monthly    *struct{} `xml:"monthly"`
}

func (r XMLEDLRecurring) String() string {
	if r.FiveMinute != nil {
		return "five-minute"
	}
	if r.Hourly != nil {
		return "hourly"
	}
	if r.Daily != nil {
		return "daily"
	}
	if r.Weekly != nil {
		return "weekly"
	}
	if r.Monthly != nil {
		return "monthly"
	}
	return "daily"
}

type XMLExternalListEntry struct {
	Name        string          `xml:"name,attr"`
	Description string          `xml:"description"`
	Type        XMLEDLType      `xml:"type"`
	URL         string          `xml:"url"`
	Recurring   XMLEDLRecurring `xml:"recurring"`
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
	CustomURLCategories   []XMLCustomURLCategoryEntry    `xml:"custom-url-category>entry"`
}

// Rules XML representation
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
	Tag         []string `xml:"tag>member"`
	Schedule    string   `xml:"schedule"`
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

type XMLQoSRuleEntry struct {
	Name        string   `xml:"name,attr"`
	From        []string `xml:"from>member"`
	To          []string `xml:"to>member"`
	Source      []string `xml:"source>member"`
	Destination []string `xml:"destination>member"`
	Service     []string `xml:"service>member"`
	Application []string `xml:"application>member"`
	QoSClass    string   `xml:"class"`
	DSCPTOS     string   `xml:"dscp-tos"`
	Disabled    string   `xml:"disabled"`
	Description string   `xml:"description"`
	Schedule    string   `xml:"schedule"`
}

type XMLPBFRuleEntry struct {
	Name        string   `xml:"name,attr"`
	From        []string `xml:"from>member"`
	Source      []string `xml:"source>member"`
	Destination []string `xml:"destination>member"`
	Service     []string `xml:"service>member"`
	Application []string `xml:"application>member"`
	Action      string   `xml:"action"`
	Forward     struct {
		Interface string `xml:"interface"`
		NextHop   string `xml:"next-hop"`
		Monitor   string `xml:"monitor>profile"`
	} `xml:"forward"`
	Disabled    string   `xml:"disabled"`
	Description string   `xml:"description"`
	Schedule    string   `xml:"schedule"`
}

type XMLDecryptionRuleEntry struct {
	Name        string   `xml:"name,attr"`
	From        []string `xml:"from>member"`
	To          []string `xml:"to>member"`
	Source      []string `xml:"source>member"`
	Destination []string `xml:"destination>member"`
	Service     []string `xml:"service>member"`
	Action      string   `xml:"action"`
	Type        string   `xml:"type"`
	Profile     string   `xml:"profile"`
	Disabled    string   `xml:"disabled"`
	Description string   `xml:"description"`
	Schedule    string   `xml:"schedule"`
}

type XMLAppOverrideRuleEntry struct {
	Name        string   `xml:"name,attr"`
	From        []string `xml:"from>member"`
	To          []string `xml:"to>member"`
	Source      []string `xml:"source>member"`
	Destination []string `xml:"destination>member"`
	Protocol    string   `xml:"protocol"`
	Port        string   `xml:"port"`
	Application string   `xml:"application"`
	Disabled    string   `xml:"disabled"`
	Description string   `xml:"description"`
}

type XMLTunnelInspectionRuleEntry struct {
	Name        string   `xml:"name,attr"`
	From        []string `xml:"from>member"`
	To          []string `xml:"to>member"`
	Source      []string `xml:"source>member"`
	Destination []string `xml:"destination>member"`
	Protocols   []string `xml:"protocol>member"`
	Action      string   `xml:"action"`
	Disabled    string   `xml:"disabled"`
	Description string   `xml:"description"`
}

// Structure groups
type XMLRulebase struct {
	SecurityRules         []XMLSecurityRuleEntry         `xml:"security>rules>entry"`
	NATRules              []XMLNATRuleEntry              `xml:"nat>rules>entry"`
	QoSRules              []XMLQoSRuleEntry              `xml:"qos>rules>entry"`
	PBFRules              []XMLPBFRuleEntry              `xml:"pbf>rules>entry"`
	DecryptionRules       []XMLDecryptionRuleEntry       `xml:"decryption>rules>entry"`
	AppOverrideRules      []XMLAppOverrideRuleEntry        `xml:"application-override>rules>entry"`
	TunnelInspectionRules []XMLTunnelInspectionRuleEntry   `xml:"tunnel-inspection>rules>entry"`
}

type XMLDeviceGroup struct {
	Name                  string                         `xml:"name,attr"`
	Parent                string                         `xml:"parent,attr"`
	Address               []XMLAddressEntry              `xml:"address>entry"`
	AddressGroup          []XMLAddressGroupEntry         `xml:"address-group>entry"`
	Service               []XMLServiceEntry              `xml:"service>entry"`
	ServiceGroup          []XMLServiceGroupEntry         `xml:"service-group>entry"`
	Application           []XMLApplicationEntry          `xml:"application>entry"`
	ApplicationGroups     []XMLApplicationGroupEntry     `xml:"application-group>entry"`
	Region                []XMLRegionEntry               `xml:"region>entry"`
	Schedule              []XMLScheduleEntry             `xml:"schedule>entry"`
	PreRulebase           XMLRulebase                    `xml:"pre-rulebase"`
	PostRulebase          XMLRulebase                    `xml:"post-rulebase"`
	Tags                  []XMLTagEntry                  `xml:"tag>entry"`
	Profiles              XMLProfiles                    `xml:"profiles"`
	SecurityProfileGroups []XMLSecurityProfileGroupEntry `xml:"profile-group>entry"`
	LogSettingsProfiles   []XMLLogSettingsProfileEntry   `xml:"log-settings>profiles>entry"`
	ExternalDynamicLists  []XMLExternalListEntry         `xml:"external-list>entry"`
	Devices               []struct {
		Name string `xml:"name,attr"`
	} `xml:"devices>entry"`
}

// Interface, VR, Zone definitions
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
	Name           string   `xml:"name,attr"`
	Templates      []string `xml:"templates>member"`
	Devices        []string `xml:"devices>member"`
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

type XMLReadOnlyDGEntry struct {
	Name     string `xml:"name,attr"`
	ParentDG string `xml:"parent-dg"`
}

type XMLManagedDeviceEntry struct {
	Serial        string               `xml:"name,attr"`
	IPAddress     string               `xml:"ip-address"`
	IP            string               `xml:"ip"`
	Hostname      string               `xml:"hostname"`
	TemplateStack string               `xml:"template-stack"`
	Template      string               `xml:"template"`
	DeviceGroups  []XMLReadOnlyDGEntry `xml:"device-group>entry"`
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

	Shared struct {
		Address               []XMLAddressEntry              `xml:"address>entry"`
		AddressGroup          []XMLAddressGroupEntry         `xml:"address-group>entry"`
		Service               []XMLServiceEntry              `xml:"service>entry"`
		ServiceGroup          []XMLServiceGroupEntry         `xml:"service-group>entry"`
		Application           []XMLApplicationEntry          `xml:"application>entry"`
		ApplicationGroups     []XMLApplicationGroupEntry     `xml:"application-group>entry"`
		Region                []XMLRegionEntry               `xml:"region>entry"`
		Schedule              []XMLScheduleEntry             `xml:"schedule>entry"`
		PreRulebase           XMLRulebase                    `xml:"pre-rulebase"`
		PostRulebase          XMLRulebase                    `xml:"post-rulebase"`
		Tags                  []XMLTagEntry                  `xml:"tag>entry"`
		Profiles              XMLProfiles                    `xml:"profiles"`
		SecurityProfileGroups []XMLSecurityProfileGroupEntry `xml:"profile-group>entry"`
		LogSettingsProfiles   []XMLLogSettingsProfileEntry   `xml:"log-settings>profiles>entry"`
		ExternalDynamicLists  []XMLExternalListEntry         `xml:"external-list>entry"`
		ManagedDevices        []XMLManagedDeviceEntry        `xml:"managed-devices>entry"`
	} `xml:"shared"`

	DeviceGroups []XMLDeviceGroup `xml:"device-group>entry"`

	Devices []struct {
		Name           string             `xml:"name,attr"`
		Templates      []XMLTemplate      `xml:"template>entry"`
		TemplateStacks []XMLTemplateStack `xml:"template-stack>entry"`
		DeviceGroups   []XMLDeviceGroup   `xml:"device-group>entry"`
		DeviceConfig   *XMLDeviceConfig   `xml:"deviceconfig"`
		Network        struct {
			Interface struct {
				Ethernet []InterfaceNode `xml:"ethernet>entry"`
			} `xml:"interface"`
			VirtualRouter []VirtualRouterNode `xml:"virtual-router>entry"`
		} `xml:"network"`
		Vsys []struct {
			Name                  string                         `xml:"name,attr"`
			Zone                  []ZoneNode                     `xml:"zone>entry"`
			Address               []XMLAddressEntry              `xml:"address>entry"`
			AddressGroup          []XMLAddressGroupEntry         `xml:"address-group>entry"`
			Service               []XMLServiceEntry              `xml:"service>entry"`
			ServiceGroup          []XMLServiceGroupEntry         `xml:"service-group>entry"`
			Application           []XMLApplicationEntry          `xml:"application>entry"`
			ApplicationGroups     []XMLApplicationGroupEntry     `xml:"application-group>entry"`
			Region                []XMLRegionEntry               `xml:"region>entry"`
			Schedule              []XMLScheduleEntry             `xml:"schedule>entry"`
			SecurityRules         []XMLSecurityRuleEntry         `xml:"rulebase>security>rules>entry"`
			NATRules              []XMLNATRuleEntry              `xml:"rulebase>nat>rules>entry"`
			QoSRules              []XMLQoSRuleEntry              `xml:"rulebase>qos>rules>entry"`
			PBFRules              []XMLPBFRuleEntry              `xml:"rulebase>pbf>rules>entry"`
			DecryptionRules       []XMLDecryptionRuleEntry       `xml:"rulebase>decryption>rules>entry"`
			AppOverrideRules      []XMLAppOverrideRuleEntry        `xml:"rulebase>application-override>rules>entry"`
			TunnelInspectionRules []XMLTunnelInspectionRuleEntry   `xml:"rulebase>tunnel-inspection>rules>entry"`
			Tags                  []XMLTagEntry                  `xml:"tag>entry"`
			Profiles              XMLProfiles                    `xml:"profiles"`
			SecurityProfileGroups []XMLSecurityProfileGroupEntry `xml:"profile-group>entry"`
			LogSettingsProfiles   []XMLLogSettingsProfileEntry   `xml:"log-settings>profiles>entry"`
			ExternalDynamicLists  []XMLExternalListEntry         `xml:"external-list>entry"`
		} `xml:"vsys>entry"`
	} `xml:"devices>entry"`
}

type XMLStaticRouteEntry struct {
	Name        string `xml:"name,attr"`
	Destination string `xml:"destination"`
	Interface   string `xml:"interface"`
	Nexthop     struct {
		IPAddress string `xml:"ip-address"`
	} `xml:"nexthop"`
	Metric int `xml:"metric"`
}

type IngestionStats struct {
	ConfigType          string   `json:"config_type"`
	Devices             []string `json:"devices"`
	TemplatesCount      int      `json:"templates_count"`
	DevicesCount        int      `json:"devices_count"`
	InterfacesCount     int      `json:"interfaces_count"`
	ZonesCount          int      `json:"zones_count"`
	VirtualRoutersCount int      `json:"virtual_routers_count"`
	AddedCount          int      `json:"added_count"`
	ModifiedCount       int      `json:"modified_count"`
	UnchangedCount      int      `json:"unchanged_count"`
	Warnings            []string `json:"warnings"`
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
		Devices:  []string{},
		Warnings: []string{},
	}

	hasMgtDevices := len(config.Shared.ManagedDevices) > 0 || (config.MgtConfig != nil && len(config.MgtConfig.Devices) > 0) || (config.ReadOnly != nil && len(config.ReadOnly.Devices) > 0)
	hasShared := len(config.Shared.Address) > 0 || len(config.Shared.AddressGroup) > 0 || len(config.Shared.Service) > 0 || len(config.Shared.PreRulebase.SecurityRules) > 0 || len(config.Shared.PostRulebase.SecurityRules) > 0 || hasMgtDevices
	isPanorama := len(allTemplates) > 0 || len(allDeviceGroups) > 0 || len(allTemplateStacks) > 0 || hasShared

	var addedCount, modifiedCount, unchangedCount int

	if isPanorama {
		stats.ConfigType = "Panorama"
		stats.TemplatesCount = len(allTemplates)

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

		for _, dg := range allDeviceGroups {
			dgName := dg.Name + " (Device Group)"
			stats.Devices = append(stats.Devices, dgName)
		}

		// Calculate object deltas for Shared
		sharedUUID := "paloalto-panorama-global"
		if add, mod, unc, err := a.compareAddressObjects(sharedUUID, "shared", config.Shared.Address); err != nil {
			return nil, fmt.Errorf("compareAddressObjects shared: %w", err)
		} else {
			addedCount += add; modifiedCount += mod; unchangedCount += unc
		}
		if add, mod, unc, err := a.compareServiceObjects(sharedUUID, "shared", config.Shared.Service); err != nil {
			return nil, fmt.Errorf("compareServiceObjects shared: %w", err)
		} else {
			addedCount += add; modifiedCount += mod; unchangedCount += unc
		}
		if add, mod, unc, err := a.compareAddressGroups(sharedUUID, "shared", config.Shared.AddressGroup); err != nil {
			return nil, fmt.Errorf("compareAddressGroups shared: %w", err)
		} else {
			addedCount += add; modifiedCount += mod; unchangedCount += unc
		}
		if add, mod, unc, err := a.compareServiceGroups(sharedUUID, "shared", config.Shared.ServiceGroup); err != nil {
			return nil, fmt.Errorf("compareServiceGroups shared: %w", err)
		} else {
			addedCount += add; modifiedCount += mod; unchangedCount += unc
		}
		if add, mod, unc, err := a.compareApplicationObjects(sharedUUID, "shared", config.Shared.Application); err != nil {
			return nil, fmt.Errorf("compareApplicationObjects shared: %w", err)
		} else {
			addedCount += add; modifiedCount += mod; unchangedCount += unc
		}

		// Calculate object deltas for Device Groups
		for _, dg := range allDeviceGroups {
			dgUUID := "paloalto-dg-" + dg.Name
			if add, mod, unc, err := a.compareAddressObjects(dgUUID, dg.Name, dg.Address); err != nil {
				return nil, fmt.Errorf("compareAddressObjects dg %s: %w", dg.Name, err)
			} else {
				addedCount += add; modifiedCount += mod; unchangedCount += unc
			}
			if add, mod, unc, err := a.compareServiceObjects(dgUUID, dg.Name, dg.Service); err != nil {
				return nil, fmt.Errorf("compareServiceObjects dg %s: %w", dg.Name, err)
			} else {
				addedCount += add; modifiedCount += mod; unchangedCount += unc
			}
			if add, mod, unc, err := a.compareAddressGroups(dgUUID, dg.Name, dg.AddressGroup); err != nil {
				return nil, fmt.Errorf("compareAddressGroups dg %s: %w", dg.Name, err)
			} else {
				addedCount += add; modifiedCount += mod; unchangedCount += unc
			}
			if add, mod, unc, err := a.compareServiceGroups(dgUUID, dg.Name, dg.ServiceGroup); err != nil {
				return nil, fmt.Errorf("compareServiceGroups dg %s: %w", dg.Name, err)
			} else {
				addedCount += add; modifiedCount += mod; unchangedCount += unc
			}
			if add, mod, unc, err := a.compareApplicationObjects(dgUUID, dg.Name, dg.Application); err != nil {
				return nil, fmt.Errorf("compareApplicationObjects dg %s: %w", dg.Name, err)
			} else {
				addedCount += add; modifiedCount += mod; unchangedCount += unc
			}
		}

		// Conflict Warning Ledger (Managed Devices checking)
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
						if existing.Hostname == "" { existing.Hostname = md.Hostname }
						if existing.IPAddress == "" { existing.IPAddress = md.IPAddress }
						if existing.IP == "" { existing.IP = md.IP }
						if existing.TemplateStack == "" { existing.TemplateStack = md.TemplateStack }
						if existing.Template == "" { existing.Template = md.Template }
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
						if existing.Hostname == "" { existing.Hostname = md.Hostname }
						if existing.IPAddress == "" { existing.IPAddress = md.IPAddress }
						if existing.IP == "" { existing.IP = md.IP }
						if existing.TemplateStack == "" { existing.TemplateStack = md.TemplateStack }
						if existing.Template == "" { existing.Template = md.Template }
						allManagedDevices[md.Serial] = existing
					} else {
						allManagedDevices[md.Serial] = md
					}
				}
			}
		}
		for _, dg := range allDeviceGroups {
			for _, d := range dg.Devices {
				if d.Name != "" && d.Name != "localhost.localdomain" {
					if _, exists := allManagedDevices[d.Name]; !exists {
						allManagedDevices[d.Name] = XMLManagedDeviceEntry{Serial: d.Name}
					}
				}
			}
		}
		for _, stack := range allTemplateStacks {
			for _, devMember := range stack.Devices {
				if devMember != "" && devMember != "localhost.localdomain" {
					if _, exists := allManagedDevices[devMember]; !exists {
						allManagedDevices[devMember] = XMLManagedDeviceEntry{Serial: devMember}
					}
				}
			}
			for _, devEntry := range stack.DevicesEntries {
				if devEntry.Name != "" && devEntry.Name != "localhost.localdomain" {
					if _, exists := allManagedDevices[devEntry.Name]; !exists {
						allManagedDevices[devEntry.Name] = XMLManagedDeviceEntry{Serial: devEntry.Name}
					}
				}
			}
		}

		for _, mdev := range allManagedDevices {
			dgName := ""
			for _, dg := range allDeviceGroups {
				for _, d := range dg.Devices {
					if d.Name == mdev.Serial {
						dgName = dg.Name
						break
					}
				}
				if dgName != "" { break }
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
					if stackName != "" { break }
					for _, devEntry := range stack.DevicesEntries {
						if devEntry.Name == mdev.Serial {
							stackName = stack.Name
							break
						}
					}
					if stackName != "" { break }
				}
			}

			// Query DB for existing mapping
			var dbDGName sql.NullString
			var dbStackName sql.NullString
			var dbTmplName sql.NullString
			err := a.store.DB().QueryRow(`
				SELECT dg.name, ts.name, t.name
				FROM managed_devices_raw m
				LEFT JOIN device_groups dg ON m.device_group_id = dg.id
				LEFT JOIN template_stacks ts ON m.template_stack_id = ts.id
				LEFT JOIN templates t ON m.template_id = t.id
				WHERE m.serial = ?`, mdev.Serial).Scan(&dbDGName, &dbStackName, &dbTmplName)
			switch err {
			case nil:
				nameOrSerial := mdev.Hostname
				if nameOrSerial == "" {
					nameOrSerial = mdev.Serial
				}

				if dgName != "" && dgName != dbDGName.String {
					curDG := dbDGName.String
					if curDG == "" {
						curDG = "None"
					}
					stats.Warnings = append(stats.Warnings, fmt.Sprintf("Managed device '%s' (Serial: %s) is mapped to Device Group '%s' in XML, but is currently assigned to '%s' in database.", nameOrSerial, mdev.Serial, dgName, curDG))
				}

				if stackName != "" && stackName != dbStackName.String && stackName != dbTmplName.String {
					curStack := dbStackName.String
					if curStack == "" {
						curStack = dbTmplName.String
					}
					if curStack == "" {
						curStack = "None"
					}
					stats.Warnings = append(stats.Warnings, fmt.Sprintf("Managed device '%s' (Serial: %s) is mapped to Template/Stack '%s' in XML, but is currently assigned to '%s' in database.", nameOrSerial, mdev.Serial, stackName, curStack))
				}
			case sql.ErrNoRows:
				nameOrSerial := mdev.Hostname
				if nameOrSerial == "" {
					nameOrSerial = mdev.Serial
				}
				stats.Warnings = append(stats.Warnings, fmt.Sprintf("[ADDITION] Managed device '%s' (Serial: %s) exists in the XML but is missing from the database (will be added).", nameOrSerial, mdev.Serial))
			}
		}

		// Check for missing Device Groups
		for _, dg := range allDeviceGroups {
			var exists int
			err := a.store.DB().QueryRow("SELECT COUNT(*) FROM device_groups WHERE name = ?", dg.Name).Scan(&exists)
			if err == nil && exists == 0 {
				stats.Warnings = append(stats.Warnings, fmt.Sprintf("[ADDITION] Device Group '%s' exists in the XML but is missing from the database (will be added).", dg.Name))
			}
		}

		// Check for missing Templates
		for _, tmpl := range allTemplates {
			var exists int
			err := a.store.DB().QueryRow("SELECT COUNT(*) FROM templates WHERE name = ?", tmpl.Name).Scan(&exists)
			if err == nil && exists == 0 {
				stats.Warnings = append(stats.Warnings, fmt.Sprintf("[ADDITION] Template '%s' exists in the XML but is missing from the database (will be added).", tmpl.Name))
			}
		}

		// Check for missing Template Stacks
		for _, stack := range allTemplateStacks {
			var exists int
			err := a.store.DB().QueryRow("SELECT COUNT(*) FROM template_stacks WHERE name = ?", stack.Name).Scan(&exists)
			if err == nil && exists == 0 {
				stats.Warnings = append(stats.Warnings, fmt.Sprintf("[ADDITION] Template Stack '%s' exists in the XML but is missing from the database (will be added).", stack.Name))
			}
		}

	} else {
		stats.ConfigType = "Firewall"
		stats.DevicesCount = len(config.Devices)

		for _, dev := range config.Devices {
			name := dev.Name
			if name == "" || name == "localhost.localdomain" {
				name = "standalone-firewall"
			}
			fwName, serial := parseFirewallFilename(filename)
			var xmlSerial string
			if dev.DeviceConfig != nil {
				xmlSerial = dev.DeviceConfig.System.Serial
				if xmlSerial == "" {
					xmlSerial = dev.DeviceConfig.System.SerialNumber
				}
			}
			if xmlSerial == "" && config.DeviceConfig != nil {
				xmlSerial = config.DeviceConfig.System.Serial
				if xmlSerial == "" {
					xmlSerial = config.DeviceConfig.System.SerialNumber
				}
			}
			if serial == "" {
				serial = xmlSerial
			}

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

			// standalone device UUID
			deviceUUID := "paloalto-fw-" + dev.Name
			if dev.Name == "" || dev.Name == "localhost.localdomain" {
				deviceUUID = "paloalto-fw-standalone"
			}
			if fwName != "" {
				if serial != "" {
					deviceUUID = "paloalto-fw-" + fwName + "-" + serial
				} else {
					deviceUUID = "paloalto-fw-" + fwName
				}
			} else if serial != "" {
				deviceUUID = "paloalto-fw-" + name + "-" + serial
			}

			// Calculate object deltas for Standalone firewall VSYS
			for _, vsys := range dev.Vsys {
				scope := "vsys:" + vsys.Name
				if add, mod, unc, err := a.compareAddressObjects(deviceUUID, scope, vsys.Address); err != nil {
					return nil, fmt.Errorf("compareAddressObjects standalone vsys %s: %w", vsys.Name, err)
				} else {
					addedCount += add; modifiedCount += mod; unchangedCount += unc
				}
				if add, mod, unc, err := a.compareServiceObjects(deviceUUID, scope, vsys.Service); err != nil {
					return nil, fmt.Errorf("compareServiceObjects standalone vsys %s: %w", vsys.Name, err)
				} else {
					addedCount += add; modifiedCount += mod; unchangedCount += unc
				}
				if add, mod, unc, err := a.compareAddressGroups(deviceUUID, scope, vsys.AddressGroup); err != nil {
					return nil, fmt.Errorf("compareAddressGroups standalone vsys %s: %w", vsys.Name, err)
				} else {
					addedCount += add; modifiedCount += mod; unchangedCount += unc
				}
				if add, mod, unc, err := a.compareServiceGroups(deviceUUID, scope, vsys.ServiceGroup); err != nil {
					return nil, fmt.Errorf("compareServiceGroups standalone vsys %s: %w", vsys.Name, err)
				} else {
					addedCount += add; modifiedCount += mod; unchangedCount += unc
				}
				if add, mod, unc, err := a.compareApplicationObjects(deviceUUID, scope, vsys.Application); err != nil {
					return nil, fmt.Errorf("compareApplicationObjects standalone vsys %s: %w", vsys.Name, err)
				} else {
					addedCount += add; modifiedCount += mod; unchangedCount += unc
				}
			}

			// Check if standalone firewall is missing from database
			if serial != "" {
				var exists int
				err := a.store.DB().QueryRow("SELECT COUNT(*) FROM managed_devices_raw WHERE serial = ?", serial).Scan(&exists)
				if err == nil && exists == 0 {
					stats.Warnings = append(stats.Warnings, fmt.Sprintf("[ADDITION] Standalone Firewall '%s' (Serial: %s) exists in the XML but is missing from the database (will be added).", name, serial))
				}
			}
		}
	}

	stats.AddedCount = addedCount
	stats.ModifiedCount = modifiedCount
	stats.UnchangedCount = unchangedCount

	return stats, nil
}

// Registry to track database primary key mappings for name references
type registry struct {
	addresses         map[string]map[string]int64
	addressGroups     map[string]map[string]int64
	services          map[string]map[string]int64
	serviceGroups     map[string]map[string]int64
	applications      map[string]map[string]int64
	applicationGroups map[string]map[string]int64
	schedules         map[string]map[string]int64
	tags              map[string]map[string]int64
	profiles          map[string]map[string]int64
}

func newRegistry() *registry {
	return &registry{
		addresses:         make(map[string]map[string]int64),
		addressGroups:     make(map[string]map[string]int64),
		services:          make(map[string]map[string]int64),
		serviceGroups:     make(map[string]map[string]int64),
		applications:      make(map[string]map[string]int64),
		applicationGroups: make(map[string]map[string]int64),
		schedules:         make(map[string]map[string]int64),
		tags:              make(map[string]map[string]int64),
		profiles:          make(map[string]map[string]int64),
	}
}

func (r *registry) registerAddress(scope, name string, id int64) {
	if _, ok := r.addresses[scope]; !ok {
		r.addresses[scope] = make(map[string]int64)
	}
	r.addresses[scope][name] = id
}

func (r *registry) registerAddressGroup(scope, name string, id int64) {
	if _, ok := r.addressGroups[scope]; !ok {
		r.addressGroups[scope] = make(map[string]int64)
	}
	r.addressGroups[scope][name] = id
}

func (r *registry) registerService(scope, name string, id int64) {
	if _, ok := r.services[scope]; !ok {
		r.services[scope] = make(map[string]int64)
	}
	r.services[scope][name] = id
}

func (r *registry) registerServiceGroup(scope, name string, id int64) {
	if _, ok := r.serviceGroups[scope]; !ok {
		r.serviceGroups[scope] = make(map[string]int64)
	}
	r.serviceGroups[scope][name] = id
}

func (r *registry) registerApplication(scope, name string, id int64) {
	if _, ok := r.applications[scope]; !ok {
		r.applications[scope] = make(map[string]int64)
	}
	r.applications[scope][name] = id
}

func (r *registry) registerApplicationGroup(scope, name string, id int64) {
	if _, ok := r.applicationGroups[scope]; !ok {
		r.applicationGroups[scope] = make(map[string]int64)
	}
	r.applicationGroups[scope][name] = id
}

func (r *registry) registerSchedule(scope, name string, id int64) {
	if _, ok := r.schedules[scope]; !ok {
		r.schedules[scope] = make(map[string]int64)
	}
	r.schedules[scope][name] = id
}

func (r *registry) registerTag(scope, name string, id int64) {
	if _, ok := r.tags[scope]; !ok {
		r.tags[scope] = make(map[string]int64)
	}
	r.tags[scope][name] = id
}

func (r *registry) registerProfile(scope, name string, id int64) {
	if _, ok := r.profiles[scope]; !ok {
		r.profiles[scope] = make(map[string]int64)
	}
	r.profiles[scope][name] = id
}

func (r *registry) resolveAddress(scopes []string, name string) (addrID int64, grpID int64, found bool) {
	for _, sc := range scopes {
		if scopeMap, ok := r.addressGroups[sc]; ok {
			if id, ok := scopeMap[name]; ok {
				return 0, id, true
			}
		}
		if scopeMap, ok := r.addresses[sc]; ok {
			if id, ok := scopeMap[name]; ok {
				return id, 0, true
			}
		}
	}
	return 0, 0, false
}

func (r *registry) resolveService(scopes []string, name string) (srvID int64, grpID int64, found bool) {
	for _, sc := range scopes {
		if scopeMap, ok := r.serviceGroups[sc]; ok {
			if id, ok := scopeMap[name]; ok {
				return 0, id, true
			}
		}
		if scopeMap, ok := r.services[sc]; ok {
			if id, ok := scopeMap[name]; ok {
				return id, 0, true
			}
		}
	}
	return 0, 0, false
}

func (r *registry) resolveApplication(scopes []string, name string) (id int64, found bool) {
	for _, sc := range scopes {
		if scopeMap, ok := r.applications[sc]; ok {
			if id, ok := scopeMap[name]; ok {
				return id, true
			}
		}
	}
	return 0, false
}

func (r *registry) resolveApplicationOrGroup(scopes []string, name string) (appID int64, grpID int64, found bool) {
	for _, sc := range scopes {
		if scopeMap, ok := r.applicationGroups[sc]; ok {
			if id, ok := scopeMap[name]; ok {
				return 0, id, true
			}
		}
		if scopeMap, ok := r.applications[sc]; ok {
			if id, ok := scopeMap[name]; ok {
				return id, 0, true
			}
		}
	}
	return 0, 0, false
}

func (r *registry) resolveSchedule(scopes []string, name string) (id int64, found bool) {
	for _, sc := range scopes {
		if scopeMap, ok := r.schedules[sc]; ok {
			if id, ok := scopeMap[name]; ok {
				return id, true
			}
		}
	}
	return 0, false
}

func (r *registry) resolveTag(scopes []string, name string) (id int64, found bool) {
	for _, sc := range scopes {
		if scopeMap, ok := r.tags[sc]; ok {
			if id, ok := scopeMap[name]; ok {
				return id, true
			}
		}
	}
	return 0, false
}

func (r *registry) resolveProfile(scopes []string, name string) (id int64, found bool) {
	for _, sc := range scopes {
		if scopeMap, ok := r.profiles[sc]; ok {
			if id, ok := scopeMap[name]; ok {
				return id, true
			}
		}
	}
	return 0, false
}

func buildDGInheritance(deviceGroups []XMLDeviceGroup, config *PaloAltoConfig) map[string]string {
	parentMap := make(map[string]string)
	if config != nil && config.ReadOnly != nil {
		for _, dev := range config.ReadOnly.Devices {
			for _, dg := range dev.DeviceGroups {
				if dg.ParentDG != "" {
					parentMap[dg.Name] = dg.ParentDG
				}
			}
		}
	}
	for _, dg := range deviceGroups {
		if dg.Parent != "" {
			parentMap[dg.Name] = dg.Parent
		}
	}
	return parentMap
}

func getScopesForDG(dgName string, parentMap map[string]string) []string {
	scopes := []string{dgName}
	curr := dgName
	for {
		parent, exists := parentMap[curr]
		if !exists || parent == "" {
			break
		}
		scopes = append(scopes, parent)
		curr = parent
	}
	scopes = append(scopes, "shared")
	return scopes
}

func clearDeviceTables(tx *sql.Tx, deviceUUID string) {
	// 1. Delete specific structural entities
	tx.Exec("DELETE FROM device_groups WHERE uuid = ?", deviceUUID)
	tx.Exec("DELETE FROM templates WHERE uuid = ?", deviceUUID)
	tx.Exec("DELETE FROM template_stacks WHERE uuid = ?", deviceUUID)

	// 2. Delete the scope which automatically cascade-deletes objects, rules, topology, and static routes
	tx.Exec("DELETE FROM scopes WHERE uuid = ?", deviceUUID)
}

func insertAddressObjects(tx *sql.Tx, deviceUUID, scope string, entries []XMLAddressEntry, reg *registry) error {
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
			continue
		}
		res, err := stmt.Exec(deviceUUID, scope, entry.Name, addrType, addrVal, entry.Description)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err == nil {
			reg.registerAddress(scope, entry.Name, id)
		}
	}
	return nil
}

func insertAddressGroupsPass1(tx *sql.Tx, deviceUUID, scope string, entries []XMLAddressGroupEntry, reg *registry) error {
	groupStmt, err := tx.Prepare(`
		INSERT INTO address_groups (device_uuid, scope, name, description)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer groupStmt.Close()

	for _, entry := range entries {
		res, err := groupStmt.Exec(deviceUUID, scope, entry.Name, entry.Description)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err == nil {
			reg.registerAddressGroup(scope, entry.Name, id)
		}
	}
	return nil
}

func insertAddressGroupsPass2(tx *sql.Tx, scope string, entries []XMLAddressGroupEntry, reg *registry, dgParentMap map[string]string) error {
	memberStmt, err := tx.Prepare(`
		INSERT INTO address_group_members (group_id, member_address_id, member_group_id, member_name)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer memberStmt.Close()

	scopes := []string{scope}
	if scope != "shared" && !strings.HasPrefix(scope, "vsys:") {
		scopes = getScopesForDG(scope, dgParentMap)
	} else if strings.HasPrefix(scope, "vsys:") {
		scopes = append(scopes, "shared")
	}

	for _, entry := range entries {
		var groupID int64
		if scopeMap, ok := reg.addressGroups[scope]; ok {
			if id, ok := scopeMap[entry.Name]; ok {
				groupID = id
			}
		}
		if groupID == 0 {
			continue
		}

		for _, memberName := range entry.Static {
			addrID, grpID, found := reg.resolveAddress(scopes, memberName)
			if found {
				if addrID > 0 {
					_, err = memberStmt.Exec(groupID, addrID, nil, nil)
				} else {
					_, err = memberStmt.Exec(groupID, nil, grpID, nil)
				}
			} else {
				_, err = memberStmt.Exec(groupID, nil, nil, memberName)
			}
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func insertApplicationGroupsPass1(tx *sql.Tx, deviceUUID, scope string, entries []XMLApplicationGroupEntry, reg *registry) error {
	groupStmt, err := tx.Prepare(`
		INSERT INTO application_groups (device_uuid, scope, name, description)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer groupStmt.Close()

	for _, entry := range entries {
		res, err := groupStmt.Exec(deviceUUID, scope, entry.Name, entry.Description)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err == nil {
			reg.registerApplicationGroup(scope, entry.Name, id)
		}
	}
	return nil
}

func insertApplicationGroupsPass2(tx *sql.Tx, scope string, entries []XMLApplicationGroupEntry, reg *registry, dgParentMap map[string]string) error {
	memberStmt, err := tx.Prepare(`
		INSERT INTO application_group_members (group_id, member_application_id, member_group_id, member_name)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer memberStmt.Close()

	scopes := []string{scope}
	if scope != "shared" && !strings.HasPrefix(scope, "vsys:") {
		scopes = getScopesForDG(scope, dgParentMap)
	} else if strings.HasPrefix(scope, "vsys:") {
		scopes = append(scopes, "shared")
	}

	for _, entry := range entries {
		var groupID int64
		if scopeMap, ok := reg.applicationGroups[scope]; ok {
			if id, ok := scopeMap[entry.Name]; ok {
				groupID = id
			}
		}
		if groupID == 0 {
			continue
		}

		for _, memberName := range entry.Members {
			appID, grpID, found := reg.resolveApplicationOrGroup(scopes, memberName)
			if found {
				if appID > 0 {
					_, err = memberStmt.Exec(groupID, appID, nil, nil)
				} else {
					_, err = memberStmt.Exec(groupID, nil, grpID, nil)
				}
			} else {
				_, err = memberStmt.Exec(groupID, nil, nil, memberName)
			}
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func insertServiceObjects(tx *sql.Tx, deviceUUID, scope string, entries []XMLServiceEntry, reg *registry) error {
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
		res, err := stmt.Exec(deviceUUID, scope, entry.Name, proto, srcPort, destPort, entry.Description)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err == nil {
			reg.registerService(scope, entry.Name, id)
		}
	}
	return nil
}

func insertServiceGroupsPass1(tx *sql.Tx, deviceUUID, scope string, entries []XMLServiceGroupEntry, reg *registry) error {
	groupStmt, err := tx.Prepare(`
		INSERT INTO service_groups (device_uuid, scope, name, description)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer groupStmt.Close()

	for _, entry := range entries {
		res, err := groupStmt.Exec(deviceUUID, scope, entry.Name, entry.Description)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err == nil {
			reg.registerServiceGroup(scope, entry.Name, id)
		}
	}
	return nil
}

func insertServiceGroupsPass2(tx *sql.Tx, scope string, entries []XMLServiceGroupEntry, reg *registry, dgParentMap map[string]string) error {
	memberStmt, err := tx.Prepare(`
		INSERT INTO service_group_members (group_id, member_service_id, member_group_id, member_name)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer memberStmt.Close()

	scopes := []string{scope}
	if scope != "shared" && !strings.HasPrefix(scope, "vsys:") {
		scopes = getScopesForDG(scope, dgParentMap)
	} else if strings.HasPrefix(scope, "vsys:") {
		scopes = append(scopes, "shared")
	}

	for _, entry := range entries {
		var groupID int64
		if scopeMap, ok := reg.serviceGroups[scope]; ok {
			if id, ok := scopeMap[entry.Name]; ok {
				groupID = id
			}
		}
		if groupID == 0 {
			continue
		}

		for _, memberName := range entry.Members {
			srvID, grpID, found := reg.resolveService(scopes, memberName)
			if found {
				if srvID > 0 {
					_, err = memberStmt.Exec(groupID, srvID, nil, nil)
				} else {
					_, err = memberStmt.Exec(groupID, nil, grpID, nil)
				}
			} else {
				_, err = memberStmt.Exec(groupID, nil, nil, memberName)
			}
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func insertApplicationObjects(tx *sql.Tx, deviceUUID, scope string, entries []XMLApplicationEntry, reg *registry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO application_objects (device_uuid, scope, name, category, subcategory, technology, risk, ports, description)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range entries {
		portsStr := strings.Join(entry.Ports, ",")
		res, err := stmt.Exec(deviceUUID, scope, entry.Name, entry.Category, entry.Subcategory, entry.Technology, entry.Risk, portsStr, entry.Description)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err == nil {
			reg.registerApplication(scope, entry.Name, id)
		}
	}
	return nil
}

func insertRegions(tx *sql.Tx, deviceUUID, scope string, entries []XMLRegionEntry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO regions (device_uuid, scope, name, latitude, longitude, addresses)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range entries {
		addrJSON, _ := json.Marshal(entry.Address)
		if _, err := stmt.Exec(deviceUUID, scope, entry.Name, entry.Latitude, entry.Longitude, string(addrJSON)); err != nil {
			return err
		}
	}
	return nil
}

func insertSchedules(tx *sql.Tx, deviceUUID, scope string, entries []XMLScheduleEntry, reg *registry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO schedules (device_uuid, scope, name, schedule_type, schedule_details)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range entries {
		details := strings.TrimSpace(entry.InnerXML)
		typeStr := "recurring"
		if strings.Contains(details, "<non-recurring>") {
			typeStr = "non-recurring"
		}
		res, err := stmt.Exec(deviceUUID, scope, entry.Name, typeStr, details)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err == nil {
			reg.registerSchedule(scope, entry.Name, id)
		}
	}
	return nil
}

func insertTags(tx *sql.Tx, deviceUUID, scope string, entries []XMLTagEntry, reg *registry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO tags (device_uuid, scope, name, color, description)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range entries {
		res, err := stmt.Exec(deviceUUID, scope, entry.Name, entry.Color, entry.Comments)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err == nil {
			reg.registerTag(scope, entry.Name, id)
		}
	}
	return nil
}

func insertSecurityProfiles(tx *sql.Tx, deviceUUID, scope string, profiles XMLProfiles, reg *registry) error {
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
			res, err := stmt.Exec(deviceUUID, scope, entry.Name, typeStr)
			if err != nil {
				return err
			}
			id, err := res.LastInsertId()
			if err == nil {
				reg.registerProfile(scope, entry.Name, id)
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

func insertLogForwardingProfiles(tx *sql.Tx, deviceUUID, scope string, entries []XMLLogSettingsProfileEntry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO log_forwarding_profiles (device_uuid, scope, name, description)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range entries {
		if _, err := stmt.Exec(deviceUUID, scope, entry.Name, entry.Description); err != nil {
			return err
		}
	}
	return nil
}

func insertSecurityProfileGroups(tx *sql.Tx, deviceUUID, scope string, entries []XMLSecurityProfileGroupEntry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO security_profile_groups (device_uuid, scope, name, description, antivirus, spyware, vulnerability, url_filtering, file_blocking, wildfire_analysis, dns_security)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	getFirstMember := func(members []string) string {
		if len(members) > 0 {
			return members[0]
		}
		return ""
	}

	for _, entry := range entries {
		if _, err := stmt.Exec(
			deviceUUID,
			scope,
			entry.Name,
			entry.Description,
			getFirstMember(entry.Antivirus),
			getFirstMember(entry.Spyware),
			getFirstMember(entry.Vulnerability),
			getFirstMember(entry.URLFiltering),
			getFirstMember(entry.FileBlocking),
			getFirstMember(entry.WildfireAnalysis),
			getFirstMember(entry.DNSSecurity),
		); err != nil {
			return err
		}
	}
	return nil
}

func insertCustomURLCategories(tx *sql.Tx, deviceUUID, scope string, entries []XMLCustomURLCategoryEntry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO custom_url_categories (device_uuid, scope, name, description, url_list)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range entries {
		urlList := strings.Join(entry.List, ",")
		if _, err := stmt.Exec(deviceUUID, scope, entry.Name, entry.Description, urlList); err != nil {
			return err
		}
	}
	return nil
}

func insertExternalDynamicLists(tx *sql.Tx, deviceUUID, scope string, entries []XMLExternalListEntry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO external_dynamic_lists (device_uuid, scope, name, description, list_type, source_url, recurring)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range entries {
		if _, err := stmt.Exec(
			deviceUUID,
			scope,
			entry.Name,
			entry.Description,
			entry.Type.String(),
			entry.URL,
			entry.Recurring.String(),
		); err != nil {
			return err
		}
	}
	return nil
}

// Relational Mappings helpers
func insertRuleZones(tx *sql.Tx, ruleType string, ruleID int64, direction string, zones []string) error {
	stmt, err := tx.Prepare(`
		INSERT INTO rule_zone_mappings (rule_type, rule_id, direction, zone_name)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, zone := range zones {
		if zone == "" {
			continue
		}
		if _, err := stmt.Exec(ruleType, ruleID, direction, zone); err != nil {
			return err
		}
	}
	return nil
}

func insertRuleAddresses(tx *sql.Tx, ruleType string, ruleID int64, direction string, addresses []string, scopes []string, reg *registry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO rule_address_mappings (rule_type, rule_id, direction, address_id, group_id, ad_hoc_value)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, addr := range addresses {
		if addr == "" {
			continue
		}
		addrID, grpID, found := reg.resolveAddress(scopes, addr)
		if found {
			if addrID > 0 {
				if _, err := stmt.Exec(ruleType, ruleID, direction, addrID, nil, nil); err != nil {
					return err
				}
			} else {
				if _, err := stmt.Exec(ruleType, ruleID, direction, nil, grpID, nil); err != nil {
					return err
				}
			}
		} else {
			if _, err := stmt.Exec(ruleType, ruleID, direction, nil, nil, addr); err != nil {
				return err
			}
		}
	}
	return nil
}

func insertRuleServices(tx *sql.Tx, ruleType string, ruleID int64, services []string, scopes []string, reg *registry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO rule_service_mappings (rule_type, rule_id, service_id, group_id, ad_hoc_value)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, srv := range services {
		if srv == "" {
			continue
		}
		srvID, grpID, found := reg.resolveService(scopes, srv)
		if found {
			if srvID > 0 {
				if _, err := stmt.Exec(ruleType, ruleID, srvID, nil, nil); err != nil {
					return err
				}
			} else {
				if _, err := stmt.Exec(ruleType, ruleID, nil, grpID, nil); err != nil {
					return err
				}
			}
		} else {
			if _, err := stmt.Exec(ruleType, ruleID, nil, nil, srv); err != nil {
				return err
			}
		}
	}
	return nil
}

func insertRuleApplications(tx *sql.Tx, ruleType string, ruleID int64, applications []string, scopes []string, reg *registry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO rule_application_mappings (rule_type, rule_id, custom_app_id, predefined_app_name)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, app := range applications {
		if app == "" {
			continue
		}
		if appID, found := reg.resolveApplication(scopes, app); found {
			if _, err := stmt.Exec(ruleType, ruleID, appID, nil); err != nil {
				return err
			}
		} else {
			if _, err := stmt.Exec(ruleType, ruleID, nil, app); err != nil {
				return err
			}
		}
	}
	return nil
}

func insertRuleTags(tx *sql.Tx, entityType string, entityID int64, tags []string, scopes []string, reg *registry) error {
	stmt, err := tx.Prepare(`
		INSERT INTO entity_tag_mappings (entity_type, entity_id, tag_id)
		VALUES (?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, tag := range tags {
		if tag == "" {
			continue
		}
		if tagID, found := reg.resolveTag(scopes, tag); found {
			if _, err := stmt.Exec(entityType, entityID, tagID); err != nil {
				return err
			}
		}
	}
	return nil
}

func insertSecurityRules(tx *sql.Tx, deviceUUID, scope string, entries []XMLSecurityRuleEntry, reg *registry, dgParentMap map[string]string) error {
	stmt, err := tx.Prepare(`
		INSERT INTO security_rules (device_uuid, scope, rule_name, description, action, disabled, profile_type, profile_group, schedule_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	scopes := []string{scope}
	if scope != "shared" && !strings.HasPrefix(scope, "vsys:") {
		scopes = getScopesForDG(scope, dgParentMap)
	} else if strings.HasPrefix(scope, "vsys:") {
		scopes = append(scopes, "shared")
	}

	for _, entry := range entries {
		disabled := 0
		if strings.ToLower(entry.Disabled) == "yes" || entry.Disabled == "true" {
			disabled = 1
		}
		action := entry.Action
		if action == "" {
			action = "allow"
		}

		var scheduleID interface{}
		if entry.Schedule != "" {
			if schedID, found := reg.resolveSchedule(scopes, entry.Schedule); found {
				scheduleID = schedID
			}
		}

		res, err := stmt.Exec(
			deviceUUID,
			scope,
			entry.Name,
			entry.Description,
			action,
			disabled,
			nil,
			nil,
			scheduleID,
		)
		if err != nil {
			return err
		}
		ruleID, err := res.LastInsertId()
		if err != nil {
			return err
		}

		insertRuleZones(tx, "security", ruleID, "from", entry.From)
		insertRuleZones(tx, "security", ruleID, "to", entry.To)
		insertRuleAddresses(tx, "security", ruleID, "source", entry.Source, scopes, reg)
		insertRuleAddresses(tx, "security", ruleID, "destination", entry.Destination, scopes, reg)
		insertRuleServices(tx, "security", ruleID, entry.Service, scopes, reg)
		insertRuleApplications(tx, "security", ruleID, entry.Application, scopes, reg)
		insertRuleTags(tx, "security_rule", ruleID, entry.Tag, scopes, reg)
	}
	return nil
}

func insertNATRules(tx *sql.Tx, deviceUUID, scope string, entries []XMLNATRuleEntry, reg *registry, dgParentMap map[string]string) error {
	stmt, err := tx.Prepare(`
		INSERT INTO nat_rules (device_uuid, scope, rule_name, description, disabled, to_zone, service_id, service_group_id, service_ad_hoc, source_translation_type, source_translation_address, destination_translation_address, destination_translation_port)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	scopes := []string{scope}
	if scope != "shared" && !strings.HasPrefix(scope, "vsys:") {
		scopes = getScopesForDG(scope, dgParentMap)
	} else if strings.HasPrefix(scope, "vsys:") {
		scopes = append(scopes, "shared")
	}

	for _, entry := range entries {
		disabled := 0
		if strings.ToLower(entry.Disabled) == "yes" || entry.Disabled == "true" {
			disabled = 1
		}

		toZone := ""
		if len(entry.To) > 0 {
			toZone = entry.To[0]
		}

		var serviceID interface{}
		var serviceGroupID interface{}
		var serviceAdHoc interface{}

		if entry.Service != "" {
			srvID, grpID, found := reg.resolveService(scopes, entry.Service)
			if found {
				if srvID > 0 {
					serviceID = srvID
				} else {
					serviceGroupID = grpID
				}
			} else {
				serviceAdHoc = entry.Service
			}
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

		res, err := stmt.Exec(
			deviceUUID,
			scope,
			entry.Name,
			entry.Description,
			disabled,
			toZone,
			serviceID,
			serviceGroupID,
			serviceAdHoc,
			srcTransType,
			srcTransAddr,
			entry.DestinationTranslation.TranslatedAddress,
			entry.DestinationTranslation.TranslatedPort,
		)
		if err != nil {
			return err
		}
		ruleID, err := res.LastInsertId()
		if err != nil {
			return err
		}

		insertRuleZones(tx, "nat", ruleID, "from", entry.From)
		insertRuleAddresses(tx, "nat", ruleID, "source", entry.Source, scopes, reg)
		insertRuleAddresses(tx, "nat", ruleID, "destination", entry.Destination, scopes, reg)
	}
	return nil
}

func insertQoSRules(tx *sql.Tx, deviceUUID, scope string, entries []XMLQoSRuleEntry, reg *registry, dgParentMap map[string]string) error {
	stmt, err := tx.Prepare(`
		INSERT INTO qos_rules (device_uuid, scope, rule_name, description, disabled, qos_class, dscp_tos_marking, schedule_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	scopes := []string{scope}
	if scope != "shared" && !strings.HasPrefix(scope, "vsys:") {
		scopes = getScopesForDG(scope, dgParentMap)
	} else if strings.HasPrefix(scope, "vsys:") {
		scopes = append(scopes, "shared")
	}

	for _, entry := range entries {
		disabled := 0
		if strings.ToLower(entry.Disabled) == "yes" || entry.Disabled == "true" {
			disabled = 1
		}
		var scheduleID interface{}
		if entry.Schedule != "" {
			if schedID, found := reg.resolveSchedule(scopes, entry.Schedule); found {
				scheduleID = schedID
			}
		}

		res, err := stmt.Exec(
			deviceUUID,
			scope,
			entry.Name,
			entry.Description,
			disabled,
			entry.QoSClass,
			entry.DSCPTOS,
			scheduleID,
		)
		if err != nil {
			return err
		}
		ruleID, err := res.LastInsertId()
		if err != nil {
			return err
		}

		insertRuleZones(tx, "qos", ruleID, "from", entry.From)
		insertRuleZones(tx, "qos", ruleID, "to", entry.To)
		insertRuleAddresses(tx, "qos", ruleID, "source", entry.Source, scopes, reg)
		insertRuleAddresses(tx, "qos", ruleID, "destination", entry.Destination, scopes, reg)
		insertRuleServices(tx, "qos", ruleID, entry.Service, scopes, reg)
		insertRuleApplications(tx, "qos", ruleID, entry.Application, scopes, reg)
	}
	return nil
}

func insertPBFRules(tx *sql.Tx, deviceUUID, scope string, entries []XMLPBFRuleEntry, reg *registry, dgParentMap map[string]string) error {
	stmt, err := tx.Prepare(`
		INSERT INTO pbf_rules (device_uuid, scope, rule_name, description, disabled, action, forward_interface, forward_next_hop, monitor_profile, schedule_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	scopes := []string{scope}
	if scope != "shared" && !strings.HasPrefix(scope, "vsys:") {
		scopes = getScopesForDG(scope, dgParentMap)
	} else if strings.HasPrefix(scope, "vsys:") {
		scopes = append(scopes, "shared")
	}

	for _, entry := range entries {
		disabled := 0
		if strings.ToLower(entry.Disabled) == "yes" || entry.Disabled == "true" {
			disabled = 1
		}
		var scheduleID interface{}
		if entry.Schedule != "" {
			if schedID, found := reg.resolveSchedule(scopes, entry.Schedule); found {
				scheduleID = schedID
			}
		}

		res, err := stmt.Exec(
			deviceUUID,
			scope,
			entry.Name,
			entry.Description,
			disabled,
			entry.Action,
			entry.Forward.Interface,
			entry.Forward.NextHop,
			entry.Forward.Monitor,
			scheduleID,
		)
		if err != nil {
			return err
		}
		ruleID, err := res.LastInsertId()
		if err != nil {
			return err
		}

		insertRuleZones(tx, "pbf", ruleID, "from", entry.From)
		insertRuleAddresses(tx, "pbf", ruleID, "source", entry.Source, scopes, reg)
		insertRuleAddresses(tx, "pbf", ruleID, "destination", entry.Destination, scopes, reg)
		insertRuleServices(tx, "pbf", ruleID, entry.Service, scopes, reg)
		insertRuleApplications(tx, "pbf", ruleID, entry.Application, scopes, reg)
	}
	return nil
}

func insertDecryptionRules(tx *sql.Tx, deviceUUID, scope string, entries []XMLDecryptionRuleEntry, reg *registry, dgParentMap map[string]string) error {
	stmt, err := tx.Prepare(`
		INSERT INTO decryption_rules (device_uuid, scope, rule_name, description, disabled, action, decryption_type, decryption_profile, schedule_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	scopes := []string{scope}
	if scope != "shared" && !strings.HasPrefix(scope, "vsys:") {
		scopes = getScopesForDG(scope, dgParentMap)
	} else if strings.HasPrefix(scope, "vsys:") {
		scopes = append(scopes, "shared")
	}

	for _, entry := range entries {
		disabled := 0
		if strings.ToLower(entry.Disabled) == "yes" || entry.Disabled == "true" {
			disabled = 1
		}
		var scheduleID interface{}
		if entry.Schedule != "" {
			if schedID, found := reg.resolveSchedule(scopes, entry.Schedule); found {
				scheduleID = schedID
			}
		}

		res, err := stmt.Exec(
			deviceUUID,
			scope,
			entry.Name,
			entry.Description,
			disabled,
			entry.Action,
			entry.Type,
			entry.Profile,
			scheduleID,
		)
		if err != nil {
			return err
		}
		ruleID, err := res.LastInsertId()
		if err != nil {
			return err
		}

		insertRuleZones(tx, "decryption", ruleID, "from", entry.From)
		insertRuleZones(tx, "decryption", ruleID, "to", entry.To)
		insertRuleAddresses(tx, "decryption", ruleID, "source", entry.Source, scopes, reg)
		insertRuleAddresses(tx, "decryption", ruleID, "destination", entry.Destination, scopes, reg)
		insertRuleServices(tx, "decryption", ruleID, entry.Service, scopes, reg)
	}
	return nil
}

func insertAppOverrideRules(tx *sql.Tx, deviceUUID, scope string, entries []XMLAppOverrideRuleEntry, reg *registry, dgParentMap map[string]string) error {
	stmt, err := tx.Prepare(`
		INSERT INTO application_override_rules (device_uuid, scope, rule_name, description, disabled, protocol, port, custom_app_id, predefined_app_name)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	scopes := []string{scope}
	if scope != "shared" && !strings.HasPrefix(scope, "vsys:") {
		scopes = getScopesForDG(scope, dgParentMap)
	} else if strings.HasPrefix(scope, "vsys:") {
		scopes = append(scopes, "shared")
	}

	for _, entry := range entries {
		disabled := 0
		if strings.ToLower(entry.Disabled) == "yes" || entry.Disabled == "true" {
			disabled = 1
		}

		var customAppID interface{}
		var predefinedAppName interface{}
		if entry.Application != "" {
			if appID, found := reg.resolveApplication(scopes, entry.Application); found {
				customAppID = appID
			} else {
				predefinedAppName = entry.Application
			}
		}

		res, err := stmt.Exec(
			deviceUUID,
			scope,
			entry.Name,
			entry.Description,
			disabled,
			entry.Protocol,
			entry.Port,
			customAppID,
			predefinedAppName,
		)
		if err != nil {
			return err
		}
		ruleID, err := res.LastInsertId()
		if err != nil {
			return err
		}

		insertRuleZones(tx, "app_override", ruleID, "from", entry.From)
		insertRuleZones(tx, "app_override", ruleID, "to", entry.To)
		insertRuleAddresses(tx, "app_override", ruleID, "source", entry.Source, scopes, reg)
		insertRuleAddresses(tx, "app_override", ruleID, "destination", entry.Destination, scopes, reg)
	}
	return nil
}

func insertTunnelInspectionRules(tx *sql.Tx, deviceUUID, scope string, entries []XMLTunnelInspectionRuleEntry, reg *registry, dgParentMap map[string]string) error {
	stmt, err := tx.Prepare(`
		INSERT INTO tunnel_inspection_rules (device_uuid, scope, rule_name, description, disabled, protocols, action_profile)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	scopes := []string{scope}
	if scope != "shared" && !strings.HasPrefix(scope, "vsys:") {
		scopes = getScopesForDG(scope, dgParentMap)
	} else if strings.HasPrefix(scope, "vsys:") {
		scopes = append(scopes, "shared")
	}

	for _, entry := range entries {
		disabled := 0
		if strings.ToLower(entry.Disabled) == "yes" || entry.Disabled == "true" {
			disabled = 1
		}

		res, err := stmt.Exec(
			deviceUUID,
			scope,
			entry.Name,
			entry.Description,
			disabled,
			strings.Join(entry.Protocols, ","),
			entry.Action,
		)
		if err != nil {
			return err
		}
		ruleID, err := res.LastInsertId()
		if err != nil {
			return err
		}

		insertRuleZones(tx, "tunnel_inspection", ruleID, "from", entry.From)
		insertRuleZones(tx, "tunnel_inspection", ruleID, "to", entry.To)
		insertRuleAddresses(tx, "tunnel_inspection", ruleID, "source", entry.Source, scopes, reg)
		insertRuleAddresses(tx, "tunnel_inspection", ruleID, "destination", entry.Destination, scopes, reg)
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

func (a *Adapter) ParseAndStore(xmlData []byte, filename string, onProgress func(step int, percent int, detail string)) (int, int, error) {
	progress := func(step int, percent int, detail string) {
		if onProgress != nil {
			onProgress(step, percent, detail)
		}
	}
	progress(0, 10, "Parsing XML structure and validating schemas...")

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

	scopeStmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO scopes (uuid, type, reference_id, name, parent_uuid)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to prepare scope statement: %w", err)
	}
	defer scopeStmt.Close()

	dgStmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO device_groups (device_uuid, uuid, name, parent_id)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to prepare device group statement: %w", err)
	}
	defer dgStmt.Close()

	tmplStmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO templates (device_uuid, uuid, name)
		VALUES (?, ?, ?)
	`)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to prepare template statement: %w", err)
	}
	defer tmplStmt.Close()

	stackStmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO template_stacks (device_uuid, uuid, name)
		VALUES (?, ?, ?)
	`)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to prepare template stack statement: %w", err)
	}
	defer stackStmt.Close()

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

	// Instantiate the scope ID registry
	reg := newRegistry()
	dgParentMap := buildDGInheritance(allDeviceGroups, &config)

	// Keep track of internal primary keys to build references
	templateNameToID := make(map[string]int64)
	stackNameToID := make(map[string]int64)
	dgNameToID := make(map[string]int64)

	if isPanorama {
		sharedUUID := "paloalto-panorama-global"
		clearDeviceTables(tx, sharedUUID)
		
		// Register shared scope
		if _, err := scopeStmt.Exec(sharedUUID, "shared", nil, "Shared", nil); err != nil {
			return 0, 0, fmt.Errorf("failed to register shared panorama global scope: %w", err)
		}
		devicesImported++

		// 1. Process templates (network only)
		for _, tmpl := range allTemplates {
			deviceUUID := "panorama-tmpl-" + tmpl.Name
			clearDeviceTables(tx, deviceUUID)

			res, err := tmplStmt.Exec(sharedUUID, deviceUUID, tmpl.Name)
			if err != nil {
				return 0, 0, fmt.Errorf("failed to register template %s: %w", tmpl.Name, err)
			}
			tmplID, _ := res.LastInsertId()
			templateNameToID[tmpl.Name] = tmplID

			if _, err := scopeStmt.Exec(deviceUUID, "template", tmplID, tmpl.Name + " (Panorama)", nil); err != nil {
				return 0, 0, fmt.Errorf("failed to register template scope %s: %w", tmpl.Name, err)
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
			clearDeviceTables(tx, stackUUID)

			res, err := stackStmt.Exec(sharedUUID, stackUUID, stack.Name)
			if err != nil {
				return 0, 0, fmt.Errorf("failed to register template stack %s: %w", stack.Name, err)
			}
			stackID, _ := res.LastInsertId()
			stackNameToID[stack.Name] = stackID

			if _, err := scopeStmt.Exec(stackUUID, "template-stack", stackID, stack.Name + " (Template Stack)", nil); err != nil {
				return 0, 0, fmt.Errorf("failed to register template stack scope %s: %w", stack.Name, err)
			}
			devicesImported++

			for idx, tmplMember := range stack.Templates {
				tmplID, ok := templateNameToID[tmplMember]
				if !ok {
					// Create a placeholder template record to preserve references
					res, err := tmplStmt.Exec(sharedUUID, "panorama-tmpl-"+tmplMember, tmplMember)
					if err != nil {
						return 0, 0, fmt.Errorf("failed to register placeholder template %s: %w", tmplMember, err)
					}
					tmplID, _ = res.LastInsertId()
					templateNameToID[tmplMember] = tmplID

					if _, err := scopeStmt.Exec("panorama-tmpl-"+tmplMember, "template", tmplID, tmplMember + " (Panorama)", nil); err != nil {
						return 0, 0, fmt.Errorf("failed to register placeholder template scope: %w", err)
					}
				}

				if _, err := tx.Exec("INSERT INTO template_stack_members_raw (stack_id, template_id, sequence) VALUES (?, ?, ?)", stackID, tmplID, idx); err != nil {
					return 0, 0, fmt.Errorf("failed to insert template stack member: %w", err)
				}
			}
		}

		// 3. Process Shared / Global Objects
		progress(1, 30, "Synchronizing shared objects and templates...")
		if err := insertAddressObjects(tx, sharedUUID, "shared", config.Shared.Address, reg); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared address objects: %w", err)
		}
		if err := insertServiceObjects(tx, sharedUUID, "shared", config.Shared.Service, reg); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared service objects: %w", err)
		}
		if err := insertApplicationObjects(tx, sharedUUID, "shared", config.Shared.Application, reg); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared application objects: %w", err)
		}
		if err := insertTags(tx, sharedUUID, "shared", config.Shared.Tags, reg); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared tags: %w", err)
		}
		if err := insertSchedules(tx, sharedUUID, "shared", config.Shared.Schedule, reg); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared schedules: %w", err)
		}
		if err := insertRegions(tx, sharedUUID, "shared", config.Shared.Region); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared regions: %w", err)
		}
		if err := insertSecurityProfiles(tx, sharedUUID, "shared", config.Shared.Profiles, reg); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared profiles: %w", err)
		}
		if err := insertLogForwardingProfiles(tx, sharedUUID, "shared", config.Shared.LogSettingsProfiles); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared log forwarding profiles: %w", err)
		}
		if err := insertSecurityProfileGroups(tx, sharedUUID, "shared", config.Shared.SecurityProfileGroups); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared security profile groups: %w", err)
		}
		if err := insertCustomURLCategories(tx, sharedUUID, "shared", config.Shared.Profiles.CustomURLCategories); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared custom url categories: %w", err)
		}
		if err := insertExternalDynamicLists(tx, sharedUUID, "shared", config.Shared.ExternalDynamicLists); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared external dynamic lists: %w", err)
		}

		// Address / Service / Application groups Pass 1 (insert groups)
		if err := insertAddressGroupsPass1(tx, sharedUUID, "shared", config.Shared.AddressGroup, reg); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared address groups: %w", err)
		}
		if err := insertServiceGroupsPass1(tx, sharedUUID, "shared", config.Shared.ServiceGroup, reg); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared service groups: %w", err)
		}
		if err := insertApplicationGroupsPass1(tx, sharedUUID, "shared", config.Shared.ApplicationGroups, reg); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared application groups: %w", err)
		}

		// Address / Service / Application groups Pass 2 (insert members)
		if err := insertAddressGroupsPass2(tx, "shared", config.Shared.AddressGroup, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to resolve shared address group members: %w", err)
		}
		if err := insertServiceGroupsPass2(tx, "shared", config.Shared.ServiceGroup, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to resolve shared service group members: %w", err)
		}
		if err := insertApplicationGroupsPass2(tx, "shared", config.Shared.ApplicationGroups, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to resolve shared application group members: %w", err)
		}

		// 4. Process Device Groups (Pass 1 - Insert DG and Scopes)
		progress(2, 55, "Synchronizing Device Group contexts...")
		// Register default implicit "shared" root device group context
		clearDeviceTables(tx, "paloalto-dg-shared")
		resShared, err := dgStmt.Exec(sharedUUID, "paloalto-dg-shared", "shared", nil)
		if err != nil {
			return 0, 0, fmt.Errorf("failed to register root shared device group: %w", err)
		}
		sharedDgID, _ := resShared.LastInsertId()
		dgNameToID["shared"] = sharedDgID

		if _, err := scopeStmt.Exec("paloalto-dg-shared", "device-group", sharedDgID, "shared", nil); err != nil {
			return 0, 0, fmt.Errorf("failed to register root shared device group scope: %w", err)
		}

		for _, dg := range allDeviceGroups {
			dgUUID := "paloalto-dg-" + dg.Name
			clearDeviceTables(tx, dgUUID)

			res, err := dgStmt.Exec(sharedUUID, dgUUID, dg.Name, nil)
			if err != nil {
				return 0, 0, fmt.Errorf("failed to register device group %s: %w", dg.Name, err)
			}
			dgID, _ := res.LastInsertId()
			dgNameToID[dg.Name] = dgID

			if _, err := scopeStmt.Exec(dgUUID, "device-group", dgID, dg.Name + " (Device Group)", nil); err != nil {
				return 0, 0, fmt.Errorf("failed to register device group scope %s: %w", dg.Name, err)
			}
			devicesImported++

			if err := insertAddressObjects(tx, dgUUID, dg.Name, dg.Address, reg); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg address objects for %s: %w", dg.Name, err)
			}
			if err := insertServiceObjects(tx, dgUUID, dg.Name, dg.Service, reg); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg service objects for %s: %w", dg.Name, err)
			}
			if err := insertApplicationObjects(tx, dgUUID, dg.Name, dg.Application, reg); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg application objects for %s: %w", dg.Name, err)
			}
			if err := insertTags(tx, dgUUID, dg.Name, dg.Tags, reg); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg tags for %s: %w", dg.Name, err)
			}
			if err := insertSchedules(tx, dgUUID, dg.Name, dg.Schedule, reg); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg schedules for %s: %w", dg.Name, err)
			}
			if err := insertRegions(tx, dgUUID, dg.Name, dg.Region); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg regions for %s: %w", dg.Name, err)
			}
			if err := insertSecurityProfiles(tx, dgUUID, dg.Name, dg.Profiles, reg); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg profiles for %s: %w", dg.Name, err)
			}
			if err := insertLogForwardingProfiles(tx, dgUUID, dg.Name, dg.LogSettingsProfiles); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg log forwarding profiles for %s: %w", dg.Name, err)
			}
			if err := insertSecurityProfileGroups(tx, dgUUID, dg.Name, dg.SecurityProfileGroups); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg security profile groups for %s: %w", dg.Name, err)
			}
			if err := insertCustomURLCategories(tx, dgUUID, dg.Name, dg.Profiles.CustomURLCategories); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg custom url categories for %s: %w", dg.Name, err)
			}
			if err := insertExternalDynamicLists(tx, dgUUID, dg.Name, dg.ExternalDynamicLists); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg external dynamic lists for %s: %w", dg.Name, err)
			}

			// Groups Pass 1
			if err := insertAddressGroupsPass1(tx, dgUUID, dg.Name, dg.AddressGroup, reg); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg address groups for %s: %w", dg.Name, err)
			}
			if err := insertServiceGroupsPass1(tx, dgUUID, dg.Name, dg.ServiceGroup, reg); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg service groups for %s: %w", dg.Name, err)
			}
			if err := insertApplicationGroupsPass1(tx, dgUUID, dg.Name, dg.ApplicationGroups, reg); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg application groups for %s: %w", dg.Name, err)
			}

			// Groups Pass 2
			if err := insertAddressGroupsPass2(tx, dg.Name, dg.AddressGroup, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to resolve dg address group members for %s: %w", dg.Name, err)
			}
			if err := insertServiceGroupsPass2(tx, dg.Name, dg.ServiceGroup, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to resolve dg service group members for %s: %w", dg.Name, err)
			}
			if err := insertApplicationGroupsPass2(tx, dg.Name, dg.ApplicationGroups, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to resolve dg application group members for %s: %w", dg.Name, err)
			}
		}

		// Device Groups (Pass 2 - Resolve parent relationships)
		for _, dg := range allDeviceGroups {
			dgID := dgNameToID[dg.Name]
			// Default to parent group "shared" if no explicit parent group is configured in the XML
			var parentID interface{} = sharedDgID
			var parentScopeUUID interface{} = "paloalto-dg-shared"

			if parentName, ok := dgParentMap[dg.Name]; ok && parentName != "" {
				if pid, ok := dgNameToID[parentName]; ok {
					parentID = pid
					parentScopeUUID = "paloalto-dg-" + parentName
				}
			} else if dg.Parent != "" {
				if pid, ok := dgNameToID[dg.Parent]; ok {
					parentID = pid
					parentScopeUUID = "paloalto-dg-" + dg.Parent
				}
			}
			tx.Exec("UPDATE device_groups SET parent_id = ? WHERE id = ?", parentID, dgID)
			tx.Exec("UPDATE scopes SET parent_uuid = ? WHERE type = 'device-group' AND reference_id = ?", parentScopeUUID, dgID)
		}

		// 5. Write shared rules
		progress(3, 75, "Compiling security rules and policy bases...")
		if err := insertSecurityRules(tx, sharedUUID, "shared:pre", config.Shared.PreRulebase.SecurityRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared pre-security rules: %w", err)
		}
		if err := insertSecurityRules(tx, sharedUUID, "shared:post", config.Shared.PostRulebase.SecurityRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared post-security rules: %w", err)
		}
		if err := insertNATRules(tx, sharedUUID, "shared:pre", config.Shared.PreRulebase.NATRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared pre-nat rules: %w", err)
		}
		if err := insertNATRules(tx, sharedUUID, "shared:post", config.Shared.PostRulebase.NATRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared post-nat rules: %w", err)
		}
		if err := insertQoSRules(tx, sharedUUID, "shared:pre", config.Shared.PreRulebase.QoSRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared pre-qos rules: %w", err)
		}
		if err := insertQoSRules(tx, sharedUUID, "shared:post", config.Shared.PostRulebase.QoSRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared post-qos rules: %w", err)
		}
		if err := insertPBFRules(tx, sharedUUID, "shared:pre", config.Shared.PreRulebase.PBFRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared pre-pbf rules: %w", err)
		}
		if err := insertPBFRules(tx, sharedUUID, "shared:post", config.Shared.PostRulebase.PBFRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared post-pbf rules: %w", err)
		}
		if err := insertDecryptionRules(tx, sharedUUID, "shared:pre", config.Shared.PreRulebase.DecryptionRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared pre-decryption rules: %w", err)
		}
		if err := insertDecryptionRules(tx, sharedUUID, "shared:post", config.Shared.PostRulebase.DecryptionRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared post-decryption rules: %w", err)
		}
		if err := insertAppOverrideRules(tx, sharedUUID, "shared:pre", config.Shared.PreRulebase.AppOverrideRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared pre-override rules: %w", err)
		}
		if err := insertAppOverrideRules(tx, sharedUUID, "shared:post", config.Shared.PostRulebase.AppOverrideRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared post-override rules: %w", err)
		}
		if err := insertTunnelInspectionRules(tx, sharedUUID, "shared:pre", config.Shared.PreRulebase.TunnelInspectionRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared pre-tunnel inspection rules: %w", err)
		}
		if err := insertTunnelInspectionRules(tx, sharedUUID, "shared:post", config.Shared.PostRulebase.TunnelInspectionRules, reg, dgParentMap); err != nil {
			return 0, 0, fmt.Errorf("failed to insert shared post-tunnel inspection rules: %w", err)
		}

		// 6. Write device group rules
		for _, dg := range allDeviceGroups {
			dgUUID := "paloalto-dg-" + dg.Name

			if err := insertSecurityRules(tx, dgUUID, dg.Name+":pre", dg.PreRulebase.SecurityRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg pre-security rules for %s: %w", dg.Name, err)
			}
			if err := insertSecurityRules(tx, dgUUID, dg.Name+":post", dg.PostRulebase.SecurityRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg post-security rules for %s: %w", dg.Name, err)
			}
			if err := insertNATRules(tx, dgUUID, dg.Name+":pre", dg.PreRulebase.NATRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg pre-nat rules for %s: %w", dg.Name, err)
			}
			if err := insertNATRules(tx, dgUUID, dg.Name+":post", dg.PostRulebase.NATRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg post-nat rules for %s: %w", dg.Name, err)
			}
			if err := insertQoSRules(tx, dgUUID, dg.Name+":pre", dg.PreRulebase.QoSRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg pre-qos rules for %s: %w", dg.Name, err)
			}
			if err := insertQoSRules(tx, dgUUID, dg.Name+":post", dg.PostRulebase.QoSRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg post-qos rules for %s: %w", dg.Name, err)
			}
			if err := insertPBFRules(tx, dgUUID, dg.Name+":pre", dg.PreRulebase.PBFRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg pre-pbf rules for %s: %w", dg.Name, err)
			}
			if err := insertPBFRules(tx, dgUUID, dg.Name+":post", dg.PostRulebase.PBFRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg post-pbf rules for %s: %w", dg.Name, err)
			}
			if err := insertDecryptionRules(tx, dgUUID, dg.Name+":pre", dg.PreRulebase.DecryptionRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg pre-decryption rules for %s: %w", dg.Name, err)
			}
			if err := insertDecryptionRules(tx, dgUUID, dg.Name+":post", dg.PostRulebase.DecryptionRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg post-decryption rules for %s: %w", dg.Name, err)
			}
			if err := insertAppOverrideRules(tx, dgUUID, dg.Name+":pre", dg.PreRulebase.AppOverrideRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg pre-override rules for %s: %w", dg.Name, err)
			}
			if err := insertAppOverrideRules(tx, dgUUID, dg.Name+":post", dg.PostRulebase.AppOverrideRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg post-override rules for %s: %w", dg.Name, err)
			}
			if err := insertTunnelInspectionRules(tx, dgUUID, dg.Name+":pre", dg.PreRulebase.TunnelInspectionRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg pre-tunnel inspection rules for %s: %w", dg.Name, err)
			}
			if err := insertTunnelInspectionRules(tx, dgUUID, dg.Name+":post", dg.PostRulebase.TunnelInspectionRules, reg, dgParentMap); err != nil {
				return 0, 0, fmt.Errorf("failed to insert dg post-tunnel inspection rules for %s: %w", dg.Name, err)
			}
		}

		// 7. Write managed devices ledger
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
			INSERT OR REPLACE INTO managed_devices_raw (device_uuid, serial, name, ip_address, device_group_id, template_stack_id, template_id)
			VALUES (?, ?, ?, ?, ?, ?, ?)
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
					var existingName string
					err := tx.QueryRow("SELECT name FROM scopes WHERE uuid LIKE ?", "%-"+mdev.Serial).Scan(&existingName)
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
					var existingIP string
					err := tx.QueryRow("SELECT ip_address FROM managed_devices WHERE serial = ?", mdev.Serial).Scan(&existingIP)
					if err == nil && existingIP != "" {
						ipAddr = existingIP
					}
				}

				var dgID, stackID, tmplID interface{}
				if dgName != "" {
					if id, ok := dgNameToID[dgName]; ok {
						dgID = id
					}
				}
				if stackName != "" {
					if id, ok := stackNameToID[stackName]; ok {
						stackID = id
					} else if id, ok := templateNameToID[stackName]; ok {
						tmplID = id
					}
				}

				devUUID := "paloalto-fw-" + name + "-" + mdev.Serial
				
				// Register scope for this firewall if it does not exist
				var exists int
				tx.QueryRow("SELECT COUNT(*) FROM scopes WHERE uuid = ?", devUUID).Scan(&exists)
				if exists == 0 {
					var parentScopeUUID interface{}
					if dgName != "" {
						parentScopeUUID = "paloalto-dg-" + dgName
					} else if stackName != "" {
						parentScopeUUID = "panorama-stack-" + stackName
					}
					
					if _, err := tx.Exec("INSERT INTO scopes (uuid, type, reference_id, name, parent_uuid) VALUES (?, 'firewall', NULL, ?, ?)", devUUID, name, parentScopeUUID); err != nil {
						slog.Error("Failed to register firewall scope", slog.String("error", err.Error()))
					}
				}

				res, err := managedDevStmt.Exec(devUUID, mdev.Serial, name, ipAddr, dgID, stackID, tmplID)
				if err != nil {
					slog.Error("Failed to insert managed device", slog.String("error", err.Error()))
				} else {
					newID, err := res.LastInsertId()
					if err == nil {
						tx.Exec("UPDATE scopes SET reference_id = ? WHERE uuid = ?", newID, devUUID)
					}
				}
			}
		}

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
				tx.Exec("UPDATE scopes SET parent_uuid = ? WHERE uuid LIKE ?", parentUUID, "%-"+mdev.Serial)
			}
		}

	} else {
		// --- STANDALONE FIREWALL PIPELINE ---
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

			var parentScopeUUID interface{}
			if serial != "" {
				var dgID, stackID sql.NullInt64
				err := tx.QueryRow("SELECT device_group_id, template_stack_id FROM managed_devices_raw WHERE serial = ?", serial).Scan(&dgID, &stackID)
				if err == nil {
					if dgID.Valid {
						var dgUUID string
						if err := tx.QueryRow("SELECT uuid FROM device_groups WHERE id = ?", dgID.Int64).Scan(&dgUUID); err == nil {
							parentScopeUUID = dgUUID
						}
					} else if stackID.Valid {
						var stackUUID string
						if err := tx.QueryRow("SELECT uuid FROM template_stacks WHERE id = ?", stackID.Int64).Scan(&stackUUID); err == nil {
							parentScopeUUID = stackUUID
						}
					}
				}
			}

			var existingDeviceUUID string
			if serial != "" {
				tx.QueryRow("SELECT device_uuid FROM managed_devices_raw WHERE serial = ?", serial).Scan(&existingDeviceUUID)
			}

			// Protect the managed_devices_raw row from cascade delete when the scope is cleared
			if existingDeviceUUID != "" {
				tx.Exec("INSERT OR IGNORE INTO scopes (uuid, type, name) VALUES ('paloalto-temp-placeholder', 'shared', 'Temporary Placeholder')")
				tx.Exec("UPDATE managed_devices_raw SET device_uuid = 'paloalto-temp-placeholder' WHERE serial = ?", serial)
			}

			clearDeviceTables(tx, deviceUUID)

			// Register scope
			if _, err := scopeStmt.Exec(deviceUUID, "firewall", nil, deviceName, parentScopeUUID); err != nil {
				return 0, 0, fmt.Errorf("failed to register standalone firewall scope: %w", err)
			}
			devicesImported++

			if serial != "" {
				if existingDeviceUUID != "" {
					if mgmtIP != "" {
						tx.Exec("UPDATE managed_devices_raw SET name = ?, ip_address = ?, device_uuid = ? WHERE serial = ?", deviceName, mgmtIP, deviceUUID, serial)
					} else {
						tx.Exec("UPDATE managed_devices_raw SET name = ?, device_uuid = ? WHERE serial = ?", deviceName, deviceUUID, serial)
					}
					// Update scope reference ID
					var mdevID int64
					if err := tx.QueryRow("SELECT id FROM managed_devices_raw WHERE serial = ?", serial).Scan(&mdevID); err == nil {
						tx.Exec("UPDATE scopes SET reference_id = ? WHERE uuid = ?", mdevID, deviceUUID)
					}
					// If the device name changed (resulting in a new UUID), clean up the old scope context
					if existingDeviceUUID != deviceUUID && strings.HasPrefix(existingDeviceUUID, "paloalto-fw-") {
						tx.Exec("DELETE FROM scopes WHERE uuid = ?", existingDeviceUUID)
					}
				} else {
					parentCtxUUID := deviceUUID
					res, err := tx.Exec(`
						INSERT OR REPLACE INTO managed_devices_raw (device_uuid, serial, name, ip_address, device_group_id, template_stack_id, template_id)
						VALUES (?, ?, ?, ?, NULL, NULL, NULL)
					`, parentCtxUUID, serial, deviceName, mgmtIP)
					if err != nil {
						return 0, 0, fmt.Errorf("failed to insert managed device: %w", err)
					}
					mdevID, _ := res.LastInsertId()
					tx.Exec("UPDATE scopes SET reference_id = ? WHERE uuid = ?", mdevID, deviceUUID)
				}
			}

			// Clean up the placeholder if it was created
			if existingDeviceUUID != "" {
				tx.Exec("DELETE FROM scopes WHERE uuid = 'paloalto-temp-placeholder'")
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

			// Parse VSYS (Objects and Policies)
			for _, vsys := range dev.Vsys {
				scope := "vsys:" + vsys.Name

				if err := insertAddressObjects(tx, deviceUUID, scope, vsys.Address, reg); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys address objects: %w", err)
				}
				if err := insertServiceObjects(tx, deviceUUID, scope, vsys.Service, reg); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys service objects: %w", err)
				}
				if err := insertApplicationObjects(tx, deviceUUID, scope, vsys.Application, reg); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys custom applications: %w", err)
				}
				if err := insertTags(tx, deviceUUID, scope, vsys.Tags, reg); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys tags: %w", err)
				}
				if err := insertSchedules(tx, deviceUUID, scope, vsys.Schedule, reg); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys schedules: %w", err)
				}
				if err := insertRegions(tx, deviceUUID, scope, vsys.Region); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys regions: %w", err)
				}
				if err := insertSecurityProfiles(tx, deviceUUID, scope, vsys.Profiles, reg); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys profiles: %w", err)
				}
				if err := insertLogForwardingProfiles(tx, deviceUUID, scope, vsys.LogSettingsProfiles); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys log forwarding profiles: %w", err)
				}
				if err := insertSecurityProfileGroups(tx, deviceUUID, scope, vsys.SecurityProfileGroups); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys security profile groups: %w", err)
				}
				if err := insertCustomURLCategories(tx, deviceUUID, scope, vsys.Profiles.CustomURLCategories); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys custom url categories: %w", err)
				}
				if err := insertExternalDynamicLists(tx, deviceUUID, scope, vsys.ExternalDynamicLists); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys external dynamic lists: %w", err)
				}

				// Groups Pass 1
				if err := insertAddressGroupsPass1(tx, deviceUUID, scope, vsys.AddressGroup, reg); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys address groups: %w", err)
				}
				if err := insertServiceGroupsPass1(tx, deviceUUID, scope, vsys.ServiceGroup, reg); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys service groups: %w", err)
				}
				if err := insertApplicationGroupsPass1(tx, deviceUUID, scope, vsys.ApplicationGroups, reg); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys application groups: %w", err)
				}

				// Groups Pass 2
				if err := insertAddressGroupsPass2(tx, scope, vsys.AddressGroup, reg, dgParentMap); err != nil {
					return 0, 0, fmt.Errorf("failed to resolve vsys address group members: %w", err)
				}
				if err := insertServiceGroupsPass2(tx, scope, vsys.ServiceGroup, reg, dgParentMap); err != nil {
					return 0, 0, fmt.Errorf("failed to resolve vsys service group members: %w", err)
				}
				if err := insertApplicationGroupsPass2(tx, scope, vsys.ApplicationGroups, reg, dgParentMap); err != nil {
					return 0, 0, fmt.Errorf("failed to resolve vsys application group members: %w", err)
				}

				// Rules
				if err := insertSecurityRules(tx, deviceUUID, scope, vsys.SecurityRules, reg, dgParentMap); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys security rules: %w", err)
				}
				if err := insertNATRules(tx, deviceUUID, scope, vsys.NATRules, reg, dgParentMap); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys nat rules: %w", err)
				}
				if err := insertQoSRules(tx, deviceUUID, scope, vsys.QoSRules, reg, dgParentMap); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys qos rules: %w", err)
				}
				if err := insertPBFRules(tx, deviceUUID, scope, vsys.PBFRules, reg, dgParentMap); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys pbf rules: %w", err)
				}
				if err := insertDecryptionRules(tx, deviceUUID, scope, vsys.DecryptionRules, reg, dgParentMap); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys decryption rules: %w", err)
				}
				if err := insertAppOverrideRules(tx, deviceUUID, scope, vsys.AppOverrideRules, reg, dgParentMap); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys app override rules: %w", err)
				}
				if err := insertTunnelInspectionRules(tx, deviceUUID, scope, vsys.TunnelInspectionRules, reg, dgParentMap); err != nil {
					return 0, 0, fmt.Errorf("failed to insert vsys tunnel inspection rules: %w", err)
				}
			}
		}
	}

	// Clean up orphaned mapping tables once at the end of the transaction using optimized NOT EXISTS queries
	progress(4, 90, "Committing transaction updates to SQLite database...")
	if _, err := tx.Exec(`
		DELETE FROM rule_address_mappings 
		WHERE NOT EXISTS (
			SELECT 1 FROM security_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM nat_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM qos_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM pbf_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM decryption_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM application_override_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM tunnel_inspection_rules WHERE id = rule_id
		)
	`); err != nil {
		return 0, 0, fmt.Errorf("failed to clean up orphaned rule address mappings: %w", err)
	}
	if _, err := tx.Exec(`
		DELETE FROM rule_service_mappings 
		WHERE NOT EXISTS (
			SELECT 1 FROM security_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM nat_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM qos_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM pbf_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM decryption_rules WHERE id = rule_id
		)
	`); err != nil {
		return 0, 0, fmt.Errorf("failed to clean up orphaned rule service mappings: %w", err)
	}
	if _, err := tx.Exec(`
		DELETE FROM rule_application_mappings 
		WHERE NOT EXISTS (
			SELECT 1 FROM security_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM qos_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM pbf_rules WHERE id = rule_id
		)
	`); err != nil {
		return 0, 0, fmt.Errorf("failed to clean up orphaned rule application mappings: %w", err)
	}
	if _, err := tx.Exec(`
		DELETE FROM rule_zone_mappings 
		WHERE NOT EXISTS (
			SELECT 1 FROM security_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM nat_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM qos_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM pbf_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM decryption_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM application_override_rules WHERE id = rule_id
			UNION ALL SELECT 1 FROM tunnel_inspection_rules WHERE id = rule_id
		)
	`); err != nil {
		return 0, 0, fmt.Errorf("failed to clean up orphaned rule zone mappings: %w", err)
	}
	if _, err := tx.Exec(`
		DELETE FROM entity_tag_mappings 
		WHERE NOT EXISTS (
			SELECT 1 FROM tags WHERE id = tag_id
		)
	`); err != nil {
		return 0, 0, fmt.Errorf("failed to clean up orphaned entity tag mappings: %w", err)
	}
	if _, err := tx.Exec(`
		DELETE FROM security_rule_profiles 
		WHERE NOT EXISTS (
			SELECT 1 FROM security_rules WHERE id = rule_id
		)
	`); err != nil {
		return 0, 0, fmt.Errorf("failed to clean up orphaned security rule profiles: %w", err)
	}
	// Automated Self-Healing: Provision missing metadata table entries (device_groups, templates, template_stacks, managed_devices_raw)
	// for any placeholder scopes created during objects or rules ingestion.
	
	// 1. Repair missing device groups
	if dgRows, err := tx.Query(`
		SELECT uuid, name 
		FROM scopes 
		WHERE type = 'device-group' 
		  AND uuid NOT IN (SELECT uuid FROM device_groups)
	`); err == nil {
		type missingDG struct {
			UUID string
			Name string
		}
		var missingDGs []missingDG
		for dgRows.Next() {
			var m missingDG
			if err := dgRows.Scan(&m.UUID, &m.Name); err == nil {
				missingDGs = append(missingDGs, m)
			}
		}
		dgRows.Close()

		var sharedID int64
		_ = tx.QueryRow("SELECT id FROM device_groups WHERE uuid = 'paloalto-dg-shared'").Scan(&sharedID)

		for _, dg := range missingDGs {
			cleanName := strings.Replace(dg.Name, " (Device Group)", "", 1)
			if cleanName == "shared" {
				continue
			}
			res, err := tx.Exec(`
				INSERT INTO device_groups (device_uuid, uuid, name, parent_id)
				VALUES (?, ?, ?, ?)
			`, "paloalto-panorama-global", dg.UUID, cleanName, sharedID)
			if err == nil {
				newID, _ := res.LastInsertId()
				tx.Exec("UPDATE scopes SET reference_id = ? WHERE uuid = ?", newID, dg.UUID)
			}
		}
	}

	// 2. Repair missing templates
	if tmplRows, err := tx.Query(`
		SELECT uuid, name 
		FROM scopes 
		WHERE type = 'template' 
		  AND uuid NOT IN (SELECT uuid FROM templates)
	`); err == nil {
		type missingTmpl struct {
			UUID string
			Name string
		}
		var missingTmpls []missingTmpl
		for tmplRows.Next() {
			var m missingTmpl
			if err := tmplRows.Scan(&m.UUID, &m.Name); err == nil {
				missingTmpls = append(missingTmpls, m)
			}
		}
		tmplRows.Close()

		for _, t := range missingTmpls {
			cleanName := strings.Replace(t.Name, " (Panorama)", "", 1)
			res, err := tx.Exec(`
				INSERT INTO templates (device_uuid, uuid, name)
				VALUES (?, ?, ?)
			`, "paloalto-panorama-global", t.UUID, cleanName)
			if err == nil {
				newID, _ := res.LastInsertId()
				tx.Exec("UPDATE scopes SET reference_id = ? WHERE uuid = ?", newID, t.UUID)
			}
		}
	}

	// 3. Repair missing template stacks
	if stackRows, err := tx.Query(`
		SELECT uuid, name 
		FROM scopes 
		WHERE type = 'template-stack' 
		  AND uuid NOT IN (SELECT uuid FROM template_stacks)
	`); err == nil {
		type missingStack struct {
			UUID string
			Name string
		}
		var missingStacks []missingStack
		for stackRows.Next() {
			var m missingStack
			if err := stackRows.Scan(&m.UUID, &m.Name); err == nil {
				missingStacks = append(missingStacks, m)
			}
		}
		stackRows.Close()

		for _, s := range missingStacks {
			cleanName := strings.Replace(s.Name, " (Template Stack)", "", 1)
			res, err := tx.Exec(`
				INSERT INTO template_stacks (device_uuid, uuid, name)
				VALUES (?, ?, ?)
			`, "paloalto-panorama-global", s.UUID, cleanName)
			if err == nil {
				newID, _ := res.LastInsertId()
				tx.Exec("UPDATE scopes SET reference_id = ? WHERE uuid = ?", newID, s.UUID)
			}
		}
	}

	// 4. Repair missing firewalls (managed devices)
	if fwRows, err := tx.Query(`
		SELECT uuid, name 
		FROM scopes 
		WHERE type = 'firewall' 
		  AND uuid NOT IN (SELECT device_uuid FROM managed_devices_raw)
	`); err == nil {
		type missingFW struct {
			UUID string
			Name string
		}
		var missingFWs []missingFW
		for fwRows.Next() {
			var m missingFW
			if err := fwRows.Scan(&m.UUID, &m.Name); err == nil {
				missingFWs = append(missingFWs, m)
			}
		}
		fwRows.Close()

		for _, f := range missingFWs {
			serial := ""
			parts := strings.Split(f.UUID, "-")
			if len(parts) >= 4 {
				serial = parts[len(parts)-1]
			} else {
				serial = f.UUID
			}
			res, err := tx.Exec(`
				INSERT INTO managed_devices_raw (device_uuid, serial, name, ip_address, device_group_id, template_stack_id, template_id)
				VALUES (?, ?, ?, NULL, NULL, NULL, NULL)
			`, f.UUID, serial, f.Name)
			if err == nil {
				newID, _ := res.LastInsertId()
				tx.Exec("UPDATE scopes SET reference_id = ? WHERE uuid = ?", newID, f.UUID)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, 0, fmt.Errorf("failed to commit transaction: %w", err)
	}

	progress(5, 100, "Ingestion complete!")

	return devicesImported, topologyImported, nil
}

// Comparative pre-flight helpers

func (a *Adapter) compareAddressObjects(deviceUUID, scope string, entries []XMLAddressEntry) (added, modified, unchanged int, err error) {
	if len(entries) == 0 {
		return 0, 0, 0, nil
	}
	rows, err := a.store.DB().Query("SELECT name, type, value, description FROM address_objects WHERE device_uuid = ? AND scope = ?", deviceUUID, scope)
	if err != nil {
		return 0, 0, 0, err
	}
	defer rows.Close()

	type dbAddr struct {
		Type        string
		Value       string
		Description string
	}
	existing := make(map[string]dbAddr)
	for rows.Next() {
		var name string
		var val dbAddr
		var desc sql.NullString
		if err := rows.Scan(&name, &val.Type, &val.Value, &desc); err != nil {
			return 0, 0, 0, err
		}
		val.Description = desc.String
		existing[name] = val
	}

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
			continue
		}

		dbVal, ok := existing[entry.Name]
		if !ok {
			added++
		} else {
			if dbVal.Type == addrType && dbVal.Value == addrVal && dbVal.Description == entry.Description {
				unchanged++
			} else {
				modified++
			}
		}
	}
	return added, modified, unchanged, nil
}

func (a *Adapter) compareServiceObjects(deviceUUID, scope string, entries []XMLServiceEntry) (added, modified, unchanged int, err error) {
	if len(entries) == 0 {
		return 0, 0, 0, nil
	}
	rows, err := a.store.DB().Query("SELECT name, protocol, source_port, destination_port, description FROM service_objects WHERE device_uuid = ? AND scope = ?", deviceUUID, scope)
	if err != nil {
		return 0, 0, 0, err
	}
	defer rows.Close()

	type dbSrv struct {
		Protocol        string
		SourcePort      string
		DestinationPort string
		Description     string
	}
	existing := make(map[string]dbSrv)
	for rows.Next() {
		var name string
		var val dbSrv
		var srcPort sql.NullString
		var desc sql.NullString
		if err := rows.Scan(&name, &val.Protocol, &srcPort, &val.DestinationPort, &desc); err != nil {
			return 0, 0, 0, err
		}
		val.SourcePort = srcPort.String
		val.Description = desc.String
		existing[name] = val
	}

	for _, entry := range entries {
		var proto, srcPort, destPort string
		if entry.TCP != nil {
			proto = "tcp"
			destPort = entry.TCP.Port
			srcPort = entry.TCP.SourcePort
		} else if entry.UDP != nil {
			proto = "udp"
			destPort = entry.UDP.Port
			srcPort = entry.UDP.SourcePort
		}
		if proto == "" {
			continue
		}

		dbVal, ok := existing[entry.Name]
		if !ok {
			added++
		} else {
			if dbVal.Protocol == proto && dbVal.SourcePort == srcPort && dbVal.DestinationPort == destPort && dbVal.Description == entry.Description {
				unchanged++
			} else {
				modified++
			}
		}
	}
	return added, modified, unchanged, nil
}

func (a *Adapter) compareAddressGroups(deviceUUID, scope string, entries []XMLAddressGroupEntry) (added, modified, unchanged int, err error) {
	if len(entries) == 0 {
		return 0, 0, 0, nil
	}

	rows, err := a.store.DB().Query("SELECT id, name, description FROM address_groups WHERE device_uuid = ? AND scope = ?", deviceUUID, scope)
	if err != nil {
		return 0, 0, 0, err
	}
	defer rows.Close()

	type dbGroup struct {
		ID          int64
		Description string
	}
	groupMap := make(map[string]dbGroup)
	for rows.Next() {
		var name string
		var val dbGroup
		var desc sql.NullString
		if err := rows.Scan(&val.ID, &name, &desc); err != nil {
			return 0, 0, 0, err
		}
		val.Description = desc.String
		groupMap[name] = val
	}

	memberRows, err := a.store.DB().Query(`
		SELECT ag.name, COALESCE(ao.name, COALESCE(ag2.name, agm.member_name)) AS member_name
		FROM address_group_members agm
		JOIN address_groups ag ON agm.group_id = ag.id
		LEFT JOIN address_objects ao ON agm.member_address_id = ao.id
		LEFT JOIN address_groups ag2 ON agm.member_group_id = ag2.id
		WHERE ag.device_uuid = ? AND ag.scope = ?
	`, deviceUUID, scope)
	if err != nil {
		return 0, 0, 0, err
	}
	defer memberRows.Close()

	groupMembers := make(map[string][]string)
	for memberRows.Next() {
		var groupName, memberName string
		if err := memberRows.Scan(&groupName, &memberName); err != nil {
			return 0, 0, 0, err
		}
		groupMembers[groupName] = append(groupMembers[groupName], memberName)
	}

	for _, entry := range entries {
		dbGrp, ok := groupMap[entry.Name]
		if !ok {
			added++
			continue
		}

		if dbGrp.Description != entry.Description {
			modified++
			continue
		}

		dbMem := groupMembers[entry.Name]
		xmlMem := make([]string, len(entry.Static))
		copy(xmlMem, entry.Static)
		sort.Strings(xmlMem)
		sort.Strings(dbMem)

		if len(xmlMem) != len(dbMem) {
			modified++
			continue
		}

		mismatch := false
		for i := range xmlMem {
			if xmlMem[i] != dbMem[i] {
				mismatch = true
				break
			}
		}

		if mismatch {
			modified++
		} else {
			unchanged++
		}
	}
	return added, modified, unchanged, nil
}

func (a *Adapter) compareServiceGroups(deviceUUID, scope string, entries []XMLServiceGroupEntry) (added, modified, unchanged int, err error) {
	if len(entries) == 0 {
		return 0, 0, 0, nil
	}

	rows, err := a.store.DB().Query("SELECT id, name, description FROM service_groups WHERE device_uuid = ? AND scope = ?", deviceUUID, scope)
	if err != nil {
		return 0, 0, 0, err
	}
	defer rows.Close()

	type dbGroup struct {
		ID          int64
		Description string
	}
	groupMap := make(map[string]dbGroup)
	for rows.Next() {
		var name string
		var val dbGroup
		var desc sql.NullString
		if err := rows.Scan(&val.ID, &name, &desc); err != nil {
			return 0, 0, 0, err
		}
		val.Description = desc.String
		groupMap[name] = val
	}

	memberRows, err := a.store.DB().Query(`
		SELECT sg.name, COALESCE(so.name, COALESCE(sg2.name, sgm.member_name)) AS member_name
		FROM service_group_members sgm
		JOIN service_groups sg ON sgm.group_id = sg.id
		LEFT JOIN service_objects so ON sgm.member_service_id = so.id
		LEFT JOIN service_groups sg2 ON sgm.member_group_id = sg2.id
		WHERE sg.device_uuid = ? AND sg.scope = ?
	`, deviceUUID, scope)
	if err != nil {
		return 0, 0, 0, err
	}
	defer memberRows.Close()

	groupMembers := make(map[string][]string)
	for memberRows.Next() {
		var groupName, memberName string
		if err := memberRows.Scan(&groupName, &memberName); err != nil {
			return 0, 0, 0, err
		}
		groupMembers[groupName] = append(groupMembers[groupName], memberName)
	}

	for _, entry := range entries {
		dbGrp, ok := groupMap[entry.Name]
		if !ok {
			added++
			continue
		}

		if dbGrp.Description != entry.Description {
			modified++
			continue
		}

		dbMem := groupMembers[entry.Name]
		xmlMem := make([]string, len(entry.Members))
		copy(xmlMem, entry.Members)
		sort.Strings(xmlMem)
		sort.Strings(dbMem)

		if len(xmlMem) != len(dbMem) {
			modified++
			continue
		}

		mismatch := false
		for i := range xmlMem {
			if xmlMem[i] != dbMem[i] {
				mismatch = true
				break
			}
		}

		if mismatch {
			modified++
		} else {
			unchanged++
		}
	}
	return added, modified, unchanged, nil
}

func (a *Adapter) compareApplicationObjects(deviceUUID, scope string, entries []XMLApplicationEntry) (added, modified, unchanged int, err error) {
	if len(entries) == 0 {
		return 0, 0, 0, nil
	}

	rows, err := a.store.DB().Query("SELECT name, category, subcategory, technology, risk, ports, description FROM application_objects WHERE device_uuid = ? AND scope = ?", deviceUUID, scope)
	if err != nil {
		return 0, 0, 0, err
	}
	defer rows.Close()

	type dbApp struct {
		Category    string
		Subcategory string
		Technology  string
		Risk        int
		Ports       string
		Description string
	}
	existing := make(map[string]dbApp)
	for rows.Next() {
		var name string
		var val dbApp
		var desc sql.NullString
		var ports sql.NullString
		if err := rows.Scan(&name, &val.Category, &val.Subcategory, &val.Technology, &val.Risk, &ports, &desc); err != nil {
			return 0, 0, 0, err
		}
		val.Ports = ports.String
		val.Description = desc.String
		existing[name] = val
	}

	for _, entry := range entries {
		portsStr := strings.Join(entry.Ports, ",")
		dbVal, ok := existing[entry.Name]
		if !ok {
			added++
		} else {
			if dbVal.Category == entry.Category &&
				dbVal.Subcategory == entry.Subcategory &&
				dbVal.Technology == entry.Technology &&
				dbVal.Risk == entry.Risk &&
				dbVal.Ports == portsStr &&
				dbVal.Description == entry.Description {
				unchanged++
			} else {
				modified++
			}
		}
	}
	return added, modified, unchanged, nil
}

func (a *Adapter) IsPanoramaConfig(xmlData []byte) bool {
	var config PaloAltoConfig
	if err := xml.Unmarshal(xmlData, &config); err != nil {
		return false
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
	return len(allTemplates) > 0 || len(allDeviceGroups) > 0 || len(allTemplateStacks) > 0 || hasShared
}
