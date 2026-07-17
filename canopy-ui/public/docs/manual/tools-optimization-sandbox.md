# Optimization Sandbox

The **Optimization Sandbox** allows you to safely test IP addresses, CIDR blocks, or Object names against your workspace's existing objects and groups. It will identify any potential aggregation or grouping opportunities before you apply them in policies.

## Finding Aggregation Opportunities

Paste a list of IP addresses or object names into the **Source Inputs** box. When you click **Run Optimization**, the engine will scan your database and highlight:
- **1:1 Replacements:** Direct matches where your input already exists as a named Object.
- **Address Groups:** When your inputs completely cover all members of an existing Address Group.
- **CIDRs:** When your IP addresses can be summarized into a larger subnet.

## Visualizing Matches

You can toggle between two view modes to analyze the results:
- **List View:** Displays detailed, hierarchical trees of matched groups, including their nested members and IPs.
- **Matrix View:** A high-level table that plots your exact inputs against the matching groups to easily visualize overlap.

## Nested Member Search

The local search bar located at the top right of the insights panel allows you to instantly filter results. The search is recursive and will identify matches not only on the parent group name, but also across any deeply nested group members or raw IP address values.
