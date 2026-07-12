import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CanopyApiClient } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { Loader2, RefreshCw, ChevronLeft, PanelLeft, Split, GripVertical, Plus, Trash2, Box, Layers, GitMerge, Shield, Play, HelpCircle, Filter, Settings, ExternalLink } from 'lucide-react';

import { SearchableScopeDropdown } from '../components/SearchableScopeDropdown';
import { useScopeHierarchy } from '../hooks/useScopeHierarchy';
import { SearchBar } from '../components/SearchBar';

interface HeatmapPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

const AXIS_OPTIONS = [
  { label: 'Source Zone', value: 'source_zone' },
  { label: 'Source IP', value: 'source_ip' },
  { label: 'Destination Zone', value: 'dest_zone' },
  { label: 'Destination IP', value: 'dest_ip' },
  { label: 'Destination Port', value: 'dest_port' },
  { label: 'Protocol', value: 'protocol' },
  { label: 'Application', value: 'application' },
  { label: 'Action', value: 'action' }
];

const DEFAULT_PRESETS = [
  {
    name: 'Standard Firewall Rules',
    description: 'Generates standard L4/L7 firewall rules by grouping source/dest zones, IPs, and application ports.',
    passes: [
      { id: '1', aggregate: ['source_zone', 'source_ip'], groupBy: ['dest_zone', 'dest_ip', 'application', 'dest_port', 'protocol', 'action'] },
      { id: '2', aggregate: ['dest_zone', 'dest_ip'], groupBy: ['source_zone', 'source_ip', 'application', 'dest_port', 'protocol', 'action'] },
      { id: '3', aggregate: ['application', 'dest_port', 'protocol'], groupBy: ['source_zone', 'source_ip', 'dest_zone', 'dest_ip', 'action'] }
    ]
  },
  {
    name: 'Scanners & Monitoring',
    description: 'Identifies broad sweeping tools by finding sources talking to many destinations.',
    passes: [
      { id: '1', aggregate: ['dest_zone', 'dest_ip', 'application', 'dest_port', 'protocol'], groupBy: ['source_zone', 'source_ip', 'action'] },
      { id: '2', aggregate: ['source_zone', 'source_ip', 'application', 'dest_port', 'protocol'], groupBy: ['dest_zone', 'dest_ip', 'action'] },
      { id: '3', aggregate: ['source_zone', 'source_ip', 'dest_zone', 'dest_ip'], groupBy: ['application', 'dest_port', 'protocol', 'action'] }
    ]
  }
];

