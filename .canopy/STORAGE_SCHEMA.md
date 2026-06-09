# Canopy v2.0 Storage Schema Specification

## 1. Relational State Engine (SQLite - app_state.db)

### Runtime Configurations
- **Journal Mode:** `WAL` (Write-Ahead Logging) forced on initialization.
- **Busy Timeout:** `5000ms` via connection pragmas to handle multi-threaded file contention.
- **Access Pattern:** Single-threaded write synchronization pool (Mutex-wrapped) with scalable parallel reads.

### Table: devices
Tracks the imported firewall and network infrastructure appliances.
- `id` (INTEGER, PRIMARY KEY AUTOINCREMENT)
- `uuid` (TEXT, UNIQUE, NOT NULL) - Application-wide deterministic identifier
- `name` (TEXT, NOT NULL) - User-assigned friendly label (e.g., 'Calgary-Edge-PA')
- `vendor` (TEXT, NOT NULL) - Platform tracking token (`paloalto`, `fortinet`, `cisco_asa`)
- `created_at` (DATETIME, DEFAULT CURRENT_TIMESTAMP)

### Table: network_topology
The platform-blind zone mapping table optimized for bitwise subnet intersection scoring.
- `id` (INTEGER, PRIMARY KEY AUTOINCREMENT)
- `device_uuid` (TEXT, NOT NULL, REFERENCES devices(uuid) ON DELETE CASCADE)
- `interface_name` (TEXT, NOT NULL) - e.g., 'ethernet1/1', 'port1'
- `network_cidr` (TEXT, NOT NULL) - Verified IPv4 Subnet block (e.g., '10.99.3.0/24')
- `zone_name` (TEXT, NOT NULL) - Vendor security zone configuration binding (e.g., 'Trust', 'DMZ')
- `vendor_metadata` (TEXT) - JSON blob container storing custom vendor-specific variables (tags, virtual router IDs)

### Table: license_vault
Node-locked cryptographic activation token ledger.
- `id` (INTEGER, PRIMARY KEY AUTOINCREMENT)
- `license_key` (TEXT, NOT NULL) - Lemon Squeezy retail key string
- `hwid_hash` (TEXT, NOT NULL) - Locally derived SHA-256 machine hardware profile fingerprint
- `activation_token` (TEXT, NOT NULL) - Encrypted payload validation block signed by license service
- `expires_at` (DATETIME, NOT NULL) - End date of local offline grace period lease window

## 2. Vectorized Analytics Engine (DuckDB - logs.duckdb)

### Storage Layout & Access Constraints
- **Format:** Columnar vector arrays tracking multi-gigabyte text syslog summaries.
- **Process Lock:** Single-process execution wrapper required. The connection handle must be managed through an isolated lifecycle controller inside the Go core to prevent instant file access panics.
- **Ingestion Vector:** Row-by-row transactional `INSERT` blocks are strictly prohibited for processing live syslog streaming data. All ingestion streams must run through chunked memory buffers utilizing DuckDB's native high-performance vectorized `Appender` API or bulk CSV/Parquet block copies to prevent core thread starvation.

### Table: security_logs
Optimized for ultra-fast aggregations and bitwise network resolution matches.
- `timestamp` (TIMESTAMP, NOT NULL)
- `source_ip` (VARCHAR, NOT NULL)
- `destination_ip` (VARCHAR, NOT NULL)
- `destination_port` (INTEGER, NOT NULL)
- `protocol` (VARCHAR, NOT NULL) - e.g., 'tcp', 'udp', 'icmp'
- `action` (VARCHAR, NOT NULL) - Constrained to strings: `allow`, `deny`, `drop`
- `rule_uuid` (VARCHAR) - Optional pointer back to vendor firewall rule references