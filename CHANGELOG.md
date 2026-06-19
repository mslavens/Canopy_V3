# Changelog

All notable changes to this project will be documented in this file.

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
