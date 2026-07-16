# Resolver Sandbox

The Resolver Sandbox is an interactive troubleshooting tool that allows you to calculate and trace exactly how Canopy expects a specific IP address to be routed across all firewalls in your infrastructure.

## How It Works
The engine uses the identical routing intelligence that powers Canopy's deployment pipeline to perform a dry-run route resolution against the current database state.

When you enter a destination IP and click **Calculate Routes**:
1. Canopy queries the routing table of every firewall in your selected scope.
2. It performs longest-prefix matching to determine the egress interface and next hop.
3. The results are displayed in a unified table, highlighting whether the IP is directly connected, routed, or falling back to a default route.

## Filtering and Interacting
You can interact with the results to drill down into specific firewalls:
* **Interactive Scope**: Click on any Firewall name to narrow the sandbox's scope to that specific device. The table will instantly filter to only display the selected device (or devices within the selected template).
* **Route Type Filtering**: Use the **Actions** dropdown to instantly filter the results table to only show Direct connections, Routed connections, or Default routes.
* **Deep Inspection**: Select a single row to unlock the **Route Table** and **Interfaces** buttons (available to the left of the Actions menu or inside the context menu). These launch detailed modals showing the full, searchable routing and interface state for that specific firewall.

## Understanding the Results Table
The table displays both the raw configuration state and its fully resolved runtime values side-by-side:
* **Variable vs. Resolved Values**: Configuration items that utilize Canopy template variables (e.g., `$fw_outside`) are displayed in their raw form in the primary columns (Interface IP, Destination, Next Hop).
* **Blue Text Highlights**: The newly added "Resolved" columns instantly show you the actual IP string that the variable resolved to in the database! If the text is bold and blue, it means the variable successfully mutated from the base template using a local firewall override. If there is no variable, the columns will just display the standard IP.

## Limitations
Currently, this tool calculates routing boundaries based strictly on statically imported routing rules and interface subnets. Advanced routing constructs such as dynamic BGP weight injections or Policy-Based Forwarding are not evaluated in the base sandbox calculation.
