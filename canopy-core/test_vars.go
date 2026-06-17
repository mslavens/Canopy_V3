//go:build ignore

package main

import (
	"encoding/xml"
	"fmt"
)

type XMLVariableEntry struct {
	Name         string `xml:"name,attr"`
	TypeInner    string `xml:"type,innerxml"`
	Value        string `xml:"value"`
	DefaultValue string `xml:"default-value"`
}

func main() {
	xmlData := `
<variable>
  <entry name="var1">
    <type>
      <ip-netmask>192.168.1.1/24</ip-netmask>
    </type>
  </entry>
  <entry name="var2">
    <type>string</type>
    <value>my-string-value</value>
  </entry>
  <entry name="var3">
    <type>
      <fqdn>example.com</fqdn>
    </type>
    <default-value>example.com</default-value>
  </entry>
</variable>`

	var v struct {
		Entries []XMLVariableEntry `xml:"entry"`
	}

	xml.Unmarshal([]byte(xmlData), &v)
	for _, e := range v.Entries {
		fmt.Printf("Name: %s\n", e.Name)
		fmt.Printf("TypeInner: %q\n", e.TypeInner)
		fmt.Printf("Value: %q\n", e.Value)
		fmt.Printf("Default: %q\n", e.DefaultValue)
		fmt.Println("---")
	}
}
