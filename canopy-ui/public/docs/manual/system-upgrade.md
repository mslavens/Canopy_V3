## System Upgrade (Live Patching)

Canopy supports "Forward-Only" live patching in production. This allows you to upgrade your system instantly without running a full application installer.

### How to Apply a Patch
1. Obtain the latest `.cpatch` file from your administrator or the official releases page.
2. Drag and drop the `.cpatch` file into the upload zone, or click to browse.
3. The system will run a pre-flight inspection on the patch, verify its integrity, and safely extract the new files.
4. Once applied successfully, the application will prompt you to restart.

*Note for macOS Users: The application will perform a hard detached restart to safely bypass system caching and ensure all newly patched files are correctly loaded into memory.*

### Emergency Rollbacks
If a patch fails or you experience instability, you can revert to the previous state. Canopy automatically creates a lightweight snapshot of the system immediately before applying any new `.cpatch` files. 

*Note: Portable application deployments (e.g., single-file `.exe` or `.AppImage`) do not support live-patching. You must replace the executable entirely for those deployments.*