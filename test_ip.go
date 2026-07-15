package main

import (
	"fmt"
	"net"
)

func isIPInSubnet(targetIP net.IP, subnetStr string) bool {
	if targetIP == nil {
		return false
	}
	
	if net.ParseIP(subnetStr) != nil {
		return targetIP.Equal(net.ParseIP(subnetStr))
	}

	_, ipNet, err := net.ParseCIDR(subnetStr)
	if err != nil {
		return false
	}
	
	return ipNet.Contains(targetIP)
}

func main() {
	targetIP := net.ParseIP("10.194.112.1").To4()
	fmt.Println("Result:", isIPInSubnet(targetIP, "10.194.112.0/23"))
	fmt.Println("Result 0.0.0.0/0:", isIPInSubnet(targetIP, "0.0.0.0/0"))
}
