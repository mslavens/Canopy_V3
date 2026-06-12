import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, ChevronDown, Upload, Search, Columns, CheckSquare, X, MoreHorizontal } from 'lucide-react';
import { Dropdown } from './Dropdown';
import { HighlightedText } from './HighlightedText';
import { EmptyState } from './EmptyState';

export interface ColumnDef {
  key: string;
  label?: string;
  width?: string;
  allowOverflow?: boolean;
  renderCell?: (value: any, row: any, searchQuery?: string) => React.ReactNode;
}

interface DataTableProps {
  columns: ColumnDef[];
  data: any[];
  searchQuery?: string;
  exportFilename?: string;
  selectable?: boolean;
  onSelectionChange?: (selectedRows: any[]) => void;
  highlightRow?: (row: any) => boolean;
  rowStyle?: (row: any) => React.CSSProperties;
  bulkActions?: React.ReactNode;
  exportActions?: React.ReactNode;
  topRightActions?: React.ReactNode;
  toolbarTitle?: React.ReactNode;
  additionalExportColumns?: { header: string; getValue: (row: any) => string }[];
  loading?: boolean;
  rowContextMenuActions?: (row: any, closeMenu: () => void) => React.ReactNode;
  totalRows?: number;
  pagination?: boolean;
  currentPage?: number;
  rowsPerPage?: number;
  onPageChange?: (page: number) => void;
  onRowsPerPageChange?: (limit: number) => void;
}

