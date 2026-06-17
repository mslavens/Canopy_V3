import xml.etree.ElementTree as ET

tree = ET.parse("Panorama_20260422/TC-CADC-ICS-M600_017507002993.xml")
root = tree.getroot()

print("Root tag:", root.tag)

devices = root.findall("devices/entry")
print("Found", len(devices), "devices/entry at root")

device_groups = 0
for dev_entry in devices:
    dgs = dev_entry.findall("device-group/entry")
    device_groups += len(dgs)

print("Device groups from config>devices>entry>device-group>entry:", device_groups)

# Check readonly
device_groups_readonly = 0
for dev_entry in root.findall("readonly/devices/entry"):
    dgs = dev_entry.findall("device-group/entry")
    device_groups_readonly += len(dgs)

print("Device groups from config>readonly>devices>entry>device-group>entry:", device_groups_readonly)
