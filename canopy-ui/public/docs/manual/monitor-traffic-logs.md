# Network Monitor & Traffic Logs

The **Network Monitor** provides a powerful interface for analyzing both real-time streaming traffic and historical network logs imported from your firewalls.

## Traffic Logs Data Grid

The Traffic Logs tab displays a unified view of all network activity.

- **Fluid Interface:** The data grid is designed to be fully fluid and edge-to-edge, taking maximum advantage of ultrawide displays.
- **Excel-Style Column Filtering:** Every column header features a funnel icon. Hover over the header to reveal it, and click to apply powerful exact-match or multi-select filters directly to that column.
- **Right-Click Context Menu:** Right-click on any individual cell to instantly add that cell's specific value to the active filter, or to completely clear filters for that column. You can also permanently delete specific log entries.
- **Custom Views:** The grid supports resizing columns, sorting by clicking headers, and selecting multiple rows via checkboxes for bulk deletion.

## Log Importer

The **Log Import** tab allows you to ingest historical firewall traffic logs for offline analysis.

- **Supported Formats:** You can import logs exported from supported firewall vendors in standard CSV format.
- **Data Enrichment:** During import, the system automatically parses firewall-specific columns and normalizes the data for high-speed querying within the offline SQLite vault.
- **Performance:** Imported logs are seamlessly merged with the main database without requiring network access, enabling instant, high-performance offline analytics.

> [!TIP]
> Use the **Export CSV** feature (available via the table's context menu or bulk actions) to save your filtered dataset to a local file for external reporting.
