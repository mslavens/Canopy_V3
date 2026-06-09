const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { app } = require('electron');

let coreProcess = null;
let sessionToken = '';
let logStream = null;
let currentLogFile = '';

function sysLog(prefix, message, isError = false) {
    const logLine = `[${new Date().toISOString()}] [${prefix}] ${message}\n`;
    isError ? console.error(logLine.trim()) : console.log(logLine.trim());
    if (logStream) {
        logStream.write(logLine);
    }
}

/**
 * Automatically resolves the native binary asset path and fires up the Go daemon core.
 */
function startBackendCore(userDataPath) {
    // 1. Generate a secure, randomized single-session token for loopback API protection
    sessionToken = crypto.randomBytes(32).toString('hex');

    // 2. Resolve paths cleanly depending on context (Development vs Packaged app)
    const isPackaged = app ? app.isPackaged : false;
    let binaryPath = '';
    let dataPath = userDataPath;
    let corePath = '';
    let isPortableMode = 'false';
    let logLevel = process.env.CANOPY_LOG_LEVEL || (isPackaged ? 'INFO' : 'DEBUG');

    // --- PORTABLE MODE DETECTION ---
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
        // Windows Portable (.exe) -> Provided by electron-builder
        dataPath = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Canopy_Data');
        isPortableMode = 'true';
    } else if (process.env.APPIMAGE) {
        // Linux Portable (.AppImage) -> Provided by AppImage runtime
        dataPath = path.join(path.dirname(process.env.APPIMAGE), 'Canopy_Data');
        isPortableMode = 'true';
    } else if (isPackaged && process.platform === 'darwin') {
        // Mac Portable (.zip/.app) check
        const macExePath = app.getPath('exe');
        // If the app is NOT in the system /Applications folder, treat it as portable
        if (!macExePath.startsWith('/Applications/')) {
            // Path: .../Canopy.app/Contents/MacOS/Canopy -> Go up 4 levels to sit right next to Canopy.app
            dataPath = path.join(macExePath, '..', '..', '..', '..', 'Canopy_Data');
            isPortableMode = 'true';
        }
    }
    // -------------------------------

    // --- SETUP UNIFIED SYSTEM LOGGER ---
    const logDir = path.join(dataPath, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    currentLogFile = path.join(logDir, 'system.log');
    const logFile = currentLogFile;
    
    // 5MB Rolling log rotation with 5 historical compressed archives
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) {
        // Shift previous archives (1 to 4) up one slot (2 to 5)
        for (let i = 4; i >= 1; i--) {
            const oldArchive = path.join(logDir, `system.${i}.log.gz`);
            const newArchive = path.join(logDir, `system.${i + 1}.log.gz`);
            if (fs.existsSync(oldArchive)) {
                fs.renameSync(oldArchive, newArchive);
            }
        }

        // Rename active log to a temp file immediately so we can boot synchronously
        const tempLog = path.join(logDir, 'system.rotating.log');
        fs.renameSync(logFile, tempLog);

        // Compress it asynchronously in the background so it doesn't freeze the UI!
        const readStream = fs.createReadStream(tempLog);
        const writeStream = fs.createWriteStream(path.join(logDir, 'system.1.log.gz'));
        readStream.pipe(zlib.createGzip()).pipe(writeStream).on('finish', () => {
            fs.unlink(tempLog, () => {}); // Delete the raw file once safely compressed
        });
    }
    logStream = fs.createWriteStream(logFile, { flags: 'a' });

    if (!isPackaged) {
        // Local Dev Path: Point straight to your canopy-core backend codebase folder
        binaryPath = path.join(__dirname, '..', '..', 'canopy-core', 'canopy-core');
        corePath = path.join(__dirname, '..', '..', 'canopy-core');
        // For development, create a temporary data directory to avoid cluttering the source tree
        dataPath = path.join(app.getPath('temp'), 'CanopyDevData');
    } else {
        // Production Path: Look inside the compiled app resource matrix
        let exe = 'canopy-core';
        if (process.platform === 'win32') exe = 'canopy-core.exe';
        if (process.platform === 'linux') exe = 'canopy-core-linux';
        binaryPath = path.join(process.resourcesPath, exe);
        corePath = process.resourcesPath;
    }

    sysLog('Lifecycle', `Spawning background core engine at: ${binaryPath}`);
    sysLog('Lifecycle', `Setting data storage path to: ${dataPath}`);

    // 3. Spawn the background Go daemon child process
    coreProcess = spawn(binaryPath, [], {
        cwd: corePath,
        env: {
            ...process.env,
            "CANOPY_TOKEN": sessionToken, // Inject the token strictly via memory isolation
            "CANOPY_DATA_PATH": dataPath,
            "CANOPY_PORTABLE_MODE": isPortableMode,
            "CANOPY_LOG_LEVEL": logLevel
        },
        windowsHide: true // Prevents flashing a terminal window on desktop environments
    });

    // 4. Bind to stdout/stderr streams to pipe backend logs into your main process debugging console
    coreProcess.stdout.on('data', (data) => {
        sysLog('Go Engine', data.toString().trim());
    });

    coreProcess.stderr.on('data', (data) => {
        sysLog('Go Error', data.toString().trim(), true);
    });

    coreProcess.on('close', (code) => {
        sysLog('Lifecycle', `Background daemon core exited with code ${code}`);
    });

    return sessionToken;
}

/**
 * Gracefully terminates the running child process to prevent zombie port locks.
 */
function stopBackendCore() {
    if (coreProcess) {
        sysLog('Lifecycle', 'Signaling graceful termination to Go core daemon...');
        coreProcess.kill('SIGTERM'); // Send standard safe kill signal
        coreProcess = null;
    }
}

// --- ZOMBIE PROCESS PREVENTION ---
// If the developer kills the Electron process in the terminal via Ctrl+C, 
// we must guarantee the child Go daemon is dragged down with it!
process.on('exit', stopBackendCore);
process.on('SIGINT', () => {
    stopBackendCore();
    process.exit(0);
});
process.on('SIGTERM', () => {
    stopBackendCore();
    process.exit(0);
});

module.exports = {
    startBackendCore,
    stopBackendCore,
    getSessionToken: () => sessionToken,
    getLogFilePath: () => currentLogFile
};