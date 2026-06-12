import React, { useState, useRef } from 'react';
import { Upload, Download, CheckCircle, Loader2, Database, Trash2, CheckCircle2, Copy, FileText, ArrowRight, X } from 'lucide-react';
import { CanopyApiClient } from '../api/client';
import { 
    CHUNK_SIZE, 
    LINE_BREAK, 
    CSV_SPLIT_REGEX, 
    parseLine, 
    processChunkData, 
    unparseData,
    outputFieldnames,
    guessMapping,
    createMappingFromSelection
} from '../utils/paLogProcessor';

interface LogImporterProps {
  auth: { url: string; token: string } | null;
  onSuccess?: () => void;
}

export const LogImporter: React.FC<LogImporterProps> = ({ auth, onSuccess }) => {
    const [status, setStatus] = useState("Ready to process logs.");
    const [stats, setStats] = useState({ files: 0, rows: 0 });
    const [isProcessing, setIsProcessing] = useState(false);
    const [processedFiles, setProcessedFiles] = useState<string[]>([]);
    const [progress, setProgress] = useState(0);
    const [copied, setCopied] = useState(false);
    
    // Mapping State
    const [showMapper, setShowMapper] = useState(false);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
    const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
    
    const processedDataMap = useRef(new Map<string, any>());

    const effectiveFields = outputFieldnames;

    const updateStatus = (msg: string) => setStatus(msg);

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!event.target.files) return;
        const files = Array.from(event.target.files);
        event.target.value = '';
        if (files.length === 0) return;

        const firstFile = files[0];
        if (!firstFile.name.toLowerCase().endsWith('.csv')) {
            updateStatus("First file must be a CSV to detect columns.");
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result as string;
                const lines = text.split(LINE_BREAK);
                const firstLine = lines[0];
                let headers = firstLine.split(CSV_SPLIT_REGEX).map(h => h.replace(/""/g, '').trim());
                
                if (!headers || headers.length === 0 || (headers.length === 1 && !headers[0])) {
                    updateStatus("Could not detect headers in the file.");
                    return;
                }
                
                setDetectedHeaders(headers);
                setColumnMapping(guessMapping(headers, effectiveFields));
                setPendingFiles(files);
                setShowMapper(true);
                updateStatus("Please verify column mapping.");
            } catch (error) {
                console.error("Error processing file headers:", error);
                updateStatus("Error processing file.");
            }
        };
        reader.onerror = () => {
            updateStatus("Error reading file.");
        };
        reader.readAsText(firstFile.slice(0, 64 * 1024));
    };

    const startProcessing = async () => {
        setShowMapper(false);
        setIsProcessing(true);
        updateStatus(`Queued ${pendingFiles.length} file(s)...`);

        for (const file of pendingFiles) {
            if (!file.name.toLowerCase().endsWith('.csv')) {
                updateStatus(`Skipping non-CSV: ${file.name}`);
                continue;
            }
            await processFileInChunks(file, columnMapping);
        }

        setIsProcessing(false);
        setProgress(100);
        setPendingFiles([]);
        updateStatus("Processing complete.");
    };

    const handleMappingChange = (field: string, header: string) => {
        setColumnMapping(prev => ({
            ...prev,
            [field]: header
        }));
    };

    const cancelImport = () => {
        setShowMapper(false);
        setPendingFiles([]);
        updateStatus("Import cancelled.");
    };

    const handleClear = () => {
        processedDataMap.current.clear();
        setProcessedFiles([]);
        setStats({ files: 0, rows: 0 });
        setStatus("Ready to process logs.");
        setPendingFiles([]);
        setDetectedHeaders([]);
        setColumnMapping({});
        setProgress(0);
    };

    const processFileInChunks = (file: File, userMapping: Record<string, string>) => {
        return new Promise<void>((resolve, reject) => {
            let offset = 0;
            let partialLine = "";
            let fileHeaders: string[] = [];
            let headerMapping: Record<number, string> = {};
            const reader = new FileReader();

            reader.onload = (e) => {
                const chunkText = partialLine + (e.target?.result as string);
                const lines = chunkText.split(LINE_BREAK);
                partialLine = "";

                const isLastChunk = offset + CHUNK_SIZE >= file.size;
                if (!isLastChunk && !chunkText.endsWith('\n')) {
                    partialLine = lines.pop() || "";
                }

                let startLineIndex = 0;
                
                if (fileHeaders.length === 0 && lines.length > 0) {
                    const rawHeaders = lines[0].split(CSV_SPLIT_REGEX);
                    fileHeaders = rawHeaders.map(h => h.replace(/""/g, '').trim());
                    
                    headerMapping = createMappingFromSelection(fileHeaders, userMapping);
                    startLineIndex = 1;
                }

                const rawRows: string[][] = [];
                for (let i = startLineIndex; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    const row = parseLine(line, fileHeaders);
                    if (row) rawRows.push(row);
                }

                const processedChunk = processChunkData(rawRows, headerMapping, effectiveFields);
                aggregateToGlobalMap(processedChunk);

                offset += CHUNK_SIZE;
                if (offset < file.size) {
                    const currentProgress = Math.floor((offset / file.size) * 100);
                    setProgress(currentProgress);
                    updateStatus(`Processing ${file.name} (${currentProgress}%)...`);
                    
                    const blob = file.slice(offset, offset + CHUNK_SIZE);
                    reader.readAsText(blob);
                } else {
                    setProcessedFiles(prev => [...prev, file.name]);
                    setStats(prev => ({
                        files: prev.files + 1,
                        rows: processedDataMap.current.size
                    }));
                    resolve();
                }
            };

            reader.onerror = (err) => {
                console.error(err);
                reject(err);
            };

            const blob = file.slice(0, CHUNK_SIZE);
            reader.readAsText(blob);
        });
    };

    const aggregateToGlobalMap = (rows: any[]) => {
        const metricFields = ['Bytes', 'Bytes Sent', 'Bytes Received', 'Packets', 'Packets Sent', 'Packets Received'];
        for (const row of rows) {
            const count = row['Count'];
            const rowKey = effectiveFields
                .filter(name => name !== 'Count' && !metricFields.includes(name) && row[name] !== undefined)
                .map(name => row[name])
                .join('|');

            const existing = processedDataMap.current.get(rowKey);
            if (existing) {
                existing['Count'] = (parseFloat(existing['Count']) || 0) + (parseFloat(count) || 0);
                metricFields.forEach(m => {
                    existing[m] = (parseFloat(existing[m]) || 0) + (parseFloat(row[m]) || 0);
                });
                processedDataMap.current.set(rowKey, existing);
            } else {
                processedDataMap.current.set(rowKey, row);
            }
        }
    };

    const handleCopyToClipboard = async () => {
        const data = Array.from(processedDataMap.current.values());
        const csvString = unparseData(data, effectiveFields);
        try {
            await navigator.clipboard.writeText(csvString);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            const textArea = document.createElement("textarea");
            textArea.value = csvString;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand("copy");
            document.body.removeChild(textArea);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleExport = () => {
        const data = Array.from(processedDataMap.current.values());
        const csv = unparseData(data, effectiveFields);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "processed_logs.csv";
        link.click();
    };

    const handleImportToApp = async () => {
        if (!auth) return;
        setIsProcessing(true);
        updateStatus("Uploading to database...");
        try {
            const data = Array.from(processedDataMap.current.values());
            const csv = unparseData(data, effectiveFields);
            const blob = new Blob([csv], { type: 'text/csv' });
            const file = new File([blob], "processed_logs.csv", { type: "text/csv" });

            const formData = new FormData();
            formData.append('file', file);

            const client = new CanopyApiClient(auth);
            await client.importLogs('global', formData);
            
            updateStatus("Import complete.");
            if (onSuccess) onSuccess();
        } catch (err: any) {
            console.error(err);
            updateStatus(`Import failed: ${err.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const isDragging = false; // Add drop logic here if needed

    if (showMapper) {
        return (
            <div style={{ width: '100%', maxWidth: '800px', margin: '0 auto', backgroundColor: 'var(--bg-surface)', padding: '30px', borderRadius: '12px', border: '1px solid var(--border-main)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>Map Columns</h2>
                    <button onClick={cancelImport} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
                </div>
                <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px' }}>
                    We detected the following columns from <strong>{pendingFiles[0]?.name}</strong>. Please verify the mapping below.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '24px', maxHeight: '400px', overflowY: 'auto', paddingRight: '10px' }}>
                    {effectiveFields.map(field => (
                        <div key={field} style={{ backgroundColor: 'var(--bg-app)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-main)' }}>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px', color: 'var(--text-muted)' }}>{field}</label>
                            <select 
                                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-main)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '13px' }}
                                value={columnMapping[field] || ''}
                                onChange={(e) => handleMappingChange(field, e.target.value)}
                            >
                                <option value="">(Skip / Not Found)</option>
                                {detectedHeaders.map((h, i) => (
                                    <option key={i} value={h}>{h}</option>
                                ))}
                            </select>
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '16px', borderTop: '1px solid var(--border-main)' }}>
                    <button onClick={cancelImport} className="btn-secondary">Cancel</button>
                    <button onClick={startProcessing} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Start Processing <ArrowRight size={16} />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ width: '100%', maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ marginBottom: '8px' }}>
                <h1 style={{ fontSize: '28px', fontWeight: 600, color: 'var(--text-main)', margin: '0 0 8px 0' }}>Log Import</h1>
                <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
                    Import and normalize Palo Alto Networks firewall logs. Logs are automatically deduplicated and aggregated against the existing database.
                </p>
            </div>

            <div style={{ backgroundColor: 'var(--bg-surface)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-main)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>Log Import & Processor</h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                    Drag and drop raw Palo Alto logs here. They will be normalized and deduplicated automatically.
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

                {isProcessing && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)' }}>
                            <span>Progress</span>
                            <span>{progress}%</span>
                        </div>
                        <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--bg-app)', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ width: `${progress}%`, height: '100%', backgroundColor: 'var(--accent-blue)', transition: 'width 0.3s ease' }} />
                        </div>
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                    <div style={{ backgroundColor: 'var(--bg-app)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>Files</div>
                        <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-main)' }}>{stats.files}</div>
                    </div>
                    <div style={{ backgroundColor: 'var(--bg-app)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>Unique Rows</div>
                        <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-main)' }}>{stats.rows.toLocaleString()}</div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                    <button 
                        onClick={handleImportToApp}
                        disabled={stats.rows === 0 || isProcessing}
                        className="btn-primary"
                        style={{ flex: 1, padding: '12px', fontSize: '14px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', opacity: (stats.rows === 0 || isProcessing) ? 0.5 : 1 }}
                    >
                        <Database size={18} /> Import to App
                    </button>
                    <button 
                        onClick={handleCopyToClipboard}
                        disabled={stats.rows === 0 || isProcessing}
                        className="btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: (stats.rows === 0 || isProcessing) ? 0.5 : 1 }}
                    >
                        {copied ? <CheckCircle2 size={16} color="var(--status-green)" /> : <Copy size={16} />} {copied ? 'Copied!' : 'Copy CSV'}
                    </button>
                    <button 
                        onClick={handleExport}
                        disabled={stats.rows === 0 || isProcessing}
                        className="btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: (stats.rows === 0 || isProcessing) ? 0.5 : 1 }}
                    >
                        <Download size={16} /> Download CSV
                    </button>
                    <button 
                        onClick={handleClear}
                        disabled={stats.rows === 0 && processedFiles.length === 0 && !isProcessing}
                        className="btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-red)', borderColor: 'rgba(239, 68, 68, 0.3)', opacity: (stats.rows === 0 && processedFiles.length === 0 && !isProcessing) ? 0.5 : 1 }}
                    >
                        <Trash2 size={16} /> Clear
                    </button>
                </div>

                {processedFiles.length > 0 && (
                    <div style={{ marginTop: '16px' }}>
                        <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>Processed Files</h3>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '100px', overflowY: 'auto' }}>
                            {processedFiles.map((file, idx) => (
                                <li key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-main)', marginBottom: '4px' }}>
                                    <CheckCircle size={14} color="var(--status-green)" /> {file}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
};
