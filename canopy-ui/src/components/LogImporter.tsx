import React, { useState, useCallback } from 'react';
import { UploadCloud, FileType, CheckCircle2, AlertCircle } from 'lucide-react';
import { CanopyApiClient } from '../api/client';

interface LogImporterProps {
  auth: { url: string; token: string } | null;
  onSuccess?: () => void;
}

export const LogImporter: React.FC<LogImporterProps> = ({ auth, onSuccess }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.endsWith('.csv')) {
        setFile(droppedFile);
        setStatus('idle');
      } else {
        setStatus('error');
        setErrorMessage('Please upload a valid .csv log file.');
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setStatus('idle');
    }
  };

  const handleUpload = async () => {
    if (!file || !auth) return;
    setStatus('uploading');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const client = new CanopyApiClient(auth);
      await client.importLogs('global', formData);

      setStatus('success');
      setFile(null);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message || 'An unknown error occurred');
    }
  };

  return (
    <div style={{
      width: '100%',
      maxWidth: '600px',
      margin: '0 auto',
      padding: '30px',
      backgroundColor: 'var(--bg-surface)',
      borderRadius: '12px',
      border: '1px solid var(--border-color)',
      boxShadow: '0 10px 30px rgba(0,0,0,0.15)'
    }}>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-main)', margin: '0 0 8px 0' }}>Import Traffic Logs</h2>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
          Upload a Panorama CSV log export to ingest directly into the DuckDB analytical engine.
        </p>
      </div>

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => document.getElementById('log-file-upload')?.click()}
        style={{
          position: 'relative',
          border: `2px dashed ${isDragging ? 'var(--accent-blue)' : 'var(--border-main)'}`,
          borderRadius: '8px',
          padding: '40px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isDragging ? 'rgba(59, 130, 246, 0.05)' : 'var(--bg-app)',
          cursor: 'pointer',
          transition: 'all 0.2s ease'
        }}
      >
        <input
          id="log-file-upload"
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        
        {file ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <FileType size={48} color="var(--accent-blue)" style={{ marginBottom: '12px' }} />
            <span style={{ color: 'var(--text-main)', fontWeight: 500, fontSize: '15px' }}>{file.name}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '6px' }}>
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <UploadCloud size={48} color={isDragging ? 'var(--accent-blue)' : 'var(--text-muted)'} style={{ marginBottom: '12px', transition: 'color 0.2s ease' }} />
            <span style={{ color: 'var(--text-main)', fontWeight: 500, fontSize: '15px' }}>Click or drag CSV file to upload</span>
          </div>
        )}
      </div>

      {status === 'error' && (
        <div style={{
          marginTop: '16px',
          padding: '12px 16px',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px'
        }}>
          <AlertCircle size={18} color="#ef4444" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ fontSize: '13px', color: '#fca5a5', lineHeight: 1.5 }}>{errorMessage}</div>
        </div>
      )}

      {status === 'success' && (
        <div style={{
          marginTop: '16px',
          padding: '12px 16px',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <CheckCircle2 size={18} color="#22c55e" style={{ flexShrink: 0 }} />
          <div style={{ fontSize: '13px', color: '#86efac' }}>Logs imported successfully! You can view them in the data table.</div>
        </div>
      )}

      <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        {file && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setFile(null);
              setStatus('idle');
            }}
            className="btn-secondary"
          >
            Clear
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleUpload();
          }}
          disabled={!file || status === 'uploading'}
          className={!file || status === 'uploading' ? 'btn-secondary' : 'btn-primary'}
          style={{ opacity: (!file || status === 'uploading') ? 0.6 : 1 }}
        >
          {status === 'uploading' ? 'Importing...' : 'Import Logs'}
        </button>
      </div>
    </div>
  );
};
