import xml.etree.ElementTree as ET

def find_paths(element, path, target):
    if element.tag == target:
        print(" -> ".join(path + [element.tag]))
    for child in element:
        find_paths(child, path + [element.tag], target)

tree = ET.parse('/Users/mslavens/Documents/__Dev/AntigravityBuild/Canopy_V3/Panorama_20260422/TC-CADC-ICS-M600_017507002993.xml')
find_paths(tree.getroot(), [], 'device-group')
