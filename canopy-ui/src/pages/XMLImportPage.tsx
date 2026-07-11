import React, { useState, useRef } from 'react';
import { CanopyApiClient } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { 
  Upload, FileCode, CheckCircle2, AlertTriangle, Loader2, 
  Database, Network, Shield, Cpu, ExternalLink 
} from 'lucide-react';

interface PreviewStats {
  config_type: 'Panorama' | 'Firewall';
  device_groups: string[];
  firewalls: string[];
  preview: boolean;
  warnings: string[];
  stats: {
    devices_count: number;
    interfaces_count: number;
    templates_count: number;
    virtual_routers_count: number;
    zones_count: number;
    added_count: number;
    modified_count: number;
    unchanged_count: number;
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

  // Loading Progress Steps
  const [currentProgressStep, setCurrentProgressStep] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressDetail, setProgressDetail] = useState('');
  const [importingFiles, setImportingFiles] = useState<string[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(-1);
  const [currentFileName, setCurrentFileName] = useState('');
  const [currentFileStep, setCurrentFileStep] = useState(0);
  const [currentFilePercent, setCurrentFilePercent] = useState(0);

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
    setProgressDetail('Decompressing archive bundle and searching for XML configurations...');

    // Dynamic detail ticker for pre-flight parsing
    const details = [
      'Parsing templates and template stacks...',
      'Mapping device group parent hierarchies...',
      'Reading address & service databases to check existing objects...',
      'Evaluating object diff matrices (additions vs modifications)...',
      'Running pre-flight delta calculations against the active database matrix...',
      'Deep comparisons are still executing. Please wait...'
    ];
    let tickIdx = 0;
    const parseInterval = setInterval(() => {
      setProgressDetail(details[Math.min(tickIdx, details.length - 1)]);
      tickIdx++;
    }, 3500);

    try {
      if (!auth) throw new Error('Daemon authentication context missing.');
      const apiClient = new CanopyApiClient(auth);
      
      const formData = new FormData();
      formData.append('xml', selectedFile);

      // Trigger pre-flight preview check
      const res = await apiClient.importDeviceXml(formData, true);
      const data = await res.json();
      clearInterval(parseInterval);
      setPreviewData(data);
      addToast('XML configuration parsed successfully.', 'success');
    } catch (err) {
      clearInterval(parseInterval);
      const errMsg = err instanceof Error ? err.message : 'XML Parsing failed.';
      setError(errMsg);
      addToast(errMsg, 'error');
      setFile(null);
    } finally {
      clearInterval(parseInterval);
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
    setCurrentProgressStep(0);
    setProgressPercent(0);
    setProgressDetail('Connecting to Canopy secure headless engine...');
    setImportingFiles([]);
    setCurrentFileIndex(-1);
    setCurrentFileName('');
    setCurrentFileStep(0);
    setCurrentFilePercent(0);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('xml', file);

      const creds = await window.electron.getBackendAuth();
      const apiClient = new CanopyApiClient(creds);
      const response = await apiClient.importDeviceXml(formData, false);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let finalResult: any = null;

      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.trim()) {
              const data = JSON.parse(line);
              if (data.error) {
                throw new Error(data.error);
              }
              if (data.progress) {
                if (data.init) {
                  if (data.files) {
                    setImportingFiles(data.files);
                  }
                  setProgressPercent(data.percent || 0);
                  setProgressDetail(data.detail || '');
                } else {
                  setProgressPercent(data.percent);
                  setProgressDetail(data.detail);
                  if (typeof data.file_index === 'number') {
                    setCurrentFileIndex(data.file_index);
                  }
                  if (data.filename) {
                    setCurrentFileName(data.filename);
                  }
                  if (typeof data.file_step === 'number') {
                    setCurrentFileStep(data.file_step);
                  }
                  if (typeof data.file_percent === 'number') {
                    setCurrentFilePercent(data.file_percent);
                  }

                  // Map overall scaled progress to steps to prevent UI jumping/flickering
                  const pct = data.percent;
                  if (pct >= 100) {
                    setCurrentProgressStep(5);
                  } else if (pct >= 90) {
                    setCurrentProgressStep(4);
                  } else if (pct >= 65) {
                    setCurrentProgressStep(3);
                  } else if (pct >= 40) {
                    setCurrentProgressStep(2);
                  } else if (pct >= 15) {
                    setCurrentProgressStep(1);
                  } else {
                    setCurrentProgressStep(0);
                  }
                }
              } else {
                finalResult = data;
              }
            }
          }
        }
      }

      if (!finalResult || !finalResult.success) {
        throw new Error("Import completed but no success summary was received.");
      }

      // Fast-forward progress steps to complete
      setCurrentProgressStep(5);
      setProgressPercent(100);
      setProgressDetail('Ingestion complete!');

      setImportSummary({
        devices_imported: finalResult.devices_imported,
        topologies_imported: finalResult.topologies_imported
      });
      addToast('Configuration successfully committed to database.', 'success');

      try {
        const healRes = await apiClient.healWorkspace();
        if (healRes && (healRes.addresses_healed > 0 || healRes.services_healed > 0 || healRes.applications_healed > 0)) {
          addToast(`Self-heal mapped ${healRes.addresses_healed} addresses, ${healRes.services_healed} services, and ${healRes.applications_healed} apps.`, 'success');
        } else {
          addToast('Self-heal complete (no orphaned objects found).', 'success');
        }
      } catch (err) {
        console.error('Failed to run heal workspace:', err);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Import failed.';
      setError(errMsg);
      addToast(errMsg, 'error');
      setIsImporting(false);
    }
  };

  const resetParser = () => {
    setFile(null);
    setPreviewData(null);
    setImportSummary(null);
    setError(null);
    setProgressPercent(0);
    setCurrentProgressStep(0);
    setProgressDetail('');
    setImportingFiles([]);
    setCurrentFileIndex(-1);
    setCurrentFileName('');
    setCurrentFileStep(0);
    setCurrentFilePercent(0);
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
          <p style={{ margin: '0 0 4px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
            {progressDetail || 'Parsing interfaces, security zones, and templates. Large files may take a few seconds.'}
          </p>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', opacity: 0.8 }}>
            Comparing XML definitions against active database records to compute deltas...
          </span>
        </section>
      )}

      {/* Preview Stats Page */}
      {file && previewData && !isParsing && !importSummary && (
        <section style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '8px', padding: '25px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Header Row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-main)', paddingBottom: '15px', flexWrap: 'wrap', gap: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ backgroundColor: 'var(--bg-element)', padding: '10px', borderRadius: '50%', display: 'flex' }}>
                <CheckCircle2 size={24} style={{ color: 'var(--status-green)' }} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: 'var(--text-main)' }}>
                  Configuration Pre-Flight Analysis Complete
                </h3>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                  Detected Layout Type: <strong style={{ color: 'var(--accent-blue)' }}>
                    {previewData.config_type === 'Panorama' && (previewData.firewalls?.length > 0 || false) 
                      ? 'Panorama & Standalone Firewalls' 
                      : previewData.config_type}
                  </strong>
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
              <div style={{ backgroundColor: 'var(--bg-element)', border: '1px solid var(--border-main)', padding: '8px 16px', borderRadius: '20px', fontSize: '12px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Shield size={14} style={{ color: 'var(--accent-purple)' }} />
                <strong>{previewData.stats.templates_count}</strong> Templates
              </div>
            )}
            {previewData.config_type === 'Panorama' && (
              <div style={{ backgroundColor: 'var(--bg-element)', border: '1px solid var(--border-main)', padding: '8px 16px', borderRadius: '20px', fontSize: '12px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Cpu size={14} style={{ color: 'var(--accent-blue)' }} />
                <strong>{previewData.device_groups?.length || 0}</strong> Device Groups
              </div>
            )}
            {(previewData.config_type === 'Firewall' || (previewData.firewalls?.length > 0)) && (
              <div style={{ backgroundColor: 'var(--bg-element)', border: '1px solid var(--border-main)', padding: '8px 16px', borderRadius: '20px', fontSize: '12px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Cpu size={14} style={{ color: 'var(--accent-blue)' }} />
                <strong>{previewData.firewalls?.length || 0}</strong> Standalone Firewalls
              </div>
            )}
            <div style={{ backgroundColor: 'var(--bg-element)', border: '1px solid var(--border-main)', padding: '8px 16px', borderRadius: '20px', fontSize: '12px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Network size={14} style={{ color: 'var(--accent-green)' }} />
              <strong>{previewData.stats.interfaces_count}</strong> Interfaces
            </div>
            <div style={{ backgroundColor: 'var(--bg-element)', border: '1px solid var(--border-main)', padding: '8px 16px', borderRadius: '20px', fontSize: '12px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={14} style={{ color: 'var(--status-warn)' }} />
              <strong>{previewData.stats.zones_count}</strong> Security Zones
            </div>
          </div>

          {/* Delta Summary Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Object Delta Summary
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              
              {/* Additions Card */}
              <div style={{ 
                backgroundColor: 'var(--bg-element)', 
                border: '1px solid var(--border-main)', 
                borderLeft: '4px solid var(--status-green)', 
                borderRadius: '6px', 
                padding: '16px', 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '4px' 
              }}>
                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>New Objects (Additions)</span>
                <span style={{ fontSize: '28px', fontWeight: 700, color: 'var(--status-green)', lineHeight: 1 }}>
                  {previewData.stats.added_count ?? 0}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Configuration objects that do not exist and will be created.
                </span>
              </div>

              {/* Modifications Card */}
              <div style={{ 
                backgroundColor: 'var(--bg-element)', 
                border: '1px solid var(--border-main)', 
                borderLeft: '4px solid var(--status-warn)', 
                borderRadius: '6px', 
                padding: '16px', 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '4px' 
              }}>
                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>Modified Objects (Collisions)</span>
                <span style={{ fontSize: '28px', fontWeight: 700, color: 'var(--status-warn)', lineHeight: 1 }}>
                  {previewData.stats.modified_count ?? 0}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Objects that already exist but differ. Attributes will be merged.
                </span>
              </div>

              {/* Unchanged Card */}
              <div style={{ 
                backgroundColor: 'var(--bg-element)', 
                border: '1px solid var(--border-main)', 
                borderLeft: '4px solid var(--text-muted)', 
                borderRadius: '6px', 
                padding: '16px', 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '4px' 
              }}>
                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>Unchanged Objects</span>
                <span style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1 }}>
                  {previewData.stats.unchanged_count ?? 0}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Objects that are already identical in the database.
                </span>
              </div>

            </div>
          </div>

          {/* Conflict Warning Ledger Section */}
          {previewData.warnings && previewData.warnings.length > 0 && (
            <div style={{ 
              backgroundColor: 'rgba(217, 119, 6, 0.05)', 
              border: '1px solid rgba(217, 119, 6, 0.3)', 
              borderRadius: '6px', 
              padding: '18px', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '12px' 
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-warn)' }}>
                <AlertTriangle size={18} />
                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Conflict Warning Ledger ({previewData.warnings.length})
                </h4>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-main)', lineHeight: 1.4 }}>
                The following mapping anomalies were detected. Existing firewall associations in the database will be updated to match the XML specification upon import.
              </p>
              <div style={{ 
                maxHeight: '180px', 
                overflowY: 'auto', 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '8px', 
                fontSize: '12px', 
                fontFamily: 'monospace', 
                color: 'var(--text-main)', 
                backgroundColor: 'var(--bg-app)', 
                padding: '12px', 
                borderRadius: '4px',
                border: '1px solid var(--border-main)'
              }}>
                {previewData.warnings.map((warn, index) => {
                  const isAddition = warn.startsWith('[ADDITION]');
                  return (
                    <div key={index} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', lineHeight: 1.4 }}>
                      <span style={{ color: isAddition ? 'var(--status-green)' : 'var(--status-warn)', flexShrink: 0 }}>•</span>
                      <span>
                        {isAddition ? (
                          <>
                            <strong style={{ color: 'var(--status-green)' }}>[ADDITION]</strong>{' '}
                            {warn.substring('[ADDITION]'.length).trim()}
                          </>
                        ) : (
                          warn
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Device List summary */}
          <div style={{ display: 'flex', gap: '16px', flexDirection: 'column' }}>
            {previewData.device_groups && previewData.device_groups.length > 0 && (
              <div style={{ backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '6px', padding: '15px' }}>
                <div style={{ marginBottom: '10px' }}>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Panorama Contexts ({previewData.device_groups.length})
                  </h4>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Templates provide network details, while Device Groups supply policies and objects.
                  </span>
                </div>
                <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-main)' }}>
                  {previewData.device_groups.map((devName, index) => (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: 'var(--accent-purple)' }}>&rarr;</span> {devName}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {previewData.firewalls && previewData.firewalls.length > 0 && (
              <div style={{ backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '6px', padding: '15px' }}>
                <div style={{ marginBottom: '10px' }}>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Standalone Firewalls ({previewData.firewalls.length})
                  </h4>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Individual firewalls containing a combination of both network details and policies/objects.
                  </span>
                </div>
                <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-main)' }}>
                  {previewData.firewalls.map((devName, index) => (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: 'var(--accent-blue)' }}>&rarr;</span> {devName}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Zero Changes Duplicate Warning Badge */}
          {previewData.stats.added_count === 0 && previewData.stats.modified_count === 0 && (
            <div style={{
              backgroundColor: 'rgba(59, 130, 246, 0.05)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              borderRadius: '6px',
              padding: '12px 15px',
              color: 'var(--text-main)',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <CheckCircle2 size={16} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontWeight: 600 }}>Database Configuration Up-to-Date</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  This configuration file matches your active database records exactly (0 additions, 0 modifications).
                </span>
              </div>
            </div>
          )}

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
                previewData.stats.added_count === 0 && previewData.stats.modified_count === 0
                  ? 'Force Import Configuration'
                  : 'Import Entire Configuration'
              )}
            </button>
          </div>
        </section>
      )}

      {/* Premium Glassmorphic Loading Modal */}
      {isImporting && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(7, 9, 15, 0.82)',
          backdropFilter: 'blur(12px) saturate(180%)',
          WebkitBackdropFilter: 'blur(12px) saturate(180%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999
        }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(22, 28, 38, 0.95) 0%, rgba(13, 17, 24, 0.98) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            padding: '35px',
            width: '480px',
            minHeight: '560px',
            boxShadow: '0 25px 60px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            color: 'var(--text-main)'
          }}>
             {/* Header / Loading Spinner */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: currentProgressStep === 5 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: currentProgressStep === 5 ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(59, 130, 246, 0.3)',
                flexShrink: 0
              }}>
                {currentProgressStep === 5 ? (
                  <CheckCircle2 size={22} style={{ color: 'var(--status-green)' }} />
                ) : (
                  <Loader2 size={22} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />
                )}
              </div>
              <div style={{ flexGrow: 1, minWidth: 0 }}>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600 }}>
                  {currentProgressStep === 5 ? 'Ingestion Complete!' : 'Ingesting Configuration...'}
                </h3>
                <div style={{ height: '20px', display: 'flex', alignItems: 'center' }}>
                  <p style={{
                    margin: 0,
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    lineHeight: '20px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    width: '350px'
                  }}>
                    {currentProgressStep === 5 ? 'All configurations successfully committed!' : (progressDetail || 'Please do not close Canopy or refresh the window.')}
                  </p>
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <span style={{ color: 'var(--accent-blue)' }}>Progress Matrix</span>
                <span style={{ color: 'var(--text-main)' }}>{progressPercent}%</span>
              </div>
              <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--accent-blue) 0%, var(--status-green) 100%)',
                  borderRadius: '3px',
                  transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                }} />
              </div>
            </div>

            {/* Steps Log */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              backgroundColor: 'rgba(0, 0, 0, 0.2)',
              border: '1px solid rgba(255, 255, 255, 0.04)',
              borderRadius: '8px',
              padding: '16px 20px',
              maxHeight: '280px',
              overflowY: 'auto'
            }}>
              {[
                { title: 'Analyze XML Structure', desc: 'Parsed input files and verified metadata headers.' },
                { title: 'Resolve Scopes & Templates', desc: 'Mapping device-groups, parent relationships, and templates.' },
                { title: 'Synchronize Object Repository', desc: 'Ingesting address objects, groups, and service matrix.' },
                { title: 'Deploy Security & Policy Bases', desc: 'Compiling pre-rules, post-rules, and decryption policies.' },
                { title: 'Commit Matrix Database', desc: 'Securing transactional updates to active SQLite matrices.' }
              ].map((step, index) => {
                const isCompleted = index < currentProgressStep || currentProgressStep === 5;
                const isActive = index === currentProgressStep && currentProgressStep < 5;
                const isPending = index > currentProgressStep && currentProgressStep < 5;

                let iconColor = 'rgba(255, 255, 255, 0.15)';
                let textColor = 'var(--text-muted)';
                let descColor = 'rgba(255, 255, 255, 0.3)';

                if (isCompleted) {
                  iconColor = 'var(--status-green)';
                  textColor = 'var(--text-main)';
                  descColor = 'var(--text-muted)';
                } else if (isActive) {
                  iconColor = 'var(--accent-blue)';
                  textColor = 'var(--text-main)';
                  descColor = 'var(--text-muted)';
                }

                return (
                  <div key={index} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', opacity: isPending ? 0.45 : 1, transition: 'opacity 0.25s ease' }}>
                    <div style={{ marginTop: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {isCompleted ? (
                        <CheckCircle2 size={15} style={{ color: iconColor }} />
                      ) : isActive ? (
                        <Loader2 size={15} className="spin-animation" style={{ color: iconColor }} />
                      ) : (
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', border: `1.5px solid ${iconColor}`, margin: '3px' }} />
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '13px', fontWeight: isActive ? 600 : 500, color: textColor }}>
                        {step.title}
                      </span>
                      <span style={{ fontSize: '11px', color: descColor, lineHeight: 1.3 }}>
                        {step.desc}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {importSummary && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                paddingTop: '20px',
                marginTop: '4px'
              }}>
                <div style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.06)',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  fontSize: '13px',
                  color: 'var(--text-main)',
                  lineHeight: 1.5
                }}>
                  Imported <strong>{importSummary.devices_imported}</strong> devices/templates and <strong>{importSummary.topologies_imported}</strong> network topologies.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button 
                    type="button"
                    className="btn-secondary btn-sm" 
                    onClick={() => {
                      setIsImporting(false);
                    }}
                  >
                    Done
                  </button>
                  <button 
                    type="button"
                    className="btn-primary btn-sm" 
                    onClick={() => {
                      setIsImporting(false);
                      onNavigate('System', 'Database Browser');
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    Open Database Browser <ExternalLink size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
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
