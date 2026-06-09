# Workspace Management

The Workspace Management console allows for the creation, organization, and manipulation of isolated database environments.

## Hub and Spoke Architecture
Canopy operates on a "Hub and Spoke" database architecture. All active client configurations, devices, and security rules are stored in independent SQLite database files (the spokes), separate from the core configuration database (the hub). This enforces strict data isolation.

## Exporting & Importing Workspaces
When exporting a workspace, an Archive Passphrase must be specified to encrypt the exported database. This prevents sensitive configurations from being stored in plaintext.

When importing an external workspace, the matching Archive Passphrase must be provided. The engine will instantly rekey the imported database to align with the current Master Passphrase, closing potential cryptographic side-channel leaks.

## Active Context
The currently active workspace is indicated by a customized color badge in the navigation sidebar, dropdown menu, and application header. To assign a unique color to a workspace, use the **Edit** action within the management grid.