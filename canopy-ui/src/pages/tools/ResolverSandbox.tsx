import React, { useState, useEffect, useMemo } from 'react';
import { Search, MapPin, Bug, Database, Route, Network, Terminal, Info, ChevronRight, Activity, Check } from 'lucide-react';
import { CanopyApiClient } from '../../api/client';
import { EmptyState } from '../../components/EmptyState';
import { SearchBar } from '../../components/SearchBar';
import { SearchableScopeDropdown } from '../../components/SearchableScopeDropdown';
import { Dropdown } from '../../components/Dropdown';
import { useTemplateHierarchy } from '../../hooks/useTemplateHierarchy';
import { Modal } from '../../components/Modal';
import { ContextMenuItem, ContextMenuHeader, ContextMenuDivider } from '../../components/ContextMenu';
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
  const [selectedRows, setSelectedRows] = useState<any[]>([]);

  const [templates, setTemplates] = useState<any[]>([]);
  const [templateStacks, setTemplateStacks] = useState<any[]>([]);
  const [templateStackMembers, setTemplateStackMembers] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);

  const [hasValuesMap, setHasValuesMap] = useState<Record<string, boolean>>({});

  // Route Table Modal State
  const [routeModalDeviceUUID, setRouteModalDeviceUUID] = useState<string | null>(null);
  const [routeModalDeviceName, setRouteModalDeviceName] = useState<string | null>(null);
  const [deviceRoutes, setDeviceRoutes] = useState<any[]>([]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [routeSearchQuery, setRouteSearchQuery] = useState('');

  // Fetch routes when modal opens
  useEffect(() => {
    if (!routeModalDeviceUUID || !apiClient) {
      setDeviceRoutes([]);
      return;
    }
    let isMounted = true;
    const fetchRoutes = async () => {
      setIsLoadingRoutes(true);
      try {
        const routes = await apiClient.getNetworksRoutes(routeModalDeviceUUID);
        if (isMounted) setDeviceRoutes(routes || []);
      } catch (err) {
        console.error('Failed to fetch routes', err);
      } finally {
        if (isMounted) setIsLoadingRoutes(false);
      }
    };
    fetchRoutes();
    return () => { isMounted = false; };
  }, [routeModalDeviceUUID, apiClient]);

  // Interfaces Modal State
  const [ifaceModalDeviceUUID, setIfaceModalDeviceUUID] = useState<string | null>(null);
  const [ifaceModalDeviceName, setIfaceModalDeviceName] = useState<string | null>(null);
  const [deviceInterfaces, setDeviceInterfaces] = useState<any[]>([]);
  const [isLoadingInterfaces, setIsLoadingInterfaces] = useState(false);
  const [ifaceSearchQuery, setIfaceSearchQuery] = useState('');

  // Fetch interfaces when modal opens
  useEffect(() => {
    if (!ifaceModalDeviceUUID || !apiClient) {
      setDeviceInterfaces([]);
      return;
    }
    let isMounted = true;
    const fetchInterfaces = async () => {
      setIsLoadingInterfaces(true);
      try {
        const interfaces = await apiClient.getNetworksInterfaces(ifaceModalDeviceUUID);
        if (isMounted) setDeviceInterfaces(interfaces || []);
      } catch (err) {
        console.error('Failed to fetch interfaces', err);
      } finally {
        if (isMounted) setIsLoadingInterfaces(false);
      }
    };
    fetchInterfaces();
    return () => { isMounted = false; };
  }, [ifaceModalDeviceUUID, apiClient]);

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
  const isSingleSelected = selectedRows.length === 1;

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
              <div style={{ flex: 1, minHeight: 0, paddingRight: '4px' }}>
                <DataTable 
                  data={filteredMatches}
                  selectable={true}
                  onSelectionChange={setSelectedRows}
                  exportFilename={`resolver-results-${ipAddress.replace(/[^0-9a-zA-Z]/g, '_')}.csv`}
                  toolbarTitle={
                    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                      Resolved Locations ({result ? filteredMatches.length : 0})
                    </h2>
                  }
                  bulkActions={
                    selectedRows.length === 1 ? (
                      <>
                        <button 
                          className="btn-secondary btn-sm" 
                          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                          onClick={() => {
                            setRouteModalDeviceUUID(selectedRows[0].device_uuid);
                            setRouteModalDeviceName(selectedRows[0].device_name || selectedRows[0].firewall || 'Device');
                          }}
                        >
                          <Route size={14} /> Route Table
                        </button>
                        <button 
                          className="btn-secondary btn-sm" 
                          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                          onClick={() => {
                            setIfaceModalDeviceUUID(selectedRows[0].device_uuid);
                            setIfaceModalDeviceName(selectedRows[0].device_name || selectedRows[0].firewall || 'Device');
                          }}
                        >
                          <Network size={14} /> Interfaces
                        </button>
                      </>
                    ) : null
                  }
                  exportActions={
                    <>
                      {selectedRows.length === 1 && (
                        <>
                          <button 
                            className="btn-secondary btn-sm" 
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start', width: '100%' }}
                            onClick={() => {
                              setRouteModalDeviceUUID(selectedRows[0].device_uuid);
                              setRouteModalDeviceName(selectedRows[0].device_name || selectedRows[0].firewall || 'Device');
                            }}
                          >
                            <Route size={13} style={{ color: 'var(--text-muted)' }} /> View Route Table
                          </button>
                          <button 
                            className="btn-secondary btn-sm" 
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start', width: '100%' }}
                            onClick={() => {
                              setIfaceModalDeviceUUID(selectedRows[0].device_uuid);
                              setIfaceModalDeviceName(selectedRows[0].device_name || selectedRows[0].firewall || 'Device');
                            }}
                          >
                            <Network size={13} style={{ color: 'var(--text-muted)' }} /> View Interfaces
                          </button>
                          <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                        </>
                      )}
                      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '4px 8px' }}>Route Type Filter</div>
                      <button 
                        className="btn-secondary btn-sm" 
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start', width: '100%', backgroundColor: locationFilter === 'all' ? 'var(--bg-element)' : 'transparent' }}
                        onClick={() => setLocationFilter('all')}
                      >
                        {locationFilter === 'all' && <Check size={13} style={{ color: 'var(--accent-blue)' }}/>}
                        <span style={{ marginLeft: locationFilter === 'all' ? 0 : '21px' }}>Show All</span>
                      </button>
                      <button 
                        className="btn-secondary btn-sm" 
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start', width: '100%', backgroundColor: locationFilter === 'direct' ? 'var(--bg-element)' : 'transparent' }}
                        onClick={() => setLocationFilter('direct')}
                      >
                        {locationFilter === 'direct' && <Check size={13} style={{ color: 'var(--accent-blue)' }}/>}
                        <span style={{ marginLeft: locationFilter === 'direct' ? 0 : '21px' }}>Directly Connected</span>
                      </button>
                      <button 
                        className="btn-secondary btn-sm" 
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start', width: '100%', backgroundColor: locationFilter === 'routed' ? 'var(--bg-element)' : 'transparent' }}
                        onClick={() => setLocationFilter('routed')}
                      >
                        {locationFilter === 'routed' && <Check size={13} style={{ color: 'var(--accent-blue)' }}/>}
                        <span style={{ marginLeft: locationFilter === 'routed' ? 0 : '21px' }}>Routed</span>
                      </button>
                      <button 
                        className="btn-secondary btn-sm" 
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start', width: '100%', backgroundColor: locationFilter === 'default' ? 'var(--bg-element)' : 'transparent' }}
                        onClick={() => setLocationFilter('default')}
                      >
                        {locationFilter === 'default' && <Check size={13} style={{ color: 'var(--accent-blue)' }}/>}
                        <span style={{ marginLeft: locationFilter === 'default' ? 0 : '21px' }}>Default Route</span>
                      </button>
                      <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                    </>
                  }
                  topRightActions={renderCalculateButton()}
                  columns={[
                      { 
                        key: 'device_name', 
                        label: 'Firewall', 
                        width: '200px',
                        renderCell: (val, row) => (
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span 
                              style={{ fontWeight: 600, color: 'var(--accent-blue)', cursor: 'pointer' }}
                              onClick={() => setSelectedScopeUuid(row.device_uuid)}
                            >
                              {val || row.firewall}
                            </span>
                          </div>
                        )
                      },
                      {
                        key: 'vendor',
                        label: 'Vendor',
                        width: '140px',
                        exportValue: (row) => devices.find(d => d.uuid === row.device_uuid)?.vendor || 'Unknown',
                        renderCell: (_, row) => (
                          <span style={{ color: 'var(--text-muted)' }}>
                            {devices.find(d => d.uuid === row.device_uuid)?.vendor || 'Unknown'}
                          </span>
                        )
                      },
                      { 
                        key: 'type', 
                        label: 'Calculated Route', 
                        width: '200px', 
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
                      { key: 'zone', label: 'Zone', width: '130px', renderCell: val => val || 'None' },
                      { key: 'interface', label: 'Interface', width: '160px', renderCell: val => val || 'None' },
                      { 
                        key: 'interface_ip', 
                        label: 'Interface IP', 
                        width: '180px', 
                        renderCell: (val, row) => {
                          if (!val) return '-';
                          const resolved = row.resolved_interface_ip;
                          if (resolved && resolved !== val) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ color: 'var(--text-muted)' }}>{val}</span>
                                <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{resolved}</span>
                              </div>
                            );
                          }
                          return val;
                        }
                      },
                      { 
                        key: 'destination', 
                        label: 'Destination', 
                        width: '200px', 
                        renderCell: (val, row) => {
                          if (!val) return '-';
                          const resolved = row.resolved_dest;
                          if (resolved && resolved !== val) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ color: 'var(--text-muted)' }}>{val}</span>
                                <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{resolved}</span>
                              </div>
                            );
                          }
                          return val;
                        }
                      },
                      { key: 'virtual_router', label: 'Virtual Router', width: '180px', renderCell: val => val || 'None' },
                      { 
                        key: 'next_hop', 
                        label: 'Next Hop', 
                        width: '160px', 
                        renderCell: (val, row) => {
                          if (!val) return '-';
                          const resolved = row.resolved_next_hop;
                          if (resolved && resolved !== val) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ color: 'var(--text-muted)' }}>{val}</span>
                                <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{resolved}</span>
                              </div>
                            );
                          }
                          return val;
                        }
                      },
                      { 
                        key: 'origin_uuid', 
                        label: 'Template / Stack Origin', 
                        width: '250px',
                        exportValue: (row) => scopeNameMap[row.origin_uuid] || row.origin_uuid,
                        getFilterValues: (row) => scopeNameMap[row.origin_uuid] || row.origin_uuid,
                        renderCell: (val, row) => {
                          const isLocal = row.origin_uuid === row.device_uuid;
                          return (
                            <span style={{ 
                              color: isLocal ? 'var(--text-muted)' : 'var(--text-main)',
                              fontStyle: isLocal ? 'italic' : 'normal'
                            }}>
                              {isLocal ? 'Local Override' : (scopeNameMap[row.origin_uuid] || row.origin_uuid)}
                            </span>
                          );
                        }
                      }
                    ]}
                    rowContextMenuActions={(row, closeMenu) => (
                      <>
                        <ContextMenuHeader label={row.device_name || row.firewall || 'Device'} />
                        <ContextMenuItem
                          icon={<Route size={13} />}
                          label="View Route Table"
                          onClick={() => {
                            setRouteModalDeviceUUID(row.device_uuid);
                            setRouteModalDeviceName(row.device_name || row.firewall || 'Device');
                            closeMenu();
                          }}
                        />
                        <ContextMenuDivider />
                        <ContextMenuItem
                          icon={<Network size={13} />}
                          label="View Interfaces"
                          onClick={() => {
                            setIfaceModalDeviceUUID(row.device_uuid);
                            setIfaceModalDeviceName(row.device_name || row.firewall || 'Device');
                            closeMenu();
                          }}
                        />
                      </>
                    )}
                  />
              </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={!!routeModalDeviceUUID}
        onClose={() => {
          setRouteModalDeviceUUID(null);
          setRouteModalDeviceName(null);
        }}
        title={`Route Table: ${routeModalDeviceName || 'Device'}`}
        size="lg"
      >
        <div style={{ height: '600px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <SearchBar 
            value={routeSearchQuery}
            onChange={setRouteSearchQuery}
            placeholder="Search route table..."
          />
          <DataTable
            data={deviceRoutes}
            searchQuery={routeSearchQuery}
            loading={isLoadingRoutes}
            exportFilename={`routes-${routeModalDeviceName}.csv`}
            columns={[
              { key: 'route_name', label: 'Name', width: '200px', renderCell: (val: any, row: any) => <span style={{ fontWeight: 500 }}>{row.route_name}</span> },
              { key: 'vr_name', label: 'Virtual Router', width: '150px' },
              { key: 'destination', label: 'Destination', width: '200px', renderCell: (val: any, row: any) => {
                  const resolved = row.resolved_destination;
                  if (resolved && resolved !== val) {
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{val}</span>
                        <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{resolved}</span>
                      </div>
                    );
                  }
                  return val || '-';
                }
              },
              { key: 'nexthop', label: 'Next Hop', width: '180px', renderCell: (val: any, row: any) => {
                  const resolved = row.resolved_nexthop;
                  if (resolved && resolved !== val) {
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{val}</span>
                        <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{resolved}</span>
                      </div>
                    );
                  }
                  return val || '-';
                }
              },
              { key: 'interface', label: 'Interface', width: '150px' },
              { key: 'metric', label: 'Metric', width: '100px' },
            ]}
          />
        </div>
      </Modal>

      <Modal
        isOpen={!!ifaceModalDeviceUUID}
        onClose={() => {
          setIfaceModalDeviceUUID(null);
          setIfaceModalDeviceName(null);
        }}
        title={`Interfaces: ${ifaceModalDeviceName || 'Device'}`}
        size="lg"
      >
        <div style={{ height: '600px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <SearchBar 
            value={ifaceSearchQuery}
            onChange={setIfaceSearchQuery}
            placeholder="Search interfaces..."
          />
          <DataTable
            data={deviceInterfaces}
            searchQuery={ifaceSearchQuery}
            loading={isLoadingInterfaces}
            exportFilename={`interfaces-${ifaceModalDeviceName}.csv`}
            columns={[
              { key: 'name', label: 'Interface', width: '200px', renderCell: (val: any, row: any) => <span style={{ fontWeight: 500 }}>{row.name}</span> },
              { key: 'type', label: 'Type', width: '150px' },
              { key: 'ip_address', label: 'IP Address', width: '200px', renderCell: (val: any, row: any) => {
                  const resolved = row.resolved_ip_address;
                  if (resolved && resolved !== val) {
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{val}</span>
                        <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{resolved}</span>
                      </div>
                    );
                  }
                  return val || '-';
                }
              },
              { key: 'zone', label: 'Security Zone', width: '150px' },
              { key: 'vr_name', label: 'Virtual Router', width: '150px' },
              { key: 'aggregate_group', label: 'Aggregate Group', width: '150px' },
              { key: 'description', label: 'Description', width: '200px' },
            ]}
          />
        </div>
      </Modal>
    </div>
  );
};
