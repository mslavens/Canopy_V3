# Canopy v2.0 Architectural Guardrails

## Core Infrastructure Boundaries
- **Frontend Layer:** Electron + React (Thin Presentation Shell). Max 60FPS UI rendering efficiency. No native file execution, no direct database pooling, no heavy regex parser blocks, and no crypto calculations.
- **Backend Layer:** Headless compiled Go daemon bound strictly to local loopback interface (`127.0.0.1`). Manages all configuration file parsing, database management, and token data streaming. 
- **CLI Interface:** A terminal interface embedded within the Go daemon binary. CLI commands must execute core `engine` and `storage` functions directly in memory, bypassing the HTTP transport layer for maximum performance when run locally.
- **Transport Architecture:** Asynchronous HTTP REST endpoints. Server-Sent Events (SSE) for AI typing streams. WebSockets for high-volume live log pushes. All requests require an `Authorization: Bearer <token>` header.

## Security & Protection Mechanisms
- **DRM & Licensing:** Hardware ID (HWID) fingerprinting compiled directly inside the Go machine code layer, cross-checked locally against a cryptographically signed Lemon Squeezy activation token.
- **Vault Authentication:** The offline SQLite matrix must be encrypted via SQLCipher using a single Master Passphrase. If "Remember Me" functionality is implemented via Electron's `safeStorage`, it must explicitly require user presence verification (e.g., macOS TouchID or Windows Hello) prior to decryption. Silent auto-unlocks are strictly prohibited.
- **Compilation:** Production Go binaries must strip debug tables via `-ldflags=\"-s -w\"` and utilize native obfuscation via `garble`.
- **Documentation:** Single-source Markdown files embedded directly inside the patchable frontend asset bundle.
- **Patch Management:** System patches (e.g., `.cpatch` files) must be ingested strictly via the Go backend's REST API. The frontend UI is restricted to uploading the payload; the Go daemon owns all cryptographic signature validation, payload extraction, and schema migration logic.
- **Rollbacks & Migrations:** Database schema mutations must be strictly additive (Forward-Only). Dropping columns or renaming tables is prohibited, ensuring that applying an older `.cpatch` file (a downgrade) will never crash against a newer database schema.
- **Application Fingerprinting:** To safely reuse the framework across multiple distinct applications, the Go daemon must define a global `AppDisplayName` and `AppBundleID`. All SQLite databases must embed a `framework_metadata` table containing this bundle ID, and the engine must actively reject imported `.db` files originating from a different application bundle to prevent schema panics.
- **Zero-Knowledge Before Authentication:** The application must never leak tenant names, environment colors, or configuration details on a cold boot screen prior to authentication. Hot-swap UI transitions should use ephemeral `sessionStorage` to coordinate visual context without writing sensitive metadata to disk.
- **Cryptographic Oracle Prevention:** When importing an external workspace, the system must never implicitly test the active Master Passphrase against the imported archive. The user must explicitly provide the specific archive passphrase used for that file, after which the system will automatically execute a `PRAGMA rekey` to match the current environment.

## Coding Standards & Best Practices
- **Don't Repeat Yourself (DRY):** Code duplication is strictly prohibited across the entire stack.
  - *Frontend:* UI elements must be abstracted into generic, reusable React components (e.g., `<SearchBar />`) rather than duplicating styling, state management, or DOM structures.
  - *Frontend API:* Raw `fetch` calls are strictly prohibited inside React components. All network requests must be routed through a centralized API client class (e.g., `CanopyApiClient`) to ensure uniform header injection (like `Authorization`), standardized error parsing, and DRY request logic.
  - *Backend:* Core business logic must be abstracted into modular Go packages (`engine`, `storage`, `adapters`) that can be safely imported by both the REST API and the CLI without duplicating execution paths.
  - *Backend Modularity:* The `canopy-core` package must remain strictly modular. Massive monoliths are strictly prohibited. REST API endpoints must be separated into dedicated domain-specific files (e.g., `handlers_address.go`, `handlers_tags.go`, `handlers_profiles.go`) rather than appending all routes and logic into `main.go`. `main.go` should only be used for structural entrypoints, listener bindings, and global schemas.
