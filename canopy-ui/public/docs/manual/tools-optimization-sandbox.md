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
- **Policy Usages Badge**: Next to each matching group or object, you will see a badge indicating how many firewall policies currently reference it (e.g., "3 Policies"). Clicking this badge opens the **Policy Usages Modal** to display the specific rules (Security, NAT, etc.) and their direction (Source/Destination) that rely on this object.
- **Swap Matches**: Clicking this button will automatically apply the bulk optimization to your left panel, replacing all of the matched individual tokens with the single summarized Group or CIDR.

### Extracting Strict Groups
When evaluating partial or "fuzzy" group matches (where Group Tolerance is < 100%), you might find a group that covers many of your inputs but also contains unwanted "+ New" IPs. 

You can click the **Extract Strict** button on these partial group insights to automatically generate a brand-new, customized group. This new group will *strictly* contain only the members that overlapped with your inputs, perfectly tailored to your needs without exposing unnecessary access. You can customize the suggested name for the new strict group before finalizing the extraction.

### Visualizing Matches
You can toggle between two view modes in the right panel:
- **List View**: Displays detailed, hierarchical trees of matched groups, including their nested members and IPs.
- **Matrix View**: A high-level table that plots your exact inputs against the matching groups to easily visualize overlap. You can use the local **Search Bar** to instantly filter results recursively across all nested members.

---

## 4. Optimizer Alignment Overview

This overview summarizes the combinations of swaps evaluated by the Canopy Optimizer, ensuring complete logical alignment between the **Backend Matrix Engine** (API) and the **Frontend Inline Engine** (UI).

### Address Domain

- **Exact 1:1 Match**
  - **Backend (Matrix Engine):** Parses raw IPs and checks against Single-IP Objects. Ignores CIDRs.
  - **Frontend (Inline UI):** Evaluates exact value match. Filters out objects containing a `/`.

- **Subnet Match (CIDR)**
  - **Backend (Matrix Engine):** Evaluates raw IPs, raw CIDRs, Object IPs, and Object CIDRs against broader CIDR objects via exact mathematical containment based on `CIDRThreshold`.
  - **Frontend (Inline UI):** Receives `Type: "network"` insights from backend and renders them under "Subnets". Deduplicates any exact CIDR matches.

- **Group Match**
  - **Backend (Matrix Engine):** Flattens all nested group inputs and Object/CIDR inputs down to base components. Evaluates coverage against all Group trees using `GroupTolerance`.
  - **Frontend (Inline UI):** Receives `Type: "group"` insights from backend and renders them under "Group Memberships". Allows nested group inspection.

- **Swap Execution**
  - **Backend (Matrix Engine):** *(Read-only analysis)*
  - **Frontend (Inline UI):** Dynamically flattens all inputs to base IPs/CIDRs and compares against the incoming target Group. Identifies any items mathematically contained for removal.


### Service Domain

- **Exact 1:1 Match**
  - **Backend (Matrix Engine):** Parses raw ports (`tcp/80`) and checks against Single-Port Objects.
  - **Frontend (Inline UI):** Dynamically constructs `protocol/destination_port` from object properties and evaluates against raw input.

- **Range Match**
  - **Backend (Matrix Engine):** Evaluates raw ports, raw port ranges, and Object Ports against broader Port Range Objects via mathematical containment based on `CIDRThreshold`.
  - **Frontend (Inline UI):** Receives `Type: "network"` insights from backend and renders them under "Ranges". Deduplicates exact Port matches.

- **Group Match**
  - **Backend (Matrix Engine):** Flattens all nested group inputs and Object/Range inputs down to base definitions. Evaluates coverage against all Group trees using `GroupTolerance`.
  - **Frontend (Inline UI):** Receives `Type: "group"` insights from backend and renders them under "Group Memberships". Allows nested group inspection.

- **Swap Execution**
  - **Backend (Matrix Engine):** *(Read-only analysis)*
  - **Frontend (Inline UI):** Dynamically flattens all inputs to raw `protocol/destination_port`. Identifies items mathematically contained within the incoming Group for removal.


### Application Domain

- **Exact 1:1 Match**
  - **Backend (Matrix Engine):** *(No native raw-to-object logic; apps are always objects)*
  - **Frontend (Inline UI):** Performs case-insensitive matching of input name against object name.

- **Group Match**
  - **Backend (Matrix Engine):** Flattens all nested group inputs to base App names. Evaluates coverage against all Group trees using `GroupTolerance`.
  - **Frontend (Inline UI):** Receives `Type: "group"` insights from backend and renders them under "Group Memberships". Allows nested group inspection.

- **Swap Execution**
  - **Backend (Matrix Engine):** *(Read-only analysis)*
  - **Frontend (Inline UI):** Dynamically flattens all inputs to base Application names. Identifies items contained within the incoming target Group for removal.

> Both the Frontend and Backend employ full recursive unpacking algorithms for Groups. Whether an item is nested 1 layer deep or 10 layers deep, both engines mathematically drill down to the foundational base values (IPs, CIDRs, Ports, App Names) to calculate deterministic overlapping coverage.
