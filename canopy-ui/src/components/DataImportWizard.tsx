import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

interface DataImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDataType?: string;
  apiClient: any;
  deviceUuid: string;
  scope: string;
  onSuccess: () => void;
  availableDataTypes?: { value: string; label: string }[];
}

const dbFieldsMap: Record<string, string[]> = {
  address_objects: ['name', 'value', 'description', 'tags'],
  address_groups: ['name', 'type', 'description'],
  service_objects: ['name', 'protocol', 'destination_port', 'description'],
  service_groups: ['name', 'description'],
  tags: ['name', 'color', 'comments'],
  devices: ['name', 'serial', 'ip_address', 'device_group', 'template_stack', 'template'],
  device_groups: ['name', 'description'],
  templates: ['name', 'description'],
  template_stacks: ['name', 'description'],
  zones: ['name', 'type'],
  interfaces: ['name', 'type', 'ip_address', 'zone', 'vr_name', 'description'],
  static_routes: ['vr_name', 'route_name', 'destination', 'nexthop', 'interface', 'metric'],
  variables: ['name', 'type', 'value', 'description']
};

const fieldLabelsMap: Record<string, string> = {
  name: 'Name',
  value: 'Value',
  description: 'Description',
  tags: 'Tags (comma separated)',
  serial: 'Serial Number',
  ip_address: 'IP Address / CIDR',
  device_group: 'Device Group',
  template_stack: 'Template Stack',
  template: 'Template',
  type: 'Type',
  protocol: 'Protocol (tcp/udp)',
  destination_port: 'Destination Port',
  color: 'Color Name',
  comments: 'Comments',
  vr_name: 'Virtual Router',
  route_name: 'Route Name',
  destination: 'Destination Network (CIDR)',
  nexthop: 'Next Hop IP',
  interface: 'Interface Name',
  metric: 'Metric (Numeric)'
};

const requiredFieldsMap: Record<string, string[]> = {
  address_objects: ['name', 'value'],
  address_groups: ['name'],
  service_objects: ['name', 'protocol', 'destination_port'],
  service_groups: ['name'],
  tags: ['name'],
  devices: ['name', 'serial'],
  device_groups: ['name'],
  templates: ['name'],
  template_stacks: ['name'],
  zones: ['name'],
  interfaces: ['name'],
  static_routes: ['route_name', 'destination'],
  variables: ['name', 'value']
};

