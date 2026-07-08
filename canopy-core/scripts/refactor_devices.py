import re
import os

main_go_path = "/Users/mslavens/Documents/__Dev/AntigravityBuild/Canopy_V3/canopy-core/main.go"
handlers_devices_path = "/Users/mslavens/Documents/__Dev/AntigravityBuild/Canopy_V3/canopy-core/handlers_devices.go"

with open(main_go_path, "r") as f:
    content = f.read()

endpoints = [
    ("/api/device-groups/create", "handleDeviceGroupsCreate"),
    ("/api/device-groups/update", "handleDeviceGroupsUpdate"),
    ("/api/device-groups/delete", "handleDeviceGroupsDelete"),
    ("/api/templates/create", "handleTemplatesCreate"),
    ("/api/templates/update", "handleTemplatesUpdate"),
    ("/api/templates/delete", "handleTemplatesDelete"),
    ("/api/template-stacks/create", "handleTemplateStacksCreate"),
    ("/api/template-stacks/update", "handleTemplateStacksUpdate"),
    ("/api/template-stacks/delete", "handleTemplateStacksDelete"),
    ("/api/devices/create", "handleDevicesCreate"),
    ("/api/devices/update", "handleDevicesUpdate"),
    ("/api/devices/delete", "handleDevicesDelete"),
    ("/api/devices/import", "handleDevicesImport"),
]

handlers_go_content = """package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"sort"
	"strings"

	"canopy/paloalto"
	"canopy/storage"
)

"""

for url, func_name in endpoints:
    pattern = r"mux\.HandleFunc\(\"" + url + r"\", func\(w http\.ResponseWriter, r \*http\.Request\) \{(.*?)\n\t\}\)"
    matches = list(re.finditer(pattern, content, re.DOTALL))
    if matches:
        m = matches[0]
        body = m.group(1)
        handlers_go_content += f"func {func_name}(w http.ResponseWriter, r *http.Request) {{{body}\n}}\n\n"
        content = content.replace(m.group(0), f"mux.HandleFunc(\"{url}\", {func_name})")

with open(handlers_devices_path, "w") as f:
    f.write(handlers_go_content)

with open(main_go_path, "w") as f:
    f.write(content)

print("Extraction successful.")
