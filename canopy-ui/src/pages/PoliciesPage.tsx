import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { CanopyApiClient } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { SearchableScopeDropdown } from '../components/SearchableScopeDropdown';
import { SearchBar } from '../components/SearchBar';
import { HighlightedText } from '../components/HighlightedText';
import { useScopeHierarchy } from '../hooks/useScopeHierarchy';
import { Shield, Loader2, Plus } from 'lucide-react';

interface PoliciesPageProps {
  auth: { url: string; token: string } | null;
  addToast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  activeSubTab: string;
}

export const PoliciesPage: React.FC<PoliciesPageProps> = ({ auth, addToast, activeSubTab }) => {
  const [deviceGroups, setDeviceGroups] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [selectedScopeUuid, setSelectedScopeUuid] = useState<string>('paloalto-panorama-global');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [rules, setRules] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Derive rulebase from subtab
  const rulebase = useMemo(() => {
    if (activeSubTab.endsWith('Pre Rules')) return 'pre';
    if (activeSubTab.endsWith('Post Rules')) return 'post';
    if (activeSubTab.endsWith('Device Rules')) return 'device';
    return null;
  }, [activeSubTab]);

  const isSecurityPolicy = activeSubTab.startsWith('Security');

  // When switching between Pre/Post and Device Rules, ensure the scope is valid.
  // Pre/Post requires Device Groups, Device requires Firewalls.
  useEffect(() => {
    if (rulebase === 'device') {
      // If currently on a device group or shared, switch to no device (forces them to pick one)
      if (selectedScopeUuid === 'paloalto-panorama-global' || deviceGroups.some(g => g.uuid === selectedScopeUuid)) {
        setSelectedScopeUuid('');
      }
    } else {
      // If currently on a firewall or empty, switch to shared
      if (!selectedScopeUuid || devices.some(d => d.uuid === selectedScopeUuid)) {
        setSelectedScopeUuid('paloalto-panorama-global');
      }
    }
  }, [rulebase, devices, deviceGroups]);

  useEffect(() => {
    let isMounted = true;
    const loadScopes = async () => {
      if (!auth) return;
      try {
        const client = new CanopyApiClient(auth);
        
        const dgRes = await client.queryDb("SELECT id, uuid, name, parent_id FROM device_groups ORDER BY name ASC;");
        const fwRes = await client.queryDb("SELECT m.id, s.uuid, m.serial, m.name, m.device_group_id FROM managed_devices_raw m JOIN scopes s ON m.device_uuid = s.uuid ORDER BY m.name ASC;");
        
        if (isMounted) {
          const dgRows = dgRes?.rows || [];
          const fwRows = fwRes?.rows || [];
          setDeviceGroups(dgRows);
          setDevices(fwRows);
        }
      } catch (err) {
        console.error("Failed to load scopes", err);
      }
    };
    loadScopes();
    return () => { isMounted = false; };
  }, [auth]);

  const { hierarchyOptions: allHierarchyOptions, scopeNameMap, getVisibleScopes } = useScopeHierarchy(deviceGroups, devices, {
    includeShowAll: true,
    firewallValueKey: 'uuid'
  });

  const visibleScopes = getVisibleScopes(selectedScopeUuid);

  const hierarchyOptions = useMemo(() => {
    // Filter options based on rulebase
    if (rulebase === 'device') {
      return allHierarchyOptions.filter(o => o.type === 'firewall' || o.value === 'show-all');
    } else {
      return allHierarchyOptions.filter(o => o.type === 'global' || o.type === 'shared' || o.type === 'device-group' || o.value === 'show-all');
    }
  }, [allHierarchyOptions, rulebase]);

  const loadRules = useCallback(async () => {
    if (!auth || !selectedScopeUuid) return;
    
    let timer: NodeJS.Timeout | null = setTimeout(() => {
      setIsLoading(true);
      timer = null;
    }, 150);

    try {
      const res = await fetch(`${auth.url}/api/policies/security?scope=${selectedScopeUuid}&rulebase=${rulebase}`, {
        headers: { 'Authorization': `Bearer ${auth.token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const mapped = (data || []).map((r: any, idx: number) => ({ ...r, _index: idx + 1 }));
        setRules(mapped);
      } else {
        const err = await res.json();
        addToast(err.error || 'Failed to fetch rules', 'error');
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Fetch failed', 'error');
    } finally {
      if (timer) clearTimeout(timer);
      setIsLoading(false);
    }
  }, [auth, selectedScopeUuid, rulebase, addToast]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const columns = useMemo(() => {
    return [
      {
        key: '_index',
        label: 'Rule ID',
        width: '140px',
        renderCell: (val: any) => <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{val}</span>
      },
      {
        key: 'info',
        label: 'Information',
        width: '160px',
        renderCell: (val: any, row: any) => (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {row._isInherited && (
              <span 
                style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'inline-flex', padding: '2px 6px', background: 'var(--bg-app)', borderRadius: '4px', border: '1px solid var(--border-main)' }}
                title={`Inherited from ${scopeNameMap[row.device_uuid] || 'Unknown Scope'}`}
              >
                Inherited
              </span>
            )}
          </div>
        )
      },
      {
        key: 'device_uuid',
        label: 'Scope Context',
        width: '260px',
        renderCell: (val: any, row: any, query?: string) => {
          const hierarchy = [...getVisibleScopes(val)].reverse();
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontFamily: 'var(--font-mono, monospace)', fontSize: '11px', lineHeight: '1.2' }}>
              {hierarchy.map((scopeId, idx) => {
                const isLast = idx === hierarchy.length - 1;
                const isShared = scopeId === 'paloalto-panorama-global';
                const displayName = isShared ? 'Shared' : (scopeNameMap[scopeId] || scopeId);
                const indent = idx * 12; // 12px indent per level

                return (
                  <div key={scopeId} style={{ display: 'flex', alignItems: 'center', paddingLeft: `${indent}px`, gap: '4px' }}>
                    {idx > 0 && <span style={{ color: 'var(--text-muted)', marginRight: '2px' }}>└─</span>}
                    <span
                      onClick={() => setSelectedScopeUuid(scopeId)}
                      style={{
                        cursor: 'pointer',
                        transition: 'opacity 0.15s ease'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.opacity = '0.8'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; e.currentTarget.style.opacity = '1'; }}
                      title={`Switch active scope to ${displayName}`}
                    >
                      {isLast ? (
                        <span className="badge badge-info" style={{ fontWeight: 600, padding: '2px 6px', fontSize: '10px', display: 'inline-block' }}>
                          <HighlightedText text={displayName} highlight={query || ''} />
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>
                          <HighlightedText text={displayName} highlight={query || ''} />
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        }
      },
      {
        key: 'name',
        label: 'Name',
        width: '220px',
        renderCell: (val: any, row: any) => <span style={{ fontWeight: 500 }}>{row.rule_name}</span>
      },
      {
        key: '_stack',
        label: 'Type',
        width: '120px',
        renderCell: (val: any, row: any) => {
          let t = row._stack || '';
          if (t === 'Device Rules') t = 'Local';
          else if (t.includes('Pre')) t = 'Pre';
          else if (t.includes('Post')) t = 'Post';
          else t = t.replace(' Rules', '');
          
          return (
            <span style={{ 
              display: 'inline-flex', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
              backgroundColor: t === 'Local' ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-app)',
              color: t === 'Local' ? 'var(--accent-blue)' : 'var(--text-muted)'
            }}>
              {t}
            </span>
          );
        }
      },
      {
        key: 'description',
        label: 'Description',
        width: '220px',
        renderCell: (val: any, row: any) => row.description || ''
      },
      {
        key: 'tags',
        label: 'Tags',
        width: '180px',
        renderCell: (val: any, row: any) => (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {(row.tags || []).map((t: string) => (
              <span key={t} style={{ fontSize: '10px', padding: '2px 6px', background: 'var(--bg-app)', borderRadius: '4px', border: '1px solid var(--border-main)' }}>{t}</span>
            ))}
          </div>
        )
      },
      {
        key: 'sourceZone',
        label: 'Source Zone',
        width: '200px',
        renderCell: (val: any, row: any) => (row.source_zone || []).join(', ') || 'any'
      },
      {
        key: 'sourceAddress',
        label: 'Source Address',
        width: '260px',
        renderCell: (val: any, row: any) => (row.source_address || []).join(', ') || 'any'
      },
      {
        key: 'destinationZone',
        label: 'Destination Zone',
        width: '200px',
        renderCell: (val: any, row: any) => (row.destination_zone || []).join(', ') || 'any'
      },
      {
        key: 'destinationAddress',
        label: 'Destination Address',
        width: '260px',
        renderCell: (val: any, row: any) => (row.destination_address || []).join(', ') || 'any'
      },
      {
        key: 'application',
        label: 'Application',
        width: '200px',
        renderCell: (val: any, row: any) => (row.application || []).join(', ') || 'any'
      },
      {
        key: 'service',
        label: 'Service',
        width: '200px',
        renderCell: (val: any, row: any) => (row.service || []).join(', ') || 'any'
      },
      {
        key: 'category',
        label: 'URL Category',
        width: '200px',
        renderCell: (val: any, row: any) => (row.category || []).join(', ') || 'any'
      },
      {
        key: 'profiles',
        label: 'Profiles',
        width: '200px',
        renderCell: (val: any, row: any) => (row.profiles || []).join(', ') || 'none'
      },
      {
        key: 'logSetting',
        label: 'Log Profile',
        width: '200px',
        renderCell: (val: any, row: any) => row.log_setting || 'none'
      },
      {
        key: 'action',
        label: 'Action',
        width: '140px',
        renderCell: (val: any, row: any) => {
          const action = row.action || 'allow';
          const isAllow = action.toLowerCase() === 'allow';
          return (
            <span style={{ 
              display: 'inline-flex', alignItems: 'center', gap: '6px', 
              color: isAllow ? 'var(--status-green)' : 'var(--status-red)',
              fontSize: '12px', fontWeight: 500
            }}>
              {isAllow ? <Shield size={14} /> : <Shield size={14} style={{ opacity: 0.5 }} />}
              {action.charAt(0).toUpperCase() + action.slice(1)}
            </span>
          );
        }
      }
    ];
  }, [scopeNameMap, getVisibleScopes]);

  if (!rulebase || !isSecurityPolicy) {
    // Extract the policy type (e.g. NAT, Decryption) from the activeSubTab
    const policyType = activeSubTab.split('-')[0]?.trim() || activeSubTab;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px' }}>
        <Shield size={48} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
        <h2 style={{ color: 'var(--text-main)', fontSize: '18px', fontWeight: 500, margin: 0 }}>{policyType} Policies</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', maxWidth: '400px', textAlign: 'center' }}>
          This policy type is not yet fully implemented in the UI.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {/* Scope context summary top header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
            {/* Top Row: Device Group Dropdown, Lineage, and Search */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', gap: '24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-main)' }}>Device Group:</span>
                  <SearchableScopeDropdown
                    value={selectedScopeUuid}
                    options={hierarchyOptions}
                    onChange={setSelectedScopeUuid}
                    scopeNameMap={scopeNameMap}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, minHeight: '20px' }}>
                    {selectedScopeUuid !== 'show-all' && selectedScopeUuid !== 'paloalto-panorama-global' && visibleScopes.length > 1 ? (
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
                        {selectedScopeUuid === 'paloalto-panorama-global' ? 'Viewing global configuration objects (Shared).' : 'Viewing combined objects across all configured administrative scopes.'}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ width: '300px', flexShrink: 0 }}>
                <SearchBar
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder={`Search ${activeSubTab.toLowerCase()}...`}
                  width="100%"
                  variant="local"
                />
              </div>
            </div>
            <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%' }} />
          </div>
        </div>

        <div style={{ flex: 1, padding: '0', margin: '0 -30px -30px -30px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)' }}>
            <Loader2 size={24} className="animate-spin" />
            <span style={{ marginLeft: '12px' }}>Loading Rules...</span>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <DataTable 
              toolbarTitle={
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                  {activeSubTab.split('-')[1]?.trim() || activeSubTab}
                </h2>
              }
              topRightActions={
                <button
                  className="btn-primary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Plus size={14} /> Add Rule
                </button>
              }
              columns={columns}
              data={rules}
              searchQuery={searchQuery}
              exportFilename={`security_rules_${rulebase}_${selectedScopeUuid}`}
              pagination={true}
              selectable={true}
              groupByField={
                rulebase === 'device'
                  ? (selectedScopeUuid === 'show-all' ? ((row: any) => `${row.device_uuid}::${row._stack || ''}`) : "_stack")
                  : "device_uuid"
              }
              groupByRender={(val) => {
                if (rulebase === 'device') {
                  if (selectedScopeUuid === 'show-all') {
                    const [deviceUuid, stack] = val.split('::');
                    const scopeName = scopeNameMap[deviceUuid] || deviceUuid;
                    let label = stack || 'Rules';
                    if (label === 'Device Rules') label = 'Local Rules';
                    else if (!label.includes('Rules')) label = label + ' Rules';
                    
                    return (
                      <span style={{ textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-main)' }}>
                        {label} <span style={{ color: 'var(--text-muted)', margin: '0 8px' }}>•</span> {scopeName}
                      </span>
                    );
                  } else {
                    let label = val || 'Rules';
                    if (label === 'Device Rules') label = 'Local Rules';
                    return <span style={{ textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-main)' }}>{label}</span>;
                  }
                } else {
                  // pre or post rulebase
                  const scopeName = scopeNameMap[val] || val;
                  return <span style={{ textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-main)' }}>{scopeName}</span>;
                }
              }}
              rowStyle={(row: any) => {
                if (row.disabled === 1) return { opacity: 0.6 };
                if (row._isInherited) return { backgroundColor: 'var(--bg-app)', opacity: 0.9 };
                return {};
              }}
            />
          </div>
        )}
      </div>
    </div>
    </div>
  );
};
