import React, { useState, useEffect, useRef } from 'react';
import { Download, Upload, RotateCcw, Camera, Trash2, Database, Loader2, Edit2, AlertTriangle, Shield, Plus, Play } from 'lucide-react';
import { ContextMenuItem, ContextMenuDivider } from '../components/ContextMenu';
import { DataTable, ColumnDef } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { Tooltip } from '../components/Tooltip';
import { PasswordInput } from '../components/PasswordInput';
import { useConfirm } from '../components/ConfirmProvider';
import { FileInput } from '../components/FileInput';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { CanopyApiClient } from '../api/client';

interface SnapshotsPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const SnapshotsPage: React.FC<SnapshotsPageProps> = ({ auth, addToast }) => {
  const confirm = useConfirm();
  
  // State
  const [snapshots, setSnapshots] = useState<{ id: string, size_bytes: number, description?: string }[]>([]);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(true);
  const [exportId, setExportId] = useState('');
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);

  const [isTakeSnapshotModalOpen, setIsTakeSnapshotModalOpen] = useState(false);
  const [newSnapshotDesc, setNewSnapshotDesc] = useState('');
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);

  const [editingSnapshot, setEditingSnapshot] = useState<{ id: string, description: string } | null>(null);
  const [editSnapshotDesc, setEditSnapshotDesc] = useState('');
  const [isUpdatingSnapshot, setIsUpdatingSnapshot] = useState(false);

  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  const fetchSnapshots = async () => {
    if (!auth) return;
    setIsLoadingSnapshots(true);
    try {
      const apiClient = new CanopyApiClient(auth);
      const data = await apiClient.getSnapshots();
      setSnapshots(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingSnapshots(false);
    }
  };

  useEffect(() => { fetchSnapshots(); }, [auth]);

  const handleTakeSnapshot = async () => {
    if (!auth) return;
    setIsCreatingSnapshot(true);
    addToast('Saving system state...', 'info');
    try {
      const apiClient = new CanopyApiClient(auth);
      await apiClient.createSnapshot(newSnapshotDesc);
      addToast('Local snapshot captured successfully.', 'success');
      setIsTakeSnapshotModalOpen(false);
      setNewSnapshotDesc('');
      fetchSnapshots();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Snapshot failed.', 'error');
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  const handleUpdateSnapshot = async () => {
    if (!auth || !editingSnapshot) return;
    setIsUpdatingSnapshot(true);
    try {
      const apiClient = new CanopyApiClient(auth);
      await apiClient.updateSnapshot(editingSnapshot.id, editSnapshotDesc);
      addToast('Snapshot description updated.', 'success');
      setEditingSnapshot(null);
      fetchSnapshots();
    } catch (err) {
      addToast('Failed to update snapshot description.', 'error');
    } finally {
      setIsUpdatingSnapshot(false);
    }
  };

  const handleDeleteSnapshot = (id: string) => {
    if (!auth) return;
    confirm({
      title: 'Delete Snapshot', message: 'Are you sure you want to permanently delete this snapshot?', isDestructive: true, onConfirm: async () => {
        try {
          const apiClient = new CanopyApiClient(auth);
          await apiClient.deleteSnapshot(id);
          addToast('Snapshot deleted.', 'success');
          fetchSnapshots();
        } catch (err) {
          addToast('Failed to delete snapshot.', 'error');
        }
      }
    });
  };

  const handleRevertSnapshot = (id: string) => {
    if (!auth) return;
    confirm({
      title: 'Revert to Snapshot', message: 'Are you sure you want to instantly roll back your entire workspace to this specific checkpoint? All active data will be irreversibly overwritten.', isDestructive: true, confirmText: 'Revert Workspace', onConfirm: async () => {
        try {
          const apiClient = new CanopyApiClient(auth);
          await apiClient.revertSnapshot(id);
          addToast('Workspace reverted successfully. Restarting...', 'success');
          setTimeout(() => { localStorage.clear(); if (window.electron && window.electron.relaunchApp) { window.electron.relaunchApp(); } else { window.location.reload(); } }, 1500);
        } catch (err) {
          addToast(err instanceof Error ? err.message : 'Failed to revert.', 'error');
        }
      }
    });
  };

  const handleBackupSubmit = async () => {
    if (!auth || !backupPassword.trim() || !exportId) return;
    setIsBackingUp(true);
    addToast('Exporting secure archive...', 'info');
    try {
      const apiClient = new CanopyApiClient(auth);
      const res = await apiClient.downloadSnapshot(exportId, backupPassword);
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = `canopy_system_snapshot_${exportId}.cbak`;
      if (contentDisposition && contentDisposition.includes('filename=')) {
        filename = contentDisposition.split('filename=')[1].replace(/"/g, '');
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      addToast('System backup downloaded successfully.', 'success');
      setIsBackupModalOpen(false);
      setBackupPassword('');
      setExportId('');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Backup failed.', 'error');
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestoreSubmit = async () => {
    if (!auth || !restoreFile || !restorePassword) return;
    setIsRestoring(true);
    addToast('Importing and decrypting snapshot...', 'info');
    try {
      const formData = new FormData();
      formData.append('backup', restoreFile);
      formData.append('archive_password', restorePassword);
      const apiClient = new CanopyApiClient(auth);
      await apiClient.importSnapshot(formData);
      addToast('Snapshot imported successfully.', 'success');
      setIsRestoreModalOpen(false);
      setRestoreFile(null);
      setRestorePassword('');
      if (restoreFileInputRef.current) restoreFileInputRef.current.value = '';
      fetchSnapshots();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Import failed.', 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  const snapshotColumns: ColumnDef[] = [
    { key: 'id', label: 'Snapshot Checkpoint', renderCell: (val) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{new Date(parseInt(val, 10)).toLocaleString()}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>ID: {val}</span>
      </div>
    )},
    { key: 'description', label: 'Description', renderCell: (val) => <span style={{ color: 'var(--text-muted)' }}>{val || '-'}</span> },
    { key: 'size_bytes', label: 'Total Matrix Size', renderCell: (val) => <span style={{ color: 'var(--text-muted)' }}>{(val / 1024 / 1024).toFixed(2)} MB</span> },
    { key: 'actions', label: 'Actions', renderCell: (_, row) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          <Tooltip content="Instantly Revert Workspace" position="top">
            <button className="btn-table-action" onClick={() => handleRevertSnapshot(row.id)}><RotateCcw size={14} /></button>
          </Tooltip>
        </div>
      )}
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader 
        title="Configuration Snapshots" 
        description="Point-in-time backups of workspace objects, networks, and policies." 
        isSticky={false}
        bottomSpacing={false}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)', margin: '0 -30px -30px -30px' }}>
        {isLoadingSnapshots ? (
          <div className="fade-in-delayed" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px', gap: '15px' }}><Loader2 size={24} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />Loading snapshots...</div>
        ) : (
          <DataTable 
            columns={snapshotColumns} 
            data={snapshots} 
            pagination={true} 
            exportActions={
              <button 
                className="btn-secondary btn-sm" 
                onClick={() => setIsRestoreModalOpen(true)} 
                style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-start', border: 'none' }}
              >
                <Upload size={13} /> Import Backup
              </button>
            }
            topRightActions={
              <button className="btn-primary btn-sm" onClick={() => setIsTakeSnapshotModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }} disabled={isCreatingSnapshot}>
                <Camera size={14} /> {isCreatingSnapshot ? 'Saving...' : 'Take Snapshot'}
              </button>
            }
            rowContextMenuActions={(row, closeMenu) => (
              <>
                <ContextMenuItem
                  icon={<Edit2 size={13} />}
                  label="Edit Description"
                  onClick={() => {
                    closeMenu();
                    setEditingSnapshot({ id: row.id, description: row.description || '' });
                    setEditSnapshotDesc(row.description || '');
                  }}
                />
                <ContextMenuItem
                  icon={<Download size={13} />}
                  label="Download as Backup"
                  onClick={() => {
                    closeMenu();
                    setExportId(row.id);
                    setIsBackupModalOpen(true);
                  }}
                />
                <ContextMenuDivider />
                <ContextMenuItem
                  icon={<Trash2 size={13} />}
                  label="Delete"
                  onClick={() => {
                    closeMenu();
                    handleDeleteSnapshot(row.id);
                  }}
                  danger
                />
              </>
            )}
          />
        )}
      </div>

      <Modal isOpen={isTakeSnapshotModalOpen} onClose={() => { setIsTakeSnapshotModalOpen(false); setNewSnapshotDesc(''); }} title="Take Local Snapshot" size="sm" footer={<><button className="btn-secondary btn-sm" onClick={() => { setIsTakeSnapshotModalOpen(false); setNewSnapshotDesc(''); }}>Cancel</button><button className="btn-primary btn-sm" onClick={handleTakeSnapshot} disabled={isCreatingSnapshot}>{isCreatingSnapshot ? 'Saving...' : 'Save Snapshot'}</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.5 }}>Take an instant checkpoint of your current workspace configuration. You can optionally add a description to remember why this snapshot was taken.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}><label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Description (Optional)</label><input type="text" className="input-text" placeholder="e.g., Before importing AcmeCorp firewall rules" value={newSnapshotDesc} onChange={(e) => setNewSnapshotDesc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleTakeSnapshot()} disabled={isCreatingSnapshot} /></div>
        </div>
      </Modal>

      <Modal isOpen={!!editingSnapshot} onClose={() => setEditingSnapshot(null)} title="Edit Snapshot Description" size="sm" footer={<><button className="btn-secondary btn-sm" onClick={() => setEditingSnapshot(null)}>Cancel</button><button className="btn-primary btn-sm" onClick={handleUpdateSnapshot} disabled={isUpdatingSnapshot}>{isUpdatingSnapshot ? 'Saving...' : 'Save Changes'}</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Description (Optional)</label>
            <input type="text" className="input-text" placeholder="e.g., Before importing AcmeCorp firewall rules" value={editSnapshotDesc} onChange={(e) => setEditSnapshotDesc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleUpdateSnapshot()} disabled={isUpdatingSnapshot} autoFocus />
          </div>
        </div>
      </Modal>

      <Modal isOpen={isBackupModalOpen} onClose={() => { setIsBackupModalOpen(false); setBackupPassword(''); setExportId(''); }} title="Export System Backup" size="md" footer={<><button className="btn-secondary btn-sm" onClick={() => { setIsBackupModalOpen(false); setBackupPassword(''); setExportId(''); }}>Cancel</button><button className="btn-primary btn-sm" onClick={handleBackupSubmit} disabled={!backupPassword.trim() || isBackingUp}>{isBackingUp ? 'Exporting...' : 'Export Archive'}</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.5 }}>Export a full system archive (<code>.cbak</code>). All configuration files and encrypted vaults will be securely rekeyed using the passphrase provided below.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}><label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Archive Passphrase (Required)</label><PasswordInput placeholder="Enter a secure passphrase for this backup" value={backupPassword} onChange={(e) => setBackupPassword(e.target.value)} showIcon={true} autoFocus={true} /></div>
        </div>
      </Modal>

      <Modal isOpen={isRestoreModalOpen} onClose={() => { setIsRestoreModalOpen(false); setRestoreFile(null); setRestorePassword(''); }} title="Import External Backup" size="md" footer={<><button className="btn-secondary btn-sm" onClick={() => { setIsRestoreModalOpen(false); setRestoreFile(null); setRestorePassword(''); }}>Cancel</button><button className="btn-primary btn-sm" onClick={handleRestoreSubmit} disabled={!restoreFile || !restorePassword.trim() || isRestoring}>{isRestoring ? 'Importing...' : 'Import Backup'}</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.5 }}>Upload an encrypted <code>.cbak</code> backup file. It will be decrypted using the passphrase you provide, automatically rekeyed to your current passphrase, and safely added to your Local Snapshots list.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}><label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Select Backup File (.cbak)</label><FileInput ref={restoreFileInputRef} file={restoreFile} onChange={(e) => setRestoreFile(e.target.files?.[0] || null)} accept=".cbak" disabled={isRestoring} /></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}><label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Archive Passphrase (Required)</label><PasswordInput placeholder="Enter the passphrase used to encrypt this archive" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} showIcon={true} autoFocus={true} /></div>
        </div>
      </Modal>
    </div>
  );
};