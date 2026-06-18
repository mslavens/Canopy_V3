import React, { useEffect, useState, useMemo, useRef } from 'react';
import { SearchBar } from '../components/SearchBar';
import { AlertTriangle, FolderOpen, Upload, Download, Edit2, Archive, Check, ArrowRight, Plus, Trash2, Loader2 } from 'lucide-react';
import { DataTable, ColumnDef } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { Tooltip } from '../components/Tooltip';
import { Modal } from '../components/Modal';
import { FileInput } from '../components/FileInput';
import { PasswordInput } from '../components/PasswordInput';
import { useConfirm } from '../components/ConfirmProvider';
import { PageHeader } from '../components/PageHeader';
import { CanopyApiClient } from '../api/client';

interface Workspace {
  id: number;
  name: string;
  filename: string;
  created_at: string;
  color?: string; // We will add this to the Go backend next!
}

interface WorkspacesPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const WorkspacesPage: React.FC<WorkspacesPageProps> = ({ auth, addToast }) => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string>(() => localStorage.getItem('canopy-active-workspace') || 'Default Workspace');
  const confirm = useConfirm();

  // Create Modal State
  const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceColor, setNewWorkspaceColor] = useState('');
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);

  // Edit Modal State
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  // Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importName, setImportName] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const importFileInputRef = useRef<HTMLInputElement>(null);

  // Export Modal State
  const [exportWorkspace, setExportWorkspace] = useState<Workspace | null>(null);
  const [exportPassword, setExportPassword] = useState('');

  const fetchWorkspaces = async () => {
    if (!auth) return;
    setLoading(true);
    try {
      const apiClient = new CanopyApiClient(auth);
      const data = await apiClient.getWorkspaces();
      setWorkspaces(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkspaces();
  }, [auth]);

  // Keep the active workspace state perfectly synced if the user renames it
  useEffect(() => {
    const handleWorkspacesUpdated = () => {
      setActiveWorkspaceName(localStorage.getItem('canopy-active-workspace') || 'Default Workspace');
    };
    window.addEventListener('workspaces-updated', handleWorkspacesUpdated);
    return () => window.removeEventListener('workspaces-updated', handleWorkspacesUpdated);
  }, []);

  const handleCreateWorkspace = async () => {
    if (!auth || !newWorkspaceName.trim()) return;
    setIsCreatingWorkspace(true);
    try {
      const apiClient = new CanopyApiClient(auth);
      await apiClient.createWorkspace(newWorkspaceName, newWorkspaceColor);
      
      addToast('Workspace created successfully', 'success');
      fetchWorkspaces();
      window.dispatchEvent(new Event('workspaces-updated'));
      setIsCreateWorkspaceOpen(false);
      setNewWorkspaceName('');
      setNewWorkspaceColor('');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Create failed', 'error');
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const handleSwitchWorkspace = async (ws: Workspace) => {
    if (!auth || ws.name === activeWorkspaceName) return;
    try {
      const apiClient = new CanopyApiClient(auth);
      await apiClient.switchWorkspace(ws.id);
      localStorage.setItem('canopy-active-workspace', ws.name);
      localStorage.setItem('canopy-active-workspace-color', ws.color || 'var(--accent-blue)');
      sessionStorage.setItem('canopy-is-switching', 'true');
      window.location.reload();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Switch failed', 'error');
    }
  };

  const handleEditClick = (ws: Workspace) => {
    setEditingWorkspace(ws);
    setEditName(ws.name);
    setEditColor((ws.color && ws.color.trim() !== '') ? ws.color : '#89b4fa'); // Canopy Blue
  };

  const handleUpdateWorkspace = async () => {
    if (!auth || !editingWorkspace || !editName.trim()) return;
    setIsSubmitting(true);
    try {
      const apiClient = new CanopyApiClient(auth);
      await apiClient.updateWorkspace(editingWorkspace.id, editName, editColor);
      addToast('Workspace updated successfully', 'success');
      
      if (localStorage.getItem('canopy-active-workspace') === editingWorkspace.name) {
        localStorage.setItem('canopy-active-workspace', editName);
        localStorage.setItem('canopy-active-workspace-color', editColor || 'var(--accent-blue)');
      }
      
      setEditingWorkspace(null);
      fetchWorkspaces();
      window.dispatchEvent(new Event('workspaces-updated'));
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Update failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportClick = (ws: Workspace) => {
    setExportWorkspace(ws);
    setExportPassword('');
  };

  const handleExportSubmit = async () => {
    if (!auth || !exportWorkspace) return;
    setIsSubmitting(true);
    addToast(`Preparing to export ${exportWorkspace.name}...`, 'info');
    try {
      const res = await fetch(`${auth.url}/api/workspaces/export`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: exportWorkspace.id, archive_password: exportPassword })
      });
      if (!res.ok) {
        let errMsg = 'Failed to export workspace';
        try { errMsg = (await res.json()).error || errMsg; } catch {}
        throw new Error(errMsg);
      }
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = `${exportWorkspace.name.replace(/\s/g, '_')}_${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
      if (contentDisposition && contentDisposition.includes('filename=')) {
        filename = contentDisposition.split('filename=')[1].replace(/"/g, '');
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      addToast(`${exportWorkspace.name} exported successfully.`, 'success');
      setExportWorkspace(null);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      if (!selected.name.endsWith('.db')) {
        addToast('Invalid file format. Please select a .db file.', 'error');
        e.target.value = '';
        setImportFile(null);
        return;
      }
      setImportFile(selected);
    } else {
      setImportFile(null);
    }
  };

  const handleImportSubmit = async () => {
    if (!auth || !importFile) return;
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('database', importFile);
      if (importName.trim()) formData.append('name', importName);
      if (importPassword) formData.append('archive_password', importPassword);
      
      const apiClient = new CanopyApiClient(auth);
      await apiClient.importWorkspace(formData);
      addToast('Workspace imported successfully', 'success');
      setIsImportModalOpen(false);
      setImportFile(null);
      setImportName('');
      setImportPassword('');
      if (importFileInputRef.current) importFileInputRef.current.value = '';
      fetchWorkspaces();
      window.dispatchEvent(new Event('workspaces-updated'));
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Import failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = (ws: Workspace) => {
    confirm({
      title: 'Delete Workspace',
      message: `Are you sure you want to permanently delete "${ws.name}"?\n\nThis will completely wipe the isolated database from the storage drive to free up space. Ensure a backup has been exported first!`,
      isDestructive: true,
      onConfirm: async () => {
        if (!auth) return;
        try {
          const apiClient = new CanopyApiClient(auth);
          await apiClient.deleteWorkspace(ws.id);
          addToast(`${ws.name} deleted successfully`, 'success');
          fetchWorkspaces();
          window.dispatchEvent(new Event('workspaces-updated'));
        } catch (err) {
          addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
        }
      }
    });
  };

  const columns: ColumnDef[] = useMemo(() => [
    { 
      key: 'name', 
      label: 'Client Workspace', 
      width: '250px',
      renderCell: (val, row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: (row.color && row.color.trim() !== '') ? row.color : 'var(--accent-blue)' }} />
          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{val}</span>
          {val === activeWorkspaceName && (
            <span style={{ fontSize: '9px', backgroundColor: 'var(--bg-element)', color: 'var(--accent-blue)', border: '1px solid var(--accent-blue)', padding: '2px 6px', borderRadius: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Active</span>
          )}
        </div>
      ) 
    },
    { 
      key: 'filename', 
      label: 'Database File', 
      width: '250px',
      renderCell: (val) => <span style={{ color: 'var(--text-sub)' }}>{val}</span>
    },
    { 
      key: 'created_at', 
      label: 'Provisioned', 
      width: 'auto',
      renderCell: (val) => new Date(val).toLocaleDateString()
    },
    {
      key: 'actions',
      label: 'Management',
      width: '210px',
      allowOverflow: true,
      renderCell: (_, row) => {
        const ws = row as Workspace;
        const isActive = ws.name === activeWorkspaceName;
        return (
          <div style={{ display: 'flex', gap: '8px' }}>
            <Tooltip content={isActive ? "Currently Active" : "Switch to Workspace"} position="top" align="left">
              <button className={isActive ? "btn-secondary btn-sm" : "btn-primary btn-sm"} style={{ padding: '4px 8px', color: isActive ? 'var(--status-green)' : undefined, opacity: isActive ? 0.8 : 1 }} onClick={() => handleSwitchWorkspace(ws)} disabled={isActive}>
                {isActive ? <Check size={14} strokeWidth={3} /> : <ArrowRight size={14} />}
              </button>
            </Tooltip>
            <Tooltip content="Edit Name & Color" position="top">
              <button className="btn-table-action" onClick={() => handleEditClick(ws)}><Edit2 size={14} /></button>
            </Tooltip>
            <Tooltip content="Export Encrypted Vault" position="top">
              <button className="btn-table-action" onClick={() => handleExportClick(ws)}><Upload size={14} /></button>
            </Tooltip>
            <Tooltip content="Delete Workspace" position="top" align="right">
              <button className="btn-table-action-danger" onClick={() => handleDeleteClick(ws)} disabled={isActive}><Trash2 size={14} /></button>
            </Tooltip>
          </div>
        );
      }
    }
  ], [auth, addToast, activeWorkspaceName]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader 
        title="Workspace Management" 
        description="Manage, export, and color-code isolated client databases." 
        isSticky={false}
        actions={
          <>
            <button className="btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setIsCreateWorkspaceOpen(true)}><Plus size={14} /> Create</button>
            <button className="btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setIsImportModalOpen(true)}><Download size={14} /> Import</button>
            <div style={{ height: '20px', width: '1px', backgroundColor: 'var(--border-main)', marginLeft: '5px', marginRight: '5px' }} />
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Find workspace..." variant="local" />
          </>
        }
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)' }}>
        {loading ? (
          <div className="fade-in-delayed" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px', gap: '15px' }}>
            <Loader2 size={24} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />
            Loading workspace directory...
          </div>
        ) : (
          <DataTable 
            columns={columns} 
            data={workspaces} 
            searchQuery={searchQuery} 
            highlightRow={(row) => row.name === activeWorkspaceName} 
            pagination={true}
          />
        )}
      </div>

      {/* Create Workspace Modal */}
      <Modal
        isOpen={isCreateWorkspaceOpen}
        onClose={() => { setIsCreateWorkspaceOpen(false); setNewWorkspaceName(''); setNewWorkspaceColor(''); }}
        title="Create New Workspace"
        size="sm"
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => { setIsCreateWorkspaceOpen(false); setNewWorkspaceName(''); setNewWorkspaceColor(''); }}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleCreateWorkspace} disabled={!newWorkspaceName.trim() || isCreatingWorkspace}>
              {isCreatingWorkspace ? 'Creating...' : 'Create Workspace'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.5 }}>Provision a new, fully isolated SQLite database matrix for a client or project.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Workspace Name</label>
            <input 
              type="text" 
              className="input-text" 
              placeholder="e.g., Acme Corp" 
              value={newWorkspaceName} 
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateWorkspace()}
              disabled={isCreatingWorkspace}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Accent Color (Optional)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Tooltip content="Select Color" position="top" align="left">
                <input type="color" value={newWorkspaceColor || '#89b4fa'} onChange={(e) => setNewWorkspaceColor(e.target.value)} style={{ width: '36px', height: '36px', padding: 0, border: '1px solid var(--border-main)', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'transparent' }} disabled={isCreatingWorkspace} />
              </Tooltip>
              <input type="text" className="input-text" value={newWorkspaceColor} onChange={(e) => setNewWorkspaceColor(e.target.value)} style={{ flex: 1, fontFamily: 'monospace' }} placeholder="#RRGGBB" disabled={isCreatingWorkspace} />
            </div>
          </div>
        </div>
      </Modal>

      {/* Edit Workspace Modal */}
      <Modal
        isOpen={!!editingWorkspace}
        onClose={() => setEditingWorkspace(null)}
        title="Edit Workspace"
        size="sm"
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setEditingWorkspace(null)}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleUpdateWorkspace} disabled={!editName.trim() || isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Workspace Name</label>
            <input type="text" className="input-text" value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleUpdateWorkspace()} disabled={isSubmitting} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Accent Color</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Tooltip content="Select Color" position="top" align="left">
                <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} style={{ width: '36px', height: '36px', padding: 0, border: '1px solid var(--border-main)', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'transparent' }} disabled={isSubmitting} />
              </Tooltip>
              <input type="text" className="input-text" value={editColor} onChange={(e) => setEditColor(e.target.value)} style={{ flex: 1, fontFamily: 'monospace' }} placeholder="#RRGGBB" disabled={isSubmitting} />
            </div>
          </div>
        </div>
      </Modal>

      {/* Export Workspace Modal */}
      <Modal
        isOpen={!!exportWorkspace}
        onClose={() => { setExportWorkspace(null); setExportPassword(''); }}
        title="Export Workspace"
        size="md"
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => { setExportWorkspace(null); setExportPassword(''); }}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleExportSubmit} disabled={!exportPassword.trim() || isSubmitting}>
              {isSubmitting ? 'Exporting...' : 'Export Vault'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.5 }}>
            Export <strong>{exportWorkspace?.name}</strong> to an encrypted SQLite database file.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Archive Passphrase (Required)</label>
            <PasswordInput placeholder="Enter a passphrase to encrypt this export" value={exportPassword} onChange={(e) => setExportPassword(e.target.value)} showIcon={true} autoFocus={true} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Set a passphrase to secure this backup. The passphrase or a temporary key can be used.</span>
          </div>
        </div>
      </Modal>

      {/* Import Workspace Modal */}
      <Modal
        isOpen={isImportModalOpen}
        onClose={() => { setIsImportModalOpen(false); setImportFile(null); setImportName(''); setImportPassword(''); }}
        title="Import Workspace"
        size="md"
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => { setIsImportModalOpen(false); setImportFile(null); setImportName(''); setImportPassword(''); }}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleImportSubmit} disabled={!importFile || !importPassword.trim() || isSubmitting}>
              {isSubmitting ? 'Importing...' : 'Import Vault'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.5 }}>
            Upload an encrypted <code>.db</code> file. The passphrase used to encrypt the file must be provided so it can be rekeyed to the active environment.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Select Database File</label>
            <FileInput ref={importFileInputRef} file={importFile} onChange={handleImportFileChange} accept=".db" disabled={isSubmitting} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Workspace Name (Optional)</label>
            <input type="text" className="input-text" placeholder="Defaults to filename..." value={importName} onChange={(e) => setImportName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleImportSubmit()} disabled={isSubmitting} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Archive Passphrase (Required)</label>
            <PasswordInput placeholder="Enter the passphrase used to encrypt this file" value={importPassword} onChange={(e) => setImportPassword(e.target.value)} showIcon={true} />
          </div>
        </div>
      </Modal>
    </div>
  );
};