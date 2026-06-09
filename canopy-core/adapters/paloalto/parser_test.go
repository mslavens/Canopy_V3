package paloalto

import (
	"os"
	"testing"

	"canopy-core/storage"
)

const standardFirewallXML = `
<config>
  <devices>
    <entry name="fw-standalone-test">
      <deviceconfig>
        <system>
          <ip-address>192.168.1.1</ip-address>
          <hostname>fw-standalone-test</hostname>
          <serial>0123456789</serial>
        </system>
      </deviceconfig>
      <network>
        <interface>
          <ethernet>
            <entry name="ethernet1/1">
              <layer3>
                <ip>
                  <entry name="10.1.1.1/24"/>
                </ip>
              </layer3>
            </entry>
          </ethernet>
        </interface>
        <virtual-router>
          <entry name="vr-outside">
            <interface>
              <member>ethernet1/1</member>
            </interface>
          </entry>
        </virtual-router>
      </network>
      <vsys>
        <entry name="vsys1">
          <zone>
            <entry name="OutsideZone">
              <network>
                <layer3>
                  <member>ethernet1/1</member>
                </layer3>
              </network>
            </entry>
          </zone>
        </entry>
      </vsys>
    </entry>
  </devices>
</config>
`

const panoramaXML = `
<config>
  <template>
    <entry name="TemplateCorp">
      <config>
        <devices>
          <entry name="localhost.localdomain">
            <network>
              <interface>
                <ethernet>
                  <entry name="ethernet1/2">
                    <layer3>
                      <ip>
                        <entry name="192.168.10.1/24"/>
                      </ip>
                    </layer3>
                  </entry>
                </ethernet>
              </interface>
              <virtual-router>
                <entry name="vr-inside">
                  <interface>
                    <member>ethernet1/2</member>
                  </interface>
                  <routing-table>
                    <ip>
                      <static-route>
                        <entry name="DefaultRoute">
                          <destination>0.0.0.0/0</destination>
                          <interface>ethernet1/2</interface>
                          <nexthop>
                            <ip-address>192.168.10.254</ip-address>
                          </nexthop>
                          <metric>10</metric>
                        </entry>
                      </static-route>
                    </ip>
                  </routing-table>
                </entry>
              </virtual-router>
            </network>
            <vsys>
              <entry name="vsys1">
                <zone>
                  <entry name="InsideZone">
                    <network>
                      <layer3>
                        <member>ethernet1/2</member>
                      </layer3>
                    </network>
                  </entry>
                </zone>
              </entry>
            </vsys>
          </entry>
        </devices>
      </config>
    </entry>
  </template>
  <template-stack>
    <entry name="CorpStack">
      <templates>
        <member>TemplateCorp</member>
      </templates>
      <devices>
        <member>0123456789</member>
      </devices>
    </entry>
  </template-stack>
  <shared>
    <address>
      <entry name="Shared_Host_1">
        <ip-netmask>10.100.1.5/32</ip-netmask>
        <description>Test shared host</description>
      </entry>
    </address>
    <address-group>
      <entry name="Shared_Grp_1">
        <static>
          <member>Shared_Host_1</member>
        </static>
        <description>Test shared group</description>
      </entry>
    </address-group>
    <service>
      <entry name="TCP_8080">
        <protocol>
          <tcp>
            <port>8080</port>
          </tcp>
        </protocol>
        <description>Custom tcp service</description>
      </entry>
    </service>
    <pre-rulebase>
      <security>
        <rules>
          <entry name="Pre_Rule_1">
            <from><member>InsideZone</member></from>
            <to><member>OutsideZone</member></to>
            <source><member>any</member></source>
            <destination><member>Shared_Host_1</member></destination>
            <service><member>TCP_8080</member></service>
            <application><member>any</member></application>
            <action>allow</action>
            <disabled>no</disabled>
            <description>Pre-rule example</description>
          </entry>
        </rules>
      </security>
      <nat>
        <rules>
          <entry name="Pre_NAT_1">
            <from><member>InsideZone</member></from>
            <to><member>OutsideZone</member></to>
            <source><member>any</member></source>
            <destination><member>any</member></destination>
            <service>any</service>
            <disabled>no</disabled>
            <source-translation>
              <dynamic-ip-port>
                <translated-address>
                  <member>1.1.1.1</member>
                </translated-address>
              </dynamic-ip-port>
            </source-translation>
          </entry>
        </rules>
      </nat>
    </pre-rulebase>
    <tag>
      <entry name="TagCorp">
        <color>color3</color>
        <comments>Tag comment</comments>
      </entry>
    </tag>
    <profiles>
      <url-filtering>
        <entry name="Profile_URL_1"/>
      </url-filtering>
    </profiles>
    <managed-devices>
      <entry name="0123456789">
        <ip-address>10.0.0.5</ip-address>
        <hostname>fw-corp-branch</hostname>
      </entry>
    </managed-devices>
  </shared>
  <device-group>
    <entry name="CorpDG">
      <address>
        <entry name="DG_Host_1">
          <ip-netmask>192.168.20.5/32</ip-netmask>
        </entry>
      </address>
      <devices>
        <entry name="0123456789"/>
      </devices>
    </entry>
  </device-group>
</config>
`
const nestedPanoramaXML = `
<config>
  <devices>
    <entry name="localhost.localdomain">
      <template>
        <entry name="NestedTemplateCorp">
          <config>
            <devices>
              <entry name="localhost.localdomain">
                <network>
                  <interface>
                    <ethernet>
                      <entry name="ethernet1/2">
                        <layer3>
                          <ip>
                            <entry name="192.168.10.1/24"/>
                          </ip>
                        </layer3>
                      </entry>
                    </ethernet>
                  </interface>
                </network>
              </entry>
            </devices>
          </config>
        </entry>
      </template>
      <template-stack>
        <entry name="NestedCorpStack">
          <templates>
            <member>NestedTemplateCorp</member>
          </templates>
          <devices>
            <member>0123456789</member>
          </devices>
        </entry>
      </template-stack>
      <device-group>
        <entry name="NestedCorpDG">
          <address>
            <entry name="NestedDG_Host_1">
              <ip-netmask>192.168.20.5/32</ip-netmask>
            </entry>
          </address>
          <devices>
            <entry name="0123456789"/>
          </devices>
        </entry>
      </device-group>
    </entry>
  </devices>
  <mgt-config>
    <devices>
      <entry name="0123456789">
        <ip-address>10.0.0.5</ip-address>
        <hostname>nested-fw-branch</hostname>
      </entry>
    </devices>
  </mgt-config>
</config>
`


