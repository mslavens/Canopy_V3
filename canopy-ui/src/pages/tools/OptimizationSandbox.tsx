import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { Layers, Zap, Settings, Info, Hash, ChevronDown, ChevronRight, Check, CheckSquare, List as ListIcon, Grid, AlertTriangle, Package, Search } from 'lucide-react';
import { SearchBar } from '../../components/SearchBar';
import { CanopyApiClient } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { SearchableScopeDropdown } from '../../components/SearchableScopeDropdown';
import { useScopeHierarchy } from '../../hooks/useScopeHierarchy';
import { TokenizedFieldEditor } from '../../components/TokenizedFieldEditor';

interface OptimizationSandboxProps {
  apiClient?: CanopyApiClient;
  addToast?: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const OptimizationSandbox: React.FC<OptimizationSandboxProps> = ({ apiClient, addToast }) => {
  const [inputs, setInputs] = useState<string[]>([]);
  const [selectedScopeUuid, setSelectedScopeUuid] = useState('paloalto-panorama-global');

  useLayoutEffect(() => {
    setInputs([]);
  }, [selectedScopeUuid]);
  
  const [cidrThreshold, setCidrThreshold] = useState<number>(3);
  const [groupTolerance, setGroupTolerance] = useState<number>(0.8);

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [deviceGroups, setDeviceGroups] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [globalObjects, setGlobalObjects] = useState<any[]>([]);
  
  // Resizer state
  const [leftPaneWidth, setLeftPaneWidth] = useState(550);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, width: 0 });

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

  // Load scope hierarchy and objects
  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      if (!apiClient) return;
      try {
        const [scopeData, objData] = await Promise.all([
          apiClient.getPoliciesContext('security_rules', 'device'),
          apiClient.getObjectsReference()
        ]);
        if (isMounted) {
          setDeviceGroups(scopeData.device_groups || []);
          setDevices(scopeData.devices || []);
          
          const allAddressObjects = [
            ...(objData.addresses || []),
            ...(objData.address_groups || [])
          ];
          setGlobalObjects(allAddressObjects);
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
  
  const filteredObjects = useMemo(() => {
    return globalObjects.filter(obj => validScopeUuids.has(obj.device_uuid));
  }, [globalObjects, validScopeUuids]);

  const toggleSelectAll = () => {
    if (inputs.length > 0) setInputs([]);
    else {
      // In this sandbox, just as a placeholder, maybe select all from visible objects
      setInputs(filteredObjects.map((o: any) => o.name));
    }
  };

  const handleOptimize = async () => {
    if (!apiClient) return;
    if (inputs.length === 0) return;

    setIsOptimizing(true);
    setError(null);
    setResults([]);

    try {
      const res = await apiClient.optimizeObjects({
        scope_uuid: selectedScopeUuid,
        inputs: inputs,
        cidr_threshold: cidrThreshold,
        group_tolerance: groupTolerance
      });
      setResults(res.insights || []);
    } catch (err: any) {
      setError(err.message || 'Failed to optimize objects');
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleApplyOptimization = (insight: any) => {
    let newInputs = [...inputs];
    
    insight.matched_items.forEach((item: string) => {
      newInputs = newInputs.filter(v => v !== item);
    });

    if (!newInputs.includes(insight.target_name)) {
      newInputs.push(insight.target_name);
    }
    setInputs(newInputs);
    
    // Rerun optimization automatically after swap
    setTimeout(() => {
      handleOptimize();
    }, 100);
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
              <span style={{ fontSize: '13px', color: 'var(--text-main)', fontWeight: node.type === 'group' ? 600 : 400 }}>
                {node.name}
              </span>
              {node.value && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>[{node.value}]</span>}
              {node.type !== 'group' && (
                node.is_covered ? (
                  <span style={{ fontSize: '10px', backgroundColor: 'rgba(52, 211, 153, 0.1)', color: 'var(--status-green)', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid rgba(52, 211, 153, 0.2)' }}>
                    <Check size={10} /> Covered
                  </span>
                ) : (
                  <span style={{ fontSize: '10px', backgroundColor: 'rgba(192, 132, 252, 0.15)', color: 'var(--purple-400)', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', fontWeight: 600, border: '1px solid rgba(192, 132, 252, 0.3)' }}>
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

  const filteredResults = (activeTab === 'all' ? results : results.filter(r => r.type === activeTab)).filter(r => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    
    const checkNested = (members: any[] | undefined): boolean => {
      if (!members) return false;
      return members.some(m => 
        m.name.toLowerCase().includes(q) || 
        (m.value && m.value.toLowerCase().includes(q)) || 
        checkNested(m.children)
      );
    };

    return r.target_name.toLowerCase().includes(q) || 
           r.matched_items.some((i: string) => i.toLowerCase().includes(q)) ||
           checkNested(r.nested_members);
  });
  const allMatchedItems = Array.from(new Set(filteredResults.flatMap(r => r.matched_items)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}>
      <PageHeader 
        title="Optimization Sandbox" 
        description="Paste IPs, CIDRs, or Object names to find aggregation opportunities. Validate grouping rules safely before applying them in policies." 
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: '48px 0 0 0' }}>
        {/* LEFT PANE: Inputs & Controls */}
        <div style={{ width: leftPaneWidth, flexShrink: 0, padding: '24px', border: '1px solid var(--border-main)', borderRadius: '8px', backgroundColor: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto' }}>
          
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
              Source Inputs
            </label>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.4 }}>
              Paste raw IPs, CIDRs, or Object names. The sandbox will identify aggregation opportunities without modifying existing policies.
            </div>
            <TokenizedFieldEditor
              values={inputs}
              onChange={setInputs}
              options={filteredObjects}
              addToast={addToast}
              scopeNameMap={scopeNameMap}
              groupTolerance={groupTolerance}
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
                  value={cidrThreshold}
                  onChange={(e) => setCidrThreshold(parseInt(e.target.value) || 0)}
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
                  value={Math.round(groupTolerance * 100)}
                  onChange={(e) => setGroupTolerance((parseInt(e.target.value) || 100) / 100)}
                />
              </div>
            </div>

            <button
              onClick={handleOptimize}
              disabled={isOptimizing || inputs.length === 0}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px' }}
            >
              <Zap size={16} />
              {isOptimizing ? 'Analyzing...' : 'Run Optimization'}
            </button>
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
                <SearchBar width="280px" historyKey="optimization-sandbox-history" value={searchQuery} onChange={setSearchQuery} placeholder="Search Groups, IPs, or Objects..." variant="local" />
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
                  { id: 'object', label: '1:1 Replacement' },
                  { id: 'group', label: 'Address Groups' },
                  { id: 'network', label: 'CIDRs' }
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', flex: 1, padding: '16px 24px 24px 24px' }} className="custom-scrollbar">
                {filteredResults.map((insight, idx) => {
                  const isExpanded = expandedInsights.has(insight.target_name);
                  return (
                    <div key={idx} style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
                      
                      {/* Header Row */}
                      <div 
                        onClick={() => toggleExpand(insight.target_name)}
                        style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', backgroundColor: 'var(--bg-surface)' }}
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
                                <strong style={{ color: 'var(--text-main)' }}>{insight.coverage_count}</strong> items in <strong>your inputs</strong> can be swapped for the broader {insight.type === 'object' ? 'object' : insight.type} <strong style={{ color: getTypeColor(insight.type) }}>{insight.target_name}</strong>.
                              </span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Check size={12} color="var(--status-green)" /> Swaps {insight.coverage_count} items for 1 object.
                              </span>
                            </>
                          )}
                        </div>
                        </div>
                        
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleApplyOptimization(insight); }}
                          className="btn-primary"
                          style={{ padding: '6px 16px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', whiteSpace: 'nowrap', width: '160px', flexShrink: 0 }}
                        >
                          <Layers size={14} /> Swap Matches
                        </button>
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
                              <button
                                onClick={() => handleApplyOptimization(insight)}
                                className="btn-primary"
                                style={{ padding: '6px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', width: '100%', whiteSpace: 'nowrap' }}
                              >
                                <Layers size={12} /> Swap Matches
                              </button>
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
    </div>
  );
};
