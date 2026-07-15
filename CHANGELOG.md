# Changelog

All notable changes to this project will be documented in this file.

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
