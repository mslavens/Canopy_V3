import React, { useState } from 'react';
import { AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react';
import { calculateStrength } from '../utils/passphrase';
import { PasswordInput } from '../components/PasswordInput';
import { CanopyApiClient } from '../api/client';
import { useConfirm } from '../components/ConfirmProvider';
import { useUnsavedChanges } from '../components/UnsavedChangesProvider';
import { PageHeader } from '../components/PageHeader';

interface SettingsPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  autoLockMinutes: number;
  setAutoLockMinutes: (mins: number) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ auth, addToast, autoLockMinutes, setAutoLockMinutes }) => {
  const [inputValue, setInputValue] = useState(autoLockMinutes.toString());
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRekeying, setIsRekeying] = useState(false);
  const [apiError, setApiError] = useState('');
  const confirm = useConfirm();

  const handleSaveTimer = () => {
    const parsed = parseInt(inputValue, 10);
    if (isNaN(parsed) || parsed < 0) {
      addToast('Please enter a valid positive number for minutes.', 'error');
      setInputValue(autoLockMinutes.toString());
      return;
    }

    setAutoLockMinutes(parsed);
    localStorage.setItem('canopy-auto-lock-minutes', parsed.toString());
    addToast(parsed === 0 ? 'Auto-lock disabled.' : `Auto-lock timer set to ${parsed} minutes.`, 'success');
  };

  const handleIncrement = () => {
    const current = parseInt(inputValue, 10) || 0;
    setInputValue((current + 1).toString());
  };

  const handleDecrement = () => {
    const current = parseInt(inputValue, 10) || 0;
    if (current > 0) {
      setInputValue((current - 1).toString());
    }
  };

  const handleRekey = () => {
    if (!auth) return;
    
    confirm({
      title: 'Update Passphrase',
      message: 'Are you sure you want to change your passphrase?\n\nIf you forget this new password, your offline workspace data cannot be recovered. This action cannot be undone.',
      confirmText: 'Confirm Change',
      isDestructive: true,
      onConfirm: async () => {
        setIsRekeying(true);
        setApiError('');
        try {
          await new CanopyApiClient(auth).rekeyVault(currentPassword, newPassword);
        
        // If the user has a saved credential, update it with the new key so auto-unlock still works!
        if (localStorage.getItem('canopy-vault-key') && window.electron && window.electron.isSafeStorageAvailable) {
          if (await window.electron.isSafeStorageAvailable()) {
            const encrypted = await window.electron.encryptString(newPassword);
            localStorage.setItem('canopy-vault-key', encrypted);
          }
        }

          addToast('Passphrase successfully updated.', 'success');
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
        } catch (err) {
          setApiError(err instanceof Error ? err.message : 'Network error updating passphrase.');
        } finally {
          setIsRekeying(false);
        }
      }
    });
  };

  const handleFactoryReset = () => {
    if (!auth) return;
    confirm({
      title: 'Factory Reset Workspace',
      message: 'Are you sure you want to completely wipe the application? All workspaces, objects, policies, and logs will be permanently deleted. This action cannot be undone.',
      confirmText: 'Destroy Workspace',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await new CanopyApiClient(auth).wipeVault();
          localStorage.clear(); // Wipe frontend caches, notifications, and safeStorage tokens
          if (window.electron && window.electron.relaunchApp) {
            window.electron.relaunchApp();
          }
        } catch (err) {
          addToast('Failed to execute factory reset.', 'error');
        }
      }
    });
  };

  const strength = calculateStrength(newPassword);
  const isUnchanged = inputValue === autoLockMinutes.toString();
  const canRekey = currentPassword.length > 0 && strength.score >= 3 && newPassword === confirmPassword;

  let passwordError = '';
  if (newPassword.length > 0 && strength.score < 3) {
    passwordError = 'Passphrase is too weak. Please use a mix of uppercase, lowercase, numbers, and symbols.';
  } else if (confirmPassword.length > 0 && newPassword !== confirmPassword) {
    passwordError = 'Passphrases do not match.';
  }

  const activeError = apiError || passwordError;

  // Protect against accidental navigation if a form is dirty
  useUnsavedChanges(!isUnchanged, 'settings-timer');
  useUnsavedChanges(currentPassword.length > 0 || newPassword.length > 0 || confirmPassword.length > 0, 'settings-password');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '1200px' }}>
      <PageHeader 
        title="System Settings" 
        description="Configure workspace security and offline vault credentials." 
      />

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)', marginTop: '50px' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>General Preferences</h3>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
          Configure workspace security and behavior preferences.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Session Auto-Lock Timer (Minutes):</label>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input 
              type="number" 
              min="0" 
              className="input-text no-spinners" 
              style={{ width: '60px', textAlign: 'center' }} 
              value={inputValue} 
              onChange={(e) => setInputValue(e.target.value)} 
              onKeyDown={(e) => e.key === 'Enter' && !isUnchanged && handleSaveTimer()}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <button className="stepper-btn" onClick={handleIncrement} style={{ background: 'var(--bg-element)', border: '1px solid var(--border-main)', borderRadius: '4px', color: 'var(--text-main)', cursor: 'pointer', padding: '1px 4px', display: 'flex', alignItems: 'center' }}>
                <ChevronUp size={12} />
              </button>
              <button className="stepper-btn" onClick={handleDecrement} style={{ background: 'var(--bg-element)', border: '1px solid var(--border-main)', borderRadius: '4px', color: 'var(--text-main)', cursor: 'pointer', padding: '1px 4px', display: 'flex', alignItems: 'center' }}>
                <ChevronDown size={12} />
              </button>
            </div>
          </div>
          <button className="btn-secondary btn-sm" onClick={handleSaveTimer} disabled={isUnchanged}>Save</button>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '5px' }}>(Set to 0 to disable)</span>
        </div>
      </section>

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)', marginTop: '25px' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>Vault Security</h3>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
          Change the passphrase used to encrypt your offline database.
        </p>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '320px' }}>
          <PasswordInput
            placeholder="Current Passphrase"
            value={currentPassword}
            onChange={(e) => { setCurrentPassword(e.target.value); setApiError(''); }}
          />
          <PasswordInput
            placeholder="New Passphrase"
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setApiError(''); }}
          />
          <PasswordInput
            placeholder="Confirm Passphrase"
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); setApiError(''); }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 2px', visibility: newPassword.length > 0 ? 'visible' : 'hidden', marginTop: '-2px' }}>
            <div style={{ display: 'flex', gap: '4px', height: '4px' }}>
              {[1, 2, 3, 4, 5].map(level => (
                <div key={level} style={{ flex: 1, backgroundColor: strength.score >= level ? strength.color : 'var(--bg-app)', borderRadius: '2px', transition: 'background-color 0.3s ease' }} />
              ))}
            </div>
            <div style={{ fontSize: '10px', color: strength.color, textAlign: 'right', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {strength.label || 'None'}
            </div>
          </div>

          <div style={{ minHeight: '36px', marginTop: '-4px' }}>
            {activeError && (
              <div style={{ color: 'var(--status-red)', fontSize: '12px', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} /> <span>{activeError}</span>
              </div>
            )}
          </div>

          <button className="btn-danger" onClick={handleRekey} disabled={!canRekey || isRekeying}>
            {isRekeying ? 'Encrypting...' : 'Update Passphrase'}
          </button>
        </div>
      </section>

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--status-red)', marginTop: '25px' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '15px', color: 'var(--status-red)' }}>Danger Zone</h3>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
          Permanently destroy the offline vault and reset the application to its factory state.
        </p>
        <button className="btn-danger" onClick={handleFactoryReset}>
          Factory Reset Workspace
        </button>
      </section>
    </div>
  );
};