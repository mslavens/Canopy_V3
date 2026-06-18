import React, { useState, useEffect, useMemo } from 'react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
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

  const { hierarchyOptions, scopeNameMap, getVisibleScopes } = useTemplateHierarchy(templates, templateStacks, devices, {
    includeShowAll: true,
    firewallValueKey: 'uuid'
  });

  const visibleScopes = getVisibleScopes(selectedScopeUuid);

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
      { key: 'name', label: 'Variable Name', width: '200px', renderCell: (val: any, row: any) => <span style={{ fontWeight: 500 }}>{row.name}</span> },
      { key: 'device_uuid', label: 'Context / Scope', width: '250px', renderCell: (val: any) => {
        const hierarchy = [...getVisibleScopes(val)].reverse();
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontFamily: 'var(--font-mono, monospace)', fontSize: '11px', lineHeight: '1.2' }}>
            {hierarchy.map((scopeId, idx) => {
              const isLast = idx === hierarchy.length - 1;
              const displayName = scopeNameMap[scopeId] || scopeId;
              const indent = idx * 12;
              return (
                <div key={scopeId} style={{ display: 'flex', alignItems: 'center', paddingLeft: `${indent}px`, gap: '4px' }}>
                  {idx > 0 && <span style={{ color: 'var(--text-muted)', marginRight: '2px' }}>└─</span>}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedScopeUuid(scopeId);
                    }}
                    style={{ cursor: 'pointer', transition: 'opacity 0.15s ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.opacity = '0.8'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; e.currentTarget.style.opacity = '1'; }}
                    title={`Switch active scope to ${displayName}`}
                  >
                    {isLast ? (
                      <span className="badge badge-info" style={{ fontWeight: 600, padding: '2px 6px', fontSize: '10px', display: 'inline-block' }}>
                        {displayName}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>{displayName}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        );
      }},
      { key: 'type', label: 'Type', width: '150px' },
      { key: 'value', label: 'Value' },
    ],
    [scopeNameMap, getVisibleScopes]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {/* Scope context summary top header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
            {/* Top Row: Dropdown, Lineage, and Search */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', gap: '24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-main)' }}>Context:</span>
                  <SearchableScopeDropdown
                    value={selectedScopeUuid}
                    options={hierarchyOptions}
                    onChange={setSelectedScopeUuid}
                    scopeNameMap={scopeNameMap}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, minHeight: '20px' }}>
                    {selectedScopeUuid !== 'show-all' && visibleScopes.length > 1 ? (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Scope Context:
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', marginLeft: '4px', whiteSpace: 'nowrap' }}>
                          {[...visibleScopes.slice(1)].reverse().map((scopeId, idx, arr) => (
                            <React.Fragment key={scopeId}>
                              <span
                                onClick={() => setSelectedScopeUuid(scopeId)}
                                style={{
                                  color: 'var(--text-muted)',
                                  cursor: 'pointer',
                                  fontWeight: 400,
                                  transition: 'color 0.15s ease',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-main)'; e.currentTarget.style.textDecoration = 'underline'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.textDecoration = 'none'; }}
                                title={`Switch active scope to ${scopeNameMap[scopeId] || scopeId}`}
                              >
                                {scopeNameMap[scopeId] || scopeId}
                              </span>
                              {idx < arr.length - 1 && <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>➔</span>}
                            </React.Fragment>
                          ))}
                          <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>➔</span>
                          <span style={{
                            backgroundColor: 'rgba(59, 130, 246, 0.15)',
                            color: 'var(--accent-blue)',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            border: '1px solid rgba(59, 130, 246, 0.25)',
                            fontWeight: 600,
                            fontSize: '11px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            whiteSpace: 'nowrap'
                          }}>
                            {scopeNameMap[selectedScopeUuid] || selectedScopeUuid}
                          </span>
                        </span>
                      </span>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {selectedScopeUuid === 'show-all' ? 'Viewing combined objects across all configured administrative scopes.' : 'Viewing context: ' + (scopeNameMap[selectedScopeUuid] || selectedScopeUuid)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ width: '300px', flexShrink: 0 }}>
                <SearchBar
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search variables..."
                  width="100%"
                  variant="local"
                />
              </div>
            </div>
            <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%' }} />
          </div>
        </div>

        <div style={{ flex: 1, padding: '0', margin: '0 -30px -30px -30px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)' }}>
              <Loader2 size={24} className="animate-spin" />
              <span style={{ marginLeft: '12px' }}>Loading template variables...</span>
            </div>
          ) : variables.length > 0 ? (
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <DataTable
                key={selectedScopeUuid}
                toolbarTitle={
                  <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                    Template Variables ({variables.length})
                  </h2>
                }
                columns={columns}
                data={variables}
                searchQuery={searchQuery}
                exportFilename={`canopy_variables_${selectedScopeUuid}.csv`}
                pagination={true}
                allowScrollPastEnd={true}
              />
            </div>
          ) : (
            <EmptyState
              icon={<FileCode2 size={32} />}
              title="No Variables Found"
              description="No template variables found for the selected scope context."
              minHeight="100%"
            />
          )}
        </div>
      </div>
    </div>
  );
};