export const DataImportWizard: React.FC<DataImportWizardProps> = ({ 
  isOpen, 
  onClose, 
  defaultDataType = 'address_objects',
  apiClient,
  deviceUuid,
  scope,
  onSuccess,
  availableDataTypes
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1); // 1: Upload, 2: Map, 3: Review
  const [dataType, setDataType] = useState(defaultDataType);
  const [file, setFile] = useState<File | null>(null);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedData, setParsedData] = useState<Record<string, string>[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setDataType(defaultDataType);
  }, [defaultDataType]);

  const targetFields = dbFieldsMap[dataType] || ['name', 'value', 'description'];
  const requiredFields = requiredFieldsMap[dataType] || ['name'];

  // Smart Auto-mapping logic when dataType or headers change
  useEffect(() => {
    if (parsedHeaders.length > 0) {
      const autoMappings: Record<string, string> = {};
      targetFields.forEach(field => {
        const match = parsedHeaders.find(h => {
          const cleanH = h.toLowerCase().replace(/[\s_-]/g, '');
          const cleanField = field.toLowerCase().replace(/[\s_-]/g, '');
          return cleanH === cleanField || 
                 (field === 'route_name' && (cleanH === 'name' || cleanH === 'routename')) ||
                 (field === 'ip_address' && (cleanH === 'ip' || cleanH === 'address' || cleanH === 'ipaddress' || cleanH === 'mgmtip'));
        });
        if (match) autoMappings[field] = match;
      });
      setMappings(autoMappings);
    }
  }, [dataType, parsedHeaders]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage('');
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (!text) return;

        // Clean up simple CSV parsing
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(line => line !== '');
        if (lines.length > 0) {
          const parseCSVLine = (line: string) => {
            const result = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              if (char === '"') {
                inQuotes = !inQuotes;
              } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
              } else {
                current += char;
              }
            }
            result.push(current.trim());
            return result;
          };

          const headers = parseCSVLine(lines[0]);
          setParsedHeaders(headers);

          const rows: Record<string, string>[] = [];
          for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            const rowObj: Record<string, string> = {};
            headers.forEach((header, index) => {
              rowObj[header] = values[index] || '';
            });
            rows.push(rowObj);
          }
          setParsedData(rows);
        } else {
          setErrorMessage('The CSV file appears to be empty.');
        }
      };
      reader.readAsText(selectedFile);
    }
  };

  const nextStep = () => {
    if (step === 1 && file) {
      setStep(2);
    } else if (step === 2) {
      // Validate that all required fields have a mapping selected
      const missing = requiredFields.filter(f => !mappings[f]);
      if (missing.length > 0) {
        setErrorMessage(`Please map all required fields: ${missing.map(f => fieldLabelsMap[f] || f).join(', ')}`);
        return;
      }
      setErrorMessage('');
      setStep(3);
    }
  };

  const executeImport = async () => {
    setIsProcessing(true);
    setErrorMessage('');
    
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
        // Reset state
        setStep(1);
        setFile(null);
        setParsedHeaders([]);
        setParsedData([]);
        setMappings({});
      } else {
        throw new Error(resData.error || 'Failed to import records');
      }
    } catch (e: any) {
      console.error('Import failed', e);
      setIsProcessing(false);
      setErrorMessage(e.message || 'Import failed. Check console for details.');
    }
  };

  const typesToRender = availableDataTypes || [
    { value: 'address_objects', label: 'Address Objects' },
    { value: 'address_groups', label: 'Address Groups' },
    { value: 'service_objects', label: 'Service Objects' },
    { value: 'service_groups', label: 'Service Groups' },
    { value: 'tags', label: 'Tags' }
  ];

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 3000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        backgroundColor: 'var(--bg-surface)', borderRadius: '8px',
        width: '600px', maxWidth: '90vw', padding: '30px',
        border: '1px solid var(--border-main)',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)'
      }}>
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px' }}>
          Data Import Manager
        </h2>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '24px' }}>
          Step {step} of 3: {step === 1 ? 'Upload File' : step === 2 ? 'Map Columns' : 'Confirm Import'}
        </div>

        {errorMessage && (
          <div style={{ padding: '12px 16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--status-red)', borderRadius: '6px', color: 'var(--status-red)', fontSize: '13px', marginBottom: '20px' }}>
            {errorMessage}
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', display: 'block', marginBottom: '8px' }}>Target Data Type</label>
              <select 
                className="input-text" 
                value={dataType}
                onChange={(e) => setDataType(e.target.value)}
                style={{ width: '100%', padding: '10px' }}
              >
                {typesToRender.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div style={{
              border: '2px dashed var(--border-main)', borderRadius: '6px',
              padding: '40px 20px', textAlign: 'center', backgroundColor: 'var(--bg-app)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px'
            }}>
              <input type="file" accept=".csv" onChange={handleFileChange} style={{ fontSize: '13px', cursor: 'pointer' }} />
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Only CSV format is currently supported.</p>
              {file && <p style={{ fontSize: '13px', color: '#34d399', fontWeight: 500, marginTop: '8px' }}>Selected file: {file.name}</p>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              Map your spreadsheet columns to the Canopy database fields. Auto-matched columns are preselected.
            </p>
            <div style={{ border: '1px solid var(--border-main)', borderRadius: '6px', overflowY: 'auto', maxHeight: '300px' }}>
              {targetFields.map(dbField => {
                const isRequired = requiredFields.includes(dbField);
                return (
                  <div key={dbField} style={{ display: 'flex', padding: '12px 16px', borderBottom: '1px solid var(--border-main)', alignItems: 'center', gap: '16px' }}>
                    <div style={{ width: '180px', fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>
                      {fieldLabelsMap[dbField] || dbField} {isRequired && <span style={{ color: 'var(--status-red)' }}>*</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <select 
                        className="input-text" 
                        style={{ width: '100%', padding: '8px' }}
                        value={mappings[dbField] || ''}
                        onChange={e => setMappings({...mappings, [dbField]: e.target.value})}
                      >
                        <option value="">-- Select Column --</option>
                        {parsedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              Review the summary before executing the import transaction.
            </p>
            <div style={{ padding: '16px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '13px', color: 'var(--text-main)' }}>
                <strong>File:</strong> {file?.name}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-main)' }}>
                <strong>Type:</strong> {typesToRender.find(t => t.value === dataType)?.label || dataType}
              </div>
              <div style={{ fontSize: '13px', color: '#34d399', fontWeight: 600 }}>
                {parsedData.length} records ready to import.
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '30px', paddingTop: '16px', borderTop: '1px solid var(--border-main)' }}>
          <button 
            onClick={onClose}
            className="btn-secondary btn-md"
            disabled={isProcessing}
          >
            Cancel
          </button>
          
          {step > 1 && (
            <button 
              onClick={() => setStep(step - 1 as 1 | 2)}
              className="btn-secondary btn-md"
              disabled={isProcessing}
            >
              Back
            </button>
          )}

          {step < 3 ? (
            <button 
              onClick={nextStep}
              disabled={!file}
              className="btn-primary btn-md"
              style={{ minWidth: '100px' }}
            >
              Next Step
            </button>
          ) : (
            <button 
              onClick={executeImport}
              disabled={isProcessing}
              className="btn-primary btn-md"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '130px', justifyContent: 'center' }}
            >
              {isProcessing ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Importing...
                </>
              ) : 'Execute Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
