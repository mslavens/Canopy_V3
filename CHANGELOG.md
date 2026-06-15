# Changelog

All notable changes to this project will be documented in this file.
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
