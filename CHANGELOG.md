# Changelog

All notable changes to this project will be documented in this file.

## v0.33.6 - Optimization Sandbox Live Updates & Engine Fixes
**Date:** 2026-07-18

### Added
- **Live Optimization Engine**: Removed the manual "Run Optimization" button in favor of a silent, reactive auto-updater. The global insights panel now dynamically re-evaluates inputs, thresholds, and scopes in real-time as you type, instantly reflecting aggregation opportunities without requiring a manual refresh.

### Changed
- **Strict 1:1 Replacement Mapping**: Fixed a bug where the backend engine was improperly suggesting 1:1 object replacements for raw IPs that were deeply nested inside an explicitly provided group. 1:1 swaps are now strictly limited to IPs that you specifically type into the input box.
- **Strict CIDR Boundary Adherence**: Updated the global CIDR collapsing logic to ensure that if a group overlaps with a mathematical CIDR boundary, it will only suggest swapping the group for the CIDR if *100%* of the group's members fall inside the CIDR, completely preventing accidental coverage loss for partially-overlapping groups.
- **Redundant Member Purging**: Fixed a string-matching bug in the UI's inline swap handler. When you swap an inline group, the UI now properly cross-references the underlying IPs and correctly purges any of your raw IP inputs that are mathematically covered by the newly swapped group.
- **Sandbox Documentation Polish**: Rewrote the Sandbox Help manual (`?` modal) into a comprehensive, step-by-step "How-To" guide for new users.
- **Delimiter Support**: The Sandbox input parser now accepts semicolons (`;`) as valid delimiters alongside commas and newlines.
- **Inspector UX Polish**: Changed the inline 'Inspect Group' label to use the standard Canopy blue color. Nested the 'Expand to Members' button directly inside the Inspection accordion to drastically reduce default popover clutter.

## v0.33.5 - Optimization Sandbox Smart Swaps
**Date:** 2026-07-17

### Added
- **Smart Swap Redundancy Engine**: The Optimization Sandbox now deeply evaluates group coverage before you swap an object. If swapping in a parent group completely encompasses other inputs (like nested sub-groups), the sandbox proactively intercepts the action with a "Confirm Swap" modal, listing redundant objects and allowing you to prune them simultaneously.
- **Dynamic Insight Badges**: Replaced static View Options buttons with interactive, dynamic "Insight" badges that intelligently appear when deep backend logic identifies a mathematically viable optimization opportunity against your live inputs.

### Changed
- **Deep Member Tolerance Math**: Rewired the frontend `TokenizedFieldEditor`'s Tolerance matching logic to accurately map against deep leaf members. Deeply nested child group coverage is now precisely synchronized with the backend engine's mathematical evaluations, resulting in 1:1 parity between active sandbox inputs and the backend insights panel.
- **Inspector UX Polish**: Refined the Inspector popover inside the token editor. Added expanding chevrons for clean accordion control, condensed insight badges for improved row density, correctly bound single-child expansion for deep groups, collapsed the Inspect Group accordion by default, and built a recursive indented visualization tree for nested items.

## v0.33.4 - Optimization Sandbox
**Date:** 2026-07-17

### Added
- **Optimization Sandbox**: Introduced a new Optimization Sandbox tool. Paste IPs, CIDRs, or Object names to find aggregation opportunities and validate grouping rules safely before applying them in policies.
- **Deep Nested Search**: The Sandbox insights panel now supports deep recursive searching, instantly finding matches across nested child objects and raw IP values within complex group hierarchies.
- **Sandbox Documentation**: Built out a comprehensive Help manual (`?` modal) for the Optimization Sandbox, fully indexed in the Help Center.

### Changed
- **Sandbox UX Polish**: Refined the layout of the Optimization Sandbox to improve usability. Reordered the administrative scope selector, explicitly aligned column widths, and cleaned up the active tab underline to sit flush on the divider.
- **Matrix View Details**: Restored the "perfect match" detail calculations in the Matrix View to provide precise overlap metrics (e.g., "2/2 members covered").
- **Grid Cleanup**: Removed alternating row colors in the Matrix View in favor of clean grid lines for better readability.


## v0.33.3 - Table UX Refinements
**Date:** 2026-07-16

