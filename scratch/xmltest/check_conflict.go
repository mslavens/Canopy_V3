package main

import (
	"encoding/xml"
	"fmt"
)

type XMLManagedDeviceEntry struct {
	Serial        string               `xml:"name,attr"`
	IPAddress     string               `xml:"ip-address"`
	IP            string               `xml:"ip"`
	Hostname      string               `xml:"hostname"`
	TemplateStack string               `xml:"template-stack"`
	Template      string               `xml:"template"`
}

type XMLMgtConfig struct {
	Devices []XMLManagedDeviceEntry `xml:"devices>entry"`
}

type XMLReadOnly struct {
	Devices []XMLManagedDeviceEntry `xml:"devices>entry"`
}

type ZoneNode struct {
	Name    string `xml:"name,attr"`
	Network struct {
		Layer3 *struct {
			Members []string `xml:"member"`
		} `xml:"layer3"`
		Layer2 *struct {
			Members []string `xml:"member"`
		} `xml:"layer2"`
	} `xml:"network"`
}

type XMLTemplate struct {
	Name        string `xml:"name,attr"`
	Description string `xml:"description"`
	Config      struct {
		Devices []struct {
			Name string `xml:"name,attr"`
			Vsys []struct {
				Name string     `xml:"name,attr"`
				Zone []ZoneNode `xml:"zone>entry"`
			} `xml:"vsys>entry"`
		} `xml:"devices>entry"`
	} `xml:"config"`
}

type XMLTemplateStack struct {
	Name        string `xml:"name,attr"`
	Description string `xml:"description"`
	Templates   struct {
		Members []string `xml:"member"`
	} `xml:"templates"`
	Devices []struct {
		Name string `xml:"name,attr"`
	} `xml:"devices>entry"`
}

type XMLDeviceConfig struct {
	System struct {
		IPAddress string `xml:"ip-address"`
		Hostname  string `xml:"hostname"`
	} `xml:"system"`
}

type XMLDeviceGroup struct {
	Name string `xml:"name,attr"`
	Devices []struct {
		Name string `xml:"name,attr"`
	} `xml:"devices>entry"`
}

type PaloAltoConfig struct {
	XMLName        xml.Name           `xml:"config"`
	Templates      []XMLTemplate      `xml:"template>entry"`
	TemplateStacks []XMLTemplateStack `xml:"template-stack>entry"`
	MgtConfig      *XMLMgtConfig      `xml:"mgt-config"`
	ReadOnly       *XMLReadOnly       `xml:"readonly"`
	DeviceConfig   *XMLDeviceConfig   `xml:"deviceconfig"`

	Panorama struct {
		Templates      []XMLTemplate      `xml:"tpl>entry"`
		PanoramaTpl    []XMLTemplate      `xml:"template>entry"`
		TemplateStacks []XMLTemplateStack `xml:"template-stack>entry"`
		DeviceGroups   []XMLDeviceGroup   `xml:"device-group>entry"`
	} `xml:"panorama"`

	DeviceGroups []XMLDeviceGroup `xml:"device-group>entry"`

	Devices []struct {
		Name           string             `xml:"name,attr"`
		Templates      []XMLTemplate      `xml:"template>entry"`
		TemplateStacks []XMLTemplateStack `xml:"template-stack>entry"`
		DeviceGroups   []XMLDeviceGroup   `xml:"device-group>entry"`
	} `xml:"devices>entry"`
}

func main() {
	var c PaloAltoConfig
	err := xml.Unmarshal([]byte("<config></config>"), &c)
	if err != nil {
		fmt.Println("Error:", err)
	} else {
		fmt.Println("No conflicts detected!")
	}
}
