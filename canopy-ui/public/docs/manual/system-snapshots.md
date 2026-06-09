# System Snapshots & Backups

The System Snapshots console allows you to manage local configuration checkpoints and securely export or import external system archives (`.cbak` files).

## Local Snapshots
Taking a **Local Snapshot** instantly saves your current workspace configuration. Because local snapshots securely share your active passphrase, they are created without requiring any additional passwords.

If you need to roll back to a previous state, you can click **Revert Workspace**. This will instantly overwrite your active system with the snapshot data. *Note: Security Audit Logs are strictly isolated in a telemetry database and will safely survive all snapshot reverts.*

## Exporting System Backups
You can export any local snapshot as an external backup file (`.cbak`). When exporting, you must provide an **Archive Passphrase**. The system will securely rekey the snapshot using this passphrase before downloading it, allowing you to safely share the file without exposing your passphrase.

## Importing External Backups
When importing a `.cbak` file, you must provide the Archive Passphrase that was used to encrypt it. The system will securely decrypt the archive, automatically rekey it to match your current passphrase, and safely stage it in your Local Snapshots list for you to review or revert to.