### Added
- **Native Tooltips**: Added native hover tooltips (`title` attributes) to Active Filters, Device Group selectors, and dropdown options to easily reveal full values when text is truncated.
- **Copy Header Names**: Users can now right-click directly on any data table column header to expose a "Copy Column Name" action, making it easy to copy headers despite their draggable behavior.

### Changed
- **Stable Filter Menus**: Completely rebuilt the column filter dropdown logic. Active column filter dropdowns now take a "snapshot" of the selected items when opened, ensuring the list order remains completely stable and doesn't unpredictably jump around while checking multiple boxes.
- **Dynamic Context Menus**: The data table context menus now feature smart, edge-aware coordinate positioning. Menus will dynamically anchor to the bottom or right of the cursor and expand upwards/leftwards when clicking near the edge of the screen, completely preventing layout clipping.
- **Active Filter Badges**: Upgraded the "Active Filters" dropdown to render multi-value filters as individual, wrap-aware badges instead of a massive comma-separated string. Each badge now features its own precise `X` button to individually remove values without clearing the entire column.
- **Standardized Pagination Margins**: Removed artificial "Zero-CLS" vertical padding from tables. Tables with fewer rows than their configured page size will now naturally end without generating confusing, massive empty scrollbars.
- **Flash-Free Dropdowns**: Hardcoded fallback type inferences into the core Scope Dropdown for static top-level scopes (`Global` and `Shared`) to ensure their respective icons render instantly on tab switch, eliminating visual "pop-in" flashes while awaiting API hydration.

## v0.33.2 - Persistent Layouts & UX Enhancements
**Date:** 2026-07-16

### Added
- **Persistent Data Grids**: The core `DataTable` now saves your column configurations (width, visibility, and sorting order) directly to your local browser storage. The UI will flawlessly remember your tailored layout for every specific table across the app on refresh. Added a quick "Reset to Default Layout" button to instantly restore the original grid.
- **Context Menu Global Copy**: Natively right-clicking on any table row now exposes a "Copy [Column Name]" action at the top of the context menu, allowing you to instantly copy the exact cell value you clicked on directly to your clipboard.
- **Creation & Modification Auditing**: Introduced `Created At` and `Modified At` timestamp columns to all major Network, Object, and Policy tables to drastically improve auditing and tracking for user-configurable elements.
- **Selection Data Filtering**: Upgraded the static 'Selected' row counter badge in the table toolbar into an interactive dropdown. Users can now instantly "Filter to Selections" to temporarily isolate the table view to only the rows they've checked.

### Changed
- **Human-Readable Filters**: Re-wired the "Context / Scope" filter menus across the platform to resolve backend database IDs (like `paloalto-dg-AB-OIL`) into their highly-readable display names (`AB-OIL`) for a much cleaner UX.
- **Filter Badge Indicator**: Added a persistent, interactive Active Filters badge next to the table title. The badge features a dropdown menu to list all active filter parameters, with targeted "Clear" buttons and a global "Clear All Filters" action.

## v0.33.1 - Tools UI Refinements & Bug Fixes
**Date:** 2026-07-16

### Added
- **Interactive Sandbox Filtering**: The Resolver Sandbox table now dynamically listens to the active scope dropdown. Selecting a specific Template or Firewall override instantly filters the loaded routing results without requiring a recalculation.
- **Route Type Filters**: Added a new filter menu to the Actions dropdown, allowing users to instantly filter sandbox results by "Show All", "Directly Connected", "Routed", or "Default Route".
- **Enhanced CSV Exports**: The Sandbox CSV export now splits raw template variables and their runtime resolved IPs into distinct, parseable columns for easier offline data manipulation.

### Changed
- **Help Center Expansion**: Built out comprehensive contextual Help manuals (`?` modals) for both the Resolver Sandbox and CIDR Subnet Calculator, fully indexed in the Help Center Table of Contents.
- **DataTable Pagination Rendering**: Enabled pagination on the Sandbox table to dramatically improve rendering performance for large route calculations, completely eliminating "checkbox flash" layout thrashing.
- **Sandbox UI Polish**: Improved table readability by cleanly rendering human-readable firewall names and widening column headers to prevent text truncation.

