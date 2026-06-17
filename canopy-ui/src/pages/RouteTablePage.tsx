import React, { useState, useEffect, useMemo } from 'react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { SearchBar } from '../components/SearchBar';
import { SearchableScopeDropdown } from '../components/SearchableScopeDropdown';
import { useTemplateHierarchy } from '../hooks/useTemplateHierarchy';
import { Map, Loader2 } from 'lucide-react';

interface RouteTablePageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const RouteTablePage: React.FC<RouteTablePageProps> = ({ auth, addToast }) => {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [routes, setRoutes] = useState<any[]>([]);

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

  const fetchRoutes = async () => {
    if (!apiClient) return;
    try {
      setLoading(true);
      const uuidToQuery = selectedScopeUuid === 'show-all' ? undefined : selectedScopeUuid;
      const res = await apiClient.getNetworksRoutes(uuidToQuery);
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
  }, [apiClient, selectedScopeUuid]);

  const columns: ColumnDef[] = useMemo(
    () => [
      { 
        key: 'device_uuid', 
        label: 'Context / Scope', 
        width: '250px',
        renderCell: (val: any) => scopeNameMap[val] || val
      },
      { key: 'vr_name', label: 'Virtual Router', width: '200px' },
      { key: 'route_name', label: 'Name', width: '200px' },
      { key: 'destination', label: 'Destination', width: '200px' },
      { key: 'nexthop', label: 'Next Hop', width: '180px' },
      { key: 'interface', label: 'Interface', width: '150px' },
      { key: 'metric', label: 'Metric', width: '100px' },
    ],
    [scopeNameMap]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      <PageHeader
        title="Routing Tables"
        description="Inspect virtual routers and static routes mapped to local devices and templates."
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
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search routes..." variant="local" />
          </div>
        }
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
            icon={<Map size={32} />}
            title="No Routes Found"
            description="No static routes found for the selected scope context."
            minHeight="300px"
          />
        )}
      </div>
    </div>
  );
};
