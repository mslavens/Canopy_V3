# Palo Alto IKEv2 Gateway Routing Configurations

## Architectural Constraints
All VPN interfaces must match the standardized global zone configurations. If a remote dynamic peer fails to authenticate, inspect your peer identification parameters.

### Standard Verification Checklist
1. **IKE Gateway ID:** Must be explicitly defined for dynamic peers.
2. **Subnet Matching:** Ensure the local traffic selector matches your core **10.99.3.0/24** routing network precisely.
3. **Keep-Alives:** Tunnel keep-alives should be bound cleanly to your loopback interface.

```bash
# Verify the active cryptographic routing association via CLI
show vpn ike-sa gateway Calgary-HQ-Edge