### Fixed
- **Cross-Platform SQLite Compatibility**: Refactored the core engine database queries to use dynamically generated SQL `IN` clauses instead of relying on the `json_each` SQLite extension, ensuring flawless cross-platform compatibility across various SQLCipher drivers without missing queries.
- **Variable Resolution Order**: Fixed a string-replacement bug in the Go backend (`ApplyVariables`) where variable subsets (e.g., `$fw_outside`) were being overwritten before their longer, more specific counterparts (`$fw_outside_next_hop`), resulting in orphaned string artifacts.
- **Device Override Scoping**: Fixed a bug in the global `useTemplateHierarchy` hook where selecting a specific device override fell through the ancestry tree, causing local filters to mistakenly hide all table rows.
- **Vendor Filtering**: Corrected a state binding issue that prevented the Vendor column filter from working in the Sandbox table.

## v0.33.0 - Tools Pages & Resolver Sandbox
**Date:** 2026-07-15

### Added
- **Tools Page Navigation**: Introduced a brand new "Tools" top-level navigation hub for interactive utility applications.
- **CIDR Subnet Calculator**: Built a fully interactive React-based IP calculator. The calculator allows users to input any CIDR block, instantly analyze network boundaries, split the subnet into smaller custom slices, and export the generated ranges to CSV.
- **Resolver Sandbox**: Shipped the core Resolver Sandbox UI. This interactive tool allows users to input a destination IP and perform a dry-run calculation against the database, mapping exactly how Canopy expects the IP to be routed across all firewalls in the infrastructure.
- **True Recursive Next-Hop Resolution**: The Resolver Sandbox engine seamlessly follows static routes to their Next Hops, recursively traversing routing tables (up to 5 levels deep) until it successfully resolves a physical interface.

### Changed
- **Override Prioritization Engine**: Inverted the scope ancestry evaluation logic to accurately reflect device-level overrides. Locally defined routes on a physical firewall now correctly override conflicting routes inherited from generic templates, accurately mirroring real-world Palo Alto networking logic.
- **Longest Prefix Match (LPM)**: Enhanced the routing calculation engine to properly prioritize routes based on subnet specificity (`/32` takes precedence over `/23`, and so on).

### Fixed
- **Resolver Sandbox Connectivity**: Fixed a silent React UI bug that prevented the API Client from properly initializing inside the `ToolsPage`, resolving an issue where clicking "Calculate Routes" previously failed silently.


## v0.32.1 - Bug Fixes & Optimizations
**Date:** 2026-07-14

### Added
- **Dynamic Group Initialization (XML Import)**: The XML importer now correctly triggers dynamic group materialization after data ingestion is complete. This ensures dynamic groups accurately reflect their matching members immediately after an import.

### Changed
- **Optimized UI Data Loading**: Decoupled diff fetching from the main data loading sequence in the UI. Rendering large datasets (e.g., 45k+ objects) is now significantly faster, with diffs calculating non-blockingly in the background.

### Fixed
- **Dynamic Group Hierarchy Scoping**: Fixed a critical backend bug where intermediate scopes (like nested device groups) were improperly ignored during dynamic group candidate evaluation. Dynamic groups now strictly trace the entire inheritance hierarchy to find valid candidates.
- **Sticky Uncommitted Flags**: Fixed multiple overlapping state bugs where the `Uncommitted` badge failed to clear after a user reverted their modifications. The backend now natively strips snapshot dirty flags and explicitly cascades state clears down to parent entities when child relationships (like members or tags) are reverted.
- **CSV Data Mapping Styling**: Resolved a UI mapping issue where statically typed inputs on the CSV import modal were rendering out of alignment.

## v0.32.0 - Pending Changes Modal Overhaul
**Date:** 2026-07-14

### Added
- **Pending Changes Enhancements**: Overhauled the Pending Changes modal to include deep JSON searching, dynamic search highlighting, and automatic row expansion for matched payloads.
- **CSV Data Export Formatting**: The CSV export engine now supports formatted detail payload exports, mirroring the native UI diff layout for changes.
- **DataTable Column Resizing**: Improved DataTable flexibility by dropping full-width restrictions on resizing events, allowing seamless, spreadsheet-like UX without layout snapping.
- **Global Table Controls**: Implemented dynamic Expand All / Collapse All column header toggles for expandable rows.
- **Search Clear Buttons**: Added quick-clear actions to local table search inputs.

