/// <reference types="vite/client" />

interface Window {
  electron: {
    getBackendAuth: () => Promise<{ url: string; token: string }>;
    onTriggerHelp: (callback: () => void) => void;
    relaunchApp: () => void;
    exportLogs: () => Promise<{ success: boolean; filePath?: string }>;
    isSafeStorageAvailable: () => Promise<boolean>;
    encryptString: (plainText: string) => Promise<string>;
    decryptString: (base64Str: string) => Promise<string>;
    promptBiometric: (reason: string) => Promise<boolean>;
    spawnWindow: (queryStr: string) => void;
    broadcastMutation: (targetType?: string) => void;
    onMutationDetected: (callback: (targetType?: string) => void) => void;
  };
}