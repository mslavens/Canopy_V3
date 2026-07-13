import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { CanopyApiClient } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { SearchableScopeDropdown } from '../components/SearchableScopeDropdown';
import { SearchBar } from '../components/SearchBar';
import { HighlightedText } from '../components/HighlightedText';
import { useScopeHierarchy } from '../hooks/useScopeHierarchy';
import { Shield, Loader2, Plus } from 'lucide-react';
import { ExpandableBadgeList } from '../components/ExpandableBadgeList';

interface PoliciesPageProps {
  auth: { url: string; token: string } | null;
  addToast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  activeSubTab: string;
  setActiveSubTab?: (tab: string) => void;
  globalScopeUuid?: string;
  setGlobalScopeUuid?: (uuid: string) => void;
  globalScopeVendor?: string;
  setGlobalScopeVendor?: (vendor: string) => void;
}

export const PoliciesPage: React.FC<PoliciesPageProps> = ({
  auth, addToast, activeSubTab, setActiveSubTab,
  globalScopeUuid, setGlobalScopeUuid, globalScopeVendor, setGlobalScopeVendor
}) => {
  const [deviceGroups, setDeviceGroups] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [ruleCounts, setRuleCounts] = useState<Record<string, number>>({});

  const [localScope, setLocalScope] = useState<string>('paloalto-panorama-global');
  const selectedScopeUuid = globalScopeUuid || localScope;
  const setSelectedScopeUuid = setGlobalScopeUuid || setLocalScope;

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [rules, setRules] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [loadedContext, setLoadedContext] = useState<string>('');

  // Derive rulebase from subtab
  const rulebase = useMemo(() => {
    if (activeSubTab.endsWith('Pre Rules')) return 'pre';
    if (activeSubTab.endsWith('Post Rules')) return 'post';
    if (activeSubTab.endsWith('Device Rules')) return 'device';
    return null;
  }, [activeSubTab]);

  useEffect(() => {
    const handlePayload = (payloadStr: string | null) => {
      if (!payloadStr) return;
      try {
        const payload = JSON.parse(payloadStr);
        setSearchQuery(payload.query);
        if (payload.scope && setSelectedScopeUuid) {
          setSelectedScopeUuid(payload.scope);
        }
      } catch (e) {
        setSearchQuery(payloadStr);
      }
    };

    // Check session storage on mount
    const injectedSearch = sessionStorage.getItem('canopy-local-search-injection');
    if (injectedSearch) {
      handlePayload(injectedSearch);
      sessionStorage.removeItem('canopy-local-search-injection');
    }

    // Listen for live injection events (when already mounted and tab doesn't change)
    const handleInject = (e: any) => {
      handlePayload(e.detail);
    };
    window.addEventListener('canopy-inject-search', handleInject);
    return () => window.removeEventListener('canopy-inject-search', handleInject);
  }, [activeSubTab, setSelectedScopeUuid]);

  const policyType = useMemo(() => {
    if (activeSubTab.startsWith('Security')) return 'security';
    if (activeSubTab.startsWith('NAT')) return 'nat';
    if (activeSubTab.startsWith('QoS')) return 'qos';
    if (activeSubTab.startsWith('PBF')) return 'pbf';
    if (activeSubTab.startsWith('Decryption')) return 'decryption';
    if (activeSubTab.startsWith('Application Override') || activeSubTab.startsWith('App Override')) return 'application_override';
    if (activeSubTab.startsWith('Tunnel')) return 'tunnel_inspection';
    if (activeSubTab.startsWith('Authentication')) return 'authentication';
    if (activeSubTab.startsWith('DoS Protection')) return 'dos';
    return 'security';
  }, [activeSubTab]);

  // When switching between Pre/Post and Device Rules, ensure the scope is valid.
  // Pre/Post requires Device Groups, Device requires Firewalls.
  useEffect(() => {
    if (rulebase !== 'device') {
      // If currently on a firewall, intelligently switch to its parent device group
      if (selectedScopeUuid) {
        const fw = devices.find(d => d.uuid === selectedScopeUuid);
        if (fw) {
          const parentDg = deviceGroups.find(g => g.id === fw.device_group_id);
          if (parentDg) {
            setSelectedScopeUuid(parentDg.uuid);
          } else {
            setSelectedScopeUuid('paloalto-panorama-global');
          }
          return;
        }
      }

      // If empty (e.g., they were on 'show-all' or hadn't picked a device), default to shared
      if (!selectedScopeUuid) {
        setSelectedScopeUuid('paloalto-panorama-global');
      }
    }
  }, [rulebase, devices, deviceGroups]);

  const apiClient = useMemo(() => (auth ? new CanopyApiClient(auth) : null), [auth]);

  const handleScopeChange = (val: string) => {
    setSelectedScopeUuid(val);
    if (setGlobalScopeVendor) {
      if (val === 'show-all') {
        // Default
      } else {
        const fw = devices.find(f => f.uuid === val);
        if (fw && fw.vendor) setGlobalScopeVendor(fw.vendor);
        else {
          const dg = deviceGroups.find(g => g.uuid === val);
          if (dg && dg.vendor) setGlobalScopeVendor(dg.vendor);
        }
      }
    }
  };

  useEffect(() => {
    let isMounted = true;
    const loadContext = async () => {
      if (!apiClient || !policyType) return;
      try {
        let tableName = `${policyType}_rules`;
        const validTables = ['security_rules', 'nat_rules', 'qos_rules', 'pbf_rules', 'decryption_rules', 'application_override_rules', 'tunnel_inspection_rules', 'authentication_rules', 'dos_rules'];
        if (!validTables.includes(tableName)) tableName = 'security_rules';

        const data = await apiClient.getPoliciesContext(tableName, rulebase || '');

        if (isMounted) {
          setDeviceGroups(data.device_groups || []);
          setDevices(data.devices || []);
          setRuleCounts(data.rule_counts_map || {});
        }
      } catch (err) {
        console.error("Failed to load scopes", err);
      }
    };
    loadContext();
    return () => { isMounted = false; };
  }, [apiClient, policyType, rulebase]);

  const { hierarchyOptions: allHierarchyOptions, scopeNameMap, getVisibleScopes } = useScopeHierarchy(deviceGroups, devices, {
    includeShowAll: true,
    firewallValueKey: 'uuid'
  });

  const visibleScopes = getVisibleScopes(selectedScopeUuid);

  const hierarchyOptions = useMemo(() => {
    // Filter options based on rulebase
    if (rulebase === 'device') {
      return allHierarchyOptions; // Allow both firewalls and device groups
    } else {
      return allHierarchyOptions.filter(o => o.type === 'global' || o.type === 'shared' || o.type === 'device-group' || o.value === 'show-all');
    }
  }, [allHierarchyOptions, rulebase]);

  useEffect(() => {
    let isMounted = true;
    const loadTabCounts = async () => {
      if (!auth || !apiClient || !policyType || !activeSubTab) return;
      try {
        let url = `${auth.url}/api/system/policies-counts`;
        if (selectedScopeUuid !== 'show-all') {
          const scopesStr = visibleScopes.join(',');
          if (scopesStr) {
            url += `?scopes=${encodeURIComponent(scopesStr)}`;
          }
        }

        const payload = await apiClient.request<any>(url.replace(apiClient.auth.url, ''));

        if (isMounted) {
          window.dispatchEvent(new CustomEvent('update-tab-counts', { detail: payload }));
        }
      } catch (err) {
        console.error("Failed to load tab counts", err);
      }
    };
    loadTabCounts();
    return () => { isMounted = false; };
  }, [auth, policyType, selectedScopeUuid, visibleScopes, activeSubTab]);

  const activeFetchRef = useRef<number>(0);

  const loadRules = useCallback(async () => {
    if (!auth || !apiClient) return;

    const fetchId = Date.now();
    activeFetchRef.current = fetchId;

    const currentLoadedType = loadedContext.split('::')[0];
    if (currentLoadedType !== policyType) {
      setRules([]); // Only clear rules when switching policy types to prevent column mismatch. For scope/rulebase switches, keep data so isFetching can dim smoothly.
    }

    setIsFetching(true);

    if (!selectedScopeUuid) {
      setIsFetching(false);
      return;
    }

    const implementedTypes = ['security', 'nat', 'qos', 'pbf', 'decryption', 'application_override', 'tunnel_inspection', 'authentication', 'dos'];
    if (!implementedTypes.includes(policyType)) {
      setIsFetching(false);
      return;
    }

    let timer: NodeJS.Timeout | null = setTimeout(() => {
      if (activeFetchRef.current === fetchId) {
        setIsLoading(true);
      }
      timer = null;
    }, 150);

    try {
      const data = await apiClient.getPolicies(policyType, selectedScopeUuid, rulebase || '');

      // Ignore stale responses if a newer fetch was initiated
      if (activeFetchRef.current !== fetchId) return;

      const mapped = (data || []).map((r: any, idx: number) => ({ ...r, _index: idx + 1 }));
      setRules(mapped);
      setLoadedContext(`${policyType}::${selectedScopeUuid}::${rulebase}`);
    } catch (err) {
      if (activeFetchRef.current === fetchId) {
        addToast(err instanceof Error ? err.message : 'Fetch failed', 'error');
      }
    } finally {
      if (activeFetchRef.current === fetchId) {
        setIsFetching(false);
        setIsLoading(false);
      }
      if (timer) clearTimeout(timer);
    }
  }, [auth, selectedScopeUuid, rulebase, policyType, addToast]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const renderObjectRefs = useCallback((refs: any[]) => {
    return (
      <ExpandableBadgeList
        items={refs || []}
        limit={5}
        renderItem={(r: any, i: number) => {
          const isPredefined = r.object_type === 'predefined' || r.object_type === 'predefined_app';
          const isAdHoc = r.object_type === 'ad_hoc';
          const bgColor = isAdHoc ? 'rgba(255, 165, 0, 0.1)' : 'var(--bg-app)';
          const textColor = isAdHoc ? '#e8a123' : isPredefined ? 'var(--text-muted)' : 'var(--text-main)';
          const borderColor = isAdHoc ? 'rgba(255, 165, 0, 0.3)' : 'var(--border-main)';

          return (
            <span
              key={i}
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                background: bgColor,
                color: textColor,
                borderRadius: '4px',
                border: `1px solid ${borderColor}`,
                cursor: r.id ? 'pointer' : 'default',
                display: 'inline-flex',
                alignItems: 'center',
                wordBreak: 'break-all'
              }}
              title={r.object_type ? r.object_type.replace('_', ' ') : ''}
              onClick={(e) => {
                if (r.id) {
                  e.stopPropagation();
                  console.log(`Trigger flyout for object ID: ${r.id}, Type: ${r.object_type}`);
                }
              }}
            >
              {r.name}
            </span>
          );
        }}
      />
    );
  }, []);

  const renderStringList = useCallback((list: string[], emptyText = 'any') => {
    if (!list || list.length === 0) return <span style={{ color: 'var(--text-muted)' }}>{emptyText}</span>;
    return (
      <ExpandableBadgeList
        items={list}
        limit={5}
        renderItem={(item: string, idx: number) => (
          <span key={idx} style={{ 
            fontSize: '11px', 
            padding: '2px 6px',
            background: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderRadius: '4px',
            border: '1px solid var(--border-main)',
            display: 'inline-flex',
            alignItems: 'center',
            wordBreak: 'break-all' 
          }}>{item}</span>
        )}
      />
    );
  }, []);

  const getObjFilterVals = useCallback((refs: any[]) => {
    if (!refs || refs.length === 0) return ['any'];
    return refs.map(r => r.name);
  }, []);

  const columns = useMemo(() => {
    const commonStart = [
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedScopeUuid(scopeId);

                        if (rulebase === 'device' && setActiveSubTab) {
                          const isPre = (row?.scope || '').endsWith(':pre');
                          const isPost = (row?.scope || '').endsWith(':post');
                          const prefix = activeSubTab.split('-')[0]?.trim() || 'Security';

                          if (isPre) {
                            setActiveSubTab(`${prefix} - Pre Rules`);
                          } else if (isPost) {
                            setActiveSubTab(`${prefix} - Post Rules`);
                          }
                        }
                      }}
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
        renderCell: (val: any, row: any) => <span style={{ fontWeight: 500 }}>{row.rule_name}</span>,
        getFilterValues: (r: any) => r.rule_name || ''
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
        },
        getFilterValues: (r: any) => {
          let t = r._stack || '';
          if (t === 'Device Rules') t = 'Local';
          else if (t.includes('Pre')) t = 'Pre';
          else if (t.includes('Post')) t = 'Post';
          else t = t.replace(' Rules', '');
          return t;
        }
      },
      {
        key: 'description',
        label: 'Description',
        width: '220px',
        renderCell: (val: any, row: any) => row.description || '',
        getFilterValues: (r: any) => r.description || ''
      },
      {
        key: 'tags',
        label: 'Tags',
        width: '180px',
        renderCell: (val: any, row: any) => (
          <ExpandableBadgeList
            items={row.tags || []}
            limit={5}
            renderItem={(t: string) => (
              <span key={t} style={{ fontSize: '10px', padding: '2px 6px', background: 'var(--bg-app)', borderRadius: '4px', border: '1px solid var(--border-main)', wordBreak: 'break-all' }}>{t}</span>
            )}
          />
        ),
        getFilterValues: (r: any) => r.tags && r.tags.length > 0 ? r.tags : ['']
      }
    ];

    const actionCol = {
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
      },
      getFilterValues: (r: any) => r.action || 'allow'
    };

    if (policyType === 'nat') {
      return [
        ...commonStart,
        { key: 'toZone', label: 'To Zone', width: '200px', renderCell: (v: any, r: any) => r.to_zone || 'any', getFilterValues: (r: any) => r.to_zone || 'any' },
        { key: 'sourceAddress', label: 'Source Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.source_address), getFilterValues: (r: any) => getObjFilterVals(r.source_address) },
        { key: 'destinationAddress', label: 'Destination Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.destination_address), getFilterValues: (r: any) => getObjFilterVals(r.destination_address) },
        { key: 'service', label: 'Service', width: '200px', renderCell: (v: any, r: any) => renderObjectRefs(r.service), getFilterValues: (r: any) => getObjFilterVals(r.service) },
        { key: 'srcTranslation', label: 'Source Translation', width: '220px', renderCell: (v: any, r: any) => r.source_translation_type ? `${r.source_translation_type}: ${r.source_translation_address || ''}` : 'none', getFilterValues: (r: any) => r.source_translation_type ? `${r.source_translation_type}: ${r.source_translation_address || ''}` : 'none' },
        { key: 'dstTranslation', label: 'Destination Translation', width: '220px', renderCell: (v: any, r: any) => r.destination_translation_address ? `${r.destination_translation_address}:${r.destination_translation_port || ''}` : 'none', getFilterValues: (r: any) => r.destination_translation_address ? `${r.destination_translation_address}:${r.destination_translation_port || ''}` : 'none' },
      ];
    }

    if (policyType === 'qos') {
      return [
        ...commonStart,
        { key: 'sourceZone', label: 'Source Zone', width: '200px', renderCell: (v: any, r: any) => renderStringList(r.source_zone, 'any'), getFilterValues: (r: any) => r.source_zone && r.source_zone.length > 0 ? r.source_zone : ['any'] },
        { key: 'sourceAddress', label: 'Source Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.source_address), getFilterValues: (r: any) => getObjFilterVals(r.source_address) },
        { key: 'destinationZone', label: 'Destination Zone', width: '200px', renderCell: (v: any, r: any) => renderStringList(r.destination_zone, 'any'), getFilterValues: (r: any) => r.destination_zone && r.destination_zone.length > 0 ? r.destination_zone : ['any'] },
        { key: 'destinationAddress', label: 'Destination Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.destination_address), getFilterValues: (r: any) => getObjFilterVals(r.destination_address) },
        { key: 'qosClass', label: 'QoS Class', width: '160px', renderCell: (v: any, r: any) => r.qos_class || 'none', getFilterValues: (r: any) => r.qos_class || 'none' },
        { key: 'dscpTos', label: 'DSCP/ToS', width: '160px', renderCell: (v: any, r: any) => r.dscp_tos_marking || 'none', getFilterValues: (r: any) => r.dscp_tos_marking || 'none' },
      ];
    }

    if (policyType === 'pbf') {
      return [
        ...commonStart,
        { key: 'sourceZone', label: 'Source Zone', width: '200px', renderCell: (v: any, r: any) => renderStringList(r.source_zone, 'any'), getFilterValues: (r: any) => r.source_zone && r.source_zone.length > 0 ? r.source_zone : ['any'] },
        { key: 'sourceAddress', label: 'Source Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.source_address), getFilterValues: (r: any) => getObjFilterVals(r.source_address) },
        { key: 'destinationAddress', label: 'Destination Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.destination_address), getFilterValues: (r: any) => getObjFilterVals(r.destination_address) },
        actionCol,
        { key: 'forwardInterface', label: 'Forward Interface', width: '200px', renderCell: (v: any, r: any) => r.forward_interface || 'none', getFilterValues: (r: any) => r.forward_interface || 'none' },
        { key: 'forwardNextHop', label: 'Next Hop', width: '200px', renderCell: (v: any, r: any) => r.forward_next_hop || 'none', getFilterValues: (r: any) => r.forward_next_hop || 'none' },
      ];
    }

    if (policyType === 'decryption') {
      return [
        ...commonStart,
        { key: 'sourceZone', label: 'Source Zone', width: '200px', renderCell: (v: any, r: any) => renderStringList(r.source_zone, 'any'), getFilterValues: (r: any) => r.source_zone && r.source_zone.length > 0 ? r.source_zone : ['any'] },
        { key: 'sourceAddress', label: 'Source Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.source_address), getFilterValues: (r: any) => getObjFilterVals(r.source_address) },
        { key: 'destinationZone', label: 'Destination Zone', width: '200px', renderCell: (v: any, r: any) => renderStringList(r.destination_zone, 'any'), getFilterValues: (r: any) => r.destination_zone && r.destination_zone.length > 0 ? r.destination_zone : ['any'] },
        { key: 'destinationAddress', label: 'Destination Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.destination_address), getFilterValues: (r: any) => getObjFilterVals(r.destination_address) },
        actionCol,
        { key: 'decryptionType', label: 'Decryption Type', width: '180px', renderCell: (v: any, r: any) => r.decryption_type || 'none', getFilterValues: (r: any) => r.decryption_type || 'none' },
        { key: 'decryptionProfile', label: 'Profile', width: '200px', renderCell: (v: any, r: any) => r.decryption_profile || 'none', getFilterValues: (r: any) => r.decryption_profile || 'none' },
      ];
    }

    if (policyType === 'application_override') {
      return [
        ...commonStart,
        { key: 'sourceZone', label: 'Source Zone', width: '200px', renderCell: (v: any, r: any) => renderStringList(r.source_zone, 'any'), getFilterValues: (r: any) => r.source_zone && r.source_zone.length > 0 ? r.source_zone : ['any'] },
        { key: 'sourceAddress', label: 'Source Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.source_address), getFilterValues: (r: any) => getObjFilterVals(r.source_address) },
        { key: 'destinationZone', label: 'Destination Zone', width: '200px', renderCell: (v: any, r: any) => renderStringList(r.destination_zone, 'any'), getFilterValues: (r: any) => r.destination_zone && r.destination_zone.length > 0 ? r.destination_zone : ['any'] },
        { key: 'destinationAddress', label: 'Destination Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.destination_address), getFilterValues: (r: any) => getObjFilterVals(r.destination_address) },
        { key: 'protocol', label: 'Protocol', width: '160px', renderCell: (v: any, r: any) => r.protocol || 'any', getFilterValues: (r: any) => r.protocol || 'any' },
        { key: 'port', label: 'Port', width: '160px', renderCell: (v: any, r: any) => r.port || 'any', getFilterValues: (r: any) => r.port || 'any' },
        { key: 'application', label: 'Application', width: '200px', renderCell: (v: any, r: any) => renderObjectRefs(r.application), getFilterValues: (r: any) => getObjFilterVals(r.application) },
      ];
    }

    if (policyType === 'tunnel_inspection') {
      return [
        ...commonStart,
        actionCol,
        { key: 'protocols', label: 'Protocols', width: '200px', renderCell: (v: any, r: any) => r.protocols || 'any', getFilterValues: (r: any) => r.protocols || 'any' },
        { key: 'actionProfile', label: 'Action Profile', width: '200px', renderCell: (v: any, r: any) => r.action_profile || 'none', getFilterValues: (r: any) => r.action_profile || 'none' },
      ];
    }

    if (policyType === 'authentication') {
      return [
        ...commonStart,
        { key: 'sourceAddress', label: 'Source Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.source_address), getFilterValues: (r: any) => getObjFilterVals(r.source_address) },
        { key: 'destinationAddress', label: 'Destination Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.destination_address), getFilterValues: (r: any) => getObjFilterVals(r.destination_address) },
        { key: 'service', label: 'Service', width: '200px', renderCell: (v: any, r: any) => renderObjectRefs(r.service), getFilterValues: (r: any) => getObjFilterVals(r.service) },
        { key: 'application', label: 'Application', width: '200px', renderCell: (v: any, r: any) => renderObjectRefs(r.application), getFilterValues: (r: any) => getObjFilterVals(r.application) },
        actionCol,
        { key: 'authenticationProfile', label: 'Authentication Profile', width: '200px', renderCell: (v: any, r: any) => r.authentication_profile || 'none', getFilterValues: (r: any) => r.authentication_profile || 'none' },
        { key: 'logSetting', label: 'Log Profile', width: '200px', renderCell: (v: any, r: any) => r.log_setting || 'none', getFilterValues: (r: any) => r.log_setting || 'none' },
      ];
    }

    if (policyType === 'dos') {
      return [
        ...commonStart,
        { key: 'sourceAddress', label: 'Source Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.source_address), getFilterValues: (r: any) => getObjFilterVals(r.source_address) },
        { key: 'destinationAddress', label: 'Destination Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.destination_address), getFilterValues: (r: any) => getObjFilterVals(r.destination_address) },
        { key: 'service', label: 'Service', width: '200px', renderCell: (v: any, r: any) => renderObjectRefs(r.service), getFilterValues: (r: any) => getObjFilterVals(r.service) },
        { key: 'application', label: 'Application', width: '200px', renderCell: (v: any, r: any) => renderObjectRefs(r.application), getFilterValues: (r: any) => getObjFilterVals(r.application) },
        actionCol,
        { key: 'aggregateProfile', label: 'Aggregate Profile', width: '200px', renderCell: (v: any, r: any) => r.aggregate_profile || 'none', getFilterValues: (r: any) => r.aggregate_profile || 'none' },
        { key: 'classifiedProfile', label: 'Classified Profile', width: '200px', renderCell: (v: any, r: any) => r.classified_profile || 'none', getFilterValues: (r: any) => r.classified_profile || 'none' },
      ];
    }

    // Default: security
    return [
      ...commonStart,
      { key: 'sourceZone', label: 'Source Zone', width: '200px', renderCell: (v: any, r: any) => renderStringList(r.source_zone, 'any'), getFilterValues: (r: any) => r.source_zone && r.source_zone.length > 0 ? r.source_zone : ['any'] },
      { key: 'sourceAddress', label: 'Source Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.source_address), getFilterValues: (r: any) => getObjFilterVals(r.source_address) },
      { key: 'destinationZone', label: 'Destination Zone', width: '200px', renderCell: (v: any, r: any) => renderStringList(r.destination_zone, 'any'), getFilterValues: (r: any) => r.destination_zone && r.destination_zone.length > 0 ? r.destination_zone : ['any'] },
      { key: 'destinationAddress', label: 'Destination Address', width: '260px', renderCell: (v: any, r: any) => renderObjectRefs(r.destination_address), getFilterValues: (r: any) => getObjFilterVals(r.destination_address) },
      { key: 'application', label: 'Application', width: '200px', renderCell: (v: any, r: any) => renderObjectRefs(r.application), getFilterValues: (r: any) => getObjFilterVals(r.application) },
      { key: 'service', label: 'Service', width: '200px', renderCell: (v: any, r: any) => renderObjectRefs(r.service), getFilterValues: (r: any) => getObjFilterVals(r.service) },
      { key: 'category', label: 'URL Category', width: '200px', renderCell: (v: any, r: any) => renderStringList(r.category, 'any'), getFilterValues: (r: any) => r.category && r.category.length > 0 ? r.category : ['any'] },
      {
        key: 'profiles', label: 'Profiles', width: '200px', renderCell: (v: any, r: any) => {
          if (r.profile_type === 'group') return r.profile_group || 'none';
          if (r.profile_type === 'profiles') return renderStringList(r.profiles, 'none');
          return 'none';
        }, getFilterValues: (r: any) => {
          if (r.profile_type === 'group') return r.profile_group || 'none';
          if (r.profile_type === 'profiles') return r.profiles && r.profiles.length > 0 ? r.profiles : ['none'];
          return 'none';
        }
      },
      { key: 'logSetting', label: 'Log Profile', width: '200px', renderCell: (v: any, r: any) => r.log_setting || 'none', getFilterValues: (r: any) => r.log_setting || 'none' },
      actionCol
    ];
  }, [scopeNameMap, getVisibleScopes, rulebase, setActiveSubTab, policyType, getObjFilterVals]);

  const getGroupVal = useCallback((row: any) => {
    if (rulebase === 'device') {
      if (selectedScopeUuid === 'show-all') {
        return `${row.device_uuid}::${row._stack || ''}`;
      }
      return row._stack || '';
    }
    return row.device_uuid || '';
  }, [rulebase, selectedScopeUuid]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rules) {
      const val = getGroupVal(r);
      counts[val] = (counts[val] || 0) + 1;
    }
    return counts;
  }, [rules, getGroupVal]);

  const implementedTypes = ['security', 'nat', 'qos', 'pbf', 'decryption', 'application_override', 'tunnel_inspection', 'authentication', 'dos'];

  if (!rulebase || !implementedTypes.includes(policyType)) {
    const displayType = activeSubTab.split('-')[0]?.trim() || activeSubTab;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px' }}>
        <Shield size={48} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
        <h2 style={{ color: 'var(--text-main)', fontSize: '18px', fontWeight: 500, margin: 0 }}>{displayType} Policies</h2>
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
                  <span style={{ width: '95px', display: 'inline-block', fontSize: '12px', fontWeight: 500, color: 'var(--text-main)' }}>Device Group:</span>
                  <SearchableScopeDropdown
                    value={selectedScopeUuid}
                    options={hierarchyOptions}
                    onChange={handleScopeChange}
                    scopeNameMap={scopeNameMap}
                    ruleCounts={ruleCounts}
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
                                onClick={() => handleScopeChange(scopeId)}
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
                key={selectedScopeUuid}
                toolbarTitle={
                  <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                    {activeSubTab.split('-')[1]?.trim() || activeSubTab} ({rules.length})
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
                isFetching={isFetching}
                allowScrollPastEnd={true}
                groupByField={getGroupVal}
                groupByRender={(val) => {
                  const count = groupCounts[val] || 0;
                  if (rulebase === 'device') {
                    if (selectedScopeUuid === 'show-all') {
                      const [deviceUuid, stack] = val.split('::');
                      const scopeName = scopeNameMap[deviceUuid] || deviceUuid;
                      let label = stack || 'Rules';
                      if (label === 'Device Rules') label = 'Local Rules';
                      else if (!label.includes('Rules')) label = label + ' Rules';

                      return (
                        <span style={{ textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-main)' }}>
                          {label} ({count}) <span style={{ color: 'var(--text-muted)', margin: '0 8px' }}>•</span> {scopeName}
                        </span>
                      );
                    } else {
                      let label = val || 'Rules';
                      if (label === 'Device Rules') label = 'Local Rules';
                      return <span style={{ textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-main)' }}>{label} ({count})</span>;
                    }
                  } else {
                    // pre or post rulebase
                    const scopeName = scopeNameMap[val] || val;
                    return <span style={{ textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-main)' }}>{scopeName} ({count})</span>;
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