### Fixed
- **Transaction Blocked Reverts**: Addressed a transaction constraint error by moving bulk reverts to an iterative, single-item execution model.
- **Column Indexing Offsets**: Fixed a bug where expandable or selectable columns caused an off-by-one indexing error during column drag-resize initialization.
- **Vendor Normalization**: Standardized Vendor string capitalization to prevent mismatch between global UI rendering and hardware-derived scope data.
- **App-Native Confirmations**: Swapped standard browser confirm dialogs for custom UI modals to maintain brand and style alignment.


## [0.31.0] - 2026-07-14
### Added
- **Hierarchical Object Overrides**: Enabled full UI support for Panorama-style object overrides. Objects inherited from parent device groups can now be seamlessly overridden in lower-level scopes with custom values.
- **Metadata Flags & Native Filtering**: Added a new native column and filtering support for `Flags` on objects. The table now dynamically calculates and renders "Inherited", "Overridden", "Local", and "Uncommitted" status badges.
- **Override Reversion Workflow**: Implemented both single and bulk reversion actions, allowing users to safely delete local overrides and instantly fall back to inherited parent values.
- **Pending Revert Tracking**: Built a cross-referenced diff checker that stages a "Pending Revert" dashed-badge on inherited objects when their active override has been deleted but the workspace has not yet been committed.

### Fixed
- **Commit State Flushes**: Fixed a candidate configuration bug in the Go backend where successfully generating a commit snapshot failed to flush the active `dirty` bit from object tables, causing uncommitted flags to persist improperly.

## [0.30.0] - 2026-07-13
### Added
- **Palo Alto XML Subinterface Support**: The backend XML parser now correctly navigates and extracts subinterfaces for physical Ethernet ports, ensuring IPs and zones are mapped properly.
- **Aggregate Ethernet (AE) Interfaces**: Built full support for AE interfaces. Subinterfaces on AE ports are now extracted, and physical ethernet interfaces correctly parse and expose their assigned Aggregate Group.
- **GlobalProtect Gateway VPN Extraction**: The offline network analyzer now automatically extracts GlobalProtect Gateway configurations and their remote-user IP Pools, seamlessly inserting them as connected Static Routes mapping back to the VPN tunnel interface.
- **Network Interface Data Model**: Enhanced the internal `interfaces` database table and APIs to support tracking `aggregate_group`, allowing users to accurately trace interface bonds.

### Fixed
- **Unassigned Zone & Virtual Router Overrides**: Removed forced fallbacks that incorrectly defaulted unassigned XML interfaces to "untrusted" or "default" Virtual Routers. The ingestion pipeline now strictly adheres to 1:1 representations of the imported XML without assuming values.
- **Pending Changes tagged switch**: Addressed a core backend linter warning by modernizing the composite table deletion logic to use a tagged switch statement.

## [0.27.0] - 2026-07-10
### Added
- **Candidate Configuration Engine (Workspace Commits)**: Implemented a full workspace snapshot and commit architecture mimicking Panorama's candidate configuration. Modifications to objects and policies are now safely staged in the active workspace and can be reviewed, diffed, committed, or completely reverted without affecting the active config.
- **Commit Details Modal**: Built a dedicated UI interface for reviewing pending changes, complete with syntax-highlighted JSON diffs and a dynamic notification badge that perfectly tracks the number of uncommitted modifications.
- **Single Change Revert (Undo)**: Implemented granular "Undo" capabilities within the Pending Changes modal. Users can now revert individual modifications without having to revert the entire uncommitted workspace.
- **Dependency Enforcement for Deletions**: Restored Canopy 1.0 "Object in Use" safety guardrails. When attempting to delete an object (Address, Service, Group) that is actively referenced by parent Groups or Rules, the UI now intercepts the deletion and explicitly lists all dependent relationships, requiring explicit "Remove & Delete" confirmation to prevent accidental cascading configuration drops.

### Changed
- **Backend Diffing Engine**: Developed a high-performance generic map diffing engine in Go that mathematically compares the active SQLite state against the last committed JSON snapshot to generate real-time pending changes.
- **Stable Pending Changes UI**: The Pending Changes diff list is now strictly sorted alphabetically by object name on the backend, resolving an issue where random Go map iterations caused the UI to shuffle items every few seconds.

