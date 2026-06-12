const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe, dedicated API to the window global context
contextBridge.exposeInMainWorld('electron', {
    /**
     * Secures and fetches the runtime port location and one-time session key
     * from the Electron main process lifecycle loop.
     * @returns {Promise<{url: string, token: string}>}
     */
    getBackendAuth: () => ipcRenderer.invoke('get-backend-auth'),
    onTriggerHelp: (callback) => ipcRenderer.on('trigger-help', () => callback()),
    relaunchApp: () => ipcRenderer.send('relaunch-app'),
    exportLogs: () => ipcRenderer.invoke('export-logs'),
    readLogs: () => ipcRenderer.invoke('read-logs'),
    isSafeStorageAvailable: () => ipcRenderer.invoke('is-safe-storage-available'),
    encryptString: (plainText) => ipcRenderer.invoke('encrypt-string', plainText),
    decryptString: (base64Str) => ipcRenderer.invoke('decrypt-string', base64Str),
    promptBiometric: (reason) => ipcRenderer.invoke('prompt-biometric', reason),
    spawnWindow: (queryStr) => ipcRenderer.send('spawn-window', queryStr),
    broadcastMutation: (targetType) => ipcRenderer.send('broadcast-mutation', targetType),
    onMutationDetected: (callback) => {
        ipcRenderer.on('mutation-detected', (event, targetType) => callback(targetType));
    }
});