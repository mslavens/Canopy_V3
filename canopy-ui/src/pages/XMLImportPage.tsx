import React, { useState, useRef } from 'react';
import { CanopyApiClient } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { 
  Upload, FileCode, CheckCircle2, AlertTriangle, Loader2, 
  Database, Network, Shield, Cpu, ExternalLink 
} from 'lucide-react';

interface PreviewStats {
  config_type: 'Panorama' | 'Firewall';
  devices: string[];
  preview: boolean;
  stats: {
    devices_count: number;
    interfaces_count: number;
    templates_count: number;
    virtual_routers_count: number;
    zones_count: number;
  };
}

interface XMLImportPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  onNavigate: (mainTab: string, subTab: string) => void;
}

export const XMLImportPage: React.FC<XMLImportPageProps> = ({ auth, addToast, onNavigate }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Phase 1: Preview Data
  const [previewData, setPreviewData] = useState<PreviewStats | null>(null);
  
  // Phase 2: Completed Import Summary
  const [importSummary, setImportSummary] = useState<{
    devices_imported: number;
    topologies_imported: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const processFile = async (selectedFile: File) => {
    const name = selectedFile.name.toLowerCase();
    if (!name.endsWith('.xml') && !name.endsWith('.tgz') && !name.endsWith('.tar.gz')) {
      addToast('Invalid file format. Please upload a .xml, .tgz, or .tar.gz configuration file.', 'error');
      setError('Please select a valid Palo Alto Networks XML or compressed (.tgz/.tar.gz) configuration file.');
      return;
    }

    setFile(selectedFile);
    setError(null);
    setPreviewData(null);
    setImportSummary(null);
    setIsParsing(true);

    try {
      if (!auth) throw new Error('Daemon authentication context missing.');
      const apiClient = new CanopyApiClient(auth);
      
      const formData = new FormData();
      formData.append('xml', selectedFile);

      // Trigger pre-flight preview check
      const res = await apiClient.importDeviceXml(formData, true);
      setPreviewData(res);
      addToast('XML configuration parsed successfully.', 'success');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'XML Parsing failed.';
      setError(errMsg);
      addToast(errMsg, 'error');
      setFile(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const handleImportAll = async () => {
    if (!file || !auth) return;
    setIsImporting(true);
    setError(null);
    try {
      const apiClient = new CanopyApiClient(auth);
      const formData = new FormData();
      formData.append('xml', file);

      // Perform final DB commit
      const res = await apiClient.importDeviceXml(formData, false);
      setImportSummary({
        devices_imported: res.devices_imported,
        topologies_imported: res.topologies_imported
      });
      addToast('Configuration successfully committed to database.', 'success');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Import failed.';
      setError(errMsg);
      addToast(errMsg, 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const resetParser = () => {
    setFile(null);
    setPreviewData(null);
    setImportSummary(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', maxWidth: '1200px' }}>
      <PageHeader
        title="PAN XML Ingestion"
        description="Ingest Palo Alto standalone or Panorama configurations with pre-flight metrics analysis."
      />

      {/* Initial Drag & Drop Zone */}
      {!file && !isParsing && (
        <section
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            backgroundColor: isDragOver ? 'var(--bg-element)' : 'var(--bg-surface)',
            border: isDragOver ? '2px dashed var(--accent-blue)' : '2px dashed var(--border-main)',
            borderRadius: '8px',
            padding: '50px 30px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            cursor: 'pointer'
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".xml,.tgz,.tar.gz"
            style={{ display: 'none' }}
          />
          <Upload size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600, color: 'var(--text-main)' }}>
            Upload PAN Configuration (XML / TGZ)
          </h3>
          <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-muted)', maxWidth: '450px', lineHeight: 1.5 }}>
            Drag and drop your Palo Alto Networks XML configuration or compressed (.tgz/.tar.gz) backup bundle here, or click to browse your local directory files.
          </p>
          <button 
            type="button" 
            className="btn-primary" 
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          >
            Browse Files
          </button>
          
          {error && (
            <div style={{ marginTop: '20px', backgroundColor: 'var(--bg-app)', borderLeft: '4px solid var(--status-red)', padding: '12px 15px', borderRadius: '4px', color: 'var(--status-red)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}
        </section>
      )}

      {/* Loader / Parsing State */}
      {isParsing && (
        <section style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '8px', padding: '50px 30px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={36} className="spin-animation" style={{ color: 'var(--accent-blue)', marginBottom: '16px' }} />
          <h3 style={{ margin: '0 0 8px 0', fontSize: '15px', fontWeight: 600, color: 'var(--text-main)' }}>
            Analyzing Configuration Structure...
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
            Parsing interfaces, security zones, and templates. Large files may take a few seconds.
          </p>
        </section>
      )}

      {/* Preview Stats Page */}
      {file && previewData && !isParsing && !importSummary && (
        <section style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '8px', padding: '25px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Header Row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-main)', paddingBottom: '15px', flexWrap: 'wrap', gap: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ backgroundColor: 'var(--bg-element)', padding: '10px', borderRadius: '50%', display: 'flex' }}>
                <CheckCircle2 size={24} style={{ color: 'var(--status-green)' }} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: 'var(--text-main)' }}>
                  Config Parsed Successfully
                </h3>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                  Detected Layout: <strong style={{ color: 'var(--accent-blue)' }}>{previewData.config_type}</strong>
                </p>
              </div>
            </div>
            <button className="btn-secondary btn-sm" onClick={resetParser} disabled={isImporting}>
              Upload Different File
            </button>
          </div>

          {/* Stats Badges row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            {previewData.config_type === 'Panorama' && (
              <div style={{ backgroundColor: 'var(--bg-element)', border: '1px solid var(--border-main)', padding: '10px 15px', borderRadius: '20px', fontSize: '12px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Shield size={14} style={{ color: 'var(--accent-purple)' }} />
                <strong>{previewData.stats.templates_count}</strong> Templates
              </div>
            )}
            <div style={{ backgroundColor: 'var(--bg-element)', border: '1px solid var(--border-main)', padding: '10px 15px', borderRadius: '20px', fontSize: '12px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={14} style={{ color: 'var(--accent-blue)' }} />
              <strong>{previewData.stats.devices_count}</strong> Devices / Contexts
            </div>
            <div style={{ backgroundColor: 'var(--bg-element)', border: '1px solid var(--border-main)', padding: '10px 15px', borderRadius: '20px', fontSize: '12px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Network size={14} style={{ color: 'var(--accent-green)' }} />
              <strong>{previewData.stats.interfaces_count}</strong> Interfaces
            </div>
            <div style={{ backgroundColor: 'var(--bg-element)', border: '1px solid var(--border-main)', padding: '10px 15px', borderRadius: '20px', fontSize: '12px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={14} style={{ color: 'var(--status-warn)' }} />
              <strong>{previewData.stats.zones_count}</strong> Security Zones
            </div>
          </div>

          {/* Device List summary */}
          <div style={{ backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '6px', padding: '15px' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Extracted Contexts ({previewData.devices.length})
            </h4>
            <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-main)' }}>
              {previewData.devices.map((devName, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--accent-blue)' }}>&rarr;</span> {devName}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ backgroundColor: 'var(--bg-app)', borderLeft: '4px solid var(--status-red)', padding: '12px 15px', borderRadius: '4px', color: 'var(--status-red)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Action Row */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
            <button className="btn-primary" onClick={handleImportAll} disabled={isImporting}>
              {isImporting ? (
                <>
                  <Loader2 size={14} className="spin-animation" style={{ marginRight: '6px' }} />
                  Saving to Database...
                </>
              ) : (
                'Import Entire Configuration'
              )}
            </button>
          </div>
        </section>
      )}

      {/* Success summary Panel */}
      {importSummary && (
        <section style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '8px', padding: '30px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '15px' }}>
          <CheckCircle2 size={48} style={{ color: 'var(--status-green)' }} />
          <div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600, color: 'var(--text-main)' }}>
              Configuration Import Complete!
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', maxWidth: '500px', lineHeight: 1.5 }}>
              Successfully registered <strong>{importSummary.devices_imported}</strong> devices/templates and provisioned <strong>{importSummary.topologies_imported}</strong> network topology interfaces into the active SQLite matrices.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button className="btn-secondary" onClick={resetParser}>
              Import Another File
            </button>
            <button 
              className="btn-primary" 
              onClick={() => onNavigate('System', 'Database Browser')}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              Open Database Browser <ExternalLink size={14} />
            </button>
          </div>
        </section>
      )}
    </div>
  );
};
