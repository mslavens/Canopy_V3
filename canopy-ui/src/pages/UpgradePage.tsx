import React, { useState, useRef, useEffect } from 'react';
import { CanopyApiClient } from '../api/client';
import { FileInput } from '../components/FileInput';
import { useConfirm } from '../components/ConfirmProvider';
import { PageHeader } from '../components/PageHeader';

interface UpgradePageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const UpgradePage: React.FC<UpgradePageProps> = ({ auth, addToast }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [patchPreview, setPatchPreview] = useState<string[] | null>(null);
  const [needsRestart, setNeedsRestart] = useState<boolean>(false);
  const confirm = useConfirm();

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      if (!selected.name.endsWith('.cpatch')) {
        addToast('Invalid file format. Please select a .cpatch file.', 'error');
        e.target.value = ''; // Clear the input so the same file can be re-selected
        setFile(null);
        return;
      }
      setFile(selected);
    } else {
      setFile(null);
    }
  };

  // Pre-flight inspection: Automatically analyze the patch before applying
  useEffect(() => {
    const inspectFile = async () => {
      if (!file || !auth) {
        setPatchPreview(null);
        return;
      }
      addLog('Inspecting patch archive...');
      try {
        const formData = new FormData();
        formData.append('patch', file);
        const apiClient = new CanopyApiClient(auth);
        const data = await apiClient.inspectPatch(formData);
        setPatchPreview(data.files);
        addLog(`Patch contains ${data.files.length} files.`);
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'Failed to inspect patch archive.', 'error');
      }
    };
    inspectFile();
  }, [file, auth, addToast]);

  const handleUpload = () => {
    if (!file || !auth) return;

    confirm({
      title: 'Apply System Patch',
      message: `Are you sure you want to apply the patch "${file.name}"?\n\nThe system will safely back up your current state before modifying any files.`,
      onConfirm: async () => {
        setIsUploading(true);
        setLogs([]);
        addLog(`Initiating patch sequence for archive: ${file.name}`);
        addLog('Creating auto-rollback backup and extracting payload...');
        const formData = new FormData();
        formData.append('patch', file);

        try {
          const apiClient = new CanopyApiClient(auth);
          const resData = await apiClient.applyPatch(formData);

          addLog(`Engine response: ${resData.message}`);
          if (resData.backup_created) addLog('Auto-rollback backup successfully secured.');
          if (resData.files_patched !== undefined) addLog(`Modified/Extracted files: ${resData.files_patched}`);

          addToast(resData.message, 'success');
          setFile(null);
          if (fileInputRef.current) fileInputRef.current.value = ''; // Clear the underlying input

          if (resData.requires_restart) {
            addLog('System update pending. Awaiting user restart...');
            addToast('Patch applied successfully. Please restart to complete the upgrade.', 'success');
            setNeedsRestart(true);
          }
        } catch (err) {
          addLog(`ERROR: ${err instanceof Error ? err.message : 'Unknown fault occurred.'}`);
          addToast(err instanceof Error ? err.message : 'Patch upload failed due to network error.', 'error');
        } finally {
          setIsUploading(false);
        }
      }
    });
  };

  const handleRollback = () => {
    if (!auth) return;

    confirm({
      title: 'Emergency Rollback',
      message: 'Are you sure you want to revert to the previous system state?\n\nThis will safely overwrite current system files with the latest backup snapshot.',
      onConfirm: async () => {
        setIsUploading(true);
        setLogs([]);
        addLog('Initiating emergency system rollback...');

        try {
          const apiClient = new CanopyApiClient(auth);
          const resData = await apiClient.rollbackSystem();

          addLog(`Engine response: ${resData.message}`);
          if (resData.files_patched !== undefined) addLog(`Restored files: ${resData.files_patched}`);
          addToast(resData.message, 'success');

          if (resData.requires_restart) {
            addLog('System rollback pending. Awaiting user restart...');
            setNeedsRestart(true);
          }
        } catch (err) {
          addLog(`ERROR: ${err instanceof Error ? err.message : 'Unknown fault occurred.'}`);
          addToast(err instanceof Error ? err.message : 'Rollback failed due to network error.', 'error');
        } finally {
          setIsUploading(false);
        }
      }
    });
  };

  const handleRestart = () => {
    confirm({
      title: 'Restart System',
      message: 'Are you sure you want to restart Canopy now?',
      onConfirm: () => {
        if (window.electron && window.electron.relaunchApp) {
          window.electron.relaunchApp();
        }
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', maxWidth: '1200px' }}>
      <PageHeader 
        title="System Upgrade" 
        description="Apply offline .cpatch files to update the Canopy engine." 
      />

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>Framework Patch Management</h3>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
          Upload a signed Canopy Patch file (<code>.cpatch</code>) to upgrade the core engine, apply database schema migrations, or update documentation assets.
        </p>

        <div style={{ backgroundColor: 'var(--bg-app)', borderLeft: '4px solid var(--status-warn)', padding: '12px 15px', borderRadius: '4px', marginBottom: '20px' }}>
          <strong style={{ fontSize: '13px', color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>Before you begin:</strong>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            <li style={{ marginBottom: '4px' }}>Ensure you have at least <strong>500MB of free disk space</strong> available for the auto-rollback backup and extraction process.</li>
            <li>Do not close the application or power off your machine during the upgrade.</li>
          </ul>
        </div>

        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <FileInput
            ref={fileInputRef}
            file={file}
            onChange={handleFileChange}
            accept=".cpatch"
            disabled={isUploading || needsRestart}
          />
          {!needsRestart ? (
            <>
              <button className="btn-primary" onClick={handleUpload} disabled={!file || isUploading}>
                {isUploading ? 'Applying Patch...' : 'Apply Patch'}
              </button>
              <button className="btn-danger" onClick={handleRollback} disabled={isUploading}>
                Revert to Previous Snapshot
              </button>
            </>
          ) : (
            <button className="btn-success" onClick={handleRestart}>
              Restart Canopy Now
            </button>
          )}
        </div>

        {/* Pre-flight inspection preview window */}
        {patchPreview && !isUploading && !needsRestart && (
          <div style={{ marginTop: '20px', padding: '15px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '6px' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '12px', color: 'var(--text-muted)' }}>Files pending modification ({patchPreview.length}):</h4>
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: 'var(--status-warn)', fontFamily: 'monospace', maxHeight: '150px', overflowY: 'auto' }}>
              {patchPreview.map((f, i) => <li key={i} style={{ marginBottom: '4px' }}>{f}</li>)}
            </ul>
          </div>
        )}

        {/* Execution Logs */}
        {logs.length > 0 && (
          <div style={{ marginTop: '25px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '6px', overflow: 'hidden' }}>
            <div style={{ backgroundColor: 'var(--bg-element)', padding: '8px 15px', borderBottom: '1px solid var(--border-main)', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Patch Execution Log
            </div>
            <div style={{ padding: '15px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--status-green)', maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {logs.map((log, idx) => (
                <div key={idx} style={{ opacity: log.includes('ERROR') ? 1 : 0.8, color: log.includes('ERROR') ? 'var(--status-red)' : 'inherit' }}>
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};