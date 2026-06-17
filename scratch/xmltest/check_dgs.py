import xml.etree.ElementTree as ET

tree = ET.parse("Panorama_20260422/TC-CADC-ICS-M600_017507002993.xml")
root = tree.getroot()

for dev in root.findall("devices/entry"):
    print("Device name:", dev.get("name"))
    dgs = dev.findall("device-group/entry")
    print("Device groups:", len(dgs))
    if len(dgs) > 0:
        print("First DG Name:", dgs[0].get("name"))
