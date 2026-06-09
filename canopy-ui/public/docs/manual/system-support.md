# System Support & Diagnostics

This module provides tools for monitoring the health of the Canopy system, adjusting telemetry logging, and accessing the embedded Command Line Interface (CLI).

## The Canopy CLI

The Canopy architecture embeds a high-performance, local CLI directly into the Go daemon binary (`canopy-core`). Because it bypasses the HTTP REST API, it is incredibly fast and perfect for automation.

### Accessing the CLI

To use the CLI, open your local terminal (e.g., PowerShell, macOS Terminal, or Linux Bash) and navigate to the folder where Canopy is installed. Run the core executable directly:

**On macOS / Linux:**
~~~bash
./canopy-core help
~~~

**On Windows:**
~~~powershell
.\canopy-core.exe help
~~~

*Note: If you are running a single-file Portable version of Canopy (e.g., `.AppImage` or the Portable Windows `.exe`), the core binary is compressed securely inside the package. The embedded CLI is only accessible on persistent, full-installation deployments.*