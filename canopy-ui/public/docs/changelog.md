# Canopy Framework Changelog

All notable changes to the Canopy platform and headless Go engine will be documented here.
## v0.22.0 - Database Health & Healing Engine
**Date:** 2026-06-16

### Added
- **Database Health & Healing Tool**: Added a robust native health scanner under `System > Database Health`. This tool safely sweeps the workspace for orphaned ad-hoc definitions left over from imports.
- **Recursive SQLite Healing**: Built a completely pure-SQL native Engine using Recursive Common Table Expressions (CTEs) to resolve orphaned objects cleanly upward through the Panorama Device Group inheritance scope on the fly.
- **Auto-Migrations**: The Go core backend now dynamically executes zero-downtime database schema migrations on startup to attach missing schema constraints on older vault files.

## v0.21.0 - Scope Hierarchy & Sticky Navigation
**Date:** 2026-06-15

### Added
- **Scope Hierarchy Badges**: Device Groups and Firewalls in the Scope Dropdown now dynamically display a pill badge with the total number of security rules they contain.
- **Sticky Scope Headers**: Added dynamic sticky headers to the Scope Dropdown. When scrolling down, parent Device Groups now dock and stack gracefully at the top of the container to provide perfect contextual awareness of the current hierarchy.

### Fixed
- Fixed an issue where clicking a local rule's scope context improperly teleported the user to the Pre/Post rules tab.
- Fixed a bug causing the active Device Group in the Scope Dropdown to vanish when interacting with the breadcrumbs.
- Prevented trackpad-induced fractional subpixel rendering gaps from causing scrolling firewall text to bleed through sticky headers.
- Fixed a silent failure and toast error loop triggered when encountering non-JSON `scope not found` backend responses.

## v0.20.0 - Go CLI Generation & Accordion Layout
**Date:** 2026-06-14

### Added
- **Accordion Object Menus**: Custom Objects and Security Profiles have been refactored out of messy horizontal tabs and nested securely as individual pages within an intuitive accordion sidebar.
- **Go Engine CLI Generation**: The Set Command generator logic was migrated from the React frontend to the native Go core for significantly improved performance and stability.
- **Dynamic Group CLI Expansion**: "Include nested child objects" now accurately generates dependent address objects for dynamically evaluated tags on the fly.


## v0.19.0 - Analytics Parity & Data Grid Integrity
**Date:** 2026-06-12

### Added
- **Analytics Engine:** Migrated the Candidate Rules log analysis engine to V3. It now utilizes DuckDB's native memory-optimized arrays (`list_sort`, `list_distinct`) and recursive Common Table Expressions (CTEs) to execute massive, cascading multi-pass rollups locally in milliseconds.
- **Cross-Platform Compilation:** Modernized `build.sh` to enforce CGO enablement and strictly enforce cross-compiler dependencies (MinGW/Linux GCC) when building the DuckDB payload for alternate platforms from a macOS host.

### Changed
- **Heatmap UX:** Restored native X/Y scrolling capabilities to the Raw Flow Matrix by discarding restrictive fixed layouts and enforcing strict cell minimum widths, preserving legibility on 20x20+ datasets.
- **Analytics UX:** Discarded the restrictive box-model framing around the Candidate Rules data grid in favor of a clean, edge-to-edge spreadsheet presentation. Grids now enforce maximum widths on merged text columns, complete with native hover tooltips to view long, comma-separated arrays without breaking the layout.
- **Data Fidelity:** Configured the Go engine to automatically infer and inject all non-aggregated columns into the analytic `GROUP BY` clause, strictly mirroring the V1 Web Worker's logic and preventing orphaned SQL bindings during progressive passes.

### Fixed
- **System Stability:** Resolved a critical race condition (deadlock) in `/api/logs/import` that caused the entire application to hang indefinitely due to a non-reentrant `RWMutex` lock conflict during CSV ingestion.
- **Data Integrity:** Corrected a JSON payload mapping error where Candidate Rule total `Hits` were being discarded by the UI due to a key mismatch with the DuckDB backend (`count` vs `total_count`).

## v0.18.0 - Log Import & Viewer Architecture
**Date:** 2026-06-12

### Added
- **Log Management:** Implemented the core data pipelines and DuckDB staging architecture for ingesting external CSV log exports.
- **Log Viewer:** Built the interactive Log Viewer interface for querying, filtering, and paginating raw traffic data directly from the headless engine.

## v0.17.0 - Backend Modularity & Dynamic Object Fixes
**Date:** 2026-06-12

### Architecture
- **Backend Modularity:** Refactored the `canopy-core` backend monolith by extracting 54 API handlers and several middleware functions out of `main.go` and safely organizing them into strictly typed, domain-specific Go packages. `main.go` was reduced from ~7,000 lines down to ~1,500 lines. 

