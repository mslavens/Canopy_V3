# Optimization Sandbox

Welcome to the **Optimization Sandbox**! This tool is designed to help you analyze, simplify, and optimize your network objects before committing any changes to your actual firewall policies. 

Whether you are migrating hundreds of raw IP addresses and want to see if they fit into existing groups, or you are trying to clean up redundant CIDRs, the sandbox provides a safe, read-only environment to discover these aggregation opportunities.

---

## 1. Getting Started: Source Inputs (Left Panel)

The left panel is your workspace. You can paste a massive list of raw IP addresses, CIDR subnets, or exact Object names into the text box at the bottom. 

### Managing Your Inputs
- **Paste & Add**: Paste comma, semicolon, or newline-separated values into the box and click **Add**. The tool will automatically format and validate them as "tokens" in the list above.
- **Bulk Selection**: Use the checkboxes next to each token to select multiple items, and click the **Remove** button to clear them out in bulk.
- **Set Any**: The **Set Any** button acts as a quick clear-all override, useful when you want to quickly test a rule that allows all traffic.

### Understanding the Input Badges
Once you add tokens, the system evaluates them instantly. You will notice colorful badges appearing next to your inputs:
- **Yellow "Insights" Badge**: This means the system has found potential optimization opportunities specifically for this token. Clicking the badge opens the **Inline Insights Popover**.
- **Icons**: You will see a green package for Objects, a blue stacked-layer icon for Groups, and a hashtag for raw IPs/CIDRs.

---

## 2. Inline Insights Popover (Clicking a Token)

When you click on a token (or its yellow Insights badge) in the left panel, a popover menu appears. This provides **strict 1:1 optimization options** for that specific item:

- **Exact 1:1 Matches**: If you pasted a raw IP address (e.g., `10.0.0.1`), and the firewall already has a named object with that exact IP, it will be listed here. Clicking **Swap** will instantly replace your raw IP with the named object.
- **Group Memberships**: If your IP address or object perfectly matches a leaf node inside a larger Address Group, the parent group is suggested here. 
- **Expand to Members**: If the token is already a Group, you can click this button to "explode" the group, replacing the single group token with all of its individual nested members. This is incredibly useful for breaking down groups to see exactly what is inside them.

*Note: The inline popover strictly evaluates 1:1 equivalency. It will intentionally ignore fuzzy CIDR overlaps to ensure you are only swapping exact matches.*

---

## 3. Global Optimization Engine (Right Panel)

While the left panel looks at individual tokens, the right panel looks at the **big picture**. 

When you click **Run Optimization**, the engine pools all of your input tokens together into a master list of raw IPs, and performs mathematical algorithms across the entire list to find bulk aggregation opportunities.

### Threshold Settings
You control how strict the optimization engine is using the two inputs at the bottom left:
- **CIDR Threshold**: How many individual IPs must fall within a subnet before the engine suggests combining them into a single CIDR block? *(Default: 3. Delete to set to 0, which disables CIDR collapsing).*
- **Group Tolerance (%)**: What percentage of a group's members must be present in your inputs before the engine suggests swapping for that group? *(Default: 100%, which requires a perfect match. Lower this to see fuzzy "partial" group matches).*

### Understanding Global Insights
The right panel displays the results categorized by type (1:1 Replacements, Address Groups, CIDRs). 
- Click the chevron `>` to expand an insight and view the **Nested Members Tree**.
- **Green "Covered" Badges**: Indicates that the nested member was found in your input list.
- **Purple "+ New" Badges**: (If Group Tolerance is < 100%) Indicates that swapping for this group will grant access to *new* IPs that were NOT in your original inputs.
- **Swap Matches**: Clicking this button will automatically apply the bulk optimization to your left panel, replacing all of the matched individual tokens with the single summarized Group or CIDR.

### Visualizing Matches
You can toggle between two view modes in the right panel:
- **List View**: Displays detailed, hierarchical trees of matched groups, including their nested members and IPs.
- **Matrix View**: A high-level table that plots your exact inputs against the matching groups to easily visualize overlap. You can use the local **Search Bar** to instantly filter results recursively across all nested members.
