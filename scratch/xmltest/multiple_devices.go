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
  <devices>
    <entry name="fw1"></entry>
  </devices>
</config>
`)
	var c Config
	xml.Unmarshal(data, &c)
	fmt.Printf("Devices: %d\n", len(c.Devices))
	for _, d := range c.Devices {
		fmt.Printf("Device: %s, Groups: %d\n", d.Name, len(d.Group))
	}
}
