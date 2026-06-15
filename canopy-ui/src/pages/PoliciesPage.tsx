import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { CanopyApiClient } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { SearchableScopeDropdown } from '../components/SearchableScopeDropdown';
import { HighlightedText } from '../components/HighlightedText';
import { useScopeHierarchy } from '../hooks/useScopeHierarchy';
import { Shield, Loader2 } from 'lucide-react';

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
      // If currently on a device group or shared, switch to a firewall
      if (selectedScopeUuid === 'paloalto-panorama-global' || deviceGroups.some(g => g.uuid === selectedScopeUuid)) {
        if (devices.length > 0) {
          setSelectedScopeUuid(devices[0].uuid);
        }
      }
    } else {
      // If currently on a firewall, switch to shared
      if (devices.some(d => d.uuid === selectedScopeUuid)) {
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
    includeShowAll: false,
    firewallValueKey: 'uuid'
  });

  const visibleScopes = getVisibleScopes(selectedScopeUuid);

  const hierarchyOptions = useMemo(() => {
    // Filter options based on rulebase
    if (rulebase === 'device') {
      return allHierarchyOptions.filter(o => o.type === 'firewall');
    } else {
      return allHierarchyOptions.filter(o => o.type === 'global' || o.type === 'shared' || o.type === 'device-group');
    }
  }, [allHierarchyOptions, rulebase]);

  const loadRules = useCallback(async () => {
    if (!auth || !selectedScopeUuid) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${auth.url}/api/policies/security?scope=${selectedScopeUuid}&rulebase=${rulebase}`, {
        headers: { 'Authorization': `Bearer ${auth.token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setRules(data || []);
      } else {
        const err = await res.json();
        addToast(err.error || 'Failed to fetch rules', 'error');
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Fetch failed', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [auth, selectedScopeUuid, rulebase, addToast]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const columns = useMemo(() => {
    return [
      {
        key: 'device_uuid',
        label: 'Scope Context',
        width: '240px',
        renderCell: (val: any, row: any, query: string) => {
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
        width: '200px',
        renderCell: (val: any, row: any) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 500 }}>{row.rule_name}</span>
            {row._isInherited && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'inline-flex', padding: '1px 4px', background: 'var(--bg-app)', borderRadius: '4px', width: 'fit-content', marginTop: '4px' }}>
                Inherited • {scopeNameMap[row.device_uuid] || 'Unknown Scope'}
              </span>
            )}
            {row.description && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', fontStyle: 'italic' }}>{row.description}</span>
            )}
          </div>
        )
      },
      {
        key: 'tags',
        label: 'Tags',
        width: '150px',
        renderCell: (val: any, row: any) => (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {(row.tags || []).map((t: string) => (
              <span key={t} style={{ fontSize: '10px', padding: '2px 6px', background: 'var(--bg-app)', borderRadius: '4px', border: '1px solid var(--border-main)' }}>{t}</span>
            ))}
          </div>
        )
      },
      {
        key: 'source',
        label: 'Source',
        width: '250px',
        renderCell: (val: any, row: any) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Zones: {(row.source_zone || []).join(', ') || 'any'}</div>
            <div style={{ fontSize: '12px' }}>{(row.source_address || []).join(', ') || 'any'}</div>
          </div>
        )
      },
      {
        key: 'destination',
        label: 'Destination',
        width: '250px',
        renderCell: (val: any, row: any) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Zones: {(row.destination_zone || []).join(', ') || 'any'}</div>
            <div style={{ fontSize: '12px' }}>{(row.destination_address || []).join(', ') || 'any'}</div>
          </div>
        )
      },
      {
        key: 'application',
        label: 'Application',
        width: '150px',
        renderCell: (val: any, row: any) => (row.application || []).join(', ') || 'any'
      },
      {
        key: 'service',
        label: 'Service',
        width: '150px',
        renderCell: (val: any, row: any) => (row.service || []).join(', ') || 'any'
      },
      {
        key: 'action',
        label: 'Action',
        width: '100px',
        renderCell: (val: any, row: any) => (
          <span style={{ 
            color: row.action === 'allow' ? 'var(--status-green)' : 'var(--status-red)',
            fontWeight: 500,
            textTransform: 'capitalize'
          }}>
            {row.action}
          </span>
        )
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%', overflow: 'hidden' }}>
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

              {/* Scope Search Bar */}
              <div style={{ position: 'relative', width: '300px', flexShrink: 0 }}>
                <div style={{ position: 'relative', width: '100%', height: '34px' }}>
                  <input
                    type="text"
                    placeholder={`Search ${activeSubTab.toLowerCase()}...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      width: '100%',
                      height: '100%',
                      paddingLeft: '32px',
                      fontSize: '13px',
                      backgroundColor: 'var(--bg-app)',
                      border: '1px solid var(--border-main)',
                      borderRadius: '4px',
                      color: 'var(--text-main)',
                      boxSizing: 'border-box'
                    }}
                  />
                  <svg 
                    style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} 
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')} 
                      style={{ 
                        position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', 
                        background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, display: 'flex' 
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '8px', marginTop: '16px' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)' }}>
            <Loader2 size={24} className="animate-spin" />
            <span style={{ marginLeft: '12px' }}>Loading Rules...</span>
          </div>
        ) : (
          <DataTable 
            columns={columns}
            data={rules}
            searchQuery={searchQuery}
            exportFilename={`security_rules_${rulebase}_${selectedScopeUuid}`}
            pagination={true}
            selectable={true}
            rowStyle={(row: any) => {
              if (row.disabled === 1) return { opacity: 0.6 };
              if (row._isInherited) return { backgroundColor: 'var(--bg-app)', opacity: 0.9 };
              return {};
            }}
          />
        )}
      </div>
    </div>
    </div>
  );
};