func TestParser(t *testing.T) {
	// Setup a temporary directory for the sqlite DB
	tmpDir, err := os.MkdirTemp("", "canopy-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	os.Setenv("CANOPY_DATA_PATH", tmpDir)
	defer os.Unsetenv("CANOPY_DATA_PATH")

	// Initialize the sqlite database
	db, err := storage.Initialize("test_state.db", "secretpassphrase")
	if err != nil {
		t.Fatalf("failed to initialize sqlite: %v", err)
	}
	defer db.Close()

	// Provision tables
	queries := []string{
		`CREATE TABLE IF NOT EXISTS devices (
			uuid TEXT PRIMARY KEY,
			name TEXT,
			vendor TEXT,
			parent_uuid TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (parent_uuid) REFERENCES devices(uuid) ON DELETE SET NULL
		);`,
		`CREATE TABLE IF NOT EXISTS network_topology (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			device_uuid TEXT NOT NULL,
			interface_name TEXT NOT NULL,
			network_cidr TEXT NOT NULL,
			zone_name TEXT NOT NULL,
			vendor_metadata TEXT,
			FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS template_stacks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			device_uuid TEXT NOT NULL,
			name TEXT NOT NULL,
			FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS template_stack_members (
			stack_id INTEGER NOT NULL,
			template_name TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			PRIMARY KEY (stack_id, template_name),
			FOREIGN KEY (stack_id) REFERENCES template_stacks(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS address_objects (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			device_uuid TEXT NOT NULL,
			scope TEXT NOT NULL,
			name TEXT NOT NULL,
			type TEXT NOT NULL,
			value TEXT NOT NULL,
			description TEXT,
			FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS address_groups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			device_uuid TEXT NOT NULL,
			scope TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT,
			FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS address_group_members (
			group_id INTEGER,
			member_name TEXT NOT NULL,
			PRIMARY KEY (group_id, member_name),
			FOREIGN KEY (group_id) REFERENCES address_groups(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS service_objects (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			device_uuid TEXT NOT NULL,
			scope TEXT NOT NULL,
			name TEXT NOT NULL,
			protocol TEXT NOT NULL,
			source_port TEXT,
			destination_port TEXT NOT NULL,
			description TEXT,
			FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS service_groups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			device_uuid TEXT NOT NULL,
			scope TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT,
			FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS service_group_members (
			group_id INTEGER,
			member_name TEXT NOT NULL,
			PRIMARY KEY (group_id, member_name),
			FOREIGN KEY (group_id) REFERENCES service_groups(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS security_rules (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			device_uuid TEXT NOT NULL,
			scope TEXT NOT NULL,
			rule_name TEXT NOT NULL,
			description TEXT,
			action TEXT NOT NULL,
			disabled INTEGER DEFAULT 0,
			from_zones TEXT,
			to_zones TEXT,
			source_addresses TEXT,
			destination_addresses TEXT,
			services TEXT,
			applications TEXT,
			FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS nat_rules (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			device_uuid TEXT NOT NULL,
			scope TEXT NOT NULL,
			rule_name TEXT NOT NULL,
			description TEXT,
			disabled INTEGER DEFAULT 0,
			from_zones TEXT,
			to_zone TEXT,
			source_addresses TEXT,
			destination_addresses TEXT,
			service TEXT,
			source_translation_type TEXT,
			source_translation_address TEXT,
			destination_translation_address TEXT,
			destination_translation_port TEXT,
			FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS static_routes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			device_uuid TEXT NOT NULL,
			vr_name TEXT NOT NULL,
			route_name TEXT NOT NULL,
			destination TEXT NOT NULL,
			nexthop TEXT,
			interface TEXT,
			metric INTEGER DEFAULT 10,
			admin_distance INTEGER DEFAULT 10,
			FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS managed_devices (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			device_uuid TEXT NOT NULL,
			serial TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			ip_address TEXT,
			device_group TEXT,
			template_stack TEXT,
			FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			device_uuid TEXT NOT NULL,
			scope TEXT NOT NULL,
			name TEXT NOT NULL,
			color TEXT,
			description TEXT,
			FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS security_profiles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			device_uuid TEXT NOT NULL,
			scope TEXT NOT NULL,
			name TEXT NOT NULL,
			type TEXT NOT NULL,
			FOREIGN KEY (device_uuid) REFERENCES devices(uuid) ON DELETE CASCADE
		);`,
	}

	for _, q := range queries {
		if _, err := db.DB().Exec(q); err != nil {
			t.Fatalf("failed to run migrations: %v", err)
		}
	}

	adapter := NewAdapter(db)

	t.Run("Standalone Firewall XML Import", func(t *testing.T) {
		devCount, topoCount, err := adapter.ParseAndStore([]byte(standardFirewallXML), "fw-standalone-test.xml")
		if err != nil {
			t.Fatalf("ParseAndStore failed: %v", err)
		}

		if devCount != 1 {
			t.Errorf("expected 1 device, got %d", devCount)
		}
		if topoCount != 1 {
			t.Errorf("expected 1 topology entry, got %d", topoCount)
		}

		// Verify database rows
		var name, vendor string
		err = db.DB().QueryRow("SELECT name, vendor FROM devices WHERE uuid = 'paloalto-fw-fw-standalone-test-0123456789'").Scan(&name, &vendor)
		if err != nil {
			t.Fatalf("failed to scan device: %v", err)
		}
		if name != "fw-standalone-test" || vendor != "PaloAlto" {
			t.Errorf("incorrect device data: name=%s, vendor=%s", name, vendor)
		}

		var ifName, cidr, zone, meta string
		err = db.DB().QueryRow("SELECT interface_name, network_cidr, zone_name, vendor_metadata FROM network_topology WHERE device_uuid = 'paloalto-fw-fw-standalone-test-0123456789'").Scan(&ifName, &cidr, &zone, &meta)
		if err != nil {
			t.Fatalf("failed to scan topology: %v", err)
		}

		if ifName != "ethernet1/1" || cidr != "10.1.1.1/24" || zone != "OutsideZone" {
			t.Errorf("incorrect topology details: name=%s, cidr=%s, zone=%s", ifName, cidr, zone)
		}

		// Verify managed_devices entry was created for standalone firewall
		var mdevSerial, mdevName, mdevIP string
		err = db.DB().QueryRow("SELECT serial, name, ip_address FROM managed_devices WHERE serial = '0123456789'").Scan(&mdevSerial, &mdevName, &mdevIP)
		if err != nil {
			t.Fatalf("failed to query managed device: %v", err)
		}
		if mdevSerial != "0123456789" || mdevName != "fw-standalone-test" || mdevIP != "192.168.1.1" {
			t.Errorf("incorrect managed device details: serial=%s, name=%s, ip=%s", mdevSerial, mdevName, mdevIP)
		}
	})

	t.Run("Panorama Template XML Import", func(t *testing.T) {
		devCount, topoCount, err := adapter.ParseAndStore([]byte(panoramaXML), "panorama.xml")
		if err != nil {
			t.Fatalf("ParseAndStore failed: %v", err)
		}

		if devCount != 4 {
			t.Errorf("expected 4 devices, got %d", devCount)
		}
		if topoCount != 1 {
			t.Errorf("expected 1 topology entry, got %d", topoCount)
		}

		// Verify database rows for template device
		var name, vendor string
		err = db.DB().QueryRow("SELECT name, vendor FROM devices WHERE uuid = 'panorama-tmpl-TemplateCorp'").Scan(&name, &vendor)
		if err != nil {
			t.Fatalf("failed to scan device: %v", err)
		}
		if name != "TemplateCorp (Panorama)" || vendor != "PaloAlto" {
			t.Errorf("incorrect device data: name=%s, vendor=%s", name, vendor)
		}

		var ifName, cidr, zone, meta string
		err = db.DB().QueryRow("SELECT interface_name, network_cidr, zone_name, vendor_metadata FROM network_topology WHERE device_uuid = 'panorama-tmpl-TemplateCorp'").Scan(&ifName, &cidr, &zone, &meta)
		if err != nil {
			t.Fatalf("failed to scan topology: %v", err)
		}

		if ifName != "ethernet1/2" || cidr != "192.168.10.1/24" || zone != "InsideZone" {
			t.Errorf("incorrect topology details: name=%s, cidr=%s, zone=%s", ifName, cidr, zone)
		}

		// Verify template stack and stack members
		var stackUUID, stackName string
		err = db.DB().QueryRow("SELECT uuid, name FROM devices WHERE uuid = 'panorama-stack-CorpStack'").Scan(&stackUUID, &stackName)
		if err != nil {
			t.Fatalf("failed to query template stack device: %v", err)
		}
		if stackName != "CorpStack (Template Stack)" {
			t.Errorf("expected stack name CorpStack (Template Stack), got %q", stackName)
		}

		var stackDbName string
		err = db.DB().QueryRow("SELECT name FROM template_stacks WHERE device_uuid = 'paloalto-panorama-global'").Scan(&stackDbName)
		if err != nil {
			t.Fatalf("failed to query template stack table: %v", err)
		}
		if stackDbName != "CorpStack" {
			t.Errorf("expected stack table name CorpStack, got %q", stackDbName)
		}

		// Verify shared address object and groups
		var addrName, addrVal, addrScope string
		err = db.DB().QueryRow("SELECT name, value, scope FROM address_objects WHERE device_uuid = 'paloalto-panorama-global' AND name = 'Shared_Host_1'").Scan(&addrName, &addrVal, &addrScope)
		if err != nil {
			t.Fatalf("failed to query address object: %v", err)
		}
		if addrVal != "10.100.1.5/32" || addrScope != "shared" {
			t.Errorf("unexpected address object properties: val=%s, scope=%s", addrVal, addrScope)
		}

		// Verify device-group address objects
		var dgAddrVal, dgAddrScope string
		err = db.DB().QueryRow("SELECT value, scope FROM address_objects WHERE device_uuid = 'paloalto-dg-CorpDG' AND name = 'DG_Host_1'").Scan(&dgAddrVal, &dgAddrScope)
		if err != nil {
			t.Fatalf("failed to query DG address object: %v", err)
		}
		if dgAddrVal != "192.168.20.5/32" || dgAddrScope != "device-group" {
			t.Errorf("unexpected DG address object properties: val=%s, scope=%s", dgAddrVal, dgAddrScope)
		}

		// Verify shared security rules
		var ruleAction, ruleScope, ruleSrc, ruleDest, ruleSvc string
		err = db.DB().QueryRow("SELECT action, scope, source_addresses, destination_addresses, services FROM security_rules WHERE device_uuid = 'paloalto-panorama-global' AND rule_name = 'Pre_Rule_1'").Scan(&ruleAction, &ruleScope, &ruleSrc, &ruleDest, &ruleSvc)
		if err != nil {
			t.Fatalf("failed to query security rule: %v", err)
		}
		if ruleAction != "allow" || ruleScope != "shared:pre" || ruleSrc != "any" || ruleDest != "Shared_Host_1" || ruleSvc != "TCP_8080" {
			t.Errorf("unexpected security rule properties: action=%s, scope=%s, source=%s, dest=%s, service=%s", ruleAction, ruleScope, ruleSrc, ruleDest, ruleSvc)
		}

		// Verify shared tags
		var tagColor string
		err = db.DB().QueryRow("SELECT color FROM tags WHERE device_uuid = 'paloalto-panorama-global' AND name = 'TagCorp'").Scan(&tagColor)
		if err != nil {
			t.Fatalf("failed to query tag: %v", err)
		}
		if tagColor != "color3" {
			t.Errorf("expected tag color color3, got %q", tagColor)
		}

		// Verify shared profiles
		var profileType string
		err = db.DB().QueryRow("SELECT type FROM security_profiles WHERE device_uuid = 'paloalto-panorama-global' AND name = 'Profile_URL_1'").Scan(&profileType)
		if err != nil {
			t.Fatalf("failed to query security profile: %v", err)
		}
		if profileType != "url-filtering" {
			t.Errorf("expected profile type url-filtering, got %q", profileType)
		}

		// Verify templates static routes
		var routeDest, routeNexthop string
		err = db.DB().QueryRow("SELECT destination, nexthop FROM static_routes WHERE device_uuid = 'panorama-tmpl-TemplateCorp' AND route_name = 'DefaultRoute'").Scan(&routeDest, &routeNexthop)
		if err != nil {
			t.Fatalf("failed to query static route: %v", err)
		}
		if routeDest != "0.0.0.0/0" || routeNexthop != "192.168.10.254" {
			t.Errorf("unexpected static route details: dest=%s, nexthop=%s", routeDest, routeNexthop)
		}

		// Verify managed devices
		var mdevSerial, mdevName, mdevIP, mdevDG, mdevStack string
		err = db.DB().QueryRow("SELECT serial, name, ip_address, device_group, template_stack FROM managed_devices WHERE device_uuid = 'paloalto-panorama-global' AND serial = '0123456789'").Scan(&mdevSerial, &mdevName, &mdevIP, &mdevDG, &mdevStack)
		if err != nil {
			t.Fatalf("failed to query managed device: %v", err)
		}
		if mdevSerial != "0123456789" || mdevName != "fw-corp-branch" || mdevIP != "10.0.0.5" || mdevDG != "CorpDG" || mdevStack != "CorpStack" {
			t.Errorf("unexpected managed device details: serial=%s, name=%s, ip=%s, dg=%s, stack=%s", mdevSerial, mdevName, mdevIP, mdevDG, mdevStack)
		}
	})

	t.Run("Panorama Nested Template XML Import", func(t *testing.T) {
		devCount, topoCount, err := adapter.ParseAndStore([]byte(nestedPanoramaXML), "panorama_nested.xml")
		if err != nil {
			t.Fatalf("ParseAndStore nested failed: %v", err)
		}

		if devCount != 4 { // Global, Template stack, Template, Device group
			t.Errorf("expected 4 devices, got %d", devCount)
		}
		_ = topoCount

		// Verify database rows for template device
		var name, vendor string
		err = db.DB().QueryRow("SELECT name, vendor FROM devices WHERE uuid = 'panorama-tmpl-NestedTemplateCorp'").Scan(&name, &vendor)
		if err != nil {
			t.Fatalf("failed to scan nested template device: %v", err)
		}
		if name != "NestedTemplateCorp (Panorama)" || vendor != "PaloAlto" {
			t.Errorf("incorrect device data: name=%s, vendor=%s", name, vendor)
		}

		// Verify device-group address objects
		var dgAddrVal, dgAddrScope string
		err = db.DB().QueryRow("SELECT value, scope FROM address_objects WHERE device_uuid = 'paloalto-dg-NestedCorpDG' AND name = 'NestedDG_Host_1'").Scan(&dgAddrVal, &dgAddrScope)
		if err != nil {
			t.Fatalf("failed to query nested DG address object: %v", err)
		}
		if dgAddrVal != "192.168.20.5/32" || dgAddrScope != "device-group" {
			t.Errorf("unexpected DG address object properties: val=%s, scope=%s", dgAddrVal, dgAddrScope)
		}

		// Verify managed devices loaded from mgt-config
		var mdevSerial, mdevName, mdevIP, mdevDG, mdevStack string
		err = db.DB().QueryRow("SELECT serial, name, ip_address, device_group, template_stack FROM managed_devices WHERE device_uuid = 'paloalto-panorama-global' AND serial = '0123456789'").Scan(&mdevSerial, &mdevName, &mdevIP, &mdevDG, &mdevStack)
		if err != nil {
			t.Fatalf("failed to query managed device from mgt-config: %v", err)
		}
		if mdevSerial != "0123456789" || mdevName != "nested-fw-branch" || mdevIP != "10.0.0.5" || mdevDG != "NestedCorpDG" || mdevStack != "NestedCorpStack" {
			t.Errorf("unexpected managed device details: serial=%s, name=%s, ip=%s, dg=%s, stack=%s", mdevSerial, mdevName, mdevIP, mdevDG, mdevStack)
		}

		// Import a standalone config for the nested firewall using filename pattern with serial
		_, _, err = adapter.ParseAndStore([]byte(standardFirewallXML), "nested-fw-branch-updated_0123456789.xml")
		if err != nil {
			t.Fatalf("failed to import standalone config after Panorama: %v", err)
		}

		// Verify standalone device in devices table now has parent_uuid set to the device group NestCorpDG
		var parentUUID string
		err = db.DB().QueryRow("SELECT parent_uuid FROM devices WHERE uuid = 'paloalto-fw-nested-fw-branch-updated-0123456789'").Scan(&parentUUID)
		if err != nil {
			t.Fatalf("failed to query standalone device after import: %v", err)
		}
		if parentUUID != "paloalto-dg-NestedCorpDG" {
			t.Errorf("expected parent_uuid to be 'paloalto-dg-NestedCorpDG', got %q", parentUUID)
		}

		// Verify the hostname in managed_devices has been updated to nested-fw-branch-updated
		var updatedMdevName string
		err = db.DB().QueryRow("SELECT name FROM managed_devices WHERE serial = '0123456789'").Scan(&updatedMdevName)
		if err != nil {
			t.Fatalf("failed to query updated managed device name: %v", err)
		}
		if updatedMdevName != "nested-fw-branch-updated" {
			t.Errorf("expected updated managed device name to be 'nested-fw-branch-updated', got %q", updatedMdevName)
		}
	})

	t.Run("Panorama Ingestion Ordering Standalone First", func(t *testing.T) {
		// Import standalone firewall first
		_, _, err := adapter.ParseAndStore([]byte(standardFirewallXML), "fw-corp-branch_9876543210.xml")
		if err != nil {
			t.Fatalf("ParseAndStore standalone failed: %v", err)
		}

		// Now import panorama XML that defines the managed device
		panoramaWithMgtDevXML := `
<config>
  <devices>
    <entry name="localhost.localdomain">
      <device-group>
        <entry name="CorpDG">
          <devices>
            <entry name="9876543210"/>
          </devices>
        </entry>
      </device-group>
    </entry>
  </devices>
  <mgt-config>
    <devices>
      <entry name="9876543210">
        <ip-address>10.0.0.9</ip-address>
      </entry>
    </devices>
  </mgt-config>
</config>
`
		_, _, err = adapter.ParseAndStore([]byte(panoramaWithMgtDevXML), "panorama.xml")
		if err != nil {
			t.Fatalf("ParseAndStore Panorama failed: %v", err)
		}

		// Verify standalone device in devices table now has parent_uuid updated to point to the device group CorpDG
		var parentUUID string
		err = db.DB().QueryRow("SELECT parent_uuid FROM devices WHERE uuid = 'paloalto-fw-fw-corp-branch-9876543210'").Scan(&parentUUID)
		if err != nil {
			t.Fatalf("failed to query standalone device parent_uuid: %v", err)
		}
		if parentUUID != "paloalto-dg-CorpDG" {
			t.Errorf("expected parent_uuid to be 'paloalto-dg-CorpDG', got %q", parentUUID)
		}

		// Verify the hostname in managed_devices has been updated to fw-corp-branch
		var mdevName string
		err = db.DB().QueryRow("SELECT name FROM managed_devices WHERE serial = '9876543210'").Scan(&mdevName)
		if err != nil {
			t.Fatalf("failed to query managed device name: %v", err)
		}
		if mdevName != "fw-corp-branch" {
			t.Errorf("expected managed device name to be 'fw-corp-branch', got %q", mdevName)
		}
	})

	t.Run("Analyze Standalone and Panorama XML", func(t *testing.T) {
		stats, err := adapter.Analyze([]byte(standardFirewallXML), "fw-standalone-test.xml")
		if err != nil {
			t.Fatalf("Analyze standalone failed: %v", err)
		}
		if stats.ConfigType != "Firewall" || stats.DevicesCount != 1 || stats.InterfacesCount != 1 || stats.ZonesCount != 1 || stats.VirtualRoutersCount != 1 {
			t.Errorf("incorrect standalone stats: %+v", stats)
		}

		pStats, err := adapter.Analyze([]byte(panoramaXML), "panorama.xml")
		if err != nil {
			t.Fatalf("Analyze panorama failed: %v", err)
		}
		if pStats.ConfigType != "Panorama" || pStats.TemplatesCount != 1 || pStats.DevicesCount != 1 || pStats.InterfacesCount != 1 || pStats.ZonesCount != 1 || pStats.VirtualRoutersCount != 1 {
			t.Errorf("incorrect panorama stats: %+v", pStats)
		}
	})
}
