package paloalto

import (
	"encoding/xml"
	"fmt"
	"os"
)

func TestPanoramaParsing(filename string) {
	data, err := os.ReadFile(filename)
	if err != nil {
		fmt.Println("File read error:", err)
		return
	}
	
	var config PaloAltoConfig
	err = xml.Unmarshal(data, &config)
	if err != nil {
		fmt.Println("UNMARSHAL ERROR:", err)
		return
	}
	
	fmt.Println("SUCCESS! Parsed", filename)
	fmt.Println("Device Groups (root):", len(config.DeviceGroups))
	fmt.Println("Devices (root):", len(config.Devices))
	for _, dev := range config.Devices {
	    fmt.Printf("Device '%s' has %d Device Groups\n", dev.Name, len(dev.DeviceGroups))
	}
}