### Fixed
- **Object Resolution:** Fixed a bug where the Object Inspector was failing to correctly resolve nested dynamic address groups and dynamic service groups.
- **State Synchronization:** Fixed a race condition in the React UI where object tags would visually disappear if the object edit modal was opened before the global tag mappings had finished loading.
- **Inspector UX:** The recursive SQL paths displayed in the Inspector now use human-readable entity names (e.g. `Group A > Nested Group B`) rather than raw internal database IDs (`12 > 45`).

## v0.16.0 - API Client & Vault Initialization Security
**Date:** 2026-05-30

### Added
- **API Architecture:** Centralized `CanopyApiClient` with automated Bearer token injection to enforce strict Fail Fast and DRY principles.
- **Vault Security:** Split Vault initialization (`/api/init`) and unlock (`/api/vault/unlock`) endpoints for strict state separation, preventing cross-contamination during cold boots.
- **Workspace API:** Fully mapped missing workspace, snapshot, and secrets management endpoints into the frontend API client.

### Fixed
- **CORS Configuration:** Safely resolve CORS preflight requests by dynamically echoing the origin instead of using wildcard (`*`) when credentials are allowed.
- **UX Glitches:** Fixed an issue where the Vault Unlock page error banners persisted even after a user started correcting their passphrase.

## v0.15.0 - Data Grids & Layout Architecture
**Date:** 2026-05-29

### Added
- **Snapshots Page:** Extracted the System Snapshots and Backups features into their own dedicated, edge-to-edge management grid.
- **Collapsible Sidebar:** Added a toggle to the top navigation bar to completely collapse the side menu, freeing up horizontal screen real estate for dense firewall rules and matrix data.
- **Documentation:** Added new Help Handbooks for the Secrets Vault and System Snapshots.

### Changed
- **UI/UX:** Decoupled the header logo container from the sidebar width to completely eliminate Cumulative Layout Shift (CLS) when dragging the sidebar resizer.
- **UI/UX:** Reordered the System sidebar navigation to match enterprise frequency-of-use vs. risk patterns.
- **UI/UX:** Data grid columns now strictly clip overflowing text with an ellipsis (`...`) instead of spilling over into adjacent columns when resized.
- **UI/UX:** Data grid headers now feature a permanent right-border and a wider, invisible hit target for significantly easier column resizing.
- **Terminology:** Clarified and simplified authentication terminology across the application by replacing "Master Passphrase" with "Passphrase".

### Fixed
- **Authentication:** Fixed an issue where the vault unlock screen would incorrectly warn users of "database corruption" when they simply entered an invalid passphrase.

## v0.14.0 - Telemetry Decoupling & Snapshot Integrity
**Date:** 2026-05-28

### Architecture
- **Telemetry Decoupling:** Extracted the `audit_logs` table from the System Hub into a dedicated, snapshot-proof `canopy_telemetry.db` SQLite database to ensure the audit history remains 100% immutable during destructive configuration rollbacks.

### Changed
- **UI/UX:** Added the raw Unix Epoch ID beneath the formatted timestamp in the Local Snapshots grid to simplify correlating UI actions with the raw standard-out Go daemon `.log` files.
- **UI/UX:** Users can now attach a custom description to Local Snapshots when capturing them, making it significantly easier to organize configuration timelines.

### Fixed
- **Snapshot Integrity:** Resolved a critical bug where restoring a local snapshot or importing an external `.cbak` archive would mistakenly overwrite the active system's audit log history.
- **Snapshot Reverts:** Fixed a race condition where a "System Reverted" event would fail to write to the telemetry database before the system daemon forced a restart.
- **Archive Security:** Added a strict "Telemetry Firewall" guardrail that actively refuses to extract or package `canopy_telemetry.db` files if they are accidentally trapped inside legacy `.cbak` archives or snapshot folders.

## v0.13.0 - Secrets Vault & Zero-CLS Layouts
**Date:** 2026-05-27

### Added
- **Secrets Vault:** Introduced a dedicated, globally encrypted `secrets_vault` table to securely store infrastructure API keys, SSH keys, and tokens.
- **Secure Reveal:** Added an inline reveal mechanism inside the Secrets Vault that fetches the decrypted key on-demand and securely generates a system audit log event.

### Changed
- **UI/UX:** Re-architected all page headers into a strict 2-row layout, completely eliminating "Spatial CLS" (layout shifting) when navigating between tabs.
- **UI/UX:** Refined the `<DataTable />` by merging its toolbar controls into a unified, borderless grey header block to match enterprise standards.
- **UI/UX:** Constrained form-based pages (like Settings and Support) to a `1200px` maximum width to prevent visual strain on ultrawide monitors.
- **UI/UX:** Fixed an optical bug where the Notifications Drawer cast a shadow onto the right edge of the screen while closed.

