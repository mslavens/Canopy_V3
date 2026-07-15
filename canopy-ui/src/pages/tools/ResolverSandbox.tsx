import React, { useState, useEffect, useMemo } from 'react';
import { Search, MapPin, Bug, Database, Route, Network, Terminal, Info, ChevronRight, Activity } from 'lucide-react';
import { CanopyApiClient } from '../../api/client';
import { EmptyState } from '../../components/EmptyState';
import { SearchBar } from '../../components/SearchBar';
import { SearchableScopeDropdown } from '../../components/SearchableScopeDropdown';
import { Dropdown } from '../../components/Dropdown';
import { useTemplateHierarchy } from '../../hooks/useTemplateHierarchy';
import { DataTable } from '../../components/DataTable';

interface ResolverSandboxProps {
  apiClient?: CanopyApiClient;
}

export const ResolverSandbox: React.FC<ResolverSandboxProps> = ({ apiClient }) => {
  const [ipAddress, setIpAddress] = useState('');
  const [selectedScopeUuid, setSelectedScopeUuid] = useState('show-all');
  
  const [isResolving, setIsResolving] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState<'all' | 'direct' | 'routed' | 'default'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [templates, setTemplates] = useState<any[]>([]);
  const [templateStacks, setTemplateStacks] = useState<any[]>([]);
  const [templateStackMembers, setTemplateStackMembers] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);

  const [hasValuesMap, setHasValuesMap] = useState<Record<string, boolean>>({});

  // Load scope hierarchy
  useEffect(() => {
    let isMounted = true;
    const loadScopes = async () => {
      if (!apiClient) return;
      try {
        const data = await apiClient.getHierarchyContext('interfaces');
        if (isMounted) {
          setTemplates(data.templates || []);
          setTemplateStacks(data.template_stacks || []);
          setTemplateStackMembers(data.template_stack_members || []);
          setDevices(data.devices || []);
          setHasValuesMap(data.has_values_map || {});
        }
      } catch (err) {
        console.error("Failed to load scopes", err);
      }
    };
    loadScopes();
    return () => { isMounted = false; };
  }, [apiClient]);

  const { hierarchyOptions, scopeNameMap, getDevicesForScope, getActiveConfigScope, deviceCounts } = useTemplateHierarchy(
    templates, templateStacks, devices, templateStackMembers, { includeShowAll: true, firewallValueKey: 'uuid' }
  );

  const handleResolve = async () => {
    if (!ipAddress.trim() || !apiClient) return;
    
    setIsResolving(true);
    setError(null);
    setResult(null);

    try {
      const deviceUuids = selectedScopeUuid === 'show-all' ? [] : getDevicesForScope(selectedScopeUuid).map((d: any) => d.uuid);
      const data = await apiClient.resolveSandboxIp(ipAddress.trim(), deviceUuids);
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve IP.');
    } finally {
      setIsResolving(false);
    }
  };

  const filteredMatches = useMemo(() => {
    if (!result || !result.matches) return [];
    return result.matches.filter((m: any) => {
      if (locationFilter === 'all') return true;
      if (locationFilter === 'direct') return m.type.includes('Direct');
      if (locationFilter === 'routed') return m.type.includes('Routing') && !m.is_default_route;
      if (locationFilter === 'default') return m.is_default_route;
      return true;
    });
  }, [result, locationFilter]);

  const isSpecificDevice = selectedScopeUuid !== 'show-all' && devices.some(d => d.uuid === selectedScopeUuid);

  const renderCalculateButton = () => (
    <button 
      onClick={handleResolve}
      disabled={!ipAddress || isResolving}
      className="btn-primary btn-sm"
      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
    >
      {isResolving ? <Activity size={14} className="animate-spin" /> : <Search size={14} />}
      {isResolving ? 'Calculating...' : 'Calculate Routes'}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%', backgroundColor: 'var(--bg-app)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        
        {/* Scope context summary top header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
            {/* Top Row: Dropdown, Lineage, and Search */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', gap: '24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span style={{ width: '95px', display: 'inline-block', fontSize: '12px', fontWeight: 500, color: 'var(--text-main)' }}>Template:</span>
                  <SearchableScopeDropdown
                    value={getActiveConfigScope(selectedScopeUuid)}
                    options={hierarchyOptions}
                    onChange={setSelectedScopeUuid}
                    scopeNameMap={scopeNameMap}
                    ruleCounts={deviceCounts}
                    hasValuesMap={hasValuesMap}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, minHeight: '20px' }}>
                    {selectedScopeUuid !== 'show-all' ? (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Scope Context:
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', marginLeft: '4px', whiteSpace: 'nowrap' }}>
                          {(() => {
                            const activeConfig = getActiveConfigScope(selectedScopeUuid);
                            return (
                              <span
                                onClick={() => setSelectedScopeUuid(activeConfig)}
                                style={{
                                  color: 'var(--text-muted)',
                                  cursor: 'pointer',
                                  fontWeight: 400,
                                  transition: 'color 0.15s ease',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-main)'; e.currentTarget.style.textDecoration = 'underline'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.textDecoration = 'none'; }}
                                title={`Switch active scope to ${scopeNameMap[activeConfig] || activeConfig}`}
                              >
                                {scopeNameMap[activeConfig] || activeConfig}
                              </span>
                            );
                          })()}
                          {(() => {
                             const activeConfig = getActiveConfigScope(selectedScopeUuid);
                             const availableDevices = getDevicesForScope(activeConfig);
                             if (availableDevices.length > 0) {
                               const isDeviceSelected = selectedScopeUuid !== activeConfig;
                               return (
                                 <React.Fragment>
                                   <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>➔</span>
                                   <Dropdown
                                     value={isDeviceSelected ? selectedScopeUuid : ""}
                                     options={["", ...availableDevices.map(fw => fw.uuid)]}
                                     onChange={(val) => {
                                         if (val) {
                                           setSelectedScopeUuid(val);
                                         } else {
                                           setSelectedScopeUuid(activeConfig);
                                         }
                                     }}
                                     searchable={true}
                                     width="220px"
                                     variant="inline"
                                     renderOption={(opt) => {
                                       if (!opt) return <span style={{ color: 'var(--text-muted)' }}>Device Overrides...</span>;
                                       const fw = availableDevices.find(f => f.uuid === opt);
                                       return (
                                         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                           <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fw ? (fw.name || fw.serial) : opt}</span>
                                           {hasValuesMap[opt] && <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--accent-blue)', flexShrink: 0, marginLeft: '6px' }} title="Has overrides configured" />}
                                         </div>
                                       );
                                     }}
                                   />
                                 </React.Fragment>
                               );
                             }
                             return null;
                          })()}
                        </span>
                      </span>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        Viewing combined administrative scopes.
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ width: '300px', flexShrink: 0 }} onKeyDown={(e) => { if (e.key === 'Enter') handleResolve() }}>
                <SearchBar 
                  value={ipAddress}
                  onChange={setIpAddress}
                  placeholder="Target IP Address..."
                  width="100%"
                  variant="local"
                />
              </div>
            </div>
            <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%' }} />
          </div>
        </div>

        {/* Content Area (Edge-to-Edge DataTable) */}
        <div style={{ flex: 1, padding: '0', margin: '0 -30px -30px -30px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {error && (
            <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid var(--status-red)', color: 'var(--status-red)', fontSize: '13px', borderRadius: '4px', margin: '20px', flexShrink: 0 }}>
              {error}
            </div>
          )}

          {isResolving ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
              <Activity className="animate-spin" size={32} style={{ color: 'var(--accent-blue)' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Running engine calculations...</span>
            </div>
          ) : (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <DataTable 
                  data={result ? filteredMatches : []}
                  exportFilename={result ? "resolver-sandbox-export.csv" : undefined}
                  toolbarTitle={
                    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                      Resolved Locations ({result ? filteredMatches.length : 0})
                    </h2>
                  }
                  topRightActions={renderCalculateButton()}
                  columns={[
                      { 
                        key: 'device_name', 
                        label: 'Firewall', 
                        width: '200px',
                        renderCell: (val) => <div style={{ fontWeight: 600 }}>{val}</div> 
                      },
                      {
                        key: 'vendor',
                        label: 'Vendor',
                        width: '120px',
                        exportValue: (row) => devices.find(d => d.uuid === row.device_uuid)?.vendor || 'Unknown',
                        renderCell: (_, row) => (
                          <span style={{ color: 'var(--text-muted)' }}>
                            {devices.find(d => d.uuid === row.device_uuid)?.vendor || 'Unknown'}
                          </span>
                        )
                      },
                      { 
                        key: 'type', 
                        label: 'Location Type', 
                        width: '180px',
                        exportValue: (row) => row.is_default_route ? 'Default Route' : row.type,
                        getFilterValues: (row) => row.is_default_route ? 'Default Route' : row.type,
                        renderCell: (_, row) => (
                          <span style={{ 
                            fontSize: '11px', 
                            fontWeight: 600, 
                            padding: '4px 8px', 
                            borderRadius: '12px',
                            backgroundColor: row.type.includes('Direct') ? 'rgba(16, 185, 129, 0.1)' : (row.is_default_route ? 'rgba(245, 158, 11, 0.1)' : 'rgba(59, 130, 246, 0.1)'),
                            color: row.type.includes('Direct') ? '#10b981' : (row.is_default_route ? '#f59e0b' : '#3b82f6')
                          }}>
                            {row.is_default_route ? 'Default Route' : row.type}
                          </span>
                        )
                      },
                      { key: 'zone', label: 'Zone', width: '120px', renderCell: val => val || 'None' },
                      { key: 'interface', label: 'Interface', width: '150px', renderCell: val => val || 'None' },
                      { key: 'virtual_router', label: 'Virtual Router', width: '150px', renderCell: val => val || 'None' },
                      { key: 'next_hop', label: 'Next Hop', width: '150px', renderCell: val => val || '-' },
                      { 
                        key: 'origin_uuid', 
                        label: 'Template / Stack Origin', 
                        width: '250px',
                        exportValue: (row) => row.origin_uuid === row.device_uuid ? 'Local Override' : (scopeNameMap[row.origin_uuid] || 'Unknown'),
                        renderCell: (val, row) => (
                          <span style={{ color: val === row.device_uuid ? 'var(--status-yellow)' : 'var(--text-main)', fontStyle: val === row.device_uuid ? 'italic' : 'normal' }}>
                            {val === row.device_uuid ? 'Local Override' : (scopeNameMap[val] || 'Unknown')}
                          </span>
                        )
                      }
                    ]}
                  />
              </div>
          )}
          
        </div>
      </div>
    </div>
  );
};
