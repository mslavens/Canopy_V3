import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './global.css';

import { AppLayout } from './layouts/AppLayout';
import { CandidatesPopoutPage } from './pages/CandidatesPopoutPage';
import { ToastContainer, ToastMessage } from './components/ToastContainer';
import { InterfacesPage } from './pages/InterfacesPage';
import { ZonesPage } from './pages/ZonesPage';
import { RouteTablePage } from './pages/RouteTablePage';
import { VariablesPage } from './pages/VariablesPage';
import { XMLImportPage } from './pages/XMLImportPage';
import { ObjectsPage } from './pages/ObjectsPage';
import { MonitorPage } from './pages/MonitorPage';
import { DeviceManagementPage } from './pages/DeviceManagementPage';
import { ChangelogPage } from './pages/ChangelogPage';
import { DatabaseBrowserPage } from './pages/DatabaseBrowserPage';
import { HeatmapPage } from './pages/HeatmapPage';
import { PoliciesPage } from './pages/PoliciesPage';
import { SettingsPage } from './pages/SettingsPage';
import { UpgradePage } from './pages/UpgradePage';
import { DesignSystemPage } from './pages/DesignSystemPage';
import { SupportPage } from './pages/SupportPage';
import { VaultUnlockPage } from './pages/VaultUnlockPage';
import { CanopyApiClient } from './api/client';
import { GlobalErrorBoundary } from './components/ErrorBoundary';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { AdaptersPage } from './pages/AdaptersPage';
import { CommitHistoryPage } from './pages/CommitHistoryPage';
import { SecretsVaultPage } from './pages/SecretsVaultPage';
import { SnapshotsPage } from './pages/SnapshotsPage';
import { DatabaseHealthPage } from './pages/DatabaseHealthPage';
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
  const [activeMainTab, setActiveMainTab] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mainTab') || 'Dashboard';
  });
  const [activeSubTab, setActiveSubTab] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('subTab') || 'Overview';
  });
  
  // Global Scope State
  const [globalScopeUuid, setGlobalScopeUuid] = useState<string>('paloalto-panorama-global');
  const [globalScopeVendor, setGlobalScopeVendor] = useState<string>('paloalto');

  const prevMainTab = React.useRef(activeMainTab);
  useEffect(() => {
    prevMainTab.current = activeMainTab;
  }, [activeMainTab]);
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
      const savedTheme = localStorage.getItem('canopy-theme') || document.documentElement.getAttribute('data-theme');
      if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme as 'light' | 'dark';
      return 'dark'; // Force dark mode as the default baseline
    }
    return 'dark';
  });

  // Persist notifications history to local storage whenever it changes
  useEffect(() => {
    localStorage.setItem('canopy-notifications', JSON.stringify(notificationsHistory));
  }, [notificationsHistory]);

  // Sync notifications history from other windows
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'canopy-notifications' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setNotificationsHistory(parsed.map((n: any) => ({ ...n, timestamp: new Date(n.timestamp) })));
        } catch (err) {
          console.error('Failed to parse remote storage update for notifications', err);
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('canopy-theme', theme);
  }, [theme]);

  // Sync theme changes from other windows
  useEffect(() => {
    const handleThemeStorage = (e: StorageEvent) => {
      if (e.key === 'canopy-theme' && (e.newValue === 'light' || e.newValue === 'dark')) {
        setTheme(e.newValue);
      }
    };
    window.addEventListener('storage', handleThemeStorage);
    return () => window.removeEventListener('storage', handleThemeStorage);
  }, []);

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

    const handleVaultLockedEvent = () => {
      setIsVaultLocked(true);
      setIsSessionExpired(true);
    };
    window.addEventListener('vault-locked', handleVaultLockedEvent);

    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      window.removeEventListener('vault-locked', handleVaultLockedEvent);
      clearTimeout(idleTimer);
    };
  }, [auth, isVaultLocked, autoLockMinutes]);

  // Poll backend health to auto-lock if another window encrypted the vault
  useEffect(() => {
    if (!auth || isVaultLocked) return;

    const apiClient = new CanopyApiClient(auth);
    const interval = setInterval(async () => {
      try {
        const data = await apiClient.healthCheck();
        if (data && data.vault_locked === true) {
          setIsVaultLocked(true);
          setIsSessionExpired(true);
        }
      } catch (err: any) {
        // If the health check fails with a 423 Locked, the API client will emit 'vault-locked'
        // which our other event listener will catch. We can also just handle it here.
        if (err.message && err.message.includes('423')) {
          setIsVaultLocked(true);
          setIsSessionExpired(true);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [auth, isVaultLocked]);

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
    if (activeMainTab === 'Networks' && activeSubTab === 'Interfaces') {
      return <InterfacesPage auth={auth} addToast={addToast} globalScopeUuid={globalScopeUuid} setGlobalScopeUuid={setGlobalScopeUuid} globalScopeVendor={globalScopeVendor} setGlobalScopeVendor={setGlobalScopeVendor} />;
    }
    if (activeMainTab === 'Networks' && activeSubTab === 'Zones') {
      return <ZonesPage auth={auth} addToast={addToast} globalScopeUuid={globalScopeUuid} setGlobalScopeUuid={setGlobalScopeUuid} globalScopeVendor={globalScopeVendor} setGlobalScopeVendor={setGlobalScopeVendor} />;
    }
    if (activeMainTab === 'Networks' && activeSubTab === 'Route Table') {
      return <RouteTablePage auth={auth} addToast={addToast} globalScopeUuid={globalScopeUuid} setGlobalScopeUuid={setGlobalScopeUuid} globalScopeVendor={globalScopeVendor} setGlobalScopeVendor={setGlobalScopeVendor} />;
    }
    if (activeMainTab === 'Networks' && activeSubTab === 'Template Variables') {
      return <VariablesPage auth={auth} addToast={addToast} globalScopeUuid={globalScopeUuid} setGlobalScopeUuid={setGlobalScopeUuid} globalScopeVendor={globalScopeVendor} setGlobalScopeVendor={setGlobalScopeVendor} />;
    }
    if (activeMainTab === 'Analytics' && activeSubTab === 'Traffic Heatmap') {
      return <HeatmapPage auth={auth} addToast={addToast} />;
    }
    if (activeMainTab === 'Device Management') {
      return <DeviceManagementPage auth={auth} addToast={addToast} activeSubTab={activeSubTab} setActiveSubTab={setActiveSubTab} />;
    }
    if (activeMainTab === 'Objects') {
      return <ObjectsPage auth={auth} addToast={addToast} activeSubTab={activeSubTab} globalScopeUuid={globalScopeUuid} setGlobalScopeUuid={setGlobalScopeUuid} globalScopeVendor={globalScopeVendor} setGlobalScopeVendor={setGlobalScopeVendor} />;
    }
    if (activeMainTab === 'Policies') {
      return <PoliciesPage auth={auth} addToast={addToast} activeSubTab={activeSubTab} setActiveSubTab={setActiveSubTab} globalScopeUuid={globalScopeUuid} setGlobalScopeUuid={setGlobalScopeUuid} globalScopeVendor={globalScopeVendor} setGlobalScopeVendor={setGlobalScopeVendor} />;
    }
    if (activeMainTab === 'XML Import') {
      return <XMLImportPage auth={auth} addToast={addToast} onNavigate={(m, s) => { setActiveMainTab(m); setActiveSubTab(s); }} />;
    }
    if (activeMainTab === 'Monitor') {
      return <MonitorPage auth={auth} addToast={addToast} activeSubTab={activeSubTab} setActiveSubTab={setActiveSubTab} />;
    }
    if (
      activeMainTab === 'Tools' || 
      activeMainTab === 'Policy Lifecycle' || 
      (activeMainTab === 'Networks' && (activeSubTab === 'Zones' || activeSubTab === 'Route Table' || activeSubTab === 'Template Variables'))
    ) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)' }}>
          <div>{activeMainTab} - Coming Soon</div>
        </div>
      );
    }
    if (activeMainTab === 'System' && activeSubTab === 'Changelog') {
      return <ChangelogPage />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Workspaces') {
      return <WorkspacesPage auth={auth} addToast={addToast} />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Commit History') {
      return <CommitHistoryPage addToast={addToast} globalScopeVendor={globalScopeVendor} />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Vendor Adapters') {
      return <AdaptersPage auth={auth} />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Secrets Vault') {
      return <SecretsVaultPage auth={auth} addToast={addToast} />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Snapshots') {
      return <SnapshotsPage auth={auth} addToast={addToast} />;
    }
    if (activeMainTab === 'System' && activeSubTab === 'Database Health') {
      return <DatabaseHealthPage auth={auth} addToast={addToast} />;
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

  const params = new URLSearchParams(window.location.search);
  const isPopout = params.get('popout') === 'candidates';
  const isObjectEditor = params.get('editor') === 'object';
  const isAssignFirewallsEditor = params.get('editor') === 'assign-firewalls';

  if (isPopout) {
    return <CandidatesPopoutPage />;
  }

  if (isAssignFirewallsEditor) {
    const groupIdParam = params.get('groupId');
    const standaloneGroupId = groupIdParam ? decodeURIComponent(groupIdParam) : null;
    
    return (
      <DeviceManagementPage
        auth={auth}
        addToast={addToast}
        standaloneAssign={true}
        standaloneGroupId={standaloneGroupId}
      />
    );
  }

  if (isObjectEditor) {
    const activeSubTab = decodeURIComponent(params.get('type') || 'Address Objects');
    const standaloneId = decodeURIComponent(params.get('id') || '');
    const standaloneMode = decodeURIComponent(params.get('mode') || 'edit');

    return (
      <ObjectsPage
        auth={auth}
        addToast={addToast}
        activeSubTab={activeSubTab}
        standaloneEditor={true}
        standaloneId={standaloneId}
        standaloneMode={standaloneMode}
      />
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
      globalScopeUuid={globalScopeUuid}
      setGlobalScopeUuid={setGlobalScopeUuid}
      globalScopeVendor={globalScopeVendor}
      setGlobalScopeVendor={setGlobalScopeVendor}
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