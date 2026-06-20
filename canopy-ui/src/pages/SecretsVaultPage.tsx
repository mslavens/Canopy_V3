import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Key, Loader2, Search, Edit2, Eye, EyeOff, Copy } from 'lucide-react';
import { DataTable, ColumnDef } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { Tooltip } from '../components/Tooltip';
import { PasswordInput } from '../components/PasswordInput';
import { useConfirm } from '../components/ConfirmProvider';
import { SearchBar } from '../components/SearchBar';
import { PageHeader } from '../components/PageHeader';
import { CanopyApiClient } from '../api/client';

interface Secret {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

interface SecretsVaultPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const SecretsVaultPage: React.FC<SecretsVaultPageProps> = ({ auth, addToast }) => {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const confirm = useConfirm();

  const [isCreateSecretOpen, setIsCreateSecretOpen] = useState(false);
  const [newSecretName, setNewSecretName] = useState('');
  const [newSecretDesc, setNewSecretDesc] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');
  const [isCreatingSecret, setIsCreatingSecret] = useState(false);

  const [editingSecret, setEditingSecret] = useState<Secret | null>(null);
  const [editSecretName, setEditSecretName] = useState('');
  const [editSecretDesc, setEditSecretDesc] = useState('');
  const [editSecretValue, setEditSecretValue] = useState('');
  const [isUpdatingSecret, setIsUpdatingSecret] = useState(false);

