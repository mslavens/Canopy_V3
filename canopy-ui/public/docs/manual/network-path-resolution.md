# Path Resolution Engine

The Path Resolution tool evaluates network transit capabilities by running high-speed bitwise masking intersections against the `network_topology` data matrix.

### How It Works
1. **Ingress Identification**: The engine decodes the provided Source IP and identifies which interface subnets currently encapsulate it.
2. **Egress Identification**: The engine performs the same bitwise subnet mask mapping against the Destination IP.
3. **Hop Calculation**: The system maps the traversal boundaries between the governing ingress appliance and egress appliance.

### Limitations
Currently, this tool calculates structural layer-3 boundaries based strictly on imported interface CIDR blocks. 

> **Note:** Advanced routing constructs (such as BGP weight injections, Policy-Based Forwarding, or NAT override rules) are not currently evaluated in the base topology calculation.