### Fixed
- **Object Restoration Constraints**: Fixed a critical backend bug where reverting an object deletion silently failed to restore it due to a missing `device_uuid` lookup constraint. The snapshot engine now explicitly embeds device UUIDs, and a robust fallback layer gracefully handles legacy snapshots.
- **Partial Object Restoration**: Fixed a flaw in the Undo logic where partially reverting a group while its members remained deleted would succeed silently, generating a broken object. The backend now strictly validates all nested relationships during a revert and gracefully rolls back the transaction with a 400 Bad Request error if dependent members are missing.
- **Diff Rendering Engine**: Refactored the Pending Changes diff viewer to bypass heavy state updates and IPC lag. Fixed an issue where the viewer improperly rendered blank lines for unchanged metadata and values.

## [0.26.0] - 2026-07-09
### Added
- **Structured Global Search**: Redesigned the global search omnibox to use a structured, tabular layout grouped by object/policy type (matching Panorama's UX). Features collapsible group headers and preserved keyboard navigation.
- **Vendor Column Inference**: Search results now parse object scope UUIDs to dynamically infer and display their origin Vendor in the global search UI.

### Changed
- **Optimized Search Payload**: Refactored the backend search payload mapping to decouple the raw object name from the scope context, ensuring clean columns in the UI.
- **Search Context De-prefixing**: Fixed a backend bug where global search mapped database UUIDs rather than human-readable names. Database-level `paloalto-dg-` prefixes are now cleanly resolved to their display names.

## [0.25.0] - 2026-07-08
### Added
- **Vendor License Simulation**: Enabled the ability to simulate licensed and unlicensed states for vendor adapters directly from the **Adapters** configuration page. Toggling an adapter immediately propagates a `canopy_adapter_toggled` event, updating the UI context globally via LocalStorage without requiring backend restarts.
- **Read-Only Graceful Degradation**: Implemented a read-only UI pattern across the platform. Creating, editing, and assigning configurations (Firewalls, Device Groups, Templates, Stacks) for unlicensed vendors is now blocked with helpful UI warnings, while still retaining read-access to existing configurations.

### Changed
- **Global Scope Refactor**: Refactored the core engine's Palo Alto scope hierarchy. The legacy `paloalto-dg-shared` device group has been removed in favor of linking root contexts directly to the new `paloalto-panorama-global` scope.

### Fixed
- **Foreign Key Constraint Error**: Resolved an issue where attempting to create a top-level device group would fail with a SQL constraint error because it was attempting to link to a deprecated parent scope.
- **Empty State Display**: Fixed an issue in the Device Management page where action buttons and Add options were completely hidden when no data was imported, preventing new users from adding items.

## [0.24.0] - 2026-07-05
### Added
- **Native Description Storage**: Added full SQLite database persistence for Base Template and Template Stack descriptions.
- **XML Import Description Extraction**: Configured Palo Alto config XML import to parse and store template descriptions automatically.
- **Member Template Actions Menu**: Integrated a custom reordering actions context menu (Move to Top/Bottom, Move Before/After) for template stack configuration with full portal-based type-ahead searchable dropdown submenus.
- **Type-ahead Dropdowns**: Integrated search capabilities into the "Add Member Template" selector dropdown on the template stack modal.

### Changed
- **Visual Alignment Refinement**: Standardized header container heights on both the left template list and right template detail panels to `130px`, keeping the tab bars horizontally aligned across the page.
- **Sidebar Tab Swap**: Swapped the sidebar tab order to prioritize "Base Templates" as the first tab by default, and changed the default active sidebar tab on page load.

## [0.23.2] - 2026-06-22
### Added
- **API Client Native Streaming**: Extended `CanopyApiClient` with a native `streamRequest` transport to securely wrapper Blobs and NDJSON streams, allowing all UI views to seamlessly handle file downloads and config imports while preserving unified token injection headers.

### Changed
- **Architectural Enforcement**: Replaced all remaining raw component `fetch()` calls in the frontend (such as Changelog, Workspaces, Snapshots, and XML imports) to exclusively use `CanopyApiClient` for uniform telemetry and auth handling.
- **Additive Database Migrations**: Hardened backend SQL engine initialization constraints. Schema migrations are now strictly additive-only, completely stripping out any destructive `DROP TABLE` statements from `canopy-core` for forward-compatible database safety.

### Fixed
- **Objects React Lifecycle**: Fixed a dangling variable reference in `ObjectsPage.tsx` where an improperly scoped `isMounted` state could trigger background crash exceptions during device tree tear-down.

## [0.23.1] - 2026-06-18
### Fixed
- **XML Import Variables**: Fixed a bug where Template Stack device variables were missing from the database. The Go XML parser now correctly interprets nested `devices` definitions, and the import engine safely buffers and preserves Panorama variables when subsequently parsing local firewall standalone configurations in the same batch.

## [0.23.0] - 2026-06-17
### Added
- **Network Templates Header**: Added a clear "Template Stacks" header to the Network dropdown menus to logically separate them from standalone templates and firewalls.

### Changed
- **Device & Firewall Display**: Cleaned up the Scope and Template dropdowns to prioritize Firewall and Device Group names. Serial numbers are now hidden by default and only used as a fallback if a name is missing, resulting in a significantly cleaner UI.
- **Pagination Reliability**: Audited and fixed pagination across multiple major data tables including Device Management, Audit Logs, Workspaces, Snapshots, Secrets Vault, Policies, and Heatmap Candidates to ensure large datasets slice reliably.

## [0.22.0] - 2026-06-16
### Added
- **Database Health & Healing Tool**: Added a robust native health scanner under `System > Database Health`. This tool safely sweeps the workspace for orphaned ad-hoc definitions left over from imports.
- **Recursive SQLite Healing**: Built a completely pure-SQL native Engine using Recursive Common Table Expressions (CTEs) to resolve orphaned objects cleanly upward through the Panorama Device Group inheritance scope on the fly.
- **Auto-Migrations**: The Go core backend now dynamically executes zero-downtime database schema migrations on startup to attach missing schema constraints on older vault files.

## [0.21.0] - 2026-06-15
### Added
- **Scope Hierarchy Badges**: Device Groups and Firewalls in the Scope Dropdown now dynamically display a pill badge with the total number of security rules they contain.
- **Sticky Scope Headers**: Added dynamic sticky headers to the Scope Dropdown. When scrolling down, parent Device Groups now dock and stack gracefully at the top of the container to provide perfect contextual awareness of the current hierarchy.

### Fixed
- Fixed an issue where clicking a local rule's scope context improperly teleported the user to the Pre/Post rules tab.
- Fixed a bug causing the active Device Group in the Scope Dropdown to vanish when interacting with the breadcrumbs.
- Prevented trackpad-induced fractional subpixel rendering gaps from causing scrolling firewall text to bleed through sticky headers.
- Fixed a silent failure and toast error loop triggered when encountering non-JSON `scope not found` backend responses.

## [0.20.0] - 2026-06-14
### Added
- **Accordion Object Menus**: Custom Objects and Security Profiles have been refactored out of messy horizontal tabs and nested securely as individual pages within an intuitive accordion sidebar.
- **Go Engine CLI Generation**: The Set Command generator logic was migrated from the React frontend to the native Go core for significantly improved performance and stability.
- **Dynamic Group CLI Expansion**: "Include nested child objects" now accurately generates dependent address objects for dynamically evaluated tags on the fly.


## [0.18.0] - 2026-06-12
### Added
- **DuckDB Log Analytics Engine**: Integrated DuckDB for blazing-fast local processing of flow logs.
- **Pre-processed Log Ingestion**: Added a new drag-and-drop UI to ingest pre-aggregated `.csv` logs into the `traffic_logs` schema.
- **Monitor Page Revamp**: Completely updated the "Monitor" tab with a beautiful datatable that visualizes flow count, bytes, packets, zones, and protocols seamlessly.
- **Custom Schema Mapping**: The backend now precisely maps `Count`, `Destination Port`, and other custom app-specific fields straight into DuckDB from the provided CSV structure.

### Fixed
- Fixed an issue where the `CanopyApiClient` was improperly instantiated in the Monitor Page, resulting in silent crashes when fetching traffic data.
- Refactored `LogImporter.tsx` to utilize Canopy's native Vanilla CSS system (`global.css`) instead of Tailwind classes, ensuring UI parity across the entire ecosystem.
- Corrected DuckDB initialization logic to drop and update schemas safely during rapid development iteration.
