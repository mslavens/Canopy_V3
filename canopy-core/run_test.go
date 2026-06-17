package main_test

import (
	"testing"
	"canopy-core/adapters/paloalto"
)

func TestRun(t *testing.T) {
	paloalto.TestPanoramaParsing("/Users/mslavens/Documents/__Dev/AntigravityBuild/Canopy_V3/Panorama_20260422/TC-CADC-ICS-M600_017507002993.xml")
}