### Security
- **Payload Masking:** Added an active payload interception guardrail to the Go daemon. Queries targeting the `secrets_vault` from the Database Browser or CLI automatically have the `secret_value` column redacted (`******** [REDACTED]`) to prevent plaintext key exfiltration via generic reads.

## v0.12.0 - Advanced Data Grids & Architecture Polish
**Date:** 2026-05-26

### Added
- **Data Grids:** Upgraded `<DataTable />` with an enterprise Top Toolbar featuring Column Visibility toggles, Checkbox Row Selection, and context-aware CSV Exports.
- **Message Center:** Transformed the "What's New" modal into a tabbed Message Center for Release Notes and future System Alerts, including an option to disable the automatic startup popup.
- **UI/UX:** Added a draggable, resizable gutter between the left navigation sidebar and the main content area. Width preferences are saved to local storage.
- **Architecture:** Created a centralized `useConfirm()` global hook to eliminate boilerplate React `<Modal />` duplication across the framework.

### Changed
- **UI/UX:** Applied a 150ms delayed-fade-in CSS animation (`.fade-in-delayed`) to all loading spinners and states to completely eliminate "flashing" during rapid local queries.
- **UI/UX:** Fixed multiple Cumulative Layout Shift (CLS) violations on DataTables to ensure the DOM pre-allocates height and prevents the page from collapsing during queries.
- **Security:** Added strict `AppBundleID` fingerprinting to the SQLite schemas to prevent database corruption if the framework is cloned to build other apps.
- **Security:** Closed a Cryptographic Oracle Vulnerability on the Workspace Import endpoint by strictly requiring manual entry of the Archive Passphrase before attempting decryption.

## v0.11.0 - UI Polish & UX Optimization
**Date:** 2026-05-26

### Changed
- **UI/UX:** Fixed multiple Cumulative Layout Shift (CLS) violations on the Support Page during manual log refreshes to ensure a perfectly rigid interface.
- **UI/UX:** Updated the manual refresh behavior on the System Logs viewer to automatically scroll users to the newest entries, aligning with enterprise logging standards.
- **Components:** Reusable `<Dropdown />` component now prevents redundant state re-renders and API calls when selecting the currently active value.
- **Components:** Enforced universal usage of `<Tooltip />` wrappers on all icon-only buttons across the application (Modals, Search Bars, Help Guides).

## v0.10.0 - Enterprise Boilerplate & Accessibility
**Date:** 2026-05-25

### Added
- **Error Handling:** Introduced a `GlobalErrorBoundary` to gracefully catch and display React render faults, preventing application freezes or white screens.
- **Accessibility:** Added comprehensive focus trapping (`Tab`/`Shift+Tab`) and `inert` attribute toggling to all floating overlays (Modals, Drawers) to prevent keyboard users from blindly interacting with hidden DOM elements.
- **Accessibility:** Implemented full keyboard navigation for custom `Dropdown` components (Arrow keys, Enter, Space, Escape) and blur-to-close behavior.

### Changed
- **Modals:** Popups, modals, and the Help Handbook can now be dismissed intuitively by clicking on the background overlay or pressing the `Escape` key.
- **Focus Rings:** Replaced jarring default browser focus outlines with a custom, theme-compliant blue ring (`:focus-visible`) that integrates seamlessly with dark mode, handles overflow clipping safely, and respects CSS stacking contexts.
- **Design System:** Upgraded the Typography and Status Banners sections, and formally integrated the numeric stepper input into the global UI reference.

## v0.9.0 - CLI Database Query & Fluid UI
**Date:** 2026-05-24

### Added
- **Embedded CLI:** Introduced the `db-query` command to execute direct SQLite queries from the terminal. Includes secure, masked vault passphrase prompting and tabulated terminal output.
- **Responsive Design:** Added a horizontally scrollable navigation bar that gracefully handles narrow windows without squishing controls.

### Changed
- **Layout Architecture:** Removed the `1200px` maximum width constraint on data-heavy pages (Settings, Database Browser, Alerts), allowing them to dynamically stretch edge-to-edge on ultrawide monitors.
- **Search UX:** Removed the experimental native Chromium `findInPage` global search due to focus-stealing conflicts.
- **Help Guide:** Restored and heavily optimized the React-based "Find in Page" widget for the Help Handbook. It now uses debounced, O(1) string matching to prevent UI thread lockups and features a sleek, pinned floating UI intercepting `Cmd/Ctrl+F`.

## v0.8.0 - Global Command Palette & Search UX
**Date:** 2026-05-22

