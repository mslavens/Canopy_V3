import React, { useState, useEffect } from 'react';
import { Lock, Unlock, AlertTriangle } from 'lucide-react';
import { Modal } from '../components/Modal';
import { Checkbox } from '../components/Checkbox';
import { calculateStrength } from '../utils/passphrase';
import { PasswordInput } from '../components/PasswordInput';
import { CanopyApiClient } from '../api/client';

interface VaultUnlockPageProps {
  auth: { url: string; token: string };
  onUnlock: () => void;
  addToast: (msg: string, type: 'success' | 'error') => void;
  isSetupRequired: boolean;
  isSessionExpired: boolean;
}

export const VaultUnlockPage: React.FC<VaultUnlockPageProps> = ({ auth, onUnlock, addToast, isSetupRequired, isSessionExpired }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; isDestructive?: boolean; onConfirm: () => void } | null>(null);

  const [rememberMe, setRememberMe] = useState(!!localStorage.getItem('canopy-vault-key'));
  const [savedKey, setSavedKey] = useState(localStorage.getItem('canopy-vault-key'));
  const [isSafeStorageReady, setIsSafeStorageReady] = useState(false);

  // Automatically clear API errors when the user begins typing to correct their password
  useEffect(() => {
    if (error) setError('');
  }, [password, confirmPassword]);

  useEffect(() => {
    const checkSafeStorage = async () => {
      if (window.electron && window.electron.isSafeStorageAvailable) {
        setIsSafeStorageReady(await window.electron.isSafeStorageAvailable());
      }
    };
    checkSafeStorage();
  }, []);

  // Poll backend health to auto-unlock if another window decrypted the vault
  useEffect(() => {
    if (isSetupRequired || !auth) return;

    const apiClient = new CanopyApiClient(auth);
    const interval = setInterval(async () => {
      try {
        const data = await apiClient.healthCheck();
        // If the vault is unlocked, the healthCheck succeeds and returns vault_locked: false
        if (data && data.vault_locked === false) {
          onUnlock();
        }
      } catch (err) {
        // Expected behavior: API returns 423 Locked when the vault is actually locked.
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [auth, isSetupRequired, onUnlock]);

  const strength = calculateStrength(password);

  let passwordError = '';
  if (isSetupRequired) {
    if (password.length > 0 && strength.score < 3) {
      passwordError = 'Passphrase is too weak. Please use a mix of uppercase, lowercase, numbers, and symbols.';
    } else if (confirmPassword.length > 0 && password !== confirmPassword) {
      passwordError = 'Passphrases do not match.';
    }
  }

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isSetupRequired && password !== confirmPassword) {
      return setError('Passwords do not match.');
    }
    if (isSetupRequired && strength.score < 3) {
      return setError('Passphrase is too weak. Please use a mix of uppercase, lowercase, numbers, and symbols.');
    }
    if (!password.trim()) return;

    setLoading(true);
    try {
      const apiClient = new CanopyApiClient(auth);
      
      if (isSetupRequired) {
        await apiClient.setupVault(password);
        addToast('Vault securely initialized and mounted.', 'success');
      } else {
        await apiClient.unlockVault(password);
        addToast('Vault decrypted and mounted successfully.', 'success');
      }
      
      if (rememberMe && isSafeStorageReady) {
        try {
          const encrypted = await window.electron.encryptString(password);
          localStorage.setItem('canopy-vault-key', encrypted);
          setSavedKey(encrypted);
        } catch (e) {}
      } else if (!rememberMe) {
        localStorage.removeItem('canopy-vault-key');
        setSavedKey(null);
      }

      setPassword(''); // Explicitly wipe passphrase from React state memory
      setConfirmPassword('');
      onUnlock();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error while communicating with backend daemon.');
    } finally {
      setLoading(false);
    }
  };

  const handleSavedUnlock = async () => {
    if (!savedKey || !auth) return;
    setLoading(true);
    setError('');

    // Force user to physically prove presence before decrypting the vault key
    if (window.electron && window.electron.promptBiometric) {
      const authorized = await window.electron.promptBiometric('Unlock Canopy Workspace');
      if (!authorized) {
        setLoading(false);
        return;
      }
    }

    try {
      const decryptedPassword = await window.electron.decryptString(savedKey);
      await new CanopyApiClient(auth).unlockVault(decryptedPassword);
      addToast('Vault decrypted and mounted successfully.', 'success');
      onUnlock();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decrypt saved credentials or reach daemon.');
      localStorage.removeItem('canopy-vault-key');
      setSavedKey(null);
      setRememberMe(false);
    } finally {
      setLoading(false);
    }
  };

  const executeEmergencyReset = async () => {
    setConfirmDialog(null);
    setLoading(true);
    try {
      await new CanopyApiClient(auth).wipeVault();
      localStorage.clear();
      if (window.electron && window.electron.relaunchApp) {
        window.electron.relaunchApp();
      }
    } catch (err) {
      setError('Failed to execute emergency reset.');
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}>
      <div style={{ backgroundColor: 'var(--bg-surface)', padding: '40px', borderRadius: '8px', border: '1px solid var(--border-main)', width: '100%', maxWidth: '420px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', padding: '15px', backgroundColor: 'var(--bg-element)', borderRadius: '50%', marginBottom: '20px' }}>
          <Lock size={32} color="var(--accent-blue)" />
        </div>
        
        <h2 style={{ margin: '0 0 10px 0', fontSize: '20px', fontWeight: 600 }}>
              {isSetupRequired ? "Secure Your Vault" : "Welcome Back"}
            </h2>
            <p style={{ margin: '0 0 30px 0', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {isSetupRequired 
                ? "Create a passphrase to encrypt your local SQLite storage matrix. Do not forget this password." 
                : "Enter your passphrase to unlock and mount the Canopy workspace."}
            </p>

          <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ visibility: error || (isSessionExpired && !isSetupRequired) ? 'visible' : 'hidden' }}>
              <div style={{ backgroundColor: 'var(--bg-app)', borderLeft: `4px solid ${error ? 'var(--status-red)' : 'var(--status-warn)'}`, color: error ? 'var(--status-red)' : 'var(--status-warn)', padding: '12px 15px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' }}>
                {error ? <AlertTriangle size={14} style={{ flexShrink: 0 }} /> : <Lock size={14} style={{ flexShrink: 0 }} />}
                <span>{error || 'Your session expired due to inactivity.'}</span>
              </div>
            </div>

            {!isSetupRequired && savedKey && isSafeStorageReady && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '5px' }}>
                <button type="button" className="btn-secondary" onClick={handleSavedUnlock} disabled={loading} style={{ padding: '12px', fontSize: '14px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', width: '100%' }}>
                  <Unlock size={14} /> Unlock with Saved Credentials
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-main)' }} />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>OR</span>
                  <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-main)' }} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <PasswordInput
                placeholder={isSetupRequired ? "Create Passphrase" : "Passphrase"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                showIcon={true}
                autoFocus={true}
              />

              {isSetupRequired && (
                <PasswordInput
                  placeholder="Confirm Passphrase"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  showIcon={true}
                />
              )}

              {isSetupRequired && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 2px', visibility: password.length > 0 ? 'visible' : 'hidden' }}>
                  <div style={{ display: 'flex', gap: '4px', height: '4px' }}>
                    {[1, 2, 3, 4, 5].map(level => (
                      <div key={level} style={{ flex: 1, backgroundColor: strength.score >= level ? strength.color : 'rgba(255, 255, 255, 0.1)', borderRadius: '2px', transition: 'background-color 0.3s ease' }} />
                    ))}
                  </div>
                  <div style={{ fontSize: '10px', color: strength.color, textAlign: 'right', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {strength.label || 'None'}
                  </div>
                </div>
              )}
            </div>

            {isSetupRequired && (
              <div style={{ minHeight: '36px', marginTop: '-4px' }}>
                {passwordError && (
                  <div style={{ color: 'var(--status-red)', fontSize: '12px', display: 'flex', alignItems: 'flex-start', gap: '6px', textAlign: 'left' }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} /> <span>{passwordError}</span>
                  </div>
                )}
              </div>
            )}

            {isSafeStorageReady && (
              <div style={{ marginTop: '5px' }}>
                <Checkbox checked={rememberMe} onChange={setRememberMe} label="Remember my passphrase on this device" />
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={loading || !password.trim() || (isSetupRequired && !!passwordError)} style={{ padding: '12px', fontSize: '14px', marginTop: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
              {loading ? 'Decrypting Engine...' : <><Unlock size={14} /> {isSetupRequired ? 'Initialize Vault' : 'Unlock Application'}</>}
            </button>
          </form>

          {!isSetupRequired && (
            <div style={{ marginTop: '25px' }}>
              <button type="button" onClick={() => setConfirmDialog({ title: 'Emergency Factory Reset', isDestructive: true, message: 'Are you sure you want to completely wipe the application? All workspaces, objects, policies, and logs will be permanently deleted. This cannot be undone.', onConfirm: executeEmergencyReset })} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }}>
                Lost your password? (Emergency Reset)
              </button>
            </div>
          )}
      </div>

      <Modal isOpen={!!confirmDialog} onClose={() => setConfirmDialog(null)} title={confirmDialog?.title || ''} size="sm" footer={<><button className="btn-secondary btn-sm" onClick={() => setConfirmDialog(null)}>Cancel</button><button className={confirmDialog?.isDestructive ? "btn-danger btn-sm" : "btn-primary btn-sm"} onClick={confirmDialog?.onConfirm}>Confirm Action</button></>}>
        <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-muted)' }}>{confirmDialog?.message}</p>
      </Modal>
    </div>
  );
};