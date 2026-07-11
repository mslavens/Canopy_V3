# Templates & Stacks

Templates and Template Stacks represent the network configuration layering system for managed firewalls. They compile configuration rules (such as network interfaces, zones, and virtual routers) into logical layers.

## Base Templates vs. Template Stacks

* **Base Templates**: Contain raw network parameters (physical ports, VLANs, virtual routers, zone bindings).
* **Template Stacks**: Order multiple Base Templates sequentially. Firewalls bind directly to Template Stacks, inheriting the combined configuration.

## Key Actions

### Creating Stacks and Templates
- Click **Add Template** under the **Base Templates** tab to declare new configuration layers.
- Click **Add Stack** under the **Stacks** tab to declare template stack layouts.

### Managing Stack Membership
1. Open the stack detail panel by selecting a template stack.
2. Under **Member Templates**, click **Add Template** to insert layers.
3. Hover over member items to drag-and-drop or right-click to access reordering actions (`Move to Top`, `Move Before...`, etc.) to adjust priority hierarchy (highest priority on top).
4. Dropdowns support type-ahead filtering for fast search.

### Generating CLI Configuration
- Right-click a Base Template or Template Stack to open the context menu.
- Click **Generate CLI** to view and copy standard vendor CLI commands representing the configuration.
