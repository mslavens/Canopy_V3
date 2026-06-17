import React, { useState, useEffect, useMemo } from 'react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { SearchBar } from '../components/SearchBar';
import { Network, Loader2 } from 'lucide-react';

interface ZonesPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const ZonesPage: React.FC<ZonesPageProps> = ({ auth, addToast }) => {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [zones, setZones] = useState<any[]>([]);

  const apiClient = useMemo(() => (auth ? new CanopyApiClient(auth) : null), [auth]);

  const fetchZones = async () => {
    if (!apiClient) return;
    try {
      setLoading(true);
      const res = await apiClient.getNetworksZones();
      setZones(res || []);
    } catch (err) {
      console.error('Failed to load zones:', err);
      addToast(err instanceof Error ? err.message : 'Failed to query network zones.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchZones();
  }, [apiClient]);

  const columns: ColumnDef[] = useMemo(
    () => [
      { key: 'scope', label: 'Context / Scope' },
      { key: 'name', label: 'Zone Name' },
      { key: 'type', label: 'Type' },
    ],
    []
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      <PageHeader
        title="Security Zones"
        description="Inspect security zones mapped to local devices and templates."
        actions={<SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search zones..." variant="local" />}
      />

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
            Loading security zones...
          </div>
        ) : zones.length > 0 ? (
          <DataTable
            columns={columns}
            data={zones}
            searchQuery={searchQuery}
            exportFilename={`canopy_zones_${new Date().toISOString().slice(0, 10)}.csv`}
          />
        ) : (
          <EmptyState
            icon={<Network size={32} />}
            title="No Zones Configured"
            description="No zones found in the database. Ensure XML imports have completed successfully."
            minHeight="300px"
          />
        )}
      </div>
    </div>
  );
};
