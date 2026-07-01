const { app, BrowserWindow, ipcMain, Menu, dialog, safeStorage, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');
const { startBackendCore, stopBackendCore, getLogFilePath } = require('./backendManager');

// Explicitly enforce Application Support folder isolation before the app boots
if (app.isPackaged) {
    app.setName('Canopy');
} else {
    app.setName('Canopy-Dev');
}

let mainWindow = null;

// Helper to dynamically find a free port on the host OS
function getFreePort() {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
    });
}

function createAppWindow(queryStr = '', options = {}) {
    const defaultOptions = {
        width: 1200,
        height: 800,
        minWidth: 1024,
        minHeight: 700,
        backgroundColor: '#1e1e2e',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    };

    const newWindow = new BrowserWindow({ ...defaultOptions, ...options });

    newWindow.once('ready-to-show', () => {
        newWindow.show();
    });

    newWindow.webContents.on('context-menu', (event, params) => {
        const template = [];
        if (params.isEditable) {
            template.push({ role: 'undo' });
            template.push({ role: 'redo' });
            template.push({ type: 'separator' });
            template.push({ role: 'cut' });
            template.push({ role: 'copy' });
            template.push({ role: 'paste' });
            template.push({ role: 'selectAll' });
        } else if (params.selectionText) {
            template.push({ role: 'copy' });
        }
        
        if (template.length > 0) {
            const menu = Menu.buildFromTemplate(template);
            menu.popup(newWindow);
        }
    });

    const isPackaged = app.isPackaged;

    if (isPackaged) {
        newWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { search: queryStr });
        
        newWindow.webContents.on('devtools-opened', () => {
            newWindow.webContents.closeDevTools();
        });
    } else {
        const querySuffix = queryStr ? `?${queryStr}` : '';
        newWindow.loadURL(`http://localhost:5173/${querySuffix}`);
    }

    return newWindow;
}

app.whenReady().then(async () => {
    const activePort = await getFreePort();
    // 1. Get the dedicated, writable path for user data and boot the Go daemon
    const userDataPath = app.getPath('userData');
    const token = startBackendCore(userDataPath, activePort);

    // 2. Spin up the native browser window shell
    mainWindow = createAppWindow();

    // Support spawning multiple windows securely
    ipcMain.on('spawn-window', (event, queryStr, options) => {
        createAppWindow(queryStr, options);
    });

    // Broadcast database mutations to all open windows
    ipcMain.on('broadcast-mutation', (event, targetType) => {
        BrowserWindow.getAllWindows().forEach(w => {
            if (w.webContents !== event.sender) {
                w.webContents.send('mutation-detected', targetType);
            }
        });
    });
    
    // 3. Expose an IPC channel so your React components can securely request the token on boot
    ipcMain.handle('get-backend-auth', () => {
        return {
            url: `http://127.0.0.1:${activePort}`,
            token: token
        };
    });

    // Expose a native save dialog to export system logs securely
    ipcMain.handle('export-logs', async () => {
        const logPath = getLogFilePath();
        if (!logPath || !fs.existsSync(logPath)) {
            throw new Error('System log file not found.');
        }
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Export System Logs',
            defaultPath: 'canopy-system.log',
            filters: [{ name: 'Log Files', extensions: ['log', 'txt'] }]
        });
        if (canceled || !filePath) return { success: false };
        fs.copyFileSync(logPath, filePath);
        return { success: true, filePath };
    });

    // Expose native log reading for the UI Support Page
    ipcMain.handle('read-logs', async () => {
        const logPath = getLogFilePath();
        if (!logPath || !fs.existsSync(logPath)) {
            return 'No system logs found.';
        }
        return fs.readFileSync(logPath, 'utf8');
    });

    // Expose native safeStorage credential management
    ipcMain.handle('is-safe-storage-available', () => {
        return safeStorage.isEncryptionAvailable();
    });
    ipcMain.handle('encrypt-string', (event, plainText) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Safe storage is not available');
        return safeStorage.encryptString(plainText).toString('base64');
    });
    ipcMain.handle('decrypt-string', (event, base64Str) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Safe storage is not available');
        return safeStorage.decryptString(Buffer.from(base64Str, 'base64'));
    });

    // Expose native biometric/OS authentication prompts
    ipcMain.handle('prompt-biometric', async (event, reason) => {
        // macOS natively supports forcing TouchID/Password prompts via systemPreferences
        if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
            try {
                await systemPreferences.promptTouchID(reason);
                return true;
            } catch (e) {
                return false; // User clicked cancel or failed fingerprint
            }
        }
        // Windows/Linux defer to OS-level credential manager prompts automatically during decryption
        return true;
    });

    // 4. Build a Native Application Menu to tie into the macOS Help Toolbar
    const isMac = process.platform === 'darwin';
    const template = [
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
        {
            role: 'help',
            submenu: [
                {
                    label: 'Canopy Help & Documentation',
                    click: () => {
                        if (mainWindow) mainWindow.webContents.send('trigger-help');
                    }
                }
            ]
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    // 5. Listen for restart requests from the frontend after a system patch
    ipcMain.on('relaunch-app', () => {
        // Using spawn instead of app.relaunch() can help bypass macOS's app bundle caching,
        // ensuring the newly patched files are loaded on restart.
        if (app.isPackaged) {
            const appPath = app.getPath('exe');
            spawn(appPath, [], {
                detached: true,
                stdio: 'ignore'
            }).unref();
        } else {
            app.relaunch();
        }
        app.quit();
    });
});

// 6. DEFENSIVE CLEANUP: Force close the core daemon when the user closes the desk UI window shell
app.on('window-all-closed', () => {
    stopBackendCore();
    app.quit();
});

app.on('will-quit', () => {
    stopBackendCore();
});