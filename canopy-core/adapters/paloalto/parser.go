package paloalto

import (
	"encoding/json"
	"encoding/xml"
	"fmt"

	"canopy-core/storage"
)

// Adapter provides a structural ingestion bridge for Palo Alto XML configurations.
type Adapter struct {
	store *storage.AppStateDB
}

// NewAdapter initializes a new Palo Alto parser adapter with the provided storage engine.
func NewAdapter(store *storage.AppStateDB) *Adapter {
	return &Adapter{
		store: store,
	}
}

// PaloAltoConfig represents the root XML structure for a Palo Alto appliance.
// It specifically targets the structural network tree and security zones layout.
type PaloAltoConfig struct {
	XMLName xml.Name `xml:"config"`
	Devices struct {
		Entry struct {
			Network struct {
				Interface struct {
					Ethernet []InterfaceNode `xml:"ethernet>entry"`
				} `xml:"interface"`
				VirtualRouter struct {
					Entry []VirtualRouterNode `xml:"virtual-router>entry"`
				} `xml:"virtual-router"`
			} `xml:"network"`
			Vsys struct {
				Entry struct {
					Import struct {
						Network struct {
							Interface struct {
								Members []string `xml:"member"`
							} `xml:"interface"`
						} `xml:"network"`
					} `xml:"import"`
					Zone struct {
						Entry []ZoneNode `xml:"zone>entry"`
					} `xml:"zone"`
				} `xml:"entry"`
			} `xml:"vsys"`
		} `xml:"entry"`
	} `xml:"devices"`
}

// InterfaceNode extracts ethernet configurations and assigned IPv4 CIDRs.
type InterfaceNode struct {
	Name string `xml:"name,attr"`
	IPs  []struct {
		Name string `xml:"name,attr"`
	} `xml:"layer3>ip>entry"`
}

// ZoneNode extracts security zones and their governing interface members.
type ZoneNode struct {
	Name    string `xml:"name,attr"`
	Network struct {
		Layer3 struct {
			Members []string `xml:"member"`
		} `xml:"layer3"`
	} `xml:"network"`
}

// VirtualRouterNode extracts the routing table interface bindings.
type VirtualRouterNode struct {
	Name       string `xml:"name,attr"`
	Interfaces struct {
		Members []string `xml:"member"`
	} `xml:"interface"`
}

// VendorMetadata structure for the JSON blob column per STORAGE_SCHEMA.md.
type VendorMetadata struct {
	VirtualRouter string   `json:"vr"`
	Tags          []string `json:"tags,omitempty"`
}

// ParseAndStore processes the XML byte array, extracts topological features,
// and safely writes them into the network_topology SQLite table via a managed transaction.
func (a *Adapter) ParseAndStore(deviceUUID string, xmlData []byte) error {
	var config PaloAltoConfig
	if err := xml.Unmarshal(xmlData, &config); err != nil {
		return fmt.Errorf("failed to unmarshal palo alto xml stream: %w", err)
	}

	// 1. Map Interfaces to their Security Zones
	interfaceToZone := make(map[string]string)
	for _, zone := range config.Devices.Entry.Vsys.Entry.Zone.Entry {
		for _, member := range zone.Network.Layer3.Members {
			interfaceToZone[member] = zone.Name
		}
	}

	// 2. Map Interfaces to their Virtual Routers
	interfaceToVR := make(map[string]string)
	for _, vr := range config.Devices.Entry.Network.VirtualRouter.Entry {
		for _, member := range vr.Interfaces.Members {
			interfaceToVR[member] = vr.Name
		}
	}

	// Enforce single-threaded write constraint for WAL journaling
	a.store.WriteLock()
	defer a.store.WriteUnlock()

	// Acquire the actual DB handle and initiate transaction
	tx, err := a.store.DB().Begin()
	if err != nil {
		return fmt.Errorf("failed to begin topology transaction: %w", err)
	}
	defer tx.Rollback()

	// Pre-compile the statement for bulk inserting efficiency
	stmt, err := tx.Prepare(`
		INSERT INTO network_topology (device_uuid, interface_name, network_cidr, zone_name, vendor_metadata)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare insert statement: %w", err)
	}
	defer stmt.Close()

	// 3. Process Ethernet Interfaces and store layout mapping
	for _, eth := range config.Devices.Entry.Network.Interface.Ethernet {
		zoneName, ok := interfaceToZone[eth.Name]
		if !ok {
			zoneName = "untrusted" // Fallback bounding zone
		}

		vrName, ok := interfaceToVR[eth.Name]
		if !ok {
			vrName = "default" // Fallback virtual router
		}

		// Pack vendor-exclusive metadata into JSON format
		metadata := VendorMetadata{
			VirtualRouter: vrName,
			Tags:          []string{"paloalto-structural-import"},
		}
		metaBytes, err := json.Marshal(metadata)
		if err != nil {
			return fmt.Errorf("failed to serialize vendor metadata for interface %s: %w", eth.Name, err)
		}

		for _, ip := range eth.IPs {
			if _, err := stmt.Exec(deviceUUID, eth.Name, ip.Name, zoneName, string(metaBytes)); err != nil {
				return fmt.Errorf("failed to insert topology row for %s: %w", eth.Name, err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit topology changes to database: %w", err)
	}

	return nil
}
