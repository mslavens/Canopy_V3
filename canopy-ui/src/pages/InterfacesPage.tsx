import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CanopyApiClient } from '../api/client';
import { FileInput } from '../components/FileInput';
import { DataTable, ColumnDef } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { SearchBar } from '../components/SearchBar';
import { SearchableScopeDropdown } from '../components/SearchableScopeDropdown';
import { useTemplateHierarchy } from '../hooks/useTemplateHierarchy';
import { Upload, Network, AlertTriangle, Loader2 } from 'lucide-react';

interface InterfacesPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const InterfacesPage: React.FC<InterfacesPageProps> = ({ auth, addToast }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [interfaces, setInterfaces] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [templates, setTemplates] = useState<any[]>([]);
  const [templateStacks, setTemplateStacks] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [selectedScopeUuid, setSelectedScopeUuid] = useState<string>('show-all');

  const apiClient = useMemo(() => (auth ? new CanopyApiClient(auth) : null), [auth]);

  useEffect(() => {
    let isMounted = true;
    const loadScopes = async () => {
      if (!apiClient) return;
      try {
        const tmplRes = await apiClient.queryDb("SELECT id, uuid, name FROM templates ORDER BY name ASC;");
        const stackRes = await apiClient.queryDb("SELECT id, uuid, name FROM template_stacks ORDER BY name ASC;");
        const fwRes = await apiClient.queryDb("SELECT m.id, s.uuid, m.serial, m.name, m.template_stack_id, m.template_id FROM managed_devices_raw m JOIN scopes s ON m.device_uuid = s.uuid ORDER BY m.name ASC;");
        
        if (isMounted) {
          setTemplates(tmplRes?.rows || []);
          setTemplateStacks(stackRes?.rows || []);
          setDevices(fwRes?.rows || []);
        }
      } catch (err) {
        console.error("Failed to load scopes", err);
      }
    };
    loadScopes();
    return () => { isMounted = false; };
  }, [apiClient]);

  const { hierarchyOptions, scopeNameMap } = useTemplateHierarchy(templates, templateStacks, devices, {
    includeShowAll: true,
    firewallValueKey: 'uuid'
  });

  const fetchInterfaces = async () => {
    if (!apiClient) return;
    try {
      setLoading(true);
      const uuidToQuery = selectedScopeUuid === 'show-all' ? undefined : selectedScopeUuid;
      const res = await apiClient.getNetworksInterfaces(uuidToQuery);
      setInterfaces(res || []);
    } catch (err) {
      console.error('Failed to load interfaces:', err);
      addToast(err instanceof Error ? err.message : 'Failed to query network interfaces.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInterfaces();
  }, [apiClient, selectedScopeUuid]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      if (!selected.name.endsWith('.xml')) {
        addToast('Invalid file format. Please select a Palo Alto configuration XML file.', 'error');
        e.target.value = '';
        setFile(null);
        return;
      }
      setFile(selected);
    } else {
      setFile(null);
    }
  };

  const handleImport = async () => {
    if (!file || !apiClient) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('xml', file);

      const res = await apiClient.importDeviceXml(formData);
      addToast(
        `Imported ${res.devices_imported} device(s) and ${res.topologies_imported} interface route(s) successfully.`,
        'success'
      );

      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      await fetchInterfaces();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to import XML file.', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const columns: ColumnDef[] = useMemo(
    () => [
      { 
        key: 'device_uuid', 
        label: 'Context / Scope', 
        width: '250px',
        renderCell: (val: any) => scopeNameMap[val] || val
      },
      { key: 'name', label: 'Interface', width: '200px' },
      { key: 'type', label: 'Type', width: '150px' },
      { key: 'ip_address', label: 'IP Address', width: '200px' },
      { key: 'zone', label: 'Security Zone', width: '200px' },
      { key: 'vr_name', label: 'Virtual Router', width: '200px' },
    ],
    [scopeNameMap]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      <PageHeader
        title="Network Interfaces"
        description="Inspect zones, subnets, and virtual routers mapped to local devices and templates."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)' }}>Context:</span>
              <div style={{ width: '250px' }}>
                <SearchableScopeDropdown
                  value={selectedScopeUuid}
                  options={hierarchyOptions}
                  onChange={setSelectedScopeUuid}
                  scopeNameMap={scopeNameMap}
                />
              </div>
            </div>
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search interfaces..." variant="local" />
          </div>
        }
      />

      {/* Upload Panel */}
      <section
        style={{
          backgroundColor: 'var(--bg-surface)',
          padding: '25px',
          borderRadius: '8px',
          border: '1px solid var(--border-main)',
          display: 'flex',
          flexDirection: 'column',
          gap: '15px',
        }}
      >
        <div>
          <h3 style={{ margin: '0 0 6px 0', fontSize: '15px', color: 'var(--accent-blue)', fontWeight: 600 }}>
            Palo Alto XML Config Ingestion
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Upload a Palo Alto Firewall running configuration XML or a Panorama template export to extract security zones, interfaces, and CIDR subnet configurations.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
          <FileInput ref={fileInputRef} file={file} onChange={handleFileChange} accept=".xml" disabled={isUploading} />
          <button className="btn-primary" onClick={handleImport} disabled={!file || isUploading}>
            {isUploading ? 'Ingesting XML...' : 'Import Configuration'}
          </button>
        </div>
      </section>

      {/* Main Grid */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div
            className="fade-in-delayed"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '13px',
              gap: '15px',
              minHeight: '300px',
            }}
          >
            <Loader2 size={24} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />
            Loading network interfaces...
          </div>
        ) : interfaces.length > 0 ? (
          <DataTable
            columns={columns}
            data={interfaces}
            searchQuery={searchQuery}
            exportFilename={`canopy_interfaces_${new Date().toISOString().slice(0, 10)}.csv`}
          />
        ) : (
          <EmptyState
            icon={<Network size={32} />}
            title="No Interfaces Found"
            description="No interfaces found for the selected scope context. Try selecting a different device or template stack."
            minHeight="300px"
          />
        )}
      </div>
    </div>
  );
};
