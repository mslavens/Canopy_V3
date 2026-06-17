import React, { useState, useEffect, useMemo } from 'react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { SearchBar } from '../components/SearchBar';
import { SearchableScopeDropdown } from '../components/SearchableScopeDropdown';
import { useTemplateHierarchy } from '../hooks/useTemplateHierarchy';
import { Network, Loader2 } from 'lucide-react';

interface ZonesPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const ZonesPage: React.FC<ZonesPageProps> = ({ auth, addToast }) => {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [zones, setZones] = useState<any[]>([]);

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

  const fetchZones = async () => {
    if (!apiClient) return;
    try {
      setLoading(true);
      const uuidToQuery = selectedScopeUuid === 'show-all' ? undefined : selectedScopeUuid;
      const res = await apiClient.getNetworksZones(uuidToQuery);
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
  }, [apiClient, selectedScopeUuid]);

  const columns: ColumnDef[] = useMemo(
    () => [
      { 
        key: 'device_uuid', 
        label: 'Context / Scope', 
        width: '250px',
        renderCell: (val: any) => scopeNameMap[val] || val
      },
      { key: 'name', label: 'Zone Name', width: '250px' },
      { key: 'type', label: 'Type', width: '250px' },
    ],
    [scopeNameMap]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      <PageHeader
        title="Security Zones"
        description="Inspect security zones mapped to local devices and templates."
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
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search zones..." variant="local" />
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
            title="No Zones Found"
            description="No zones found for the selected scope context."
            minHeight="300px"
          />
        )}
      </div>
    </div>
  );
};
