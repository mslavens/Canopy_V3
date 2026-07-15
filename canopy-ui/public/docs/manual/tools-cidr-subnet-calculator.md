# CIDR Subnet Calculator

The CIDR Subnet Calculator provides an intuitive interface for planning, dividing, and analyzing IP network subnets using Classless Inter-Domain Routing notation.

## Key Features

1. **Subnet Analysis**: Enter any IP address and CIDR prefix (e.g., `192.168.1.0/24`) to instantly calculate the network address, broadcast address, usable host range, and total number of available IPs.
2. **Subnet Slicing**: You can further divide a large subnet into smaller chunks by adjusting the target prefix length slider. The tool will generate all possible sub-networks and their associated IP ranges.
3. **Visual Representation**: The interactive gauge chart provides a quick visual representation of the subnet size and capacity.

## How to Use
- **Input Network**: Type your target network in standard CIDR format into the search bar.
- **Adjust Target Prefix**: Use the slider to divide the network into smaller segments. For example, dividing a `/24` into `/26`s will generate 4 distinct subnets of 64 IPs each.
- **Export Data**: You can select the generated subnets and use the Actions dropdown to export them to a CSV file for your own IPAM records.
