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
	data := []byte("<config></config>")
	var c Config
	err := xml.Unmarshal(data, &c)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	fmt.Println("Success")
}