- **Single Responsibility Principle (SRP):** Functions, Go structs, and React components must do exactly one thing well. If a component handles fetching data, complex data mutation, and rendering UI, it must be decoupled.
- **Fail Fast & Graceful Degradation:** 
  - *Backend:* Go errors must be explicitly handled and returned. Do not silently swallow errors. Only panic during initialization faults (e.g., database mounting failures); never panic during active runtime execution.
  - *Frontend:* React components must utilize Error Boundaries to ensure a localized rendering or fetch failure does not crash the entire Electron application shell.
- **YAGNI (You Aren't Gonna Need It):** Avoid premature optimization. Build strictly for the current schemas and requirements. Do not over-engineer generalized abstraction layers for hypothetical future use cases.

## UX & Accessibility Guidelines
- **Micro-Context (Tooltips):** Any icon-only buttons or complex data column headers must be wrapped in a reusable `<Tooltip />` component to provide instant inline context.
- **Macro-Context (Help Modals):** In-depth documentation must remain hidden by default to avoid UI clutter. Users should access contextual Markdown documentation via a universal `?` toggle mapped to the active page state.
- **Layout & Spacing Standardization:**
  - **Page Wrappers:** All top-level page components must be wrapped in `<div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>`. Data-heavy pages (like Data Grids and Logs) must be fully fluid to utilize ultrawide monitors. Reading and form-based pages (like Settings, Upgrades, or Path Resolution) must be capped with `maxWidth: '1200px'` to prevent eye strain on ultrawide displays.
  - **Navigation Scrolling:** Top-level navigation tabs must use `flexShrink: 0` combined with a hidden-scrollbar `overflowX: 'auto'` container to gracefully handle narrow windows.
  - **Data Grids:** Tables displaying large datasets must implement client-side or server-side **Pagination** to control DOM bloat. Do not use constrained `maxHeight` scrolling wrappers, as they cause native HTML scrollbars to awkwardly overlap sticky headers. Rely on pagination (e.g., 25/50/100 rows per page) and fluid horizontal scrolling for wide columns. All data grids must support client-side **CSV Export** utilizing the native browser Blob API, ensuring the generated filename includes an ISO-compliant timestamp.
  - **Section Blocks:** All module sections must be wrapped in `<section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>`.
  - **Sticky Page Headers:** The primary header (`<h2>` and search bar) for scrollable pages must use `<div style={{ position: 'sticky', top: '-30px', backgroundColor: 'var(--bg-app)', zIndex: 10, padding: '30px 0 10px 0', margin: '-30px 0 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>` to firmly dock to the top of the scroll container and obscure underlying content.
  - **Typography & Alerts:** Standardized font sizes must be used. All inline error alerts must use a `13px` font size with a `12px 15px` padding, a `4px` colored left border, and flex-align an `<AlertTriangle size={16} />` icon.
  - **Search Bars:** All global and page-level search bars must use a consistent default width of `250px`.
  - **Empty States:** When a table, list, or search result returns no data, always use the reusable `<EmptyState />` component instead of generic unstyled text. It should include a semantic icon, a bold title, and an optional description or action button.
  - **Iconography:** Icons must use standardized sizes based on their context: `32px` for large "hero" icons, `18px` for primary header/toolbar actions, `16px` for input-adornments, `14px` for standard button/alert icons, and `12px` for small secondary actions (e.g., pagination).
- **Zero Cumulative Layout Shift (CLS):** UI elements must never cause the layout to jump or shift when conditionally appearing (e.g., error messages, strength meters, loading spinners). Always pre-allocate DOM space using rigid heights (`minHeight`) or the CSS `visibility` property to guarantee a completely static, satisfying, and predictable interface.
- **Notifications:** Transient success/error states should utilize floating Toast notifications. Persistent system degradation faults should anchor firmly to the footer status bar.
- **Strict Theming:** Never hardcode absolute colors (e.g., `#FFFFFF` or `black`) or rely on native browser rendering for form elements (dropdowns, inputs, scrollbars). All UI components must explicitly bind to the semantic CSS design tokens (e.g., `var(--bg-surface)`, `var(--text-main)`) to guarantee unified Light/Dark mode transitions.
- **Searchable Dropdowns:** Any select or dropdown component displaying dynamic option lists (e.g., choosing device groups, member templates, or parent configs) containing more than 8 options must support inline search/filtering within the dropdown overlay. This ensures users can easily find items by typing. Native browser `<select>` dropdowns are prohibited for dynamic lists.
- **Actions Menu Symmetry:** Any actions available in an explorer header, toolbar, or dropdown list (e.g., adding, editing, or deleting items) must be mirrored as a custom context menu (right-click) option on the corresponding list node or table row. This enforces a consistent experience and visual alignment across all dashboard explorer modules.
- **Search Highlighting:** All local page-level search filters must visually highlight the matching text substrings using the `<HighlightedText />` component to maintain data parsing consistency across the UI.
- **State-Aware Actions (Dirty State):** Form submissions, "Save", or "Commit" buttons must be actively disabled (`disabled={true}`) when the associated input state has not changed from its baseline value. This prevents redundant API requests and provides immediate visual feedback that the data is clean.
- **Interactive Elements & Utility Classes:** All buttons and clickable elements must provide immediate visual feedback globally via `global.css`. Buttons must fade to 75% opacity on hover (`cursor: pointer`), scale down to 97% on active click, and drop to 50% opacity with `cursor: not-allowed` when disabled. Do not rely on inline React styles for button states, structure, or colors. Instead, utilize the semantic global classes (e.g., `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-success`) defined in the Design System.

## Copywriting & Tone
- **Factual and Concise:** Do not use marketing-driven or "salesy" language to pitch the application's security or features to the user (e.g., avoid terms like "military-grade", "Compliance & Immutability", or "Cryptographically sealed"). 
- **Simplicity:** Keep all UI copy, error messages, and documentation simple, dry, and to the point.

## Search & Command Hierarchy
- **The Command Palette (`Cmd+K`):** Global search must always act as a navigation router (Command Palette) querying the Go backend, never as a text highlighter.
- **Local Find-in-Page (`Cmd+F`):** Do not use Electron's native `webContents.findInPage()` API due to heavy DOM focus-stealing conflicts. Local search must be handled by React state, utilizing a debounced `useMemo` block to prevent Reconciliation Thrashing on large documents.
- **The Embedded Wiki Pattern:** Documentation routing should be handled internally by intercepting Markdown `<a href>` tags rather than forcing the user to a new browser window.

## Accessibility & Focus Management
- **Focus Trapping:** All floating overlays (Modals and sliding Drawers) must implement a `Tab` and `Shift+Tab` focus trap using native DOM queries to prevent keyboard users from dropping focus back into the background application.
- **The `inert` Attribute:** Any DOM element that is visually hidden off-screen (like a closed sliding drawer) must be given the HTML5 `inert` attribute so the browser's accessibility engine doesn't attempt to tab to invisible buttons.
- **Focus Rings:** To bypass jarring native Chromium yellow/black focus rings, apply `*:focus:not(:focus-visible) { outline: none; }` globally, and strictly style `*:focus-visible` to match the application's semantic accent color.

## Embedded CLI Limitations
- **Portable Mode Constraint:** The `canopy-core` embedded CLI tool (e.g., `db-query`) relies on persistent OS file paths. It cannot be used when the application is deployed in a single-file Portable format (like Linux `.AppImage` or Windows Portable `.exe`), as those runtimes extract binaries into temporary, hidden directories.

## Multi-Vendor Adaptability & Path Analysis
- **Multi-Vendor Workspaces:** Workspaces must natively support mixed-vendor firewall estates (e.g., a mix of Palo Alto, Fortinet, and Cisco devices in the same workspace). Shared structures (like address objects, zones, routing tables) must be normalized so that cross-vendor pathing can be resolved.
- **Heterogeneous Policy Generation:** When the Path Analysis Engine calculates traffic paths that transit multiple firewalls of different vendors, the engine must generate separate, vendor-specific policies for each transit node (e.g., generating PAN-OS CLI rules for the Palo Alto hop, and FortiOS CLI rules for the Fortinet hop).
