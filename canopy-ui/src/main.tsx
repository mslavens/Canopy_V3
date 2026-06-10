import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './global.css';

import { AppLayout } from './layouts/AppLayout';
import { ToastContainer, ToastMessage } from './components/ToastContainer';
import { PathResolutionPage } from './pages/PathResolutionPage';
import { InterfacesPage } from './pages/InterfacesPage';
import { XMLImportPage } from './pages/XMLImportPage';
import { ObjectsPage } from './pages/ObjectsPage';
import { DeviceManagementPage } from './pages/DeviceManagementPage';
import { ChangelogPage } from './pages/ChangelogPage';
import { DatabaseBrowserPage } from './pages/DatabaseBrowserPage';
import { SettingsPage } from './pages/SettingsPage';
import { UpgradePage } from './pages/UpgradePage';
import { DesignSystemPage } from './pages/DesignSystemPage';
import { SupportPage } from './pages/SupportPage';
import { VaultUnlockPage } from './pages/VaultUnlockPage';
import { CanopyApiClient } from './api/client';
import { GlobalErrorBoundary } from './components/ErrorBoundary';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { SecretsVaultPage } from './pages/SecretsVaultPage';
import { SnapshotsPage } from './pages/SnapshotsPage';
import { Loader2 } from 'lucide-react';
import { ConfirmProvider } from './components/ConfirmProvider';
import { UnsavedChangesProvider } from './components/UnsavedChangesProvider';

