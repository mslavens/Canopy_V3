import React, { useState, useEffect, useMemo } from 'react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { SearchBar } from '../components/SearchBar';
import { SearchableScopeDropdown } from '../components/SearchableScopeDropdown';
import { useTemplateHierarchy } from '../hooks/useTemplateHierarchy';
import { FileCode2, Loader2 } from 'lucide-react';

interface VariablesPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const VariablesPage: React.FC<VariablesPageProps> = ({ auth, addToast }) => {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [variables, setVariables] = useState<any[]>([]);

  // Hierarchy Data States
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

  const fetchVariables = async () => {
    if (!apiClient) return;
    try {
      setLoading(true);
      const res = await apiClient.getVariables(selectedScopeUuid);
      setVariables(res || []);
    } catch (err) {
      console.error('Failed to load variables:', err);
      addToast(err instanceof Error ? err.message : 'Failed to query template variables.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVariables();
  }, [apiClient, selectedScopeUuid]);

  const columns: ColumnDef[] = useMemo(
    () => [
      { 
        key: 'device_uuid', 
        label: 'Context / Scope (Firewall)',
        width: '250px',
        renderCell: (val: any) => scopeNameMap[val] || val
      },
      { key: 'name', label: 'Variable Name', width: '200px' },
      { key: 'type', label: 'Type', width: '150px' },
      { key: 'value', label: 'Value' },
    ],
    [scopeNameMap]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      <PageHeader
        title="Template Variables"
        description="Inspect variables extracted from templates and device configurations."
        actions={
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search variables..." variant="local" />
            <div style={{ width: '300px' }}>
              <SearchableScopeDropdown
                options={hierarchyOptions}
                value={selectedScopeUuid}
                onChange={setSelectedScopeUuid}
                scopeNameMap={scopeNameMap}
              />
            </div>
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
            Loading template variables...
          </div>
        ) : variables.length > 0 ? (
          <DataTable
            columns={columns}
            data={variables}
            searchQuery={searchQuery}
            exportFilename={`canopy_variables_${new Date().toISOString().slice(0, 10)}.csv`}
          />
        ) : (
          <EmptyState
            icon={<FileCode2 size={32} />}
            title="No Variables Configured"
            description="No template variables found in the database. Ensure XML imports have completed successfully."
            minHeight="300px"
          />
        )}
      </div>
    </div>
  );
};
