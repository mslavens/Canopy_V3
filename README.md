# Canopy v2.0 - Build & Development Guide

Welcome to the Canopy Framework! This document serves as a quick reference for building, testing, and packaging the application across multiple operating systems.

## 🛠️ Local Development

To run the application in development mode (with hot-module reloading for the React UI):
1. Open a terminal and navigate to the UI folder: `cd canopy-ui`
2. Start the dev server: `npm run dev`

*(Note: If you make changes to the Go backend, you must stop the dev server, run `go build` inside `canopy-core`, and then restart `npm run dev` to see the backend changes.)*

## 📦 Production Packaging

Canopy uses a cross-platform build pipeline. You must compile the Go backend *before* packaging the Electron frontend.

### Step 1: Compile the Backend
1. Navigate to the core folder: `cd canopy-core`
2. Run the automated build script for your target platform:
   - Mac (Universal): `./build.sh mac`
   - Windows: `./build.sh win`
   - Linux: `./build.sh linux`
   - All Platforms: `./build.sh all`

### Step 2: Package the Frontend
1. Navigate to the UI folder: `cd canopy-ui`
2. Run the electron-builder script:
   - Mac: `npm run package -- --mac`
   - Windows: `npm run package -- --win`
   - Linux: `npm run package -- --linux`

Your final, distributable installers (e.g., `.dmg`, `.exe`) will be generated inside the `canopy-ui/dist-electron/` folder.

## 🧩 Creating System Patches (.cpatch)

Canopy supports "Forward-Only" live patching in production. To create an update:
1. Compile the new backend (`./build.sh ...`) and build the new UI (`npm run build` inside `canopy-ui`).
2. Create an empty folder (e.g., `Patch_v0.2.0`).
3. Recreate the exact directory structure of the files you want to update (e.g., place your new `app.asar` and `canopy-core` binaries inside).
4. **Zip the *contents* of that folder** (not the folder itself) and rename the zip extension to `.cpatch`.
5. Upload the `.cpatch` file via the Canopy UI under **System > Upgrade**.