const App = () => {
  // Core Global Contexts
  const [auth, setAuth] = useState<{ url: string; token: string } | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [isPortable, setIsPortable] = useState<boolean>(false);
  const [isVaultLocked, setIsVaultLocked] = useState<boolean>(true);
  const [isVaultInitialized, setIsVaultInitialized] = useState<boolean>(true);
  const [isSessionExpired, setIsSessionExpired] = useState<boolean>(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState<number>(() => {
    const saved = localStorage.getItem('canopy-auto-lock-minutes');
    return saved ? parseInt(saved, 10) : 15;
  });

  // Navigation & Layout State
  const [activeMainTab, setActiveMainTab] = useState<string>('Dashboard');
  const [activeSubTab, setActiveSubTab] = useState<string>('Overview');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [notificationsHistory, setNotificationsHistory] = useState<ToastMessage[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('canopy-notifications');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Rehydrate ISO string dates back into native JavaScript Date objects
          return parsed.map((n: any) => ({ ...n, timestamp: new Date(n.timestamp) }));
        } catch (e) {
          console.error("Failed to parse notifications history", e);
        }
      }
    }
    return [];
  });

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = document.documentElement.getAttribute('data-theme');
      if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
      return 'dark'; // Force dark mode as the default baseline
    }
    return 'dark';
  });

  // Persist notifications history to local storage whenever it changes
  useEffect(() => {
    localStorage.setItem('canopy-notifications', JSON.stringify(notificationsHistory));
  }, [notificationsHistory]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const addToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: ToastMessage = { id, message, type, timestamp: new Date() };
    
    setToasts((prev) => [...prev, newToast]);
    setNotificationsHistory((prev) => [newToast, ...prev]); // Prepend so newest is at the top
    setTimeout(() => {
      setToasts((prev) => prev.filter(t => t.id !== id));
    }, 5000); // Auto-dismiss after 5 seconds
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter(t => t.id !== id));
  };

  const clearNotifications = () => setNotificationsHistory([]);

  useEffect(() => {
    const initAuthBridge = async () => {
      try {
        const credentials = await window.electron.getBackendAuth();
        
        const isSwitching = sessionStorage.getItem('canopy-is-switching') === 'true';
        if (isSwitching) {
          // Intentionally pad the hot-swap loading screen so the transition doesn't feel like a jagged flash.
          await new Promise(resolve => setTimeout(resolve, 800));
        } else {
          // Cold boot: just give the Go daemon a tiny 50ms head start to bind to the port.
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Smart polling: Wait for the Go daemon to fully bind to the port before unlocking the UI
        let isReady = false;
        const apiClient = new CanopyApiClient(credentials);
        for (let i = 0; i < 20; i++) {
          try {
            const data = await apiClient.healthCheck();
            setIsPortable(data.portable === true);
            setIsVaultLocked(data.vault_locked === true);
            setIsVaultInitialized(data.vault_exists === true);
            isReady = true;
            break;
          } catch (e) {
            // Silently swallow ERR_CONNECTION_REFUSED during the boot sequence
          }
          await new Promise(resolve => setTimeout(resolve, 150)); // Wait 150ms before checking again
        }

        if (!isReady) {
          throw new Error('Backend daemon timeout. Engine failed to start.');
        }

        setAuth(credentials);
        sessionStorage.removeItem('canopy-is-switching');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Failed to establish memory bridge with daemon';
        setSystemError(errMsg);
        addToast(errMsg, 'error');
      }
    };
    initAuthBridge();
  }, []);

  // --- GLOBAL IDLE TIMER (AUTO-LOCK) ---
  useEffect(() => {
    if (!auth || isVaultLocked || autoLockMinutes === 0) return;

    let idleTimer: ReturnType<typeof setTimeout>;
    const IDLE_TIMEOUT_MS = autoLockMinutes * 60 * 1000;

    const lockVault = async () => {
      try {
        await new CanopyApiClient(auth).lockVault();
        setIsVaultLocked(true);
        setIsSessionExpired(true);
      } catch (e) {
        console.error('Failed to lock vault on idle timeout', e);
      }
    };

    const resetTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(lockVault, IDLE_TIMEOUT_MS);
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetTimer));
    resetTimer(); // Start initially

    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      clearTimeout(idleTimer);
    };
  }, [auth, isVaultLocked, autoLockMinutes]);

  const handleManualLock = async () => {
    if (!auth) return;
    try {
      await new CanopyApiClient(auth).lockVault();
      setIsVaultLocked(true);
      setIsSessionExpired(false);
    } catch (e) {
      console.error('Failed to manually lock vault', e);
    }
  };

  // Router Switch Logic
  const renderActivePage = () => {
    if (activeMainTab === 'Network' && activeSubTab === 'Interfaces') {
      return <InterfacesPage auth={auth} addToast={addToast} />;
    }
    if (activeMainTab === 'Device Management') {
      return <DeviceManagementPage auth={auth} addToast={addToast} activeSubTab={activeSubTab} setActiveSubTab={setActiveSubTab} />;
    }
    if (activeMainTab === 'Objects') {
      return <ObjectsPage auth={auth} addToast={addToast} activeSubTab={activeSubTab} />;
    }
    if (activeMainTab === 'XML Import') {
      return <XMLImportPage auth={auth} addToast={addToast} onNavigate={(m, s) => { setActiveMainTab(m); setActiveSubTab(s); }} />;
    }
    if (activeMainTab === 'Network' && activeSubTab === 'Path Resolution') {
      return <PathResolutionPage auth={auth} addToast={addToast} />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Changelog') {
      return <ChangelogPage />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Workspaces') {
      return <WorkspacesPage auth={auth} addToast={addToast} />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Secrets Vault') {
      return <SecretsVaultPage auth={auth} addToast={addToast} />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Snapshots') {
      return <SnapshotsPage auth={auth} addToast={addToast} />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Database Browser') {
      return <DatabaseBrowserPage auth={auth} addToast={addToast} />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Upgrade') {
      return <UpgradePage auth={auth} addToast={addToast} />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Settings') {
      return <SettingsPage auth={auth} addToast={addToast} autoLockMinutes={autoLockMinutes} setAutoLockMinutes={setAutoLockMinutes} />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Audit Logs') {
      return <AuditLogsPage auth={auth} addToast={addToast} />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Design System') {
      return <DesignSystemPage />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Support') {
      return <SupportPage auth={auth} addToast={addToast} />;
    }
    return <div style={{ color: 'var(--text-muted)' }}>Select an active module from the sidebar.</div>;
  };

  // Render blocker until the memory bridge establishes
  if (!auth) {
    const targetWorkspace = localStorage.getItem('canopy-active-workspace') || 'Workspace';
    const targetColor = localStorage.getItem('canopy-active-workspace-color') || 'var(--accent-blue)';
    const isSwitching = sessionStorage.getItem('canopy-is-switching') === 'true';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: 'var(--bg-app)', color: 'var(--text-muted)' }}>
        {systemError ? (
          <div style={{ textAlign: 'center', backgroundColor: 'var(--bg-surface)', padding: '30px', borderRadius: '8px', border: '1px solid var(--status-red)', maxWidth: '400px' }}>
            <div style={{ color: 'var(--status-red)', fontSize: '16px', fontWeight: 600, marginBottom: '10px' }}>Engine Initialization Failed</div>
            <div style={{ color: 'var(--text-main)', fontSize: '13px', lineHeight: 1.5 }}>{systemError}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '15px' }}>Check your terminal logs. A previous background process may still be holding port 8080.</div>
          </div>
        ) : isSwitching ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
            <Loader2 size={32} className="spin-animation" style={{ color: targetColor }} />
            <div style={{ fontSize: '15px', color: 'var(--text-main)', fontWeight: 500, letterSpacing: '0.3px' }}>
              Loading workspace: <span style={{ color: targetColor }}>{targetWorkspace}</span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
            <Loader2 size={32} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />
            <div style={{ fontSize: '15px', color: 'var(--text-main)', fontWeight: 500, letterSpacing: '0.3px' }}>
              Initializing Canopy Engine...
            </div>
          </div>
        )}
      </div>
    );
  }

  // Render blocker until the SQLCipher Vault is decrypted
  if (isVaultLocked) {
    return (
      <>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        <VaultUnlockPage 
          auth={auth} 
          addToast={addToast} 
          onUnlock={() => { setIsVaultLocked(false); setIsSessionExpired(false); setIsVaultInitialized(true); }} 
          isSetupRequired={!isVaultInitialized}
          isSessionExpired={isSessionExpired}
        />
      </>
    );
  }

  return (
    <AppLayout
      theme={theme}
      toggleTheme={toggleTheme}
      activeMainTab={activeMainTab}
      setActiveMainTab={setActiveMainTab}
      activeSubTab={activeSubTab}
      setActiveSubTab={setActiveSubTab}
      toasts={toasts}
      addToast={addToast}
      dismissToast={dismissToast}
      notificationsHistory={notificationsHistory}
      clearNotifications={clearNotifications}
      systemError={systemError}
      isPortable={isPortable}
      port={auth ? new URL(auth.url).port : null}
      onLockApp={handleManualLock}
    >
      {renderActivePage()}
    </AppLayout>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <ConfirmProvider>
        <UnsavedChangesProvider>
          <App />
        </UnsavedChangesProvider>
      </ConfirmProvider>
    </GlobalErrorBoundary>
  </React.StrictMode>
);