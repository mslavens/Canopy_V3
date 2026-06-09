# Security Audit Logs

The Security Audit Logs provide a record of administrative actions taken within the Canopy workspace.

## Storage
Audit logs are written directly to the encrypted SQLite database (`app_state.db`) rather than plain-text system log files. This ensures the audit trail cannot be modified without the Master Passphrase.

## Audited Events
The system automatically records critical security and maintenance events, including:
* **Vault Lifecycle Events:** Unlocks, auto-locks, factory resets, and master passphrase rekeying operations.
* **Security Configurations:** Adjusting auto-lock timers and modifying system log levels.
* **Patch Management:** Applying `.cpatch` payloads and initiating emergency system rollbacks.
* **Raw Database Access:** Executing ad-hoc SQL via the `db-query` CLI tool or the Database Browser UI.