export const DataTable: React.FC<DataTableProps> = ({ 
  columns, data, searchQuery = '', exportFilename, selectable = false, onSelectionChange, highlightRow, rowStyle, bulkActions, exportActions, topRightActions, toolbarTitle, additionalExportColumns, loading = false, rowContextMenuActions,
  totalRows, pagination = false, currentPage: externalCurrentPage, rowsPerPage: externalRowsPerPage, onPageChange, onRowsPerPageChange
}) => {
  const [currentPage, setCurrentPage] = useState<number | string>(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [orderedColumnKeys, setOrderedColumnKeys] = useState<string[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [activeResizeCol, setActiveResizeCol] = useState<string | null>(null);
  const [showTableActionsMenu, setShowTableActionsMenu] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  
  // Feature: Column Filtering
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const resizingCol = useRef<string | null>(null);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);

  // Feature: Row Selection
  const [selectedRows, setSelectedRows] = useState<Set<any>>(new Set());

  // Feature: Context Menu
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, row: any } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (onSelectionChange) onSelectionChange(Array.from(selectedRows));
  }, [selectedRows, onSelectionChange]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedRows(new Set(processedRows));
    else setSelectedRows(new Set());
  };

  const handleSelectRow = (row: any, checked: boolean) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (checked) next.add(row);
      else next.delete(row);
      return next;
    });
  };

  // Feature: Column Visibility
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [showColumnToggle, setShowColumnToggle] = useState(false);
  const columnToggleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (columnToggleRef.current && !columnToggleRef.current.contains(event.target as Node)) {
        setShowColumnToggle(false);
      }
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setShowTableActionsMenu(false);
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleColumn = (colKey: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(colKey)) next.delete(colKey);
      else next.add(colKey);
      return next;
    });
  };

  const visibleColumnKeys = useMemo(() => {
    return orderedColumnKeys.filter(k => !hiddenColumns.has(k));
  }, [orderedColumnKeys, hiddenColumns]);

  const columnKeysString = columns.map(c => c.key).join(',');

  // Reset columns and sizing when the underlying data schema structurally changes
  useEffect(() => {
    setOrderedColumnKeys(columns.map(c => c.key));
    setColumnWidths({});
    setSortConfig(null);
  }, [columnKeysString]);

  // Process global search filtering and column sorting internally
  const processedRows = useMemo(() => {
    let rows = data || [];
    
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      rows = rows.filter(row => 
        columns.some(col => String(row[col.key] || '').toLowerCase().includes(lowerQuery))
      );
    }

    const filterKeys = Object.keys(columnFilters).filter(k => columnFilters[k].trim() !== '');
    if (filterKeys.length > 0) {
      rows = rows.filter(row => {
        return filterKeys.every(k => {
          const filterVal = columnFilters[k].toLowerCase();
          const rowVal = String(row[k] || '').toLowerCase();
          return rowVal.includes(filterVal);
        });
      });
    }

    if (sortConfig) {
      rows = [...rows].sort((a, b) => {
        const valA = a[sortConfig.key] !== null && a[sortConfig.key] !== undefined ? String(a[sortConfig.key]) : '';
        const valB = b[sortConfig.key] !== null && b[sortConfig.key] !== undefined ? String(b[sortConfig.key]) : '';
        
        const numA = Number(valA);
        const numB = Number(valB);
        if (!isNaN(numA) && !isNaN(numB) && valA !== '' && valB !== '') {
          return sortConfig.direction === 'asc' ? numA - numB : numB - numA;
        }
        return sortConfig.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      });
    }
    return rows;
  }, [data, searchQuery, sortConfig, columns, columnFilters]);

  useEffect(() => {
    if (!pagination) setCurrentPage(1);
  }, [searchQuery, data, pagination]);

  const effectiveCurrentPage = pagination ? (externalCurrentPage !== undefined ? externalCurrentPage + 1 : 1) : currentPage;
  const effectivePageSize = pagination ? (externalRowsPerPage || 50) : pageSize;

  const setEffectiveCurrentPage = (p: React.SetStateAction<number | string>) => {
    if (pagination && onPageChange) {
      if (typeof p === 'function') {
        const next = Number(p(effectiveCurrentPage));
        onPageChange(next - 1);
      } else {
        onPageChange(Number(p) - 1);
      }
    } else {
      setCurrentPage(p);
    }
  };

  const setEffectivePageSize = (s: number) => {
    if (pagination && onRowsPerPageChange) {
      onRowsPerPageChange(s);
    } else {
      setPageSize(s);
    }
  };

  const safeCurrentPage = Number(effectiveCurrentPage) || 1;
  const totalRecords = pagination && totalRows !== undefined ? totalRows : processedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / effectivePageSize));
  
  const startIndex = (safeCurrentPage - 1) * effectivePageSize;
  const endIndex = Math.min(startIndex + effectivePageSize, totalRecords);
  
  const paginatedRows = useMemo(() => {
    return pagination ? processedRows : processedRows.slice(startIndex, endIndex);
  }, [processedRows, startIndex, endIndex, pagination]);

  const handleSort = (colKey: string) => {
    setSortConfig(prev => {
      if (prev && prev.key === colKey) return prev.direction === 'asc' ? { key: colKey, direction: 'desc' } : null;
      return { key: colKey, direction: 'asc' };
    });
  };

  const handleDragStart = (e: React.DragEvent, colKey: string) => {
    e.dataTransfer.setData('text/plain', colKey);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = (e: React.DragEvent, targetColKey: string) => {
    e.preventDefault();
    const sourceColKey = e.dataTransfer.getData('text/plain');
    if (sourceColKey === targetColKey || !sourceColKey) return;
    setOrderedColumnKeys(prev => {
      const newCols = [...prev];
      const srcIdx = newCols.indexOf(sourceColKey);
      const tgtIdx = newCols.indexOf(targetColKey);
      newCols.splice(srcIdx, 1);
      newCols.splice(tgtIdx, 0, sourceColKey);
      return newCols;
    });
  };

  const handleResizeStart = (e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = colKey;
    setActiveResizeCol(colKey);
    startX.current = e.pageX;
    
    const th = (e.target as HTMLElement).closest('th');
    const tr = th?.parentElement;
    const ths = tr?.querySelectorAll('th');
    
    // Capture actual rendered widths of all visible columns to prevent jumping/slippage
    const currentWidths: Record<string, number> = { ...columnWidths };
    if (ths) {
      visibleColumnKeys.forEach((key, idx) => {
        const thElement = ths[selectable ? idx + 1 : idx];
        if (thElement) {
          currentWidths[key] = thElement.getBoundingClientRect().width;
        }
      });
      setColumnWidths(currentWidths);
    }
    
    startWidth.current = th ? th.getBoundingClientRect().width : (columnWidths[colKey] || 150);

    let finalWidth = startWidth.current;
    const colIndex = visibleColumnKeys.indexOf(colKey);
    const thIdx = selectable ? colIndex + 1 : colIndex;
    const table = th?.closest('table');
    const cells = table ? table.querySelectorAll(`tr > *:nth-child(${thIdx + 1})`) : [];

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingCol.current) return;
      const diff = moveEvent.pageX - startX.current;
      finalWidth = Math.max(50, startWidth.current + diff);
      
      // Perform direct DOM mutation to achieve immediate, spreadsheet-like rendering (60 FPS)
      cells.forEach(cell => {
        const el = cell as HTMLElement;
        el.style.width = `${finalWidth}px`;
        el.style.minWidth = `${finalWidth}px`;
        el.style.maxWidth = `${finalWidth}px`;
      });
    };
    
    const onMouseUp = () => {
      resizingCol.current = null;
      setActiveResizeCol(null);
      // Commit the final width to React state so it persists across table operations (sorting, filtering, paging)
      setColumnWidths(prev => ({ ...prev, [colKey]: finalWidth }));
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const handleExportCSV = () => {
    const rowsToExport = selectedRows.size > 0 ? processedRows.filter(r => selectedRows.has(r)) : processedRows;
    if (rowsToExport.length === 0) return;
    
    const exportKeys = visibleColumnKeys.filter(k => getColDef(k).label !== 'Actions');
    const baseHeaders = exportKeys.map(k => getColDef(k).label || k);
    const extraHeaders = additionalExportColumns ? additionalExportColumns.map(c => c.header) : [];
    const headers = [...baseHeaders, ...extraHeaders].join(',');

    const csvRows = rowsToExport.map(row => {
      const baseValues = exportKeys.map(k => {
        let val = row[k];
        if (val === null || val === undefined) val = '';
        
        // Format known multi-value fields with semicolons for strict Enterprise parsers
        if (typeof val === 'string' && ['member_list', 'url_list', 'ports'].includes(k)) {
          val = val.split(',').map(s => s.trim()).join('; ');
        }
        
        const stringVal = String(val).replace(/"/g, '""');
        return `"${stringVal}"`;
      });
      const extraValues = additionalExportColumns ? additionalExportColumns.map(c => {
        const val = c.getValue(row) || '';
        const stringVal = String(val).replace(/"/g, '""');
        return `"${stringVal}"`;
      }) : [];
      return [...baseValues, ...extraValues].join(',');
    });
    
    const csvContent = [headers, ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    
    // Generate YYYYMMDD_HHMMSS timestamp
    const d = new Date();
    const ts = `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}_${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}${d.getSeconds().toString().padStart(2, '0')}`;
    const baseName = (exportFilename || 'export.csv').replace(/\.csv$/i, '');
    
    link.setAttribute('download', `${baseName}_${ts}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getColDef = (key: string) => columns.find(c => c.key === key) || { key, label: key };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'transparent', minWidth: 0 }}>
      {/* --- TOP TOOLBAR (Actions & View Management) --- */}
      <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', backgroundColor: 'transparent' }}>
        <div style={{ display: 'flex', alignItems: 'center', minHeight: '26px', gap: '20px' }}>
          {toolbarTitle && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {toolbarTitle}
            </div>
          )}
          {selectable && (
            <div style={{ fontSize: '12px', color: 'var(--accent-blue)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px', visibility: selectedRows.size > 0 ? 'visible' : 'hidden', minWidth: '85px' }}>
              <CheckSquare size={14} /> {selectedRows.size > 0 ? selectedRows.size : 0} selected
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {bulkActions && (
            <>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {bulkActions}
              </div>
              <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-main)', margin: '0 4px' }} />
            </>
          )}

          {(exportActions || exportFilename) && (
            <div ref={actionsMenuRef} style={{ position: 'relative' }}>
              <button className="btn-secondary btn-sm" onClick={() => setShowTableActionsMenu(!showTableActionsMenu)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <MoreHorizontal size={14} /> Actions
              </button>
              {showTableActionsMenu && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '6px', padding: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 1000, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Table Actions</span>
                    <button onClick={() => setShowTableActionsMenu(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 0 }}><X size={14}/></button>
                  </div>
                  
                  {exportActions}
                  
                  {exportFilename && (
                    <button 
                      className="btn-secondary btn-sm" 
                      disabled={processedRows.length === 0} 
                      onClick={() => { handleExportCSV(); setShowTableActionsMenu(false); }} 
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-start', border: 'none' }}
                      title={selectedRows.size > 0 ? `Export ${selectedRows.size} selected rows to CSV` : "Export all displayed rows to CSV"}
                    >
                      <Upload size={13} /> Export to CSV
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div ref={columnToggleRef} style={{ position: 'relative' }}>
            <button className="btn-secondary btn-sm" onClick={() => setShowColumnToggle(!showColumnToggle)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Columns size={14} /> Columns
            </button>
            {showColumnToggle && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '6px', padding: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 1000, width: '220px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Toggle Columns</span>
                  <button onClick={() => setShowColumnToggle(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 0 }}><X size={14}/></button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                  {orderedColumnKeys.map(k => (
                    <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-main)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!hiddenColumns.has(k)} onChange={() => toggleColumn(k)} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getColDef(k).label || k}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {topRightActions}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ minWidth: '100%', width: 'max-content', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap' }}>
          <thead style={{ backgroundColor: 'var(--bg-element)' }}>
            <tr>
              {selectable && (
                <th style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-element)', zIndex: 1, padding: '10px 15px 10px 20px', borderBottom: '2px solid var(--bg-app)', borderRight: '1px solid var(--border-main)', width: '40px' }}>
                  <input type="checkbox" checked={selectedRows.size === processedRows.length && processedRows.length > 0} onChange={handleSelectAll} style={{ cursor: 'pointer' }} />
                </th>
              )}
              {visibleColumnKeys.map((colKey, idx) => {
                const colDef = getColDef(colKey);
                return (
                  <th key={colKey} draggable onDragStart={(e) => handleDragStart(e, colKey)} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, colKey)} style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-element)', zIndex: 1, padding: `10px ${idx === visibleColumnKeys.length - 1 ? '20px' : '15px'} 10px ${idx === 0 && !selectable ? '20px' : '15px'}`, fontWeight: 600, color: 'var(--text-muted)', borderBottom: '2px solid var(--bg-app)', borderRight: idx === visibleColumnKeys.length - 1 ? 'none' : '1px solid var(--border-main)', cursor: 'grab', width: columnWidths[colKey] ? `${columnWidths[colKey]}px` : (colDef.width || 'auto'), minWidth: columnWidths[colKey] ? `${columnWidths[colKey]}px` : (colDef.width || 'auto'), maxWidth: columnWidths[colKey] ? `${columnWidths[colKey]}px` : (colDef.width || 'auto'), overflow: 'hidden' }} title="Drag to reorder">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                        <div onClick={() => handleSort(colKey)} style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', cursor: 'pointer', flex: 1 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-main)' }}>{colDef.label || colDef.key}</span>
                          <span style={{ display: 'inline-flex', width: '14px', flexShrink: 0, color: 'var(--accent-blue)' }}>{sortConfig?.key === colKey ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : null}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--bg-app)', borderRadius: '4px', border: '1px solid var(--border-main)', padding: '2px 6px', height: '22px' }}>
                        <input 
                          type="text"
                          placeholder="Filter..."
                          value={columnFilters[colKey] || ''}
                          onChange={(e) => { setColumnFilters(prev => ({ ...prev, [colKey]: e.target.value })); setEffectiveCurrentPage(1); }}
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontSize: '11px', outline: 'none', width: '100%', minWidth: '30px' }}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        />
                        {columnFilters[colKey] && (
                          <button onClick={(e) => { e.stopPropagation(); setColumnFilters(prev => ({ ...prev, [colKey]: '' })); setEffectiveCurrentPage(1); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, display: 'flex' }}>
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div 
                      onMouseDown={(e) => handleResizeStart(e, colKey)}
                      title="Drag to resize"
                      style={{ position: 'absolute', top: 0, bottom: 0, right: '-12px', width: '24px', cursor: 'col-resize', zIndex: 2, display: 'flex', justifyContent: 'center' }}
                      onMouseEnter={(e) => { const el = e.currentTarget.firstChild as HTMLElement; if (el) el.style.backgroundColor = 'var(--accent-blue)'; }}
                      onMouseLeave={(e) => { 
                        if (activeResizeCol !== colKey) {
                          const el = e.currentTarget.firstChild as HTMLElement; 
                          if (el) el.style.backgroundColor = 'transparent'; 
                        }
                      }}
                    >
                      <div style={{ width: '3px', height: '100%', backgroundColor: activeResizeCol === colKey ? 'var(--accent-blue)' : 'transparent', transition: 'background-color 0.2s ease' }} />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, rIdx) => {
              const isHighlighted = highlightRow ? highlightRow(row) : false;
              const customStyle = rowStyle ? rowStyle(row) : {};
              return (
              <tr 
                key={rIdx} 
                className={selectedRows.has(row) || isHighlighted ? 'table-row-active' : 'table-row'} 
                style={customStyle}
                onContextMenu={(e) => {
                  if (rowContextMenuActions) {
                    e.preventDefault();
                    setContextMenu({ x: e.pageX, y: e.pageY, row });
                  }
                }}
              >
                {selectable && (
                  <td style={{ padding: '10px 15px 10px 20px', borderBottom: '1px solid var(--border-main)' }}>
                    <input type="checkbox" checked={selectedRows.has(row)} onChange={(e) => handleSelectRow(row, e.target.checked)} style={{ cursor: 'pointer' }} />
                  </td>
                )}
                {visibleColumnKeys.map((colKey, cIdx) => {
                  const colDef = getColDef(colKey);
                  return (
                    <td key={cIdx} style={{ padding: `10px ${cIdx === visibleColumnKeys.length - 1 ? '20px' : '15px'} 10px ${cIdx === 0 && !selectable ? '20px' : '15px'}`, color: 'var(--text-main)', width: columnWidths[colKey] ? `${columnWidths[colKey]}px` : (colDef.width || 'auto'), minWidth: columnWidths[colKey] ? `${columnWidths[colKey]}px` : (colDef.width || 'auto'), maxWidth: columnWidths[colKey] ? `${columnWidths[colKey]}px` : (colDef.width || 'auto'), borderBottom: '1px solid var(--border-main)', ...(colDef.allowOverflow ? { overflow: 'visible' } : { overflow: 'hidden', textOverflow: 'ellipsis' }) }}>
                      {colDef.renderCell ? colDef.renderCell(row[colKey], row, searchQuery) : (row[colKey] !== null && row[colKey] !== undefined ? <HighlightedText text={String(row[colKey])} highlight={searchQuery} /> : <span style={{ color: 'var(--text-muted)' }}>NULL</span>)}
                    </td>
                  );
                })}
              </tr>
              );
            })}
            {loading && processedRows.length === 0 && (
              <tr><td colSpan={visibleColumnKeys.length + (selectable ? 1 : 0)} style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
                  <div className="spin-animation" style={{ width: '24px', height: '24px', border: '2px solid var(--border-main)', borderTopColor: 'var(--accent-blue)', borderRadius: '50%' }} />
                  <span style={{ fontSize: '13px' }}>Loading database records...</span>
                </div>
              </td></tr>
            )}
            {!loading && processedRows.length === 0 && (
              <tr><td colSpan={visibleColumnKeys.length + (selectable ? 1 : 0)} style={{ padding: 0, borderBottom: pageSize > 1 ? '1px solid var(--border-main)' : 'none' }}>
                <EmptyState icon={<Search size={32} />} title="No results found" description={searchQuery ? `No entries match "${searchQuery}".` : "This table is currently empty."} minHeight="250px" />
              </td></tr>
            )}
            {/* Zero-CLS Padding: Fill the remaining space with a height-matched empty row so the pagination footer never jumps */}
            {paginatedRows.length < effectivePageSize && (
              <tr>
                <td colSpan={visibleColumnKeys.length + (selectable ? 1 : 0)} style={{ height: `${(effectivePageSize - Math.max(1, paginatedRows.length)) * 37}px`, borderBottom: 'none', padding: 0 }}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', backgroundColor: 'transparent', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Rows per page:</span><Dropdown options={['25', '50', '100', '500']} value={effectivePageSize.toString()} onChange={(val) => { setEffectivePageSize(Number(val)); setEffectiveCurrentPage(1); }} width="80px" direction="up" /></div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Showing {totalRecords === 0 ? 0 : startIndex + 1} to {endIndex} of {totalRecords} entries</div>
        </div>
        <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
          <button className="btn-secondary btn-sm" onClick={() => setEffectiveCurrentPage(p => Math.max(1, Number(p) - 1))} disabled={safeCurrentPage === 1}>Previous</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '0 5px', whiteSpace: 'nowrap' }}><span style={{ fontSize: '12px', color: 'var(--text-main)' }}>Page</span><input type="number" min={1} max={totalPages} value={effectiveCurrentPage} onChange={(e) => { if (e.target.value === '') { setEffectiveCurrentPage('' as any); return; } let val = parseInt(e.target.value, 10); if (!isNaN(val)) { if (val < 1) val = 1; if (val > totalPages) val = totalPages; setEffectiveCurrentPage(val); } }} onBlur={() => { if (!effectiveCurrentPage || isNaN(Number(effectiveCurrentPage))) setEffectiveCurrentPage(1); }} className="input-text no-spinners" style={{ width: '45px', padding: '4px', textAlign: 'center', fontSize: '12px', height: '26px' }} /><span style={{ fontSize: '12px', color: 'var(--text-main)' }}>of {totalPages}</span></div>
          <button className="btn-secondary btn-sm" onClick={() => setEffectiveCurrentPage(p => Math.min(totalPages, Number(p) + 1))} disabled={safeCurrentPage === totalPages}>Next</button>
        </div>
      </div>

      {contextMenu && rowContextMenuActions && createPortal(
        <div
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
        >
          <div
            ref={contextMenuRef}
            style={{
              position: 'absolute',
              top: `${contextMenu.y}px`,
              left: `${contextMenu.x}px`,
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-main)',
              borderRadius: '6px',
              padding: '6px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              minWidth: '180px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {rowContextMenuActions(contextMenu.row, () => setContextMenu(null))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};