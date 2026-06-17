import React, { useState, useEffect, useMemo } from 'react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { SearchBar } from '../components/SearchBar';
import { Waypoints, Loader2 } from 'lucide-react';

interface RouteTablePageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const RouteTablePage: React.FC<RouteTablePageProps> = ({ auth, addToast }) => {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [routes, setRoutes] = useState<any[]>([]);

  const apiClient = useMemo(() => (auth ? new CanopyApiClient(auth) : null), [auth]);

  const fetchRoutes = async () => {
    if (!apiClient) return;
    try {
      setLoading(true);
      const res = await apiClient.getNetworksRoutes();
      setRoutes(res || []);
    } catch (err) {
      console.error('Failed to load routes:', err);
      addToast(err instanceof Error ? err.message : 'Failed to query routing tables.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoutes();
  }, [apiClient]);

  const columns: ColumnDef[] = useMemo(
    () => [
      { key: 'vr_name', label: 'Virtual Router' },
      { key: 'route_name', label: 'Route Name' },
      { key: 'destination', label: 'Destination' },
      { key: 'nexthop', label: 'Next Hop' },
      { key: 'interface', label: 'Interface' },
      { key: 'metric', label: 'Metric' },
    ],
    []
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      <PageHeader
        title="Route Tables"
        description="Inspect static routing tables configured across local firewalls and templates."
        actions={<SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search routes..." variant="local" />}
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
            Loading static routes...
          </div>
        ) : routes.length > 0 ? (
          <DataTable
            columns={columns}
            data={routes}
            searchQuery={searchQuery}
            exportFilename={`canopy_routes_${new Date().toISOString().slice(0, 10)}.csv`}
          />
        ) : (
          <EmptyState
            icon={<Waypoints size={32} />}
            title="No Routes Configured"
            description="No static routes found in the database. Ensure XML imports have completed successfully."
            minHeight="300px"
          />
        )}
      </div>
    </div>
  );
};