### Added
- **Global Search (Omnibox):** Implemented a full-featured global search palette, accessible via a `Cmd/Ctrl+K` keyboard shortcut.
- **Global Search (Omnibox):** The search palette now provides categorized results from the SQLite database (devices, interfaces), the Help Documentation, and the platform Changelog.
- **Global Search (Omnibox):** Added full keyboard navigation to the search results dropdown using `ArrowUp`, `ArrowDown`, and `Enter`.
- **Local Search:** Implemented a `Cmd/Ctrl+F` shortcut to automatically focus any visible local "find-in-page" search bar (e.g., in the Help Modal or Notifications Drawer).
- **Local Search:** Added keyboard navigation to local search results using `Enter` (next) and `Shift+Enter` (previous).

### Changed
- **Search Backend:** The Go `/api/search` endpoint was upgraded to perform a multi-source text search across the SQLite database and the filesystem's Markdown documentation in parallel.
- **Build Process:** The Electron build process now unpacks the `/public/docs` directory from the ASAR archive, making it accessible to the Go backend for live documentation searching.

## v0.7.0 - Architectural UI Enhancements
**Date:** 2026-05-21

### Added
- **API Client:** Introduced `CanopyApiClient` to centralize all backend `fetch` requests, enforcing standardized `Authorization` headers and JSON error parsing across the entire frontend.
- **Form Components:** Created a reusable `<PasswordInput>` component with inline visibility toggles to DRY up authentication forms.
- **Form Components:** Created a custom `<FileInput>` wrapper for the System Upgrade page to replace native browser tooltips with a theme-compliant UI.

### Changed
- **System Layout:** Locked the main viewport to `overflowY: scroll` to permanently reserve the scrollbar gutter, guaranteeing **Zero-CLS** (Cumulative Layout Shift) when navigating between short and long pages.
- **Global Spacing:** Standardized all module `gap` and `padding` rules to `25px` for uniform visual rhythm.
- **Global Icons:** Codified strict iconography scaling rules (`18px` for headers, `16px` for inputs, `14px` for inline alerts/buttons) to improve UI hierarchy.
- **Search Bars:** Unified all search bar widths to `250px` across the application.
- **Navigation:** Reordered the `System` sidebar menu logically by function and priority.

### Fixed
- Fixed a CSS stacking context trap where floating `<Tooltip>` components were being obscured by sibling `<input>` wrappers.

## v0.6.0 - 2026-05-19 11:30 PM

**System & Core**
* Migrated the SQLite storage engine to **SQLCipher** for military-grade AES-256 offline vault encryption.
* Integrated Electron's `safeStorage` API to securely wrap Master Passphrases using the host OS Keychain / Credential Manager, complete with native Biometric (TouchID/Windows Hello) prompts.
* Implemented `garble` obfuscation into the Go build pipeline to cryptographically scramble native machine code and protect backend intellectual property.
* Added a configurable global inactivity timer that automatically severs the database connection and locks the workspace.

**UI/UX**
* Built a dedicated `VaultUnlockPage` to intercept application entry and enforce Master Passphrase validation.
* Introduced a zero-dependency password entropy/strength meter with real-time inline validation.
* Standardized system popups using a unified `<Modal>` architecture to eliminate Cumulative Layout Shift (CLS).
* Added "Dirty State Tracking" to application forms to prevent redundant API calls.
* Added an Emergency Factory Reset mechanism for secure workspace decommissioning.

## v0.5.0

**UI/UX**
* Wired up the "Revert to Previous Snapshot" button in the System Upgrade UI to allow users to manually trigger the backend's zero-space emergency rollback system.
* Added confirmation dialogs and active log streams for the system rollback sequence.

## v0.4.0

**System & Core**
* Refactored the application restart mechanism to use a detached child process instead of `app.relaunch()`. This bypasses strict macOS bundle caching and ensures patched files are immediately loaded into memory.
* Made `.cpatch` directory extraction logic fully case-insensitive to handle manually zipped artifacts more gracefully.

## v0.3.0

**System & Core**
* Tested and validated live-patching functionality via `.cpatch` payload delivery.
* Preparing system architecture for Palo Alto XML ingestion pipelines.

## v0.2.0

**System & Core**
* Introduced a resilient, forward-only live patching mechanism with zero-space emergency rollbacks.
* Excluded heavy developer directories from auto-rollback backups to dramatically improve patch speeds.
* Added environmental detection to dynamically map isolated SQLite paths for portable deployments.

**UI/UX**
* Added contextual Help Handbook for System Upgrades.
* Dynamic detection of portable deployments to intelligently hide unsupported features (like live patching) from field engineers.

## [0.1.0] - 2024-05-24

### Added
- Headless `canopy-core` engine compiled in Go for maximum parallel read efficiency.
- Isolated SQLite storage matrix with Write-Ahead Logging (WAL) constraints.
- React & Electron UI decoupled via strictly authorized IPC memory bridges.
- Contextual Help Modals and Markdown parsing engine.