  const [revealedSecrets, setRevealedSecrets] = useState<Record<number, string>>({});
  const [isRevealing, setIsRevealing] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!auth) return;
    let isMounted = true;
    const fetchSecrets = async () => {
      setIsLoading(true);
      try {
        const apiClient = new CanopyApiClient(auth);
        const data = await apiClient.getSecrets();
        if (isMounted) setSecrets(data || []);
      } catch (err) {
        console.error("Failed to fetch secrets", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    fetchSecrets();
    return () => { isMounted = false; };
  }, [auth]);

  const handleCreateSecret = async () => {
    if (!auth || !newSecretName.trim() || !newSecretValue.trim()) return;
    setIsCreatingSecret(true);
    try {
      const apiClient = new CanopyApiClient(auth);
      await apiClient.createSecret(newSecretName, newSecretDesc, newSecretValue);
      addToast('Secret securely added to vault.', 'success');
      setIsCreateSecretOpen(false);
      setNewSecretName('');
      setNewSecretDesc('');
      setNewSecretValue('');
      const fresh = await apiClient.getSecrets();
      setSecrets(fresh || []);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Error creating secret', 'error');
    } finally {
      setIsCreatingSecret(false);
    }
  };

  const handleEditClick = (secret: Secret) => {
    setEditingSecret(secret);
    setEditSecretName(secret.name);
    setEditSecretDesc(secret.description || '');
    setEditSecretValue(''); // Blank by default so we don't overwrite it unless the user types a new one
  };

  const handleUpdateSecret = async () => {
    if (!auth || !editingSecret || !editSecretName.trim()) return;
    setIsUpdatingSecret(true);
    try {
      const apiClient = new CanopyApiClient(auth);
      await apiClient.updateSecret(editingSecret.id, editSecretName, editSecretDesc, editSecretValue);
      addToast('Secret updated successfully.', 'success');
      setEditingSecret(null);
      
      // Clear any revealed state so the old password isn't visible
      setRevealedSecrets(prev => {
        const next = { ...prev };
        delete next[editingSecret.id];
        return next;
      });
      
      const fresh = await apiClient.getSecrets();
      setSecrets(fresh || []);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Error updating secret', 'error');
    } finally {
      setIsUpdatingSecret(false);
    }
  };

  const handleReveal = async (id: number) => {
    if (!auth) return;
    if (revealedSecrets[id]) {
      // Hide the secret if it is already revealed
      setRevealedSecrets(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }

    setIsRevealing(prev => ({ ...prev, [id]: true }));
    try {
      const apiClient = new CanopyApiClient(auth);
      const data = await apiClient.revealSecret(id);
      setRevealedSecrets(prev => ({ ...prev, [id]: data.secret_value }));
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Error revealing secret', 'error');
    } finally {
      setIsRevealing(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      addToast('Secret copied to clipboard.', 'success');
    } catch (err) {
      addToast('Failed to copy to clipboard. Permission may be denied.', 'error');
    }
  };

  const handleDeleteSecret = (id: number, name: string) => {
    confirm({
      title: 'Delete Secret',
      message: `Are you sure you want to permanently delete the secret "${name}"?\n\nIntegrations relying on this credential will instantly fail.`,
      isDestructive: true,
      onConfirm: async () => {
        if (!auth) return;
        try {
          const apiClient = new CanopyApiClient(auth);
          await apiClient.deleteSecret(id);
          addToast('Secret deleted successfully.', 'success');
          setSecrets(s => s.filter(x => x.id !== id));
        } catch (err) {
          addToast(err instanceof Error ? err.message : 'Error deleting secret', 'error');
        }
      }
    });
  };

  const columns: ColumnDef[] = [
    { key: 'name', label: 'Secret Identifier', renderCell: (val) => <span style={{ fontWeight: 600, color: 'var(--text-main)', fontFamily: 'monospace' }}>{val}</span> },
    { key: 'description', label: 'Description', renderCell: (val) => <span style={{ color: 'var(--text-muted)' }}>{val || '-'}</span> },
    { 
      key: 'secret_value', 
      label: 'Secret Value', 
      allowOverflow: true,
      renderCell: (_, row) => {
        const isRevealed = !!revealedSecrets[row.id];
        const isLoading = isRevealing[row.id];
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ width: '180px', flexShrink: 0, fontFamily: 'monospace', color: isRevealed ? 'var(--text-main)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
              {isRevealed ? revealedSecrets[row.id] : '••••••••••••••••'}
            </span>
            <div style={{ display: 'flex', gap: '8px', width: '50px' }}>
              <Tooltip content={isRevealed ? "Hide Secret" : "Reveal Secret"} position="top">
                <button onClick={() => handleReveal(row.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, display: 'flex' }} disabled={isLoading}>
                  {isLoading ? <Loader2 size={14} className="spin-animation" /> : (isRevealed ? <EyeOff size={14} /> : <Eye size={14} />)}
                </button>
              </Tooltip>
              {isRevealed && (
                <Tooltip content="Copy to Clipboard" position="top">
                  <button onClick={() => handleCopy(revealedSecrets[row.id])} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, display: 'flex' }}>
                    <Copy size={14} />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        );
      } 
    },
    { key: 'created_at', label: 'Added On', renderCell: (val) => <span style={{ color: 'var(--text-muted)' }}>{new Date(val).toLocaleDateString()}</span> },
    { 
      key: 'actions',
      label: 'Manage', 
      allowOverflow: true,
      renderCell: (_, row) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          <Tooltip content="Edit Secret" position="top" align="left">
            <button className="btn-table-action" onClick={() => handleEditClick(row as Secret)}><Edit2 size={14} /></button>
          </Tooltip>
          <Tooltip content="Delete Secret" position="top" align="right">
            <button className="btn-table-action-danger" onClick={() => handleDeleteSecret(row.id, row.name)}><Trash2 size={14} /></button>
          </Tooltip>
        </div>
      )
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader 
        title="Secrets Vault" 
        description="Securely store API keys and credentials for third-party integrations." 
        isSticky={false}
        bottomSpacing={false}
        actions={
          <div style={{ width: '250px' }}>
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Find secret..." variant="local" />
          </div>
        }
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)', margin: '0 -30px -30px -30px' }}>
        {isLoading ? (
          <div className="fade-in-delayed" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px', gap: '15px' }}><Loader2 size={24} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />Decrypting vault entries...</div>
        ) : secrets.length > 0 ? (
          <DataTable 
            columns={columns} 
            data={secrets} 
            searchQuery={searchQuery} 
            pagination={true} 
            topRightActions={
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button className="btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setIsCreateSecretOpen(true)}><Plus size={14} /> Add Secret</button>
              </div>
            }
          />
        ) : (
          <EmptyState icon={<Key size={32} />} title="No secrets stored" description="Add a secret to securely authenticate with external infrastructure." minHeight="250px" />
        )}
      </div>

      <Modal isOpen={isCreateSecretOpen} onClose={() => { setIsCreateSecretOpen(false); setNewSecretName(''); setNewSecretDesc(''); setNewSecretValue(''); }} title="Store New Secret" size="sm" footer={<><button className="btn-secondary btn-sm" onClick={() => { setIsCreateSecretOpen(false); setNewSecretName(''); setNewSecretDesc(''); setNewSecretValue(''); }}>Cancel</button><button className="btn-primary btn-sm" onClick={handleCreateSecret} disabled={!newSecretName.trim() || !newSecretValue.trim() || isCreatingSecret}>{isCreatingSecret ? 'Saving...' : 'Save to Vault'}</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.5 }}>Secrets are encrypted at rest using your Master Passphrase and are only accessible by the backend engine.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Secret Name / Identifier</label>
            <input type="text" className="input-text" placeholder="e.g., PAN_OS_API_KEY" value={newSecretName} onChange={(e) => setNewSecretName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateSecret()} disabled={isCreatingSecret} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Description (Optional)</label>
            <input type="text" className="input-text" placeholder="e.g., Core firewall readonly key" value={newSecretDesc} onChange={(e) => setNewSecretDesc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateSecret()} disabled={isCreatingSecret} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Secret Value</label>
            <PasswordInput placeholder="Enter the secret token or password" value={newSecretValue} onChange={(e) => setNewSecretValue(e.target.value)} showIcon={true} autoFocus={true} />
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!editingSecret} onClose={() => { setEditingSecret(null); setEditSecretValue(''); }} title="Edit Secret" size="sm" footer={<><button className="btn-secondary btn-sm" onClick={() => { setEditingSecret(null); setEditSecretValue(''); }}>Cancel</button><button className="btn-primary btn-sm" onClick={handleUpdateSecret} disabled={!editSecretName.trim() || isUpdatingSecret}>{isUpdatingSecret ? 'Saving...' : 'Save Changes'}</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.5 }}>Update the identifier, description, or value. Leave the secret value blank to keep it unchanged.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Secret Name / Identifier</label>
            <input type="text" className="input-text" value={editSecretName} onChange={(e) => setEditSecretName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleUpdateSecret()} disabled={isUpdatingSecret} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Description (Optional)</label>
            <input type="text" className="input-text" value={editSecretDesc} onChange={(e) => setEditSecretDesc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleUpdateSecret()} disabled={isUpdatingSecret} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>New Secret Value (Optional)</label>
            <PasswordInput placeholder="Leave blank to keep unchanged" value={editSecretValue} onChange={(e) => setEditSecretValue(e.target.value)} showIcon={true} />
          </div>
        </div>
      </Modal>
    </div>
  );
};