export const HeatmapPage: React.FC<HeatmapPageProps> = ({ auth, addToast }) => {
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSplitView, setIsSplitView] = useState(true);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'heatmap'|'analysis'>('heatmap');

  const [xAxis, setXAxis] = useState<string[]>(['dest_zone']);
  const [yAxis, setYAxis] = useState<string[]>(['source_zone']);
  const [metric, setMetric] = useState<'total_count' | 'total_bytes' | 'total_packets'>('total_count');
  
  // Drag and Drop state
  const [draggedItem, setDraggedItem] = useState<{axis: 'x'|'y'|'col', index: number} | null>(null);

  // Cell Selection Filter
  const [activeCellFilter, setActiveCellFilter] = useState<Record<string, string[]>[]>([]);
  const [isSelectionInProgress, setIsSelectionInProgress] = useState(false);
  const [selectedRegions, setSelectedRegions] = useState<{rows: Set<number>, cols: Set<number>}[]>([]);
  const lastHeaderClick = useRef<{field: string, value: string, index: number, axis: 'x'|'y', level: number} | null>(null);

  const dragStartRef = useRef<{row: number, col: number} | null>(null);
  const dragCurrentRef = useRef<{row: number, col: number} | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);

  // Candidate Rules state
  const [passes, setPasses] = useState<{id: string, groupBy: string[], aggregate: string[]}[]>(DEFAULT_PRESETS[0].passes);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candidateSearchQuery, setCandidateSearchQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [analysisColumns, setAnalysisColumns] = useState<string[]>([
    "source_zone", "source_ip", "dest_zone", "dest_ip", "dest_port", 
		"protocol", "application", "action"
  ]);

  const [currentScope, setCurrentScope] = useState<string>('paloalto-panorama-global');
  const [deviceGroups, setDeviceGroups] = useState<any[]>([]);
  const [firewalls, setFirewalls] = useState<any[]>([]);

  const { hierarchyOptions, scopeNameMap, getVisibleScopes } = useScopeHierarchy(deviceGroups, firewalls, {
    includeShowAll: true,
    firewallValueKey: 'serial'
  });

  const visibleScopes = useMemo(() => {
    return getVisibleScopes(currentScope);
  }, [currentScope, getVisibleScopes]);

  // Synchronize candidate state to localStorage for popout window support
  useEffect(() => {
    localStorage.setItem('canopy-candidates-data', JSON.stringify(candidates));
  }, [candidates]);

  useEffect(() => {
    localStorage.setItem('canopy-candidates-generating', JSON.stringify(isGenerating));
  }, [isGenerating]);

  useEffect(() => {
    localStorage.setItem('canopy-candidates-columns', JSON.stringify(analysisColumns));
  }, [analysisColumns]);

  useEffect(() => {
    localStorage.setItem('canopy-candidates-available-columns', JSON.stringify(availableColumns));
  }, [availableColumns]);

  useEffect(() => {
    const loadSchema = async () => {
      if (!auth) return;
      try {
        const client = new CanopyApiClient(auth);
        const schema = await client.getLogSchema();
        if (schema && schema.length > 0) {
          setAvailableColumns(schema);
        }
        const data = await client.getPoliciesContext();
        
        setDeviceGroups(data.device_groups || []);
        setFirewalls(data.devices || []);
      } catch (err) {
        console.error("Failed to load schema", err);
      }
    };
    loadSchema();
  }, [auth]);

  const fetchHeatmap = async () => {
    if (!auth) return;
    setIsLoading(true);
    try {
      const client = new CanopyApiClient(auth);
      const res = await client.getLogHeatmap('global', xAxis, yAxis);
      setData(res.data || []);
    } catch (err: any) {
      addToast(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, axis: 'x'|'y', index: number) => {
    setDraggedItem({ axis, index });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, axis: 'x'|'y', index: number) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.axis !== axis) return;
    if (draggedItem.index === index) {
        setDraggedItem(null);
        return;
    }
    const currentAxis = axis === 'x' ? xAxis : yAxis;
    const setter = axis === 'x' ? setXAxis : setYAxis;
    
    const newItems = [...currentAxis];
    const [removed] = newItems.splice(draggedItem.index, 1);
    newItems.splice(index, 0, removed);
    
    setter(newItems);
    setDraggedItem(null);
  };

  const generateCandidates = async (auto = false) => {
    if (!auth) return;
    setIsGenerating(true);
    try {
      const client = new CanopyApiClient(auth);
      const response = await client.generateCandidateRules('global', passes, 1000, activeCellFilter, analysisColumns);
      setCandidates(response.data || []);
      if (!auto && !isSplitView) setIsSplitView(true);
      if (!auto) setActiveSidebarTab('analysis');
    } catch (err: any) {
      addToast(err.message || 'Failed to generate candidates', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    fetchHeatmap();
  }, [xAxis, yAxis]);

  const getGroupKey = (row: any, fields: string[]) => fields.map(f => row[f] || '(empty)').join(' > ');

  const matrixData = React.useMemo(() => {
    const xKeys = new Set<string>();
    const yKeys = new Set<string>();
    const matrix: Record<string, Record<string, any>> = {};
    let maxVal = 0;

    data.forEach(row => {
      const xKey = getGroupKey(row, xAxis);
      const yKey = getGroupKey(row, yAxis);
      xKeys.add(xKey);
      yKeys.add(yKey);
      if (!matrix[yKey]) matrix[yKey] = {};
      const val = parseInt(row[metric] || '0', 10);
      matrix[yKey][xKey] = { value: val, raw: row };
      if (val > maxVal) maxVal = val;
    });

    const xLabels = Array.from(xKeys).sort();
    const yLabels = Array.from(yKeys).sort();

    // Calculate X-Axis Header Spans
    const xDepth = xAxis.length;
    const xHeaderRows: {label: string, span: number}[][] = Array(xDepth).fill(0).map(() => []);
    const activeXSpans: any[] = Array(xDepth).fill(null);

    xLabels.forEach(label => {
        const parts = label.split(' > ');
        parts.forEach((part, level) => {
            if (level >= xDepth) return;
            const parentPath = parts.slice(0, level).join('>');
            const current = activeXSpans[level];
            
            if (current && current.label === part && current.parentPath === parentPath) {
                current.span++;
            } else {
                if (current) xHeaderRows[level].push(current);
                activeXSpans[level] = { label: part, span: 1, parentPath };
            }
        });
    });
    activeXSpans.forEach((span, level) => {
        if (span) xHeaderRows[level].push(span);
    });

    // Calculate Y-Axis Header Spans
    const yDepth = yAxis.length;
    const yRowSpans = Array(yLabels.length).fill(0).map(() => Array(yDepth).fill(0));
    
    for (let level = 0; level < yDepth; level++) {
        let currentStart = 0;
        let currentLabel: string | null = null;
        let currentParentPath: string | null = null;

        yLabels.forEach((label, idx) => {
            const parts = label.split(' > ');
            const val = parts[level];
            const parentPath = parts.slice(0, level).join('>');

            if (idx === 0) {
                currentLabel = val;
                currentParentPath = parentPath;
                return;
            }

            if (val !== currentLabel || parentPath !== currentParentPath) {
                yRowSpans[currentStart][level] = idx - currentStart;
                currentStart = idx;
                currentLabel = val;
                currentParentPath = parentPath;
            }
        });
        if (yLabels.length > 0) {
            yRowSpans[currentStart][level] = yLabels.length - currentStart;
        }
    }

    return {
      xLabels,
      yLabels,
      xHeaderRows,
      yRowSpans,
      matrix,
      maxVal,
      xDepth,
      yDepth
    };
  }, [data, xAxis, yAxis, metric]);

  const updateSelectionBox = useCallback((start: {row: number, col: number}, end: {row: number, col: number}) => {
      if (!containerRef.current || !selectionBoxRef.current) return;
      
      const minR = Math.min(start.row, end.row);
      const maxR = Math.max(start.row, end.row);
      const minC = Math.min(start.col, end.col);
      const maxC = Math.max(start.col, end.col);

      const startCell = containerRef.current.querySelector(`td[data-r="${minR}"][data-c="${minC}"]`);
      const endCell = containerRef.current.querySelector(`td[data-r="${maxR}"][data-c="${maxC}"]`);

      if (startCell && endCell) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const startRect = startCell.getBoundingClientRect();
          const endRect = endCell.getBoundingClientRect();
          
          const box = selectionBoxRef.current;
          box.style.display = 'block';
          box.style.top = `${startRect.top - containerRect.top + containerRef.current.scrollTop}px`;
          box.style.left = `${startRect.left - containerRect.left + containerRef.current.scrollLeft}px`;
          box.style.width = `${endRect.right - startRect.left}px`;
          box.style.height = `${endRect.bottom - startRect.top}px`;
      }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent | MouseEvent, r: number, c: number) => {
    if (e.shiftKey) {
      e.preventDefault();
      setIsSelectionInProgress(true);
      const current = { row: r, col: c };
      
      if (!dragStartRef.current) {
          dragStartRef.current = current;
      }
      
      dragCurrentRef.current = current;
      updateSelectionBox(dragStartRef.current, current);
      return;
    }
    
    e.preventDefault();
    setIsSelectionInProgress(true);
    
    if (!e.ctrlKey && !e.metaKey) {
        setSelectedRegions([]);
    }
    
    const start = { row: r, col: c };
    dragStartRef.current = start;
    dragCurrentRef.current = start;
    updateSelectionBox(start, start);
  }, [updateSelectionBox]);

  const handleTableMouseDown = (e: React.MouseEvent) => {
      const td = (e.target as HTMLElement).closest('td[data-r]');
      if (!td) return;
      handleMouseDown(e, parseInt((td as HTMLElement).dataset.r!), parseInt((td as HTMLElement).dataset.c!));
  };

  const handleMouseEnter = (rowIndex: number, colIndex: number) => {
      if (dragStartRef.current) {
          const current = { row: rowIndex, col: colIndex };
          dragCurrentRef.current = current;
          updateSelectionBox(dragStartRef.current, current);
      }
  };

  const handleTableMouseOver = (e: React.MouseEvent) => {
      if (!dragStartRef.current) return;
      const td = (e.target as HTMLElement).closest('td[data-r]');
      if (!td) return;
      handleMouseEnter(parseInt((td as HTMLElement).dataset.r!), parseInt((td as HTMLElement).dataset.c!));
  };

  useEffect(() => {
    const handleMouseUp = () => {
        if (!isSelectionInProgress || !dragStartRef.current || !dragCurrentRef.current) {
            setIsSelectionInProgress(false);
            dragStartRef.current = null;
            dragCurrentRef.current = null;
            if (selectionBoxRef.current) {
                selectionBoxRef.current.style.display = 'none';
            }
            return;
        }

        const start = dragStartRef.current;
        const end = dragCurrentRef.current;
        
        const minR = Math.min(start.row, end.row);
        const maxR = Math.max(start.row, end.row);
        const minC = Math.min(start.col, end.col);
        const maxC = Math.max(start.col, end.col);

        const newRows = new Set<number>();
        const newCols = new Set<number>();
        
        for (let r = minR; r <= maxR; r++) newRows.add(r);
        for (let c = minC; c <= maxC; c++) newCols.add(c);

        setSelectedRegions(prev => [...prev, { rows: newRows, cols: newCols }]);

        setIsSelectionInProgress(false);
        dragStartRef.current = null;
        dragCurrentRef.current = null;
        if (selectionBoxRef.current) {
            selectionBoxRef.current.style.display = 'none';
        }
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => {
        document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isSelectionInProgress]);

  const isCellSelected = useCallback((r: number, c: number) => {
    if (!matrixData?.yLabels || !matrixData?.xLabels) return false;
    if (r < 0 || r >= matrixData.yLabels.length || c < 0 || c >= matrixData.xLabels.length) return false;
    if (!isSelectionInProgress && selectedRegions.length > 0) {
        return selectedRegions.some(region => region.rows.has(r) && region.cols.has(c));
    }
    return false;
  }, [selectedRegions, matrixData, isSelectionInProgress]);

  useEffect(() => {
    if (!selectedRegions || selectedRegions.length === 0) {
        setActiveCellFilter([]);
        return;
    }
    
    const filters = selectedRegions.map(region => {
        const filterObj: Record<string, string[]> = {};
        const selectedY = Array.from(region.rows).map(r => matrixData.yLabels[r]);
        const selectedX = Array.from(region.cols).map(c => matrixData.xLabels[c]);

        // Break yLabels into fields
        const yPartsMatrix = selectedY.map(l => l.split(' > '));
        yAxis.forEach((axis, level) => {
            const vals = Array.from(new Set(yPartsMatrix.map(p => p[level]).filter(Boolean)));
            if (vals.length > 0) {
                filterObj[axis] = vals;
            }
        });

        // Break xLabels into fields
        const xPartsMatrix = selectedX.map(l => l.split(' > '));
        xAxis.forEach((axis, level) => {
            const vals = Array.from(new Set(xPartsMatrix.map(p => p[level]).filter(Boolean)));
            if (vals.length > 0) {
                filterObj[axis] = vals;
            }
        });

        return filterObj;
    });
    
    setActiveCellFilter(filters);
  }, [selectedRegions, matrixData.xLabels, matrixData.yLabels, yAxis, xAxis]);

  const handleHeaderClick = (e: React.MouseEvent, label: string, parentPath: string | null, axis: 'x'|'y') => {
      const isMulti = e.ctrlKey || e.metaKey;
      const fullPath = parentPath ? `${parentPath} > ${label}` : label;
      
      const newRows = new Set<number>();
      const newCols = new Set<number>();

      if (axis === 'x') {
          matrixData.xLabels.forEach((lbl, idx) => {
              if (lbl.startsWith(fullPath)) newCols.add(idx);
          });
          matrixData.yLabels.forEach((_, idx) => newRows.add(idx));
      } else {
          matrixData.yLabels.forEach((lbl, idx) => {
              if (lbl.startsWith(fullPath)) newRows.add(idx);
          });
          matrixData.xLabels.forEach((_, idx) => newCols.add(idx));
      }

      setSelectedRegions(prev => isMulti ? [...prev, { rows: newRows, cols: newCols }] : [{ rows: newRows, cols: newCols }]);
  };

  useEffect(() => {
      const timer = setTimeout(() => {
          if (passes.length > 0 && analysisColumns.length > 0) {
              generateCandidates(true);
          } else {
              setCandidates([]);
          }
      }, 500);
      return () => clearTimeout(timer);
  }, [activeCellFilter, passes, analysisColumns]);

  const getHeatmapColor = (value: number) => {
    if (value === 0 || !matrixData.maxVal) return 'transparent';
    const intensity = Math.max(0.1, value / matrixData.maxVal);
    return `rgba(245, 158, 11, ${intensity})`;
  };

  const dataTableColumns = React.useMemo(() => {
    return [
      ...analysisColumns.map(col => ({
        key: col,
        label: availableColumns.find(c => c === col) || col,
        width: '200px',
        renderCell: (val: any) => {
          let displayVal = val;
          if (Array.isArray(val)) {
            displayVal = val.join(', ');
          } else if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
            try { displayVal = JSON.parse(val).join(', '); } catch (e) { displayVal = val; }
          }
          return displayVal || '-';
        }
      })),
      {
        key: 'count',
        label: 'Hits',
        width: '100px',
        renderCell: (val: any) => val?.toLocaleString() || 0
      }
    ];
  }, [analysisColumns, availableColumns]);

  const activePassResult = candidates.length > 0 ? candidates[candidates.length - 1] : null;

  const filteredCandidateRules = useMemo(() => {
    if (!activePassResult?.rules) return [];
    if (!candidateSearchQuery) return activePassResult.rules;
    const q = candidateSearchQuery.toLowerCase();
    return activePassResult.rules.filter((rule: any) => {
      return Object.values(rule).some(v => String(v).toLowerCase().includes(q));
    });
  }, [activePassResult, candidateSearchQuery]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      
      {/* Scope context summary top header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
        padding: '30px 30px 0 30px'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', gap: '24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <span style={{ width: '95px', display: 'inline-block', fontSize: '12px', fontWeight: 500, color: 'var(--text-main)' }}>Device Group:</span>
                <SearchableScopeDropdown
                  value={currentScope}
                  options={hierarchyOptions}
                  onChange={setCurrentScope}
                  scopeNameMap={scopeNameMap}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, minHeight: '20px' }}>
                  {currentScope !== 'show-all' && currentScope !== 'paloalto-panorama-global' && visibleScopes.length > 1 ? (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      Scope Context:
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', marginLeft: '4px', whiteSpace: 'nowrap' }}>
                        {[...visibleScopes.slice(1)].reverse().map((scopeId, idx, arr) => (
                          <React.Fragment key={scopeId}>
                            <span
                              onClick={() => setCurrentScope(scopeId)}
                              style={{ color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 400, transition: 'color 0.15s ease' }}
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
                        <span style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent-blue)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(59, 130, 246, 0.25)', fontWeight: 600, fontSize: '11px', display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                          {scopeNameMap[currentScope] || currentScope}
                        </span>
                      </span>
                    </span>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {currentScope === 'paloalto-panorama-global' ? 'Context: Global shared scope.' : 'Context: Root scope.'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%', marginTop: '12px' }} />
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-main)', display: 'flex', gap: '16px', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="btn-secondary"
            style={{ padding: '6px', backgroundColor: isSidebarOpen ? 'var(--bg-app)' : 'transparent' }}
          >
            {isSidebarOpen ? <ChevronLeft size={18} /> : <PanelLeft size={18} />}
          </button>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            Log Heatmap & Analysis
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '6px', padding: '2px', marginLeft: '12px' }}>
            {[
              { value: 'total_count', label: 'Count' },
              { value: 'total_bytes', label: 'Bytes' },
              { value: 'total_packets', label: 'Packets' }
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setMetric(opt.value as any)}
                style={{
                  padding: '4px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  border: 'none',
                  borderRadius: '4px',
                  backgroundColor: metric === opt.value ? 'var(--accent-blue)' : 'transparent',
                  color: metric === opt.value ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button 
            onClick={() => setIsSplitView(!isSplitView)}
            className="btn-secondary"
            style={{ padding: '6px', backgroundColor: isSplitView ? 'var(--accent-blue)' : 'transparent', color: isSplitView ? '#fff' : 'inherit' }}
            title="Toggle Split View"
          >
            <Split size={18} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Sidebar */}
        {isSidebarOpen && (
          <div style={{ width: '320px', borderRight: '1px solid var(--border-main)', backgroundColor: 'var(--bg-app)', display: 'flex', flexDirection: 'column', overflowY: 'auto', flexShrink: 0 }}>
            
            {/* PRESETS SECTION */}
            <div style={{ padding: '24px 24px 16px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Presets</span>
                <div style={{ display: 'flex', gap: '8px', color: 'var(--text-muted)' }}>
                  {/* Mock icons to match V1 layout */}
                  <Settings size={14} style={{ cursor: 'pointer' }}/>
                  <Trash2 size={14} style={{ cursor: 'pointer' }}/>
                  <RefreshCw size={14} style={{ cursor: 'pointer' }}/>
                </div>
              </div>
              <select 
                onChange={(e) => {
                  const preset = DEFAULT_PRESETS.find(p => p.name === e.target.value);
                  if (preset) setPasses(preset.passes);
                }}
                style={{ width: '100%', backgroundColor: 'transparent', border: '1px solid var(--border-main)', color: 'var(--text-main)', borderRadius: '6px', padding: '10px', fontSize: '13px', appearance: 'none', marginBottom: '8px' }}
              >
                {DEFAULT_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.4 }}>
                Isolates server traffic first, then cleans up outbound traffic, and finally consolidates common services/ports.
              </div>
            </div>

            {/* TABS */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-main)', padding: '0 24px' }}>
              <button 
                onClick={() => setActiveSidebarTab('heatmap')} 
                style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 600, borderBottom: activeSidebarTab === 'heatmap' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: activeSidebarTab === 'heatmap' ? 'var(--accent-blue)' : 'var(--text-muted)', backgroundColor: 'transparent', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer' }}
              >
                Heatmap
              </button>
              <button 
                onClick={() => setActiveSidebarTab('analysis')} 
                style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 600, borderBottom: activeSidebarTab === 'analysis' ? '2px solid var(--accent-purple)' : '2px solid transparent', color: activeSidebarTab === 'analysis' ? 'var(--accent-purple)' : 'var(--text-muted)', backgroundColor: 'transparent', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer' }}
              >
                Rule Analysis
              </button>
            </div>

            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {activeSidebarTab === 'heatmap' ? (
                <>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Configuration</div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Y-Axis (Rows)</label>
                      <HelpCircle size={14} color="var(--text-muted)" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {yAxis.map((y, idx) => (
                        <div 
                          key={`y-${idx}`} 
                          style={{ 
                            display: 'flex', flexDirection: 'column', gap: '8px', 
                            opacity: draggedItem?.axis === 'y' && draggedItem.index === idx ? 0.5 : 1
                          }}
                          draggable
                          onDragStart={(e) => handleDragStart(e, 'y', idx)}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, 'y', idx)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'transparent', padding: '0', borderRadius: '4px' }}>
                            <div style={{ cursor: 'grab' }}><GripVertical size={14} color="var(--text-muted)" /></div>
                            <select 
                              value={y} 
                              onChange={(e) => {
                                const newY = [...yAxis];
                                newY[idx] = e.target.value;
                                setYAxis(newY);
                              }}
                              style={{ flex: 1, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', color: 'var(--text-main)', fontSize: '13px', outline: 'none', padding: '8px', borderRadius: '6px', appearance: 'none' }}
                            >
                              {AXIS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                            <button onClick={() => setYAxis(yAxis.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}><Trash2 size={14}/></button>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '14px' }}></div>{/* spacer for grip icon align */}
                            <select style={{ flex: 1, backgroundColor: 'transparent', border: '1px solid var(--border-main)', color: 'var(--text-main)', fontSize: '12px', outline: 'none', padding: '6px 8px', borderRadius: '6px', appearance: 'none' }}>
                              <option>All items selected</option>
                            </select>
                          </div>
                        </div>
                      ))}
                      <button onClick={() => setYAxis([...yAxis, 'protocol'])} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: 'var(--accent-blue)', fontSize: '12px', cursor: 'pointer', padding: '4px 0', width: 'fit-content', marginLeft: '22px' }}><Plus size={12}/> Add Level</button>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
                    <div style={{ color: 'var(--text-muted)' }}>↓</div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>X-Axis (Columns)</label>
                      <HelpCircle size={14} color="var(--text-muted)" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {xAxis.map((x, idx) => (
                        <div 
                          key={`x-${idx}`} 
                          style={{ 
                            display: 'flex', flexDirection: 'column', gap: '8px',
                            opacity: draggedItem?.axis === 'x' && draggedItem.index === idx ? 0.5 : 1
                          }}
                          draggable
                          onDragStart={(e) => handleDragStart(e, 'x', idx)}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, 'x', idx)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'transparent', padding: '0', borderRadius: '4px' }}>
                            <div style={{ cursor: 'grab' }}><GripVertical size={14} color="var(--text-muted)" /></div>
                            <select 
                              value={x} 
                              onChange={(e) => {
                                const newX = [...xAxis];
                                newX[idx] = e.target.value;
                                setXAxis(newX);
                              }}
                              style={{ flex: 1, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', color: 'var(--text-main)', fontSize: '13px', outline: 'none', padding: '8px', borderRadius: '6px', appearance: 'none' }}
                            >
                              {AXIS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                            <button onClick={() => setXAxis(xAxis.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}><Trash2 size={14}/></button>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '14px' }}></div>{/* spacer for grip icon align */}
                            <select style={{ flex: 1, backgroundColor: 'transparent', border: '1px solid var(--border-main)', color: 'var(--text-main)', fontSize: '12px', outline: 'none', padding: '6px 8px', borderRadius: '6px', appearance: 'none' }}>
                              <option>All items selected</option>
                            </select>
                          </div>
                        </div>
                      ))}
                      <button onClick={() => setXAxis([...xAxis, 'protocol'])} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: 'var(--accent-blue)', fontSize: '12px', cursor: 'pointer', padding: '4px 0', width: 'fit-content', marginLeft: '22px' }}><Plus size={12}/> Add Level</button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Analysis Columns Config */}
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Analysis Columns</label>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{analysisColumns.length} of {availableColumns.length} visible</span>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', border: '1px solid var(--border-main)', borderRadius: '6px', padding: '4px', backgroundColor: 'var(--bg-app)', maxHeight: '300px', overflowY: 'auto' }}>
                      {[...analysisColumns, ...availableColumns.filter(c => !analysisColumns.includes(c))].map((col, idx) => {
                        const isSelected = analysisColumns.includes(col);
                        const fieldIndex = isSelected ? analysisColumns.indexOf(col) : -1;
                        return (
                          <div 
                            key={col}
                            style={{ 
                              display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '4px',
                              backgroundColor: isSelected ? 'var(--bg-surface)' : 'transparent',
                              opacity: draggedItem?.axis === 'col' && draggedItem.index === fieldIndex ? 0.5 : 1,
                              transition: 'background-color 0.1s'
                            }}
                            draggable={isSelected}
                            onDragStart={(e) => {
                              if (!isSelected) return;
                              setDraggedItem({ axis: 'col', index: fieldIndex });
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragOver={(e) => {
                              if (!isSelected) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(e) => {
                              if (!isSelected) return;
                              e.preventDefault();
                              if (!draggedItem || draggedItem.axis !== 'col' || draggedItem.index === fieldIndex) return;
                              const newCols = [...analysisColumns];
                              const [movedItem] = newCols.splice(draggedItem.index, 1);
                              newCols.splice(fieldIndex, 0, movedItem);
                              setAnalysisColumns(newCols);
                              setDraggedItem(null);
                            }}
                          >
                            {isSelected ? (
                              <div style={{ cursor: 'grab', color: 'var(--text-muted)' }}><GripVertical size={14} /></div>
                            ) : (
                              <div style={{ width: '14px' }}></div>
                            )}
                            
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1, margin: 0 }}>
                              <input 
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  if (isSelected) {
                                    setAnalysisColumns(analysisColumns.filter(c => c !== col));
                                  } else {
                                    setAnalysisColumns([...analysisColumns, col]);
                                  }
                                }}
                                style={{ accentColor: 'var(--accent-blue)', cursor: 'pointer' }}
                              />
                              <span style={{ fontSize: '12px', color: isSelected ? 'var(--text-main)' : 'var(--text-muted)' }}>
                                {availableColumns.find(c => c === col) || col}
                              </span>
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Aggregation Passes</label>
                      <button onClick={() => setPasses([...passes, { id: Math.random().toString(), groupBy: [...analysisColumns], aggregate: [] }])} style={{ background: 'none', border: 'none', color: 'var(--accent-purple)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}><Plus size={12}/> Add Pass</button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {passes.map((pass, passIdx) => (
                        <div key={pass.id} style={{ backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '6px', padding: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px solid var(--border-main)', paddingBottom: '8px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}><Layers size={14} color="var(--accent-purple)"/> Pass {passIdx + 1}</span>
                            <button onClick={() => setPasses(passes.filter((_, i) => i !== passIdx))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><Trash2 size={14}/></button>
                          </div>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {/* Aggregate Section */}
                            <div>
                              <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent-green)', marginBottom: '4px', display: 'block' }}>Aggregate (List)</label>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {analysisColumns.map((col) => {
                                  const isSelected = pass.aggregate.includes(col);
                                  const isDisabled = passIdx < passes.length - 1;
                                  return (
                                    <button
                                      key={col}
                                      disabled={isDisabled}
                                      onClick={() => {
                                        const newP = [...passes];
                                        if (isSelected) {
                                          newP[passIdx].aggregate = pass.aggregate.filter(c => c !== col);
                                          newP[passIdx].groupBy.push(col);
                                        } else {
                                          newP[passIdx].aggregate.push(col);
                                          newP[passIdx].groupBy = pass.groupBy.filter(c => c !== col);
                                        }
                                        setPasses(newP);
                                      }}
                                      style={{
                                        padding: '2px 8px',
                                        fontSize: '11px',
                                        borderRadius: '12px',
                                        border: '1px solid',
                                        borderColor: isSelected ? 'var(--accent-green)' : 'var(--border-main)',
                                        backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-surface)',
                                        color: isSelected ? 'var(--accent-green)' : 'var(--text-muted)',
                                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                                        opacity: isDisabled && !isSelected ? 0.3 : 1,
                                        transition: 'all 0.1s'
                                      }}
                                    >
                                      {availableColumns.find(c => c === col) || col}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Group By Section */}
                            <div>
                              <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent-blue)', marginBottom: '4px', display: 'block' }}>Group By</label>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {analysisColumns.map((col) => {
                                  const isSelected = pass.groupBy.includes(col);
                                  const isDisabled = passIdx < passes.length - 1;
                                  return (
                                    <button
                                      key={col}
                                      disabled={isDisabled}
                                      onClick={() => {
                                        const newP = [...passes];
                                        if (isSelected) {
                                          newP[passIdx].groupBy = pass.groupBy.filter(c => c !== col);
                                          newP[passIdx].aggregate.push(col);
                                        } else {
                                          newP[passIdx].groupBy.push(col);
                                          newP[passIdx].aggregate = pass.aggregate.filter(c => c !== col);
                                        }
                                        setPasses(newP);
                                      }}
                                      style={{
                                        padding: '2px 8px',
                                        fontSize: '11px',
                                        borderRadius: '12px',
                                        border: '1px solid',
                                        borderColor: isSelected ? 'var(--accent-blue)' : 'var(--border-main)',
                                        backgroundColor: isSelected ? 'var(--accent-blue-transparent)' : 'var(--bg-surface)',
                                        color: isSelected ? 'var(--accent-blue)' : 'var(--text-muted)',
                                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                                        opacity: isDisabled && !isSelected ? 0.3 : 1,
                                        transition: 'all 0.1s'
                                      }}
                                    >
                                      {availableColumns.find(c => c === col) || col}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>


                </>
              )}
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: isSplitView ? 'column' : 'row', overflow: 'hidden' }}>
          
          {/* Heatmap View (Shown if not split, or if split and not analysis-only) */}
          {(!isSplitView || activeSidebarTab === 'heatmap' || isSplitView) && (
            <div style={{ flex: 1, overflow: 'auto', padding: '0', backgroundColor: 'var(--bg-app)', borderBottom: isSplitView ? '1px solid var(--border-main)' : 'none' }}>
              <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, left: 0, zIndex: 20, backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-main)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}><Box size={16} color="var(--accent-blue)" /> Raw Flow Matrix</h3>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {selectedRegions.length > 0 && (
                    <button className="btn-secondary" onClick={() => setSelectedRegions([])}>Clear Selection</button>
                  )}
                  <button className="btn-secondary" onClick={fetchHeatmap} disabled={isLoading}><RefreshCw size={14} className={isLoading ? "animate-spin" : ""} /> Refresh</button>
                </div>
              </div>
              {isLoading && data.length === 0 ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', color: 'var(--text-muted)' }}>
                  <Loader2 size={24} className="animate-spin" />
                  <span style={{ marginLeft: '12px' }}>Aggregating Data...</span>
                </div>
              ) : data.length === 0 ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', color: 'var(--text-muted)' }}>
                  No aggregated data found. Check your axes or import logs.
                </div>
              ) : (
                <div ref={containerRef} style={{ minWidth: '100%', width: 'max-content', position: 'relative', border: '1px solid var(--border-main)', borderRadius: '8px', overflow: 'hidden' }}>
                  <div 
                    ref={selectionBoxRef} 
                    style={{
                      display: 'none', position: 'absolute', pointerEvents: 'none',
                      backgroundColor: 'rgba(59, 130, 246, 0.2)', border: '2px solid rgb(59, 130, 246)',
                      zIndex: 40, mixBlendMode: 'multiply'
                    }}
                  />
                  <table 
                    onMouseDown={handleTableMouseDown}
                    onMouseOver={handleTableMouseOver}
                    style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left', userSelect: 'none' }}
                  >
                    <thead>
                      {matrixData.xHeaderRows.map((row, level) => (
                        <tr key={level}>
                          {level === 0 && (
                            <th 
                              rowSpan={matrixData.xDepth} 
                              colSpan={matrixData.yDepth} 
                              style={{ 
                                padding: '12px', backgroundColor: 'var(--bg-surface)', 
                                borderBottom: '1px solid var(--border-main)', borderRight: '1px solid var(--border-main)', 
                                position: 'sticky', top: 0, left: 0, zIndex: 30, verticalAlign: 'bottom'
                              }}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                                {xAxis.map((x, i) => <div key={i} style={{ paddingLeft: `${i * 8}px` }}>→ {AXIS_OPTIONS.find(o => o.value === x)?.label}</div>)}
                                <div style={{ borderTop: '1px solid var(--border-main)', margin: '4px 0' }} />
                                {yAxis.map((y, i) => <div key={i} style={{ paddingLeft: `${i * 8}px` }}>↓ {AXIS_OPTIONS.find(o => o.value === y)?.label}</div>)}
                              </div>
                            </th>
                          )}
                          {row.map((headerItem: any, idx: number) => (
                            <th 
                              key={`${level}-${idx}`} 
                              colSpan={headerItem.span}
                              onClick={(e) => handleHeaderClick(e, headerItem.label, headerItem.parentPath, 'x')}
                              style={{ 
                                padding: '8px 12px', backgroundColor: 'var(--bg-surface)', 
                                minWidth: '100px',
                                borderBottom: '1px solid var(--border-main)', borderRight: '1px solid var(--border-main)', 
                                position: 'sticky', top: `${level * 36}px`, zIndex: 10, whiteSpace: 'nowrap',
                                overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer'
                              }}
                              title={headerItem.label}
                            >
                              {headerItem.label}
                            </th>
                          ))}
                        </tr>
                      ))}
                    </thead>
                    <tbody>
                      {matrixData.yLabels.map((yLabel, rowIdx) => {
                        const yParts = yLabel.split(' > ');
                        return (
                          <tr key={yLabel}>
                            {yParts.map((part, level) => {
                              const span = matrixData.yRowSpans[rowIdx][level];
                              if (span === 0) return null;
                              return (
                                <td 
                                  key={`${rowIdx}-${level}`}
                                  rowSpan={span}
                                  onClick={(e) => handleHeaderClick(e, part, yParts.slice(0, level).join(' > ') || null, 'y')}
                                  style={{ 
                                    padding: '8px 12px', borderBottom: '1px solid var(--border-main)', 
                                    borderRight: '1px solid var(--border-main)', backgroundColor: 'var(--bg-surface)', 
                                    position: 'sticky', left: `${level * 100}px`, zIndex: 5, fontWeight: 500, 
                                    color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    maxWidth: '150px', cursor: 'pointer'
                                  }}
                                  title={part}
                                >
                                  {part}
                                </td>
                              );
                            })}
                            {matrixData.xLabels.map((xLabel, colIdx) => {
                              const cell = matrixData.matrix[yLabel]?.[xLabel];
                              const val = cell ? cell.value : 0;
                              const isSelected = isCellSelected(rowIdx, colIdx);
                              return (
                                <td 
                                  key={`${yLabel}-${xLabel}`} 
                                  data-r={rowIdx}
                                  data-c={colIdx}
                                  style={{ 
                                    padding: '12px', 
                                    minWidth: '80px',
                                    borderBottom: '1px solid var(--border-main)', 
                                    borderRight: '1px solid var(--border-main)', 
                                    backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.4)' : getHeatmapColor(val),
                                    textAlign: 'center',
                                    color: val > 0 && !isSelected ? (val / matrixData.maxVal > 0.5 ? '#000' : 'var(--text-main)') : (isSelected ? '#fff' : 'var(--text-muted)'),
                                    fontWeight: val > 0 || isSelected ? 600 : 400,
                                    cursor: 'cell',
                                    outline: activeCellFilter.length > 0 && activeCellFilter[0][xAxis[0]]?.[0] === xLabel.split(' > ')[0] && activeCellFilter[0][yAxis[0]]?.[0] === yParts[0] && !isSelected ? '2px solid var(--accent-blue)' : 'none',
                                    outlineOffset: '-2px',
                                    transition: 'background-color 0.1s'
                                  }}
                                  title={`X: ${xLabel}\nY: ${yLabel}`}
                                >
                                  {val > 0 ? val.toLocaleString() : '-'}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Analysis View (Shown if split) */}
          {(isSplitView) && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0', backgroundColor: 'var(--bg-app)' }}>
               <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, left: 0, zIndex: 20, backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-main)' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <GitMerge size={16} color="var(--accent-purple)" /> Candidate Rules
                  {isGenerating && <Loader2 size={14} className="animate-spin" color="var(--text-muted)" />}
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <SearchBar 
                      value={candidateSearchQuery} 
                      onChange={setCandidateSearchQuery} 
                      placeholder="Search candidates..." 
                      variant="local" 
                    />
                  <button
                    onClick={() => {
                      if (window.electron && window.electron.spawnWindow) {
                        window.electron.spawnWindow('popout=candidates');
                      }
                    }}
                    title="Pop out Candidate Rules to a new window"
                    style={{
                      backgroundColor: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '4px',
                      borderRadius: '4px',
                      transition: 'all 0.1s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-main)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
              </div>
              
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', opacity: isGenerating && candidates.length > 0 ? 0.5 : 1, transition: 'opacity 0.2s', pointerEvents: isGenerating ? 'none' : 'auto' }}>
              {isGenerating && candidates.length === 0 ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', color: 'var(--text-muted)' }}>
                  <Loader2 size={24} className="animate-spin" />
                  <span style={{ marginLeft: '12px' }}>Executing Passes...</span>
                </div>
              ) : candidates.length === 0 ? (
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'center', alignItems: 'center', height: '200px', color: 'var(--text-muted)', border: '1px dashed var(--border-main)', borderRadius: '8px', margin: '32px' }}>
                  <Shield size={32} color="var(--text-muted)" />
                  <span>No candidates generated. Configure your passes in the Rule Analysis tab and click Generate.</span>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  {activePassResult && (
                    <DataTable 
                      columns={dataTableColumns} 
                      data={filteredCandidateRules} 
                      searchQuery={candidateSearchQuery}
                      exportFilename={`heatmap_candidates_${activePassResult?.id}.csv`}
                      selectable={true}
                      pagination={true}
                    />
                  )}
                </div>
              )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
    </div>
  );
};
