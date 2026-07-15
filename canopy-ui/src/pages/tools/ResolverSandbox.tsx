import React, { useState, useEffect, useMemo } from 'react';
import { Search, MapPin, Bug, Database, Route, Network, Terminal, Info, ChevronRight, Activity } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { CanopyApiClient } from '../../api/client';
import { EmptyState } from '../../components/EmptyState';
import { SearchableScopeDropdown } from '../../components/SearchableScopeDropdown';
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
  const [activeTab, setActiveTab] = useState<'locations' | 'json' | 'interfaces' | 'routes'>('locations');
  const [locationFilter, setLocationFilter] = useState<'all' | 'direct' | 'routed' | 'default'>('all');

  const [templates, setTemplates] = useState<any[]>([]);
  const [templateStacks, setTemplateStacks] = useState<any[]>([]);
  const [templateStackMembers, setTemplateStackMembers] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);

  const [deviceInterfaces, setDeviceInterfaces] = useState<any[]>([]);
  const [deviceRoutes, setDeviceRoutes] = useState<any[]>([]);

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
        }
      } catch (err) {
        console.error("Failed to load scopes", err);
      }
    };
    loadScopes();
    return () => { isMounted = false; };
  }, [apiClient]);

  const { hierarchyOptions, scopeNameMap, getDevicesForScope } = useTemplateHierarchy(
    templates, templateStacks, devices, templateStackMembers, { includeShowAll: true, firewallValueKey: 'uuid' }
  );

  // When tab changes, load interfaces/routes if applicable
  useEffect(() => {
    if (!apiClient) return;
    if (selectedScopeUuid !== 'show-all' && devices.some(d => d.uuid === selectedScopeUuid)) {
      if (activeTab === 'interfaces') {
        apiClient.getNetworksInterfaces(selectedScopeUuid).then(res => setDeviceInterfaces(res || []));
      } else if (activeTab === 'routes') {
        apiClient.getNetworksRoutes(selectedScopeUuid).then(res => setDeviceRoutes(res || []));
      }
    } else {
      setDeviceInterfaces([]);
      setDeviceRoutes([]);
    }
  }, [apiClient, selectedScopeUuid, activeTab, devices]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader 
        title="Resolver Sandbox" 
        description="Simulate how the firewall's mathematical engine determines routing and zone placement for an IP address." 
      />
      
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* Left Side: Inputs */}
        <div style={{ width: '320px', padding: '25px', borderRight: '1px solid var(--border-main)', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>Target IP Address <span style={{ color: 'var(--status-red)' }}>*</span></label>
            <input 
              type="text" 
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleResolve()}
              placeholder="e.g. 10.1.1.5"
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-main)',
                borderRadius: '6px',
                color: 'var(--text-main)',
                fontSize: '14px',
                width: '100%',
                outline: 'none',
                fontFamily: 'monospace'
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--accent-blue)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--border-main)'}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>Target Scope <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}>(Optional)</span></label>
            <SearchableScopeDropdown
              value={selectedScopeUuid}
              options={hierarchyOptions}
              onChange={setSelectedScopeUuid}
              scopeNameMap={scopeNameMap}
              width="100%"
            />
          </div>

          <button 
            onClick={handleResolve}
            disabled={!ipAddress || isResolving}
            className="btn-primary"
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '10px', marginTop: '10px' }}
          >
            <Search size={16} /> 
            {isResolving ? 'Calculating...' : 'Calculate Routes'}
          </button>
        </div>

        {/* Right Side: Tabbed Viewer */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-main)', padding: '0 25px', backgroundColor: 'var(--bg-surface)' }}>
            {[
              { id: 'locations', label: 'Resolved Locations', icon: MapPin },
              { id: 'json', label: 'Engine Raw JSON', icon: Terminal },
              { id: 'interfaces', label: 'Interfaces', icon: Network },
              { id: 'routes', label: 'Routing Table (FIB)', icon: Route }
            ].map(tab => {
              const active = activeTab === tab.id;
              const disabled = (tab.id === 'interfaces' || tab.id === 'routes') && !isSpecificDevice;
              return (
                <button
                  key={tab.id}
                  disabled={disabled}
                  onClick={() => setActiveTab(tab.id as any)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '16px 20px',
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderBottom: active ? '2px solid var(--accent-blue)' : '2px solid transparent',
                    color: active ? 'var(--text-main)' : 'var(--text-muted)',
                    fontWeight: active ? 600 : 500,
                    fontSize: '13px',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.5 : 1
                  }}
                  title={disabled ? 'Select a specific device to view' : ''}
                >
                  <tab.icon size={16} />
                  {tab.label}
                  {tab.id === 'locations' && result && (
                    <span style={{ backgroundColor: 'var(--bg-sub)', padding: '2px 6px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, color: 'var(--text-main)', marginLeft: '4px' }}>
                      {result.matches?.length || 0}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div style={{ flex: 1, backgroundColor: 'var(--bg-app)', padding: '25px', overflowY: 'auto' }}>
            {error && (
              <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid var(--status-red)', color: 'var(--status-red)', fontSize: '13px', borderRadius: '4px', marginBottom: '20px' }}>
                {error}
              </div>
            )}

            {!result && !error && !isResolving && (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <EmptyState 
                  icon={<Bug size={40} />} 
                  title="Ready for Execution" 
                  description="Enter an IP address and click Calculate Routes to test routing logic." 
                />
              </div>
            )}

            {isResolving && (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
                <Activity className="animate-spin" size={32} style={{ color: 'var(--accent-blue)' }} />
                <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Running engine calculations...</span>
              </div>
            )}

            {result && !isResolving && activeTab === 'locations' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
                
                {/* Stats & Filters */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    Searched <strong style={{ color: 'var(--text-main)' }}>{result.devices_searched}</strong> device(s)
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {[
                      { id: 'all', label: 'All Matches' },
                      { id: 'direct', label: 'Direct / Connected' },
                      { id: 'routed', label: 'Routed' },
                      { id: 'default', label: 'Default Route' }
                    ].map(f => (
                      <button
                        key={f.id}
                        onClick={() => setLocationFilter(f.id as any)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '16px',
                          border: '1px solid',
                          borderColor: locationFilter === f.id ? 'var(--accent-blue)' : 'var(--border-main)',
                          backgroundColor: locationFilter === f.id ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-surface)',
                          color: locationFilter === f.id ? 'var(--accent-blue)' : 'var(--text-muted)',
                          fontSize: '12px',
                          fontWeight: locationFilter === f.id ? 600 : 500,
                          cursor: 'pointer'
                        }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredMatches.length === 0 ? (
                  <div style={{ marginTop: '40px' }}>
                    <EmptyState 
                      icon={<Search size={40} />} 
                      title="No Matches Found" 
                      description="Could not find any routing table or interface matches for this filter." 
                    />
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {filteredMatches.map((match: any, idx: number) => (
                      <div key={idx} style={{ 
                        backgroundColor: 'var(--bg-surface)', 
                        border: '1px solid var(--border-main)', 
                        borderRadius: '8px', 
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Database size={16} style={{ color: 'var(--text-muted)' }} />
                            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)' }}>{match.device_name}</span>
                          </div>
                          <span style={{ 
                            fontSize: '11px', 
                            fontWeight: 600, 
                            padding: '4px 8px', 
                            borderRadius: '12px',
                            backgroundColor: match.type.includes('Direct') ? 'rgba(16, 185, 129, 0.1)' : (match.is_default_route ? 'rgba(245, 158, 11, 0.1)' : 'rgba(59, 130, 246, 0.1)'),
                            color: match.type.includes('Direct') ? '#10b981' : (match.is_default_route ? '#f59e0b' : '#3b82f6')
                          }}>
                            {match.is_default_route ? 'Default Route' : match.type}
                          </span>
                        </div>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', backgroundColor: 'var(--bg-app)', padding: '12px', borderRadius: '6px' }}>
                          <div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Zone</div>
                            <div style={{ fontSize: '13px', color: 'var(--text-main)', fontWeight: 500 }}>{match.zone || 'None'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Interface</div>
                            <div style={{ fontSize: '13px', color: 'var(--text-main)', fontWeight: 500 }}>{match.interface || 'None'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Virtual Router</div>
                            <div style={{ fontSize: '13px', color: 'var(--text-main)', fontWeight: 500 }}>{match.virtual_router || 'default'}</div>
                          </div>
                          {match.route_name && (
                            <div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Route Rule</div>
                              <div style={{ fontSize: '13px', color: 'var(--text-main)', fontWeight: 500 }}>{match.route_name}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {result && !isResolving && activeTab === 'json' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
                  <Info size={16} />
                  Raw execution log and JSON payload returned from the Go Engine.
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>Execution Log</h4>
                  <div style={{ backgroundColor: '#1e1e1e', color: '#d4d4d4', padding: '16px', borderRadius: '6px', fontFamily: 'monospace', fontSize: '12px', overflowX: 'auto', whiteSpace: 'pre' }}>
                    {result.debug_log?.map((log: string, idx: number) => (
                      <div key={idx} style={{ marginBottom: '4px' }}>{log}</div>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                  <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>Payload</h4>
                  <textarea 
                    readOnly 
                    value={JSON.stringify(result, null, 2)}
                    style={{
                      flex: 1,
                      backgroundColor: '#1e1e1e',
                      color: '#d4d4d4',
                      padding: '16px',
                      borderRadius: '6px',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      border: 'none',
                      resize: 'none',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>
            )}

            {activeTab === 'interfaces' && isSpecificDevice && (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <DataTable 
                  data={deviceInterfaces}
                  columns={[
                    { key: 'name', label: 'Name', width: '200px' },
                    { key: 'ip_address', label: 'IP Address', width: '200px' },
                    { key: 'zone', label: 'Zone', width: '150px' },
                    { key: 'virtual_router', label: 'Virtual Router', width: '150px' }
                  ]}
                />
              </div>
            )}

            {activeTab === 'routes' && isSpecificDevice && (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <DataTable 
                  data={deviceRoutes}
                  columns={[
                    { key: 'name', label: 'Name', width: '200px' },
                    { key: 'destination', label: 'Destination', width: '200px' },
                    { key: 'interface', label: 'Interface', width: '150px' },
                    { key: 'virtual_router', label: 'Virtual Router', width: '150px' }
                  ]}
                />
              </div>
            )}
            
          </div>
        </div>
      </div>
    </div>
  );
};
