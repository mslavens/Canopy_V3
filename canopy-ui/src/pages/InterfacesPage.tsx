import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CanopyApiClient } from '../api/client';
import { FileInput } from '../components/FileInput';
import { DataTable, ColumnDef } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { SearchBar } from '../components/SearchBar';
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

  const apiClient = useMemo(() => (auth ? new CanopyApiClient(auth) : null), [auth]);

  const fetchInterfaces = async () => {
    if (!apiClient) return;
    try {
      setLoading(true);
      const res = await apiClient.queryDb(`
        SELECT t.interface_name, t.network_cidr, t.zone_name, t.vendor_metadata, d.name AS device_name, 'PaloAlto' AS vendor 
        FROM network_topology t 
        JOIN scopes d ON t.device_uuid = d.uuid 
        ORDER BY d.name ASC, t.interface_name ASC
      `);
      setInterfaces(res.rows || []);
    } catch (err) {
      console.error('Failed to load interfaces:', err);
      addToast(err instanceof Error ? err.message : 'Failed to query network interfaces.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInterfaces();
  }, [apiClient]);

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
      { key: 'device_name', label: 'Device / Template Context' },
      { key: 'interface_name', label: 'Interface' },
      { key: 'network_cidr', label: 'Network CIDR' },
      { key: 'zone_name', label: 'Security Zone' },
      {
        key: 'vr',
        label: 'Virtual Router',
        renderCell: (_val: any, row: any) => {
          try {
            const meta = JSON.parse(row.vendor_metadata || '{}');
            return meta.vr || 'default';
          } catch {
            return 'default';
          }
        },
      },
      {
        key: 'tags',
        label: 'Metadata Tags',
        renderCell: (_val: any, row: any) => {
          try {
            const meta = JSON.parse(row.vendor_metadata || '{}');
            return (meta.tags || []).join(', ');
          } catch {
            return '-';
          }
        },
      },
    ],
    []
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      <PageHeader
        title="Network Interfaces"
        description="Inspect zones, subnets, and virtual routers. Upload configuration XMLs to import new devices and topologies."
        actions={<SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search interfaces..." variant="local" />}
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
            title="No Interfaces Configured"
            description="Import a standalone Palo Alto Firewall running configuration or a Panorama export to begin network path analysis."
            minHeight="300px"
          />
        )}
      </div>
    </div>
  );
};
