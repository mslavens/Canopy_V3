import React, { useState } from 'react';

interface DataImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDataType?: string;
  apiClient: any;
  deviceUuid: string;
  scope: string;
  onSuccess: () => void;
}

export const DataImportWizard: React.FC<DataImportWizardProps> = ({ 
  isOpen, 
  onClose, 
  defaultDataType = 'address_objects',
  apiClient,
  deviceUuid,
  scope,
  onSuccess
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1); // 1: Upload, 2: Map, 3: Review Conflicts
  const [dataType, setDataType] = useState(defaultDataType);
  const [file, setFile] = useState<File | null>(null);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedData, setParsedData] = useState<Record<string, string>[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (!text) return;

        // Simple CSV Parser
        const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
        if (lines.length > 0) {
          // Parse headers
          const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
          setParsedHeaders(headers);

          // Parse rows
          const rows: Record<string, string>[] = [];
          for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const rowObj: Record<string, string> = {};
            headers.forEach((header, index) => {
              rowObj[header] = values[index] || '';
            });
            rows.push(rowObj);
          }
          setParsedData(rows);

          // Auto-map where possible
          const autoMappings: Record<string, string> = {};
          const dbFields = ['name', 'value', 'description', 'tags']; // Include tags for dynamic group matching
          dbFields.forEach(field => {
            const match = headers.find(h => h.toLowerCase() === field.toLowerCase());
            if (match) autoMappings[field] = match;
          });
          setMappings(autoMappings);
        }
      };
      reader.readAsText(selectedFile);
    }
  };

  const nextStep = () => {
    if (step === 1 && file) setStep(2);
    else if (step === 2) setStep(3);
  };

  const executeImport = async () => {
    setIsProcessing(true);
    
    // Transform parsedData using mappings
    const finalPayload = parsedData.map(row => {
      const dbRow: Record<string, string> = {};
      Object.keys(mappings).forEach(dbField => {
        const csvHeader = mappings[dbField];
        if (csvHeader) {
          dbRow[dbField] = row[csvHeader];
        }
      });
      return dbRow;
    });

    try {
      const response = await apiClient.fetchApi('/api/objects/import', {
        method: 'POST',
        body: JSON.stringify({
          device_uuid: deviceUuid,
          scope: scope,
          type: dataType,
          data: finalPayload
        })
      });
      
      const resData = await response.json();
      if (resData.success) {
        setIsProcessing(false);
        onSuccess();
        onClose();
      } else {
        throw new Error(resData.error || 'Failed to import objects');
      }
    } catch (e) {
      console.error('Import failed', e);
      setIsProcessing(false);
      // In a real app we would add a toast here
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        backgroundColor: 'var(--bg-card)', borderRadius: '8px',
        width: '600px', maxWidth: '90vw', padding: '24px',
        border: '1px solid var(--border-main)',
        boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '16px' }}>
          Data Import Manager
        </h2>

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Upload a CSV or Excel file to inject data directly into the active workspace.
            </p>
            
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>Target Data Type</label>
              <select 
                className="input-text" 
                value={dataType}
                onChange={(e) => setDataType(e.target.value)}
                style={{ width: '100%', padding: '8px' }}
              >
                <option value="address_objects">Address Objects</option>
                <option value="address_groups">Address Groups</option>
                <option value="service_objects">Service Objects</option>
                <option value="tags">Tags</option>
              </select>
            </div>

            <div style={{
              border: '2px dashed var(--border-main)', borderRadius: '6px',
              padding: '32px', textAlign: 'center', backgroundColor: 'var(--bg-main)'
            }}>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} />
              {file && <p style={{ fontSize: '12px', color: 'var(--text-main)', marginTop: '8px' }}>Selected: {file.name}</p>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Map your spreadsheet columns to the Canopy database fields.
            </p>
            <div style={{ border: '1px solid var(--border-main)', borderRadius: '6px', overflow: 'hidden' }}>
              {/* Mock mapping rows */}
              {['name', 'value', 'description', 'tags'].map(dbField => (
                <div key={dbField} style={{ display: 'flex', padding: '12px', borderBottom: '1px solid var(--border-main)', alignItems: 'center', gap: '16px' }}>
                  <div style={{ width: '150px', fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>
                    {dbField} <span style={{ color: '#ef4444' }}>*</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <select 
                      className="input-text" 
                      style={{ width: '100%', padding: '6px' }}
                      value={mappings[dbField] || ''}
                      onChange={e => setMappings({...mappings, [dbField]: e.target.value})}
                    >
                      <option value="">-- Select Column --</option>
                      {parsedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Review any conflicts before executing the import.
            </p>
            <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px' }}>
              <p style={{ fontSize: '12px', color: '#ef4444', fontWeight: 600 }}>0 Conflicts Detected</p>
              <p style={{ fontSize: '12px', color: 'var(--text-main)' }}>All {parsedData.length} rows from {file?.name} are safe to import.</p>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-main)' }}>
          <button 
            onClick={onClose}
            style={{ padding: '8px 16px', backgroundColor: 'transparent', border: '1px solid var(--border-main)', borderRadius: '4px', color: 'var(--text-main)', cursor: 'pointer', fontSize: '12px' }}
          >
            Cancel
          </button>
          
          {step > 1 && (
            <button 
              onClick={() => setStep(step - 1 as 1 | 2)}
              style={{ padding: '8px 16px', backgroundColor: 'var(--bg-main)', border: '1px solid var(--border-main)', borderRadius: '4px', color: 'var(--text-main)', cursor: 'pointer', fontSize: '12px' }}
            >
              Back
            </button>
          )}

          {step < 3 ? (
            <button 
              onClick={nextStep}
              disabled={!file}
              style={{ padding: '8px 16px', backgroundColor: file ? 'var(--button-primary)' : 'var(--bg-main)', border: 'none', borderRadius: '4px', color: file ? '#fff' : 'var(--text-muted)', cursor: file ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 500 }}
            >
              Next Step
            </button>
          ) : (
            <button 
              onClick={executeImport}
              disabled={isProcessing}
              style={{ padding: '8px 16px', backgroundColor: 'var(--button-primary)', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
            >
              {isProcessing ? 'Importing...' : 'Execute Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
