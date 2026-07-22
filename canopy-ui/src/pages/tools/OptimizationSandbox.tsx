import React, { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Layers, Zap, Settings, Info, Hash, ChevronDown, ChevronRight, Check, CheckSquare, List as ListIcon, Grid, AlertTriangle, Package, Search, X } from 'lucide-react';
import { SearchBar } from '../../components/SearchBar';
import { CanopyApiClient } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { SearchableScopeDropdown } from '../../components/SearchableScopeDropdown';
import { useScopeHierarchy } from '../../hooks/useScopeHierarchy';
import { TokenizedFieldEditor } from '../../components/TokenizedFieldEditor';
import { GlobalObjectCrudModal } from '../../components/GlobalObjectCrudModal';

const GlobalConfirmSwapModal = ({ insight, onConfirm, onCancel }: any) => {
  const [excluded, setExcluded] = useState(new Set<string>());
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
      <div style={{ width: '450px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '8px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--text-main)' }}>Confirm Optimization Swap</h3>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ padding: '20px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Are you sure you want to swap <strong style={{ color: 'var(--accent-blue)' }}>{insight.matched_items?.length}</strong> items for <strong style={{ color: '#a78bfa' }}>{insight.target_name}</strong>?
          
          <div style={{ marginTop: '12px', marginBottom: '8px', color: 'var(--text-main)' }}>The following items will be removed from your inputs:</div>
          <div style={{ border: '1px solid var(--border-main)', borderRadius: '6px', maxHeight: '250px', overflowY: 'auto', backgroundColor: 'var(--bg-surface)' }}>
            {insight.matched_items?.map((item: string) => {
              const isKept = excluded.has(item);
              return (
                <label key={item} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: '1px solid var(--border-main)', cursor: 'pointer', backgroundColor: isKept ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                  <input type="checkbox" checked={!isKept} onChange={(e) => {
                    const next = new Set(excluded);
                    if (e.target.checked) next.delete(item);
                    else next.add(item);
                    setExcluded(next);
                  }} />
                  <span style={{ textDecoration: !isKept ? 'line-through' : 'none', color: !isKept ? 'var(--status-red)' : 'var(--text-main)' }}>{item}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-main)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'rgba(255,255,255,0.02)' }}>
          <button onClick={onCancel} style={{ padding: '6px 16px', background: 'transparent', border: '1px solid var(--border-main)', color: 'var(--text-main)', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>Cancel</button>
          <button onClick={() => onConfirm(excluded)} style={{ padding: '6px 16px', background: '#a78bfa', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>Confirm Swap</button>
        </div>
      </div>
    </div>
  );
};

interface OptimizationSandboxProps {
  apiClient?: CanopyApiClient;
  addToast?: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const OptimizationSandbox: React.FC<OptimizationSandboxProps> = ({ apiClient, addToast }) => {
  const [domainTab, setDomainTab] = useState<'addresses' | 'services' | 'applications'>('addresses');
  const [inputs, setInputs] = useState<string[]>([]);
  const [selectedScopeUuid, setSelectedScopeUuid] = useState('paloalto-panorama-global');

  useLayoutEffect(() => {
    setInputs([]);
  }, [selectedScopeUuid, domainTab]);
  
  const [cidrThresholdRaw, setCidrThresholdRaw] = useState<string>('3');
  const [groupToleranceRaw, setGroupToleranceRaw] = useState<string>('10');
  
  const cidrThreshold = isNaN(parseInt(cidrThresholdRaw)) ? 0 : parseInt(cidrThresholdRaw);
  const groupTolerance = isNaN(parseInt(groupToleranceRaw)) ? 1 : parseInt(groupToleranceRaw) / 100;

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [deviceGroups, setDeviceGroups] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [globalAddressObjects, setGlobalAddressObjects] = useState<any[]>([]);
  const [globalServiceObjects, setGlobalServiceObjects] = useState<any[]>([]);
  const [globalApplicationObjects, setGlobalApplicationObjects] = useState<any[]>([]);
  
  // Resizer state
  const [leftPaneWidth, setLeftPaneWidth] = useState(550);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, width: 0 });

  // Extraction State
  const [selectedInsightToExtract, setSelectedInsightToExtract] = useState<any>(null);
  const [extractStrictGroupName, setExtractStrictGroupName] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [confirmGlobalSwapInsight, setConfirmGlobalSwapInsight] = useState<any>(null);
  
  // Quick Add State
  const [quickAddModalData, setQuickAddModalData] = useState<{ value: string } | null>(null);

  // Policy Usages Modal State
  const [policyUsagesModalData, setPolicyUsagesModalData] = useState<{ targetName: string; domain: string; usageCount: number } | null>(null);
  const [policyUsages, setPolicyUsages] = useState<any[]>([]);
  const [isLoadingUsages, setIsLoadingUsages] = useState(false);

  const handleOpenPolicyUsages = async (targetName: string, domain: string, usageCount: number) => {
    setPolicyUsagesModalData({ targetName, domain, usageCount });
    setIsLoadingUsages(true);
    setPolicyUsages([]);
    try {
      const resp = await apiClient?.request<any>(`/api/policies/usages?scope=${selectedScopeUuid}&domain=${domain}&object_name=${encodeURIComponent(targetName)}`);
      if (resp) {
        setPolicyUsages(resp);
      }
    } catch (e) {
      if (addToast) addToast("Failed to fetch policy usages", "error");
    } finally {
      setIsLoadingUsages(false);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = e.clientX - dragStartRef.current.x;
      setLeftPaneWidth(Math.max(300, Math.min(dragStartRef.current.width + deltaX, 1200)));
    };
    const handleMouseUp = () => {
      if (isDraggingRef.current) {
         isDraggingRef.current = false;
         document.body.style.cursor = 'default';
         document.body.style.userSelect = 'auto';
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);
  
  const [viewMode, setViewMode] = useState<'list' | 'matrix'>('list');
  const [activeTab, setActiveTab] = useState<'all' | 'object' | 'group' | 'network'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedInsights, setExpandedInsights] = useState<Set<string>>(new Set());
  const [expandedMatrixRows, setExpandedMatrixRows] = useState<Set<number>>(new Set());

  const toggleMatrixRow = (idx: number) => {
    setExpandedMatrixRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const loadReferenceData = async () => {
    if (!apiClient) return;
    try {
      const objData = await apiClient.getObjectsReference();
      const allAddressObjects = [
        ...(objData.addresses || []),
        ...(objData.address_groups || [])
      ];
      setGlobalAddressObjects(allAddressObjects);

      const allServiceObjects = [
        ...(objData.services || []),
        ...(objData.service_groups || [])
      ];
      setGlobalServiceObjects(allServiceObjects);

      const allApplicationObjects = [
        ...(objData.applications || []),
        ...(objData.application_groups || [])
      ];
      setGlobalApplicationObjects(allApplicationObjects);
    } catch (err) {
      console.error('Failed to load objects reference data', err);
    }
  };

  // Load scope hierarchy and objects
  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      if (!apiClient) return;
      try {
        const scopeData = await apiClient.getPoliciesContext('security_rules', 'device');
        if (isMounted) {
          setDeviceGroups(scopeData.device_groups || []);
          setDevices(scopeData.devices || []);
          await loadReferenceData();
        }
      } catch (err) {
        console.error('Failed to load sandbox data', err);
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, [apiClient]);

  const { hierarchyOptions, scopeNameMap, getVisibleScopes } = useScopeHierarchy(deviceGroups, devices, { includeShowAll: false, firewallValueKey: 'uuid' });

  const validScopeUuids = useMemo(() => new Set(getVisibleScopes(selectedScopeUuid)), [getVisibleScopes, selectedScopeUuid]);
  
  const currentGlobalObjects = domainTab === 'addresses' ? globalAddressObjects : (domainTab === 'services' ? globalServiceObjects : globalApplicationObjects);
  
  const filteredObjects = useMemo(() => {
    return currentGlobalObjects.filter(obj => validScopeUuids.has(obj.device_uuid));
  }, [currentGlobalObjects, validScopeUuids]);

  const toggleSelectAll = () => {
    if (inputs.length > 0) setInputs([]);
    else {
      // In this sandbox, just as a placeholder, maybe select all from visible objects
      setInputs(filteredObjects.map((o: any) => o.name));
    }
  };

  const handleOptimize = useCallback(async () => {
    if (!apiClient) return;
    if (inputs.length === 0) {
      setResults([]);
      return;
    }

    setIsOptimizing(true);
    setError(null);

    try {
      const res = await apiClient.optimizeObjects({
        scope_uuid: selectedScopeUuid,
        domain: domainTab === 'addresses' ? 'address' : (domainTab === 'services' ? 'service' : 'application'),
        inputs: inputs,
        cidr_threshold: cidrThreshold,
        group_tolerance: groupTolerance / 100
      });
      const validInsights = (res.insights || []).filter((insight: any) => {
        if ((insight.type === 'object' || insight.type === 'network') && insight.matched_items?.length === 1) {
          if (insight.matched_items[0] === insight.target_name) {
            return false;
          }
        }
        return true;
      });
      setResults(validInsights);
    } catch (err: any) {
      setError(err.message || 'Failed to optimize objects');
    } finally {
      setIsOptimizing(false);
    }
  }, [apiClient, inputs, cidrThreshold, groupTolerance, selectedScopeUuid]);

  const handleExtractStrictGroup = async () => {
    if (!apiClient || !selectedInsightToExtract || !extractStrictGroupName.trim()) return;
    setIsExtracting(true);
    try {
      // Find all covered leaf nodes recursively
      const coveredLeaves: string[] = [];
      const extractLeaves = (nodes: any[]) => {
        nodes.forEach(node => {
          if (node.is_covered) {
            if (node.children && node.children.length > 0) {
              extractLeaves(node.children);
            } else {
              coveredLeaves.push(node.name);
            }
          }
        });
      };
      
      if (selectedInsightToExtract.nested_tree) {
        extractLeaves(selectedInsightToExtract.nested_tree);
      }

      if (coveredLeaves.length === 0) {
        if (addToast) addToast("No covered members found to extract.", "error");
        setIsExtracting(false);
        return;
      }

      let activeScopeName = scopeNameMap[selectedScopeUuid] || 'Shared';
      if (selectedScopeUuid === 'paloalto-panorama-global' || activeScopeName === 'Shared') {
        activeScopeName = 'shared';
      }

      const payload = {
        device_uuid: selectedScopeUuid,
        scope: activeScopeName,
        name: extractStrictGroupName.trim(),
        description: `Strict optimization group extracted from ${selectedInsightToExtract.target_name}`,
        type: 'static',
        filter: '',
        members: coveredLeaves,
        tags: []
      };

      if (domainTab === 'addresses') {
        await apiClient.createAddressGroup(payload);
      } else if (domainTab === 'services') {
        await apiClient.createServiceGroup(payload);
      } else {
        await apiClient.createApplicationGroup(payload);
      }

      if (addToast) addToast(`Successfully extracted strict group '${payload.name}' with ${coveredLeaves.length} members.`, 'success');
      
      setSelectedInsightToExtract(null);
      setExtractStrictGroupName('');
    } catch (e: any) {
      if (addToast) addToast(e.message || "Failed to extract strict group.", "error");
    } finally {
      setIsExtracting(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      handleOptimize();
    }, 500);
    return () => clearTimeout(timer);
  }, [handleOptimize]);

  const executeApplyOptimization = (insight: any, excluded: Set<string>) => {
    let newInputs = [...inputs];
    
    insight.matched_items.forEach((item: string) => {
      if (!excluded.has(item)) {
        newInputs = newInputs.filter(v => v !== item);
      }
    });

    if (!newInputs.includes(insight.target_name)) {
      newInputs.push(insight.target_name);
    }
    setInputs(newInputs);
    setConfirmGlobalSwapInsight(null);
    
    // Rerun optimization automatically after swap
    setTimeout(() => {
      handleOptimize();
    }, 100);
  };

  const handleApplyOptimization = (insight: any) => {
    setConfirmGlobalSwapInsight(insight);
  };

  const toggleExpand = (targetName: string) => {
    const next = new Set(expandedInsights);
    if (next.has(targetName)) {
      next.delete(targetName);
    } else {
      next.add(targetName);
    }
    setExpandedInsights(next);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'group': return <Layers size={14} color="var(--accent-blue)" />;
      case 'network': return <Hash size={14} color="var(--status-green)" />;
      case 'object': return <Package size={14} color="var(--status-green)" />;
      default: return <Layers size={14} color="var(--accent-blue)" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'group': return 'var(--accent-blue)';
      case 'network': return 'var(--status-green)';
      default: return 'var(--accent-blue)';
    }
  };

  const renderNestedTree = (nodes: any[], depth = 0) => {
    if (!nodes || nodes.length === 0) return null;
    return (
      <ul style={depth === 0 ? { paddingLeft: 0, listStyleType: 'none', margin: 0 } : { paddingLeft: '22px', listStyleType: 'none', margin: '4px 0 0 7px', borderLeft: '1px solid var(--border-main)' }}>
        {nodes.map((node, idx) => (
          <li key={idx} style={{ marginTop: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {node.type === 'group' ? <Layers size={14} color="var(--accent-blue)" /> : <Package size={14} color="var(--status-green)" />}
              <span title={node.value ? `${node.name}\nValue: ${node.value}` : node.name} style={{ fontSize: '13px', color: 'var(--text-main)', fontWeight: node.type === 'group' ? 600 : 400 }}>
                {node.name}
              </span>
              {node.value && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>[{node.value}]</span>}
              {node.type !== 'group' && (
                node.is_covered ? (
                  <span style={{ marginLeft: 'auto', fontSize: '10px', backgroundColor: 'rgba(52, 211, 153, 0.1)', color: 'var(--status-green)', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid rgba(52, 211, 153, 0.2)' }}>
                    <Check size={10} /> Covered
                  </span>
                ) : (
                  <span style={{ marginLeft: 'auto', fontSize: '10px', backgroundColor: 'rgba(192, 132, 252, 0.15)', color: 'var(--purple-400)', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', fontWeight: 600, border: '1px solid rgba(192, 132, 252, 0.3)' }}>
                    + New
                  </span>
                )
              )}
            </div>
            {node.children && node.children.length > 0 && renderNestedTree(node.children, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };

  const filteredResults = useMemo(() => {
    let r = activeTab === 'all' ? results : results.filter(x => x.type === activeTab);
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const checkNested = (members: any[] | undefined): boolean => {
        if (!members) return false;
        return members.some(m => 
          m.name.toLowerCase().includes(q) || 
          (m.value && m.value.toLowerCase().includes(q)) || 
          checkNested(m.children)
        );
      };

      r = r.filter(x => 
        x.target_name.toLowerCase().includes(q) || 
        x.matched_items.some((i: string) => i.toLowerCase().includes(q)) ||
        checkNested(x.nested_members)
      );
    }

    // Sort by most impactful
    r.sort((a, b) => {
      // 1. Perfect matches first (missing_count === 0, but total_members > 1 to avoid trivial 1:1s if groups exist)
      const aIsPerfect = a.type === 'group' && a.missing_count === 0;
      const bIsPerfect = b.type === 'group' && b.missing_count === 0;
      
      if (aIsPerfect && !bIsPerfect) return -1;
      if (!aIsPerfect && bIsPerfect) return 1;

      // 2. Sort by number of matched items
      return b.matched_items.length - a.matched_items.length;
    });

    return r;
  }, [results, activeTab, searchQuery]);

  const allMatchedItems = Array.from(new Set(filteredResults.flatMap(r => r.matched_items)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}>
      <PageHeader 
        title="Optimization Sandbox" 
        description={domainTab === 'addresses' 
          ? "Paste IPs, CIDRs, or Object names to find aggregation opportunities. Validate grouping rules safely before applying them in policies."
          : domainTab === 'services' 
            ? "Paste raw ports, or Service Object names to find aggregation opportunities. Validate grouping rules safely before applying them."
            : "Paste raw Application IDs or Application Group names to find aggregation opportunities. Validate grouping rules safely before applying them."}
      />
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-main)', padding: '0 32px' }}>
        <button
          onClick={() => setDomainTab('addresses')}
          style={{ padding: '16px 24px', background: 'transparent', border: 'none', borderBottom: domainTab === 'addresses' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: domainTab === 'addresses' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
        >
          Addresses
        </button>
        <button
          onClick={() => setDomainTab('services')}
          style={{ padding: '16px 24px', background: 'transparent', border: 'none', borderBottom: domainTab === 'services' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: domainTab === 'services' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
        >
          Services
        </button>
        <button
          onClick={() => setDomainTab('applications')}
          style={{ padding: '16px 24px', background: 'transparent', border: 'none', borderBottom: domainTab === 'applications' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: domainTab === 'applications' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
        >
          Applications
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: '32px 0 0 0' }}>
        {/* LEFT PANE: Inputs & Controls */}
        <div data-boundary="left-pane" style={{ width: leftPaneWidth, flexShrink: 0, padding: '24px', border: '1px solid var(--border-main)', borderRadius: '8px', backgroundColor: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Administrative Scope
            </label>
            <div style={{ width: '100%' }}>
              <SearchableScopeDropdown
                value={selectedScopeUuid}
                onChange={setSelectedScopeUuid}
                options={hierarchyOptions}
                scopeNameMap={scopeNameMap}
                hasValuesMap={{}}
                width="100%"
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0, overflow: 'hidden' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <Package size={14} style={{ color: '#a78bfa' }} />
              Source Inputs {inputs.length > 0 && `(${inputs.length})`}
            </label>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.4 }}>
              {domainTab === 'addresses' 
                ? "Paste raw IPs, CIDRs, or Object names. The sandbox will identify aggregation opportunities without modifying existing policies."
                : domainTab === 'services'
                  ? "Paste raw ports (e.g. tcp/80, udp/53), or Service Object names. The sandbox will identify aggregation opportunities without modifying existing policies."
                  : "Paste raw Application IDs, or Application Object names. The sandbox will identify aggregation opportunities without modifying existing policies."}
            </div>
            <TokenizedFieldEditor
              values={inputs}
              onChange={setInputs}
              options={filteredObjects}
              addToast={addToast}
              scopeNameMap={scopeNameMap}
              groupTolerance={groupTolerance}
              cidrThreshold={cidrThreshold}
              domain={domainTab === 'addresses' ? 'address' : (domainTab === 'services' ? 'service' : 'application')}
              insights={results}
              onAddObject={(val) => setQuickAddModalData({ value: val })}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  CIDR Threshold
                </label>
                <input
                  type="number"
                  min="0"
                  className="input-text"
                  style={{ width: '100%' }}
                  value={cidrThresholdRaw}
                  onChange={(e) => setCidrThresholdRaw(e.target.value)}
                  onBlur={() => {
                    if (cidrThresholdRaw.trim() === '') setCidrThresholdRaw('0');
                  }}
                />
              </div>
              
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Group Tolerance (%)
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  className="input-text"
                  style={{ width: '100%' }}
                  value={groupToleranceRaw}
                  onChange={(e) => setGroupToleranceRaw(e.target.value)}
                  onBlur={() => {
                    if (groupToleranceRaw.trim() === '') setGroupToleranceRaw('100');
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* RESIZER */}
        <div 
          onMouseDown={(e) => {
             isDraggingRef.current = true;
             dragStartRef.current = { x: e.clientX, width: leftPaneWidth };
             document.body.style.cursor = 'col-resize';
             document.body.style.userSelect = 'none';
          }}
          style={{ 
             width: '32px', 
             cursor: 'col-resize', 
             flexShrink: 0, 
             display: 'flex', 
             justifyContent: 'center', 
             alignItems: 'center' 
          }}
        >
          <div 
            style={{ 
               width: '4px', 
               height: '40px', 
               backgroundColor: 'var(--border-main)', 
               borderRadius: '2px',
               transition: 'background-color 0.2s'
            }} 
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--text-muted)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--border-main)'}
          />
        </div>

        {/* RIGHT PANE: Results Area */}
        <div style={{ flex: 1, overflow: 'hidden', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '8px', display: 'flex', flexDirection: 'column' }}>
          
          {/* Header */}
          <div style={{ padding: '16px 24px 0 24px', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                Optimization Insights {results.length > 0 && <span style={{ color: 'var(--text-muted)' }}>({results.length})</span>}
              </h2>
              {results.length > 0 && (
                <SearchBar width="280px" historyKey="optimization-sandbox-history" value={searchQuery} onChange={setSearchQuery} placeholder={domainTab === 'addresses' ? "Search Groups, IPs, or Objects..." : domainTab === 'services' ? "Search Groups, Ports, or Objects..." : "Search Groups or Applications..."} variant="local" />
              )}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              <span style={{ color: 'var(--text-main)' }}>Type:</span> Sandbox Analysis
            </div>
            <div style={{ fontSize: '12px', color: 'var(--accent-blue)' }}>
              Validate grouping rules safely before applying them in policies
            </div>
          </div>

          {results.length > 0 && (
            <div style={{ padding: '16px 0 0 0', margin: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-main)', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: '16px' }}>
                {[
                  { id: 'all', label: 'All Results' },
                  { id: 'group', label: 'Groups' },
                  { id: 'object', label: '1:1 Replacement' },
                  { id: 'network', label: domainTab === 'addresses' ? 'CIDRs' : 'Ranges' }
                ].map(tab => {
                  const count = tab.id === 'all' ? results.length : results.filter(r => r.type === tab.id).length;
                  if (count === 0 && tab.id !== 'all') return null;
                  const isActive = activeTab === tab.id;
                  
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      style={{
                        padding: '12px 4px',
                        backgroundColor: 'transparent',
                        border: 'none',
                        borderBottom: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
                        color: isActive ? 'var(--text-main)' : 'var(--text-muted)',
                        fontSize: '13px',
                        fontWeight: isActive ? 600 : 400,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '-1px',
                        transition: 'all 0.2s'
                      }}
                    >
                      {tab.label} ({count})
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', backgroundColor: 'var(--bg-element)', borderRadius: '6px', padding: '4px' }}>
                <button
                  onClick={() => setViewMode('list')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 16px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', cursor: 'pointer',
                    backgroundColor: viewMode === 'list' ? 'var(--bg-surface)' : 'transparent',
                    color: viewMode === 'list' ? 'var(--text-main)' : 'var(--text-muted)',
                    boxShadow: viewMode === 'list' ? '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)' : 'none',
                    border: 'none', transition: 'all 0.2s'
                  }}
                >
                  <ListIcon size={14} /> List
                </button>
                <button
                  onClick={() => setViewMode('matrix')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 16px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', cursor: 'pointer',
                    backgroundColor: viewMode === 'matrix' ? 'var(--bg-surface)' : 'transparent',
                    color: viewMode === 'matrix' ? 'var(--text-main)' : 'var(--text-muted)',
                    boxShadow: viewMode === 'matrix' ? '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)' : 'none',
                    border: 'none', transition: 'all 0.2s'
                  }}
                >
                  <Grid size={14} /> Matrix
                </button>
              </div>
            </div>
          )}

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            {error && (
              <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', padding: '16px', margin: '16px 24px', color: 'var(--status-red)', fontSize: '13px', flexShrink: 0 }}>
                {error}
              </div>
            )}

            {!isOptimizing && results.length === 0 && !error && (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <EmptyState
                  icon={<Settings size={40} color="var(--text-muted)" />}
                  title="Ready for Analysis"
                  description="Paste items and click Run Optimization to see aggregation opportunities."
                />
              </div>
            )}

            {/* List View */}
            {filteredResults.length > 0 && viewMode === 'list' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', scrollbarGutter: 'stable', flex: 1, padding: '16px 24px 24px 24px' }} className="custom-scrollbar">
                {filteredResults.map((insight, idx) => {
                  const isExpanded = expandedInsights.has(insight.target_name);
                  return (
                    <div key={idx} style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
                      
                      {/* Header Row */}
                      <div 
                        onClick={() => toggleExpand(insight.target_name)}
                        style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', backgroundColor: 'var(--bg-surface)', gap: '24px' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-surface)'}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                          <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>
                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {insight.type === 'group' ? (
                            <>
                              <span style={{ fontSize: '14px', color: 'var(--text-main)' }}>
                                <strong style={{ color: 'var(--text-main)' }}>{insight.covered_members}</strong> out of <strong>{insight.total_members}</strong> members of <strong style={{ color: getTypeColor(insight.type) }}>{insight.target_name}</strong> are covered.
                              </span>
                              {insight.missing_count === 0 ? (
                                <span style={{ fontSize: '11px', color: 'var(--status-green)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <Check size={12} /> Perfect Match: All {insight.total_members} nested objects are already covered by the rule.
                                </span>
                              ) : (
                                <span style={{ fontSize: '11px', color: 'var(--status-warn)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <AlertTriangle size={12} /> Note: Swapping will grant access to {insight.missing_count} additional dormant nested objects (Currently {insight.covered_members}/{insight.total_members} covered).
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              <span style={{ fontSize: '14px', color: 'var(--text-main)' }}>
                                <strong style={{ color: 'var(--text-main)' }}>{insight.coverage_count}</strong> items in <strong>your inputs</strong> can be swapped for the broader {insight.type === 'object' ? 'object' : (insight.type === 'network' ? (domainTab === 'addresses' ? 'network' : 'range') : insight.type)} <strong style={{ color: getTypeColor(insight.type) }}>{insight.target_name}</strong>.
                              </span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Check size={12} color="var(--status-green)" /> Swaps {insight.coverage_count} items for 1 object.
                              </span>
                            </>
                          )}
                        </div>
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0, width: '160px' }}>
                          {insight.usage_count > 0 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleOpenPolicyUsages(insight.target_name, domainTab === 'addresses' ? 'address' : (domainTab === 'services' ? 'service' : 'application'), insight.usage_count); }}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', backgroundColor: 'rgba(255,165,0,0.1)', border: '1px solid rgba(255,165,0,0.3)', padding: '6px 12px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--status-warn)', cursor: 'pointer', width: '100%', transition: 'background-color 0.2s' }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,165,0,0.2)'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,165,0,0.1)'}
                            >
                              <Zap size={12} /> {insight.usage_count} Policies
                            </button>
                          )}
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleApplyOptimization(insight); }}
                            className="btn-primary"
                            style={{ padding: '6px 16px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', whiteSpace: 'nowrap', width: '100%' }}
                          >
                            <Layers size={14} /> Swap Matches
                          </button>
                          {insight.type === 'group' && insight.missing_count > 0 && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); setSelectedInsightToExtract(insight); setExtractStrictGroupName(`${insight.target_name}_strict`); }}
                              className="btn-secondary"
                              style={{ padding: '6px 16px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', whiteSpace: 'nowrap', width: '100%' }}
                            >
                              <CheckSquare size={14} /> Extract Strict Group
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded Body */}
                      {isExpanded && (
                        <div style={{ borderTop: '1px solid var(--border-main)', backgroundColor: 'rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column' }}>
                          {insight.nested_tree && insight.nested_tree.length > 0 ? (
                            <div style={{ padding: '24px' }}>
                              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Layers size={14} color="var(--text-muted)" /> NESTED MEMBERS
                              </div>
                              <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '6px', padding: '16px', maxHeight: '300px', overflowY: 'auto' }} className="custom-scrollbar">
                                {renderNestedTree(insight.nested_tree)}
                              </div>
                            </div>
                          ) : (
                            <div style={{ padding: '24px' }}>
                              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-main)', textTransform: 'uppercase', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Check size={14} color="var(--status-green)" /> ITEMS TO SWAP ({insight.matched_items.length})
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {insight.matched_items.map((item: string, i: number) => (
                                  <span key={i} style={{ padding: '4px 8px', backgroundColor: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.2)', color: 'var(--status-green)', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}>
                                    {item}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Matrix View */}
            {filteredResults.length > 0 && viewMode === 'matrix' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, border: '1px solid var(--border-main)', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--bg-surface)', margin: '16px 24px 24px 24px' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-main)', backgroundColor: 'var(--bg-app)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-main)', flexShrink: 0 }}>
                   <Layers size={14} color="var(--text-muted)" /> ADDRESS MATRIX
                </div>
                <div style={{ flex: 1, overflow: 'auto' }} className="custom-scrollbar">
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                    <thead style={{ backgroundColor: 'var(--bg-element)' }}>
                      <tr>
                        <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-main)', position: 'sticky', left: 0, top: 0, backgroundColor: 'var(--bg-element)', zIndex: 30, minWidth: '200px', boxShadow: 'inset -1px 0 0 var(--border-main), 4px 0 8px rgba(0, 0, 0, 0.15)' }}>
                          Common Group
                        </th>
                        {allMatchedItems.map((item, i) => (
                          <th key={i} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-main)', borderRight: '1px solid var(--border-main)', textAlign: 'center', whiteSpace: 'nowrap', fontFamily: 'monospace', color: 'var(--text-muted)', position: 'sticky', top: 0, zIndex: 20, backgroundColor: 'var(--bg-element)' }}>
                            {item}
                          </th>
                        ))}
                        <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-main)', borderLeft: '1px solid var(--border-main)', textAlign: 'center', width: '120px', position: 'sticky', top: 0, zIndex: 20, backgroundColor: 'var(--bg-element)' }}>
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResults.map((insight, idx) => {
                        const defaultBg = 'transparent';
                        const stickyDefaultBg = 'var(--bg-surface)';
                        const stickyHoverBg = 'var(--bg-element)';
                        return (
                          <React.Fragment key={idx}>
                            <tr 
                              style={{ borderBottom: '1px solid var(--border-main)', backgroundColor: defaultBg }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                              const stickyTd = e.currentTarget.querySelector('td') as HTMLElement;
                              if (stickyTd) stickyTd.style.backgroundColor = stickyHoverBg;
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = defaultBg;
                              const stickyTd = e.currentTarget.querySelector('td') as HTMLElement;
                              if (stickyTd) stickyTd.style.backgroundColor = stickyDefaultBg;
                            }}
                          >
                            <td style={{ padding: '12px 16px', position: 'sticky', left: 0, backgroundColor: stickyDefaultBg, zIndex: 10, transition: 'background-color 0.2s', boxShadow: 'inset -1px 0 0 var(--border-main), 4px 0 8px rgba(0, 0, 0, 0.15)' }}>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontWeight: 600, color: getTypeColor(insight.type), display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  {insight.type === 'group' && (
                                    <button 
                                      onClick={() => toggleMatrixRow(idx)}
                                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0, color: 'var(--text-muted)' }}
                                    >
                                      {expandedMatrixRows.has(idx) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    </button>
                                  )}
                                  {getTypeIcon(insight.type)} {insight.target_name}
                                  {insight.usage_count > 0 && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', backgroundColor: 'rgba(255,165,0,0.1)', border: '1px solid rgba(255,165,0,0.2)', padding: '2px 6px', borderRadius: '12px', fontSize: '9px', fontWeight: 600, color: 'var(--status-warn)', marginLeft: '8px' }}>
                                      <Zap size={9} /> {insight.usage_count} Policies
                                    </span>
                                  )}
                                </span>
                                {insight.type === 'group' ? (
                                  <>
                                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                      {insight.nested_tree ? insight.nested_tree.filter((n: any) => n.is_covered).length : 0} / {insight.nested_tree ? insight.nested_tree.length : 0} members covered ({insight.covered_members}/{insight.total_members} nested)
                                    </span>
                                    {insight.missing_count === 0 ? (
                                      <span style={{ fontSize: '10px', color: 'var(--status-green)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Check size={10} /> Perfect Match
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: '10px', color: 'var(--status-warn)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <AlertTriangle size={10} /> {insight.missing_count} dormant nested
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                      {insight.coverage_count} items fit in object
                                    </span>
                                    <span style={{ fontSize: '10px', color: 'var(--status-green)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                      <Check size={10} /> Consolidates {insight.coverage_count} items
                                    </span>
                                  </>
                                )}
                              </div>
                            </td>
                            {allMatchedItems.map((item, i) => (
                              <td key={i} style={{ padding: '12px 16px', borderRight: '1px solid var(--border-main)', textAlign: 'center' }}>
                              {insight.matched_items.includes(item) ? (
                                <Check size={16} strokeWidth={2} color="var(--status-green)" style={{ display: 'block', margin: '0 auto', opacity: 0.9 }} />
                              ) : (
                                <span style={{ color: 'var(--text-muted)', opacity: 0.5, fontWeight: 600 }}>-</span>
                              )}
                            </td>
                            ))}
                            <td style={{ padding: '12px 16px', borderLeft: '1px solid var(--border-main)', textAlign: 'center' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <button
                                  onClick={() => handleApplyOptimization(insight)}
                                  className="btn-primary"
                                  style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', width: '100%', whiteSpace: 'nowrap' }}
                                >
                                  <Layers size={12} /> Swap Matches
                                </button>
                                {insight.type === 'group' && insight.missing_count > 0 && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setSelectedInsightToExtract(insight); setExtractStrictGroupName(`${insight.target_name}_strict`); }}
                                    className="btn-secondary"
                                    style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', width: '100%', whiteSpace: 'nowrap' }}
                                  >
                                    <CheckSquare size={12} /> Extract Strict
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {insight.type === 'group' && expandedMatrixRows.has(idx) && (
                            <tr style={{ backgroundColor: 'rgba(0,0,0,0.1)', borderBottom: '1px solid var(--border-main)' }}>
                              <td colSpan={allMatchedItems.length + 2} style={{ padding: '24px 24px 24px 48px' }}>
                                <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <Layers size={14} color="var(--text-muted)" /> NESTED MEMBERS
                                </div>
                                {renderNestedTree(insight.nested_tree)}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Extract Strict Group Modal */}
      {selectedInsightToExtract && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-main, #1E1E24)', border: '1px solid var(--border-main)',
            borderRadius: '8px', padding: '24px', width: '400px',
            display: 'flex', flexDirection: 'column', gap: '16px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckSquare size={18} /> Extract Strict Group
              </h3>
              <button onClick={() => { setSelectedInsightToExtract(null); setExtractStrictGroupName(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
              You are extracting a strict Custom Group containing only the <strong>{selectedInsightToExtract.covered_members}</strong> covered members from <strong style={{ color: 'var(--text-main)' }}>{selectedInsightToExtract.target_name}</strong>.
            </p>
            
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                New Group Name
              </label>
              <div style={{ position: 'relative' }}>
                <input 
                  type="text" 
                  value={extractStrictGroupName}
                  onChange={e => setExtractStrictGroupName(e.target.value)}
                  placeholder={`e.g. ${selectedInsightToExtract.target_name}_strict`}
                  style={{
                    width: '100%', padding: '8px 32px 8px 12px',
                    backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-main)',
                    color: 'var(--text-main)', borderRadius: '4px', fontSize: '14px', outline: 'none'
                  }}
                  autoFocus
                />
                {extractStrictGroupName && (
                  <button 
                    onClick={() => setExtractStrictGroupName('')}
                    style={{
                      position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px'
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
              <button onClick={() => { setSelectedInsightToExtract(null); setExtractStrictGroupName(''); }} className="btn-secondary" style={{ padding: '8px 16px' }} disabled={isExtracting}>Cancel</button>
              <button onClick={handleExtractStrictGroup} className="btn-primary" style={{ padding: '8px 16px' }} disabled={isExtracting || !extractStrictGroupName.trim()}>
                {isExtracting ? 'Extracting...' : 'Extract Group'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Policy Usages Modal */}
      {policyUsagesModalData && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)',
            borderRadius: '8px', width: '600px', maxHeight: '80vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border-main)' }}>
              <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Zap size={18} color="var(--status-warn)" /> {policyUsagesModalData.usageCount} Policies Referencing {policyUsagesModalData.targetName}
              </h3>
              <button onClick={() => setPolicyUsagesModalData(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }} className="custom-scrollbar">
              {isLoadingUsages ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  Loading policies...
                </div>
              ) : policyUsages.length === 0 ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  No policies found.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', padding: '8px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-main)' }}>
                    <div style={{ flex: 1 }}>Rule Name</div>
                    <div style={{ width: '120px' }}>Type</div>
                    <div style={{ width: '100px' }}>Direction</div>
                  </div>
                  {policyUsages.map((usage, idx) => (
                    <div key={`${usage.rule_type}-${usage.id}-${idx}`} style={{ display: 'flex', padding: '8px 12px', fontSize: '13px', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '4px', border: '1px solid var(--border-main)' }}>
                      <div style={{ flex: 1, color: 'var(--text-main)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {usage.rule_name}
                      </div>
                      <div style={{ width: '120px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                        {usage.rule_type}
                      </div>
                      <div style={{ width: '100px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                        {usage.direction || '-'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 24px', borderTop: '1px solid var(--border-main)' }}>
              <button onClick={() => setPolicyUsagesModalData(null)} className="btn-secondary" style={{ padding: '8px 16px' }}>Close</button>
            </div>
          </div>
        </div>
      )}
      {quickAddModalData && (
        <GlobalObjectCrudModal
          isOpen={!!quickAddModalData}
          onClose={() => setQuickAddModalData(null)}
          onSuccess={async (newObjectName?: string) => {
            await loadReferenceData();
            if (newObjectName && quickAddModalData) {
              setInputs(prev => {
                const newInputs = [...prev];
                const index = newInputs.indexOf(quickAddModalData.value);
                if (index !== -1) {
                  newInputs[index] = newObjectName;
                } else {
                  if (!newInputs.includes(newObjectName)) {
                    newInputs.push(newObjectName);
                  }
                }
                return newInputs;
              });
            }
            setQuickAddModalData(null);
          }}
          mode="create"
          objectType={domainTab === 'addresses' ? 'Address Objects' : (domainTab === 'services' ? 'Services' : 'Applications')}
          defaultName={`host_${quickAddModalData.value}`}
          defaultValue={quickAddModalData.value}
          defaultScopeUuid={selectedScopeUuid}
          apiClient={apiClient}
          addToast={addToast as any}
        />
      )}
      {confirmGlobalSwapInsight && createPortal(
        <GlobalConfirmSwapModal
          insight={confirmGlobalSwapInsight}
          onCancel={() => setConfirmGlobalSwapInsight(null)}
          onConfirm={(excluded: Set<string>) => executeApplyOptimization(confirmGlobalSwapInsight, excluded)}
        />,
        document.body
      )}
    </div>
  );
};

