package main

import (
	"encoding/xml"
	"fmt"
)

type Config struct {
	XMLName xml.Name `xml:"config"`
	
	FlatGroups []struct{ Name string `xml:"name,attr"` } `xml:"panorama>device-group>entry"`

	Panorama struct {
		NestedGroups []struct{ Name string `xml:"name,attr"` } `xml:"device-group>entry"`
	} `xml:"panorama"`
}

func main() {
	data := []byte(`
<config>
  <panorama>
    <device-group>
      <entry name="dg1"></entry>
    </device-group>
  </panorama>
</config>
`)
	var c Config
	err := xml.Unmarshal(data, &c)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	fmt.Printf("FlatGroups: %d, NestedGroups: %d\n", len(c.FlatGroups), len(c.Panorama.NestedGroups))
}
