package main

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"strings"
)

func main() {
	f, err := os.Open("/Users/mslavens/Documents/__Dev/AntigravityBuild/Canopy_V3/Panorama_20260422.tgz")
	if err != nil {
		panic(err)
	}
	defer f.Close()

	gzf, err := gzip.NewReader(f)
	if err != nil {
		panic(err)
	}
	defer gzf.Close()

	tarReader := tar.NewReader(gzf)

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			panic(err)
		}

		if header.Typeflag == tar.TypeReg {
			data, err := io.ReadAll(tarReader)
			if err != nil {
				panic(err)
			}
			if strings.Contains(string(data), "<device-group>") {
				fmt.Println("FOUND PANORAMA CONFIG:", header.Name)
			}
		}
	}
}
