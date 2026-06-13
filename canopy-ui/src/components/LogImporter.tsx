import React, { useState } from 'react';
import { Upload, Loader2, Database, Trash2, ArrowRight } from 'lucide-react';
import { CanopyApiClient } from '../api/client';

interface LogImporterProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  onSuccess?: () => void;
}

export const LogImporter: React.FC<LogImporterProps> = ({ auth, addToast, onSuccess }) => {
    const [status, setStatus] = useState("Ready to import logs.");
    const [stats, setStats] = useState({ files: 0, rows: 0 });
    const [isProcessing, setIsProcessing] = useState(false);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    
    const updateStatus = (msg: string) => setStatus(msg);

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!event.target.files) return;
        const files = Array.from(event.target.files);
        event.target.value = '';
        if (files.length === 0) return;

        const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'));
        if (csvFiles.length === 0) {
            updateStatus("Please select CSV files only.");
            return;
        }

        setPendingFiles(prev => [...prev, ...csvFiles]);
        updateStatus(`${csvFiles.length} file(s) staged for import.`);
    };

    const handleClear = () => {
        setStats({ files: 0, rows: 0 });
        setStatus("Ready to process logs.");
        setPendingFiles([]);
    };

    const handleImportToApp = async () => {
        if (!auth || pendingFiles.length === 0) return;
        setIsProcessing(true);
        updateStatus("Uploading to database... this may take a moment for large files.");
        
        let totalRows = 0;
        let successfulFiles = 0;

        for (const file of pendingFiles) {
            try {
                const formData = new FormData();
                formData.append('file', file);
                
                // Assuming client_id is provided globally or via config. Using 'global' for now.
                formData.append('client_id', 'global'); 

                const client = new CanopyApiClient(auth);
                const result = await client.importLogs('global', formData);
                
                // Expecting the updated backend to return {"status":"success", "rows": X}
                if (result && result.rows !== undefined) {
                    totalRows += result.rows;
                }
                successfulFiles++;
                
                updateStatus(`Successfully imported ${file.name}`);
            } catch (err: any) {
                console.error(`Import failed for ${file.name}:`, err);
                updateStatus(`Import failed for ${file.name}: ${err.message}`);
                addToast(`Failed to import ${file.name}: ${err.message || String(err)}`, 'error');
            }
        }

        setStats(prev => ({ files: prev.files + successfulFiles, rows: prev.rows + totalRows }));
        setPendingFiles([]);
        setIsProcessing(false);
        
        if (successfulFiles > 0) {
            updateStatus("Import complete.");
            addToast(`Successfully imported ${totalRows.toLocaleString()} rows from ${successfulFiles} file(s).`, 'success');
        }
    };

    return (
        <div style={{ width: '100%', maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ backgroundColor: 'var(--bg-surface)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-main)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                    Select or drag and drop CSV files containing raw Palo Alto Networks firewall logs. The files will be processed and imported into the database.
                </p>

                <div style={{ position: 'relative', border: '2px dashed var(--border-main)', borderRadius: '8px', padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-app)', transition: 'border-color 0.2s ease', cursor: 'pointer' }}>
                    <input 
                        type="file" 
                        multiple 
                        accept=".csv"
                        onChange={handleFileUpload}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 10 }}
                    />
                    <Upload size={32} color="var(--text-muted)" style={{ marginBottom: '12px' }} />
                    <div className="btn-primary" style={{ pointerEvents: 'none' }}>Browse CSV Files</div>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '16px 0 0 0' }}>Or drag and drop files here</p>
                </div>

                <div style={{ backgroundColor: 'var(--bg-app)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-main)', fontSize: '13px', fontFamily: 'monospace', color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{status}</span>
                    {isProcessing && <Loader2 size={16} className="animate-spin" color="var(--accent-blue)" />}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                    <div style={{ backgroundColor: 'var(--bg-app)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>Files Staged</div>
                        <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-main)' }}>{pendingFiles.length}</div>
                    </div>
                    <div style={{ backgroundColor: 'var(--bg-app)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>Unique Rows Imported</div>
                        <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--status-green)' }}>{stats.rows.toLocaleString()}</div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                    <button 
                        onClick={handleImportToApp}
                        disabled={pendingFiles.length === 0 || isProcessing}
                        className="btn-primary"
                        style={{ flex: 1, padding: '12px', fontSize: '14px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', opacity: (pendingFiles.length === 0 || isProcessing) ? 0.5 : 1 }}
                    >
                        <Database size={18} /> Upload & Process in DB <ArrowRight size={16} />
                    </button>
                    <button 
                        onClick={handleClear}
                        disabled={pendingFiles.length === 0 && stats.rows === 0 && !isProcessing}
                        className="btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-red)', borderColor: 'rgba(239, 68, 68, 0.3)', opacity: (pendingFiles.length === 0 && stats.rows === 0 && !isProcessing) ? 0.5 : 1 }}
                    >
                        <Trash2 size={16} /> Clear
                    </button>
                    {stats.rows > 0 && onSuccess && (
                        <button 
                            onClick={onSuccess}
                            className="btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--bg-element)' }}
                        >
                            View Logs <ArrowRight size={16} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
