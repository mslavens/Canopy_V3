package main

import (
	"encoding/xml"
	"fmt"
)

type Config struct {
	XMLName xml.Name `xml:"config"`
	Devices []struct {
		Name  string `xml:"name,attr"`
		Group []struct {
			Name string `xml:"name,attr"`
		} `xml:"device-group>entry"`
	} `xml:"devices>entry"`
}

type ConfigOld struct {
	XMLName xml.Name `xml:"config"`
	Devices struct {
		Entry []struct {
			Name  string `xml:"name,attr"`
			Group []struct {
				Name string `xml:"name,attr"`
			} `xml:"device-group>entry"`
		} `xml:"entry"`
	} `xml:"devices"`
}

func main() {
	data := []byte(`
<config>
  <devices>
    <entry name="localhost">
      <device-group>
        <entry name="dg1"></entry>
      </device-group>
    </entry>
  </devices>
</config>
`)
	var c Config
	xml.Unmarshal(data, &c)
	if len(c.Devices) > 0 {
		fmt.Printf("NEW: Devices: %d, Groups in dev 0: %d\n", len(c.Devices), len(c.Devices[0].Group))
	} else {
		fmt.Printf("NEW: Devices: %d\n", len(c.Devices))
	}

	var co ConfigOld
	xml.Unmarshal(data, &co)
	if len(co.Devices.Entry) > 0 {
		fmt.Printf("OLD: Devices: %d, Groups in dev 0: %d\n", len(co.Devices.Entry), len(co.Devices.Entry[0].Group))
	} else {
		fmt.Printf("OLD: Devices: %d\n", len(co.Devices.Entry))
	}
}
