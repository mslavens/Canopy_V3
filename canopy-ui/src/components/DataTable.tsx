import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, ChevronDown, ChevronRight, Upload, Search, Columns, CheckSquare, X, MoreHorizontal, Filter, Copy } from 'lucide-react';
import { Dropdown } from './Dropdown';
import { HighlightedText } from './HighlightedText';
import { EmptyState } from './EmptyState';
import { ContextMenuItem, ContextMenuDivider } from './ContextMenu';

export interface ColumnDef {
  key: string;
  label?: string;
  width?: string;
  renderCell?: (value: any, row: any, searchQuery?: string) => React.ReactNode;
  getFilterValues?: (row: any) => string | string[];
  exportValue?: (row: any) => string;
  formatFilterValue?: (value: string) => string;
  allowOverflow?: boolean;
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
  onRowDoubleClick?: (row: any) => void;
  isFetching?: boolean;
  bulkActions?: React.ReactNode;
  exportActions?: React.ReactNode;
  topRightActions?: React.ReactNode;
  toolbarTitle?: React.ReactNode;
  additionalExportColumns?: { header: string; getValue: (row: any) => string }[];
  loading?: boolean;
  rowContextMenuActions?: (row: any, closeMenu: () => void, colKey?: string, cellValue?: any, setFilterValue?: (col: string, val: string) => void, clearColumnFilter?: (col: string) => void, clearAllFilters?: () => void) => React.ReactNode;
  totalRows?: number;
  pagination?: boolean;
  currentPage?: number;
  rowsPerPage?: number;
  onPageChange?: (page: number) => void;
  onRowsPerPageChange?: (limit: number) => void;
  groupByField?: string | ((row: any) => string);
  groupByRender?: (groupVal: any) => React.ReactNode;
  allowScrollPastEnd?: boolean;
  expandableRowRender?: (row: any) => React.ReactNode;
  rowKeyField?: string | ((row: any) => string);
  disableInternalSearch?: boolean;
  expandedRows?: Set<any>;
  onExpandedRowsChange?: (expandedRows: Set<any>) => void;
}

export const DataTable: React.FC<DataTableProps> = ({ 
  columns, data, searchQuery = '', exportFilename, selectable = false, onSelectionChange, highlightRow, rowStyle, bulkActions, exportActions, topRightActions, toolbarTitle, additionalExportColumns, loading = false, isFetching = false, rowContextMenuActions,
  totalRows, pagination = false, currentPage: externalCurrentPage, rowsPerPage: externalRowsPerPage, onPageChange, onRowsPerPageChange, groupByField, groupByRender, allowScrollPastEnd = false, expandableRowRender, rowKeyField,
  disableInternalSearch = false, expandedRows: externalExpandedRows, onExpandedRowsChange
}) => {
  const [currentPage, setCurrentPage] = useState<number | string>(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [orderedColumnKeys, setOrderedColumnKeys] = useState<string[]>([]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const [actualLastGroupHeight, setActualLastGroupHeight] = useState(0);
  const [internalExpandedRows, setInternalExpandedRows] = useState<Set<any>>(new Set());
  const expandedRows = externalExpandedRows !== undefined ? externalExpandedRows : internalExpandedRows;

  const handleExpandedRowsChange = (next: Set<any>) => {
    if (onExpandedRowsChange) onExpandedRowsChange(next);
    if (externalExpandedRows === undefined) setInternalExpandedRows(next);
  };

  const getRowKey = (row: any) => {
    if (rowKeyField) {
      return typeof rowKeyField === 'function' ? rowKeyField(row) : row[rowKeyField];
    }
    return row.id !== undefined ? row.id : (row.dbId !== undefined ? row.dbId : row);
  };

  useEffect(() => {
    if (!scrollContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setContainerHeight(entries[0].contentRect.height);
    });
    observer.observe(scrollContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [activeResizeCol, setActiveResizeCol] = useState<string | null>(null);
  const [showTableActionsMenu, setShowTableActionsMenu] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: any; colKey?: string; cellValue?: any } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  
  // Feature: Column Filtering
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [filterMenuCol, setFilterMenuCol] = useState<string | null>(null);
  const [filterMenuSearch, setFilterMenuSearch] = useState('');
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const [showActiveFiltersMenu, setShowActiveFiltersMenu] = useState(false);
  const activeFiltersMenuRef = useRef<HTMLDivElement>(null);
  const [showSelectedMenu, setShowSelectedMenu] = useState(false);
  const selectedMenuRef = useRef<HTMLDivElement>(null);
  const [filterToSelections, setFilterToSelections] = useState(false);

  const searchedRows = useMemo(() => {
    let rows = data || [];
    
    if (searchQuery.trim() && !disableInternalSearch) {
      const lowerQuery = searchQuery.trim().toLowerCase();
      rows = rows.filter(row => {
        // Search through all values in the row object natively
        const matchesRowValues = Object.values(row).some(val => {
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().includes(lowerQuery);
        });
        
        if (matchesRowValues) return true;

        // Also search through derived filter values (e.g. arrays or computed properties)
        return columns.some(col => {
          const val = col.getFilterValues ? col.getFilterValues(row) : row[col.key];
          if (Array.isArray(val)) {
            return val.some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(lowerQuery));
          }
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().includes(lowerQuery);
        });
      });
    }
    return rows;
  }, [data, searchQuery, columns]);

  const uniqueValuesForFilter = useMemo(() => {
    if (!filterMenuCol) return [];
    
    let baseRows = searchedRows;
    const otherFilterKeys = Object.keys(columnFilters).filter(k => k !== filterMenuCol && columnFilters[k] !== undefined);
    
    if (otherFilterKeys.length > 0) {
      baseRows = baseRows.filter(row => {
        return otherFilterKeys.every(k => {
          const colDef = columns.find(c => c.key === k);
          const v = colDef?.getFilterValues ? colDef.getFilterValues(row) : row[k];
          if (Array.isArray(v)) {
            if (v.length === 0) return columnFilters[k].has('');
            return v.some(item => columnFilters[k].has(item !== null && item !== undefined ? String(item) : ''));
          } else {
            const rowVal = v !== null && v !== undefined ? String(v) : '';
            return columnFilters[k].has(rowVal);
          }
        });
      });
    }

    const vals = new Set<string>();
    baseRows.forEach(row => {
      const colDef = columns.find(c => c.key === filterMenuCol);
      const v = colDef?.getFilterValues ? colDef.getFilterValues(row) : row[filterMenuCol];
      if (Array.isArray(v)) {
        if (v.length === 0) vals.add('');
        else v.forEach(item => vals.add(item !== null && item !== undefined ? String(item) : ''));
      } else {
        vals.add(v !== null && v !== undefined ? String(v) : '');
      }
    });
    return Array.from(vals).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [searchedRows, filterMenuCol, columns, columnFilters]);

  const filteredUniqueValues = useMemo(() => {
    if (!filterMenuSearch) return uniqueValuesForFilter;
    const lower = filterMenuSearch.toLowerCase();
    return uniqueValuesForFilter.filter(v => v.toLowerCase().includes(lower));
  }, [uniqueValuesForFilter, filterMenuSearch]);

  const resizingCol = useRef<string | null>(null);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);

  // Feature: Row Selection
  const [selectedRows, setSelectedRows] = useState<Set<any>>(new Set());

  // Feature: Context Menu
  
  useEffect(() => {
    if (onSelectionChange) onSelectionChange(Array.from(selectedRows));
  }, [selectedRows, onSelectionChange]);

  // Clear selections for objects that no longer exist in the data (e.g. after a delete or refresh)
  useEffect(() => {
    setSelectedRows(prev => {
      if (prev.size === 0) return prev;
      const next = new Set<any>();
      for (const row of prev) {
        // If the data objects are re-fetched, references change and selection naturally clears.
        // If data objects are mutated in place, this preserves valid selections.
        if (data.includes(row)) next.add(row);
      }
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [data]);

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
        const portalDropdowns = document.querySelectorAll('.portal-dropdown-menu');
        let clickedInsidePortal = false;
        portalDropdowns.forEach(el => {
          if (el.contains(event.target as Node)) clickedInsidePortal = true;
        });
        if (!clickedInsidePortal) {
          setContextMenu(null);
        }
      }
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        // If clicking outside, close the filter menu
        // We ensure we don't close it if they just clicked the filter icon itself
        const target = event.target as HTMLElement;
        if (!target.closest('.filter-icon-btn')) {
          setFilterMenuCol(null);
          setFilterMenuSearch('');
        }
      }
      if (activeFiltersMenuRef.current && !activeFiltersMenuRef.current.contains(event.target as Node)) {
        setShowActiveFiltersMenu(false);
      }
      if (selectedMenuRef.current && !selectedMenuRef.current.contains(event.target as Node)) {
        setShowSelectedMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Prevent wheel events from bleeding through the filter menu to the underlying table
  useEffect(() => {
    const el = filterMenuRef.current;
    if (!el) return;
    
    const handleWheel = (e: WheelEvent) => {
      const scrollableList = el.querySelector('.filter-scrollable-list');
      if (scrollableList && scrollableList.contains(e.target as Node)) {
        // If it's inside the scrollable area, check if it actually can scroll
        const hasScrollbar = scrollableList.scrollHeight > scrollableList.clientHeight;
        if (!hasScrollbar) {
          e.preventDefault();
        }
        // Otherwise, overscroll-behavior: contain will handle the chaining
        return;
      }
      // If scrolling over the header/footer of the popup, stop it from scrolling the table
      e.preventDefault();
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [filterMenuCol]);

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
  const tableId = useMemo(() => `canopy_dt_${columnKeysString}`, [columnKeysString]);

  // Load layout and columns
  useEffect(() => {
    const savedStateStr = localStorage.getItem(tableId);
    if (savedStateStr) {
      try {
        const savedState = JSON.parse(savedStateStr);
        setOrderedColumnKeys(savedState.orderedColumnKeys || columns.map(c => c.key));
        setHiddenColumns(new Set(savedState.hiddenColumns || []));
        setColumnWidths(savedState.columnWidths || {});
      } catch (e) {
        setOrderedColumnKeys(columns.map(c => c.key));
        setHiddenColumns(new Set());
        setColumnWidths({});
      }
    } else {
      setOrderedColumnKeys(columns.map(c => c.key));
      setHiddenColumns(new Set());
      setColumnWidths({});
    }
    setSortConfig(null);
  }, [columnKeysString, tableId]);

  // Save layout changes
  const isLoadedRef = useRef(false);
  useEffect(() => {
    if (!isLoadedRef.current) {
      isLoadedRef.current = true;
      return;
    }
    const stateToSave = {
      orderedColumnKeys,
      hiddenColumns: Array.from(hiddenColumns),
      columnWidths
    };
    localStorage.setItem(tableId, JSON.stringify(stateToSave));
  }, [orderedColumnKeys, hiddenColumns, columnWidths, tableId]);

  const handleResetLayout = () => {
    localStorage.removeItem(tableId);
    setOrderedColumnKeys(columns.map(c => c.key));
    setHiddenColumns(new Set());
    setColumnWidths({});
    setShowColumnToggle(false);
  };

  // Process global search filtering and column sorting internally
  const processedRows = useMemo(() => {
    let rows = searchedRows;

    const filterKeys = Object.keys(columnFilters).filter(k => columnFilters[k] !== undefined);
    if (filterKeys.length > 0) {
      rows = rows.filter(row => {
        return filterKeys.every(k => {
          const colDef = columns.find(c => c.key === k);
          const v = colDef?.getFilterValues ? colDef.getFilterValues(row) : row[k];
          if (Array.isArray(v)) {
            if (v.length === 0) return columnFilters[k].has('');
            return v.some(item => columnFilters[k].has(item !== null && item !== undefined ? String(item) : ''));
          } else {
            const rowVal = v !== null && v !== undefined ? String(v) : '';
            return columnFilters[k].has(rowVal);
          }
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

    if (filterToSelections && selectedRows.size > 0) {
      rows = rows.filter(row => selectedRows.has(row) || Array.from(selectedRows).some(r => getRowKey(r) === getRowKey(row)));
    }

    return rows;
  }, [searchedRows, sortConfig, columns, columnFilters, filterToSelections, selectedRows]);

  // Reset to page 1 when search queries or filters change
  useEffect(() => {
    if (pagination) {
      if (onPageChange) {
        if (externalCurrentPage !== 0 && externalCurrentPage !== undefined) {
          onPageChange(0);
        }
      } else {
        setCurrentPage(1);
      }
    }
  }, [searchQuery, columnFilters, filterToSelections]);

  const effectiveCurrentPage = externalCurrentPage !== undefined ? externalCurrentPage + 1 : currentPage;
  const effectivePageSize = externalRowsPerPage !== undefined ? externalRowsPerPage : pageSize;

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
    return pagination ? processedRows.slice(startIndex, endIndex) : processedRows;
  }, [processedRows, startIndex, endIndex, pagination]);

  // Measure the exact pixel height of the last group to handle multi-line wrapped text
  useEffect(() => {
    if (!allowScrollPastEnd || paginatedRows.length === 0) return;
    const measure = () => {
      if (!scrollContainerRef.current) return;
      const elements = scrollContainerRef.current.querySelectorAll('.last-group-row');
      let h = 0;
      elements.forEach(el => {
        h += el.getBoundingClientRect().height;
      });
      if (h > 0) setActualLastGroupHeight(h);
    };
    
    // Defer measurement slightly to let DOM render
    const timer = setTimeout(measure, 10);
    return () => clearTimeout(timer);
  }, [paginatedRows, allowScrollPastEnd, columnWidths, containerHeight]);

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
    
    // Calculate the exact DOM index offset for columns
    let colOffset = 0;
    if (expandableRowRender) colOffset++;
    if (selectable) colOffset++;
    
    // Capture actual rendered widths of all visible columns to prevent jumping/slippage
    const currentWidths: Record<string, number> = { ...columnWidths };
    if (ths) {
      visibleColumnKeys.forEach((key, idx) => {
        const thElement = ths[idx + colOffset];
        if (thElement) {
          currentWidths[key] = thElement.getBoundingClientRect().width;
        }
      });
      setColumnWidths(currentWidths);
    }
    
    startWidth.current = th ? th.getBoundingClientRect().width : (columnWidths[colKey] || 150);

    let finalWidth = startWidth.current;
    const colIndex = visibleColumnKeys.indexOf(colKey);
    const thIdx = colIndex + colOffset;
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
        const colDef = getColDef(k);
        let val = colDef.exportValue ? colDef.exportValue(row) : row[k];
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

  // Calculate dynamic padding to allow the last group to scroll perfectly to the top without disappearing
  let calculatedScrollPadding = 0;
  if (allowScrollPastEnd && containerHeight > 0 && paginatedRows.length > 0) {
    if (actualLastGroupHeight > 0) {
      calculatedScrollPadding = Math.max(0, containerHeight - 42 - actualLastGroupHeight); // Subtract 42px to account for the sticky column headers!
    } else {
      // Fallback estimate if measurement hasn't completed yet
      if (groupByField) {
        const getGroupVal = (r: any) => typeof groupByField === 'function' ? groupByField(r) : r[groupByField];
        const lastGroupVal = getGroupVal(paginatedRows[paginatedRows.length - 1]);
        const lastGroupCount = paginatedRows.filter(r => getGroupVal(r) === lastGroupVal).length;
        const lastGroupHeight = 32 + (lastGroupCount * 40);
        calculatedScrollPadding = Math.max(0, containerHeight - 42 - lastGroupHeight);
      } else {
        const lastGroupHeight = paginatedRows.length * 40;
        calculatedScrollPadding = Math.max(0, containerHeight - 42 - lastGroupHeight);
      }
    }
  }

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
          {(() => {
            const activeFilterKeys = Object.keys(columnFilters).filter(k => columnFilters[k] !== undefined && columnFilters[k].size > 0);
            if (activeFilterKeys.length === 0) return null;
            return (
              <div ref={activeFiltersMenuRef} style={{ position: 'relative' }}>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => setShowActiveFiltersMenu(!showActiveFiltersMenu)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', backgroundColor: 'rgba(59, 130, 246, 0.1)' }}
                >
                  <Filter size={14} /> {activeFilterKeys.length} Filter{activeFilterKeys.length !== 1 ? 's' : ''} Applied
                </button>
                {showActiveFiltersMenu && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '8px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '6px', padding: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 1000, width: '250px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Active Filters</span>
                      <button onClick={() => setShowActiveFiltersMenu(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 0 }}><X size={14}/></button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                      {activeFilterKeys.map(k => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', fontSize: '12px', padding: '6px', backgroundColor: 'var(--bg-element)', borderRadius: '4px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>{getColDef(k).label || k}</span>
                            <span style={{ color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {Array.from(columnFilters[k]).map(v => {
                                const displayVal = getColDef(k).formatFilterValue ? getColDef(k).formatFilterValue!(v) : v;
                                return displayVal === '' ? '(Blank)' : displayVal;
                              }).join(', ')}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              setColumnFilters(prev => { const next = {...prev}; delete next[k]; return next; });
                              setEffectiveCurrentPage(1);
                              if (activeFilterKeys.length === 1) setShowActiveFiltersMenu(false);
                            }}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', flexShrink: 0 }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                    <button
                      onClick={() => {
                        setColumnFilters({});
                        setEffectiveCurrentPage(1);
                        setShowActiveFiltersMenu(false);
                      }}
                      style={{ background: 'none', border: 'none', color: 'var(--status-red)', fontSize: '11px', cursor: 'pointer', textAlign: 'center', padding: '4px' }}
                    >
                      Clear All Filters
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
          {selectable && (
            <div ref={selectedMenuRef} style={{ position: 'relative', visibility: selectedRows.size > 0 ? 'visible' : 'hidden' }}>
              <button
                className="btn-secondary btn-sm"
                onClick={() => setShowSelectedMenu(!showSelectedMenu)}
                style={{ fontSize: '12px', color: 'var(--accent-blue)', borderColor: filterToSelections ? 'var(--accent-blue)' : 'transparent', backgroundColor: 'rgba(59, 130, 246, 0.1)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px', minWidth: '85px' }}
              >
                <CheckSquare size={14} /> {selectedRows.size > 0 ? selectedRows.size : 0} selected {filterToSelections && '(Filtered)'}
              </button>
              {showSelectedMenu && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '8px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '6px', padding: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 1000, width: '180px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {filterToSelections ? (
                    <button
                      onClick={() => {
                        setFilterToSelections(false);
                        setShowSelectedMenu(false);
                      }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-main)', fontSize: '12px', cursor: 'pointer', textAlign: 'left', padding: '8px 12px', borderRadius: '4px', width: '100%', display: 'flex', alignItems: 'center', gap: '8px' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <Filter size={14} /> Show All Rows
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setFilterToSelections(true);
                        setShowSelectedMenu(false);
                      }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-main)', fontSize: '12px', cursor: 'pointer', textAlign: 'left', padding: '8px 12px', borderRadius: '4px', width: '100%', display: 'flex', alignItems: 'center', gap: '8px' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <Filter size={14} /> Filter to Selections
                    </button>
                  )}
                  <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '2px 0' }} />
                  <button
                    onClick={() => {
                      setSelectedRows(new Set());
                      setFilterToSelections(false);
                      setShowSelectedMenu(false);
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--status-red)', fontSize: '12px', cursor: 'pointer', textAlign: 'left', padding: '8px 12px', borderRadius: '4px', width: '100%', display: 'flex', alignItems: 'center', gap: '8px' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <X size={14} /> Clear Selections
                  </button>
                </div>
              )}
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
                <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                <button onClick={handleResetLayout} style={{ background: 'none', border: 'none', color: 'var(--accent-blue)', fontSize: '11px', cursor: 'pointer', textAlign: 'center', padding: '4px' }}>
                  Reset to default layout
                </button>
              </div>
            )}
          </div>
          
          {topRightActions}
        </div>
      </div>

      {/* Main Table Area */}
      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: 'scroll', overflowX: 'auto', containerType: 'inline-size' }}>
        <table style={{ minWidth: Object.keys(columnWidths).length > 0 ? 'auto' : '100%', width: 'max-content', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap' }}>
          <thead style={{ backgroundColor: 'var(--bg-element)' }}>
            <tr>
              {expandableRowRender && (
                <th 
                  style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-element)', zIndex: 1, padding: '10px 10px', borderBottom: '2px solid var(--bg-app)', borderRight: '1px solid var(--border-main)', width: '32px', cursor: 'pointer', textAlign: 'center' }}
                  onClick={() => {
                    if (expandedRows.size > 0 && expandedRows.size >= processedRows.length) {
                      handleExpandedRowsChange(new Set());
                    } else {
                      const allKeys = new Set(processedRows.map(r => getRowKey(r)));
                      handleExpandedRowsChange(allKeys);
                    }
                  }}
                  title={expandedRows.size > 0 && expandedRows.size >= processedRows.length ? "Collapse All" : "Expand All"}
                >
                  {expandedRows.size > 0 && expandedRows.size >= processedRows.length ? <ChevronDown size={14} style={{color: 'var(--text-muted)'}} /> : <ChevronRight size={14} style={{color: 'var(--text-muted)'}} />}
                </th>
              )}
              {selectable && (
                <th style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-element)', zIndex: 1, padding: '10px 15px 10px 20px', borderBottom: '2px solid var(--bg-app)', borderRight: '1px solid var(--border-main)', width: '40px' }}>
                  <input type="checkbox" checked={selectedRows.size === processedRows.length && processedRows.length > 0} onChange={handleSelectAll} style={{ cursor: 'pointer' }} />
                </th>
              )}
              {visibleColumnKeys.map((colKey, idx) => {
                const colDef = getColDef(colKey);
                return (
                  <th 
                    key={colKey} 
                    className="data-table-th"
                    style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-element)', zIndex: filterMenuCol === colKey ? 100 : 1, padding: `10px ${idx === visibleColumnKeys.length - 1 ? '20px' : '15px'} 10px ${idx === 0 && !selectable ? '20px' : '15px'}`, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'left', borderBottom: '2px solid var(--bg-app)', borderRight: idx === visibleColumnKeys.length - 1 ? 'none' : '1px solid var(--border-main)', width: columnWidths[colKey] ? `${columnWidths[colKey]}px` : (colDef.width || 'auto'), minWidth: columnWidths[colKey] ? `${columnWidths[colKey]}px` : (colDef.width || 'auto'), maxWidth: columnWidths[colKey] ? `${columnWidths[colKey]}px` : (colDef.width || 'auto'), overflow: 'visible' }} 
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', position: 'relative' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                        <div 
                          draggable 
                          onDragStart={(e) => handleDragStart(e, colKey)} 
                          onDragOver={handleDragOver} 
                          onDrop={(e) => handleDrop(e, colKey)}
                          onClick={() => handleSort(colKey)} 
                          style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', cursor: 'pointer', flex: 1 }}
                          title="Drag to reorder, click to sort"
                        >
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-main)' }}>{colDef.label || colDef.key}</span>
                          <span style={{ display: 'inline-flex', width: '14px', flexShrink: 0, color: 'var(--accent-blue)' }}>{sortConfig?.key === colKey ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : null}</span>
                        </div>
                        <button 
                          className="filter-icon-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (filterMenuCol === colKey) {
                              setFilterMenuCol(null);
                            } else {
                              setFilterMenuCol(colKey);
                              setFilterMenuSearch('');
                            }
                          }}
                          style={{ 
                            background: 'none', border: 'none', padding: '2px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
                            color: columnFilters[colKey] ? 'var(--accent-blue)' : 'var(--text-muted)',
                            backgroundColor: columnFilters[colKey] ? 'rgba(137, 180, 250, 0.1)' : 'transparent',
                            opacity: columnFilters[colKey] ? 1 : 0,
                            pointerEvents: columnFilters[colKey] ? 'auto' : 'none',
                            transition: 'opacity 0.2s ease, background-color 0.2s ease'
                          }}
                          title={columnFilters[colKey] ? "Filter Active. Click to modify." : "Filter column"}
                        >
                          <Filter size={14} />
                        </button>
                      </div>
                      
                      {filterMenuCol === colKey && (
                        <div 
                          ref={filterMenuRef}
                          style={{ 
                            position: 'absolute', 
                            top: '100%', 
                            left: 0, 
                            marginTop: '8px',
                            zIndex: 10, 
                            backgroundColor: 'var(--bg-surface)', 
                            border: '1px solid var(--border-main)', 
                            borderRadius: '6px', 
                            boxShadow: '0 4px 16px rgba(0,0,0,0.25)', 
                            width: '240px', 
                            display: 'flex', 
                            flexDirection: 'column',
                            overflow: 'hidden'
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <div style={{ padding: '12px', borderBottom: '1px solid var(--border-main)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Filter: {colDef.label || colKey}</span>
                              <button onClick={() => setFilterMenuCol(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 0 }}><X size={14}/></button>
                            </div>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                              <Search size={12} style={{ position: 'absolute', left: '8px', color: 'var(--text-muted)' }} />
                              <input 
                                type="text" 
                                placeholder="Search values..." 
                                value={filterMenuSearch}
                                onChange={(e) => setFilterMenuSearch(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (filterMenuSearch.trim()) {
                                      setColumnFilters(prev => {
                                        const next = { ...prev };
                                        if (filteredUniqueValues.length === uniqueValuesForFilter.length) {
                                          delete next[colKey];
                                        } else {
                                          next[colKey] = new Set(filteredUniqueValues);
                                        }
                                        return next;
                                      });
                                    }
                                    setFilterMenuCol(null);
                                  }
                                }}
                                style={{ width: '100%', padding: '6px 8px 6px 26px', fontSize: '12px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '4px', color: 'var(--text-main)', outline: 'none' }}
                                autoFocus
                              />
                            </div>
                          </div>
                          
                          <div className="filter-scrollable-list" style={{ maxHeight: '200px', overflowY: 'auto', overscrollBehavior: 'contain', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {filteredUniqueValues.length === 0 ? (
                              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>No matching values.</div>
                            ) : (
                              <>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-main)', cursor: 'pointer', paddingBottom: '6px', borderBottom: '1px solid var(--border-main)', marginBottom: '4px' }}>
                                    <input 
                                      type="checkbox" 
                                      checked={
                                        columnFilters[colKey] === undefined 
                                          ? true 
                                          : filteredUniqueValues.every(v => columnFilters[colKey]?.has(v))
                                      }
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setColumnFilters(prev => {
                                          const next = { ...prev };
                                          let currentSet = prev[colKey] ? new Set(prev[colKey]) : new Set(uniqueValuesForFilter);
                                          
                                          if (checked) {
                                            filteredUniqueValues.forEach(v => currentSet.add(v));
                                          } else {
                                            filteredUniqueValues.forEach(v => currentSet.delete(v));
                                          }
                                          
                                          if (currentSet.size === uniqueValuesForFilter.length) {
                                            delete next[colKey];
                                          } else {
                                            next[colKey] = currentSet;
                                          }
                                          return next;
                                        });
                                        setEffectiveCurrentPage(1);
                                      }}
                                      style={{ cursor: 'pointer', margin: 0 }}
                                    />
                                    <span style={{ fontWeight: 600, flex: 1 }}>{filterMenuSearch ? '(Select All Search Results)' : '(Select All)'}</span>
                                  </label>
                                {filteredUniqueValues.slice(0, 300).map(val => {
                                  const isActive = columnFilters[colKey] === undefined || columnFilters[colKey].has(val);
                                  return (
                                    <label key={val} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-main)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                      <input 
                                        type="checkbox" 
                                        checked={isActive}
                                        onChange={(e) => {
                                          const checked = e.target.checked;
                                          setColumnFilters(prev => {
                                            const next = { ...prev };
                                            let currentSet = prev[colKey] ? new Set(prev[colKey]) : new Set(uniqueValuesForFilter);
                                            
                                            if (checked) currentSet.add(val);
                                            else currentSet.delete(val);
                                            
                                            if (currentSet.size === uniqueValuesForFilter.length) {
                                              delete next[colKey];
                                            } else {
                                              next[colKey] = currentSet;
                                            }
                                            return next;
                                          });
                                          setEffectiveCurrentPage(1);
                                        }}
                                        style={{ cursor: 'pointer', margin: 0 }}
                                      />
                                      {(() => {
                                        const displayVal = colDef.formatFilterValue ? colDef.formatFilterValue(val) : val;
                                        return <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={displayVal || '(Blanks)'}>{displayVal || '(Blanks)'}</span>;
                                      })()}
                                    </label>
                                  );
                                })}
                                {filteredUniqueValues.length > 300 && (
                                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '8px', paddingBottom: '4px', fontStyle: 'italic' }}>
                                    Showing top 300 results. Use search to find more.
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          
                          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <button 
                              className="btn-secondary btn-sm"
                              onClick={() => {
                                setColumnFilters(prev => {
                                  const next = { ...prev };
                                  delete next[colKey];
                                  return next;
                                });
                                setEffectiveCurrentPage(1);
                                setFilterMenuSearch('');
                                setFilterMenuCol(null);
                              }}
                              style={{ fontSize: '11px', padding: '4px 8px' }}
                              disabled={columnFilters[colKey] === undefined}
                            >
                              Clear
                            </button>
                            <button 
                              className="btn-primary btn-sm"
                              onClick={() => {
                                if (filterMenuSearch.trim()) {
                                  setColumnFilters(prev => {
                                    const next = { ...prev };
                                    if (filteredUniqueValues.length === uniqueValuesForFilter.length) {
                                      delete next[colKey];
                                    } else {
                                      next[colKey] = new Set(filteredUniqueValues);
                                    }
                                    return next;
                                  });
                                }
                                setFilterMenuCol(null);
                              }}
                              style={{ fontSize: '11px', padding: '4px 12px' }}
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      )}
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
              const getGroupVal = (r: any) => typeof groupByField === 'function' ? groupByField(r) : (groupByField ? r[groupByField] : undefined);
              const groupVal = groupByField ? getGroupVal(row) : undefined;
              const prevGroupVal = groupByField && rIdx > 0 ? getGroupVal(paginatedRows[rIdx - 1]) : undefined;
              const showGroupHeader = groupByField && groupVal !== prevGroupVal;
              
              const isLastGroup = groupByField ? groupVal === getGroupVal(paginatedRows[paginatedRows.length - 1]) : true;

              return (
                <React.Fragment key={rIdx}>
                  {showGroupHeader && (
                    <tr className={isLastGroup ? 'last-group-row' : ''}>
                      <td colSpan={visibleColumnKeys.length + (selectable ? 1 : 0)} style={{ position: 'sticky', top: '41px', zIndex: 5, backgroundColor: 'var(--bg-element)', padding: '6px 15px', fontWeight: 600, color: 'var(--text-main)', borderBottom: '1px solid var(--border-main)', fontSize: '12px' }}>
                        {groupByRender ? groupByRender(groupVal) : groupVal}
                      </td>
                    </tr>
                  )}
              <tr 
                className={`${selectedRows.has(row) || (Array.from(selectedRows).some(r => getRowKey(r) === getRowKey(row))) || isHighlighted ? 'table-row-active' : 'table-row'} ${isLastGroup && !expandedRows.has(getRowKey(row)) ? 'last-group-row' : ''}`} 
                style={customStyle}
                onContextMenu={(e) => {
                  if (rowContextMenuActions && !visibleColumnKeys.length) {
                    e.preventDefault();
                    setContextMenu({ x: e.pageX, y: e.pageY, row });
                  }
                }}
              >
                {expandableRowRender && (
                  <td style={{ padding: '10px 10px', width: '32px', borderBottom: '1px solid var(--border-main)', cursor: 'pointer' }} onClick={() => {
                    const rowKey = getRowKey(row);
                    const next = new Set(expandedRows);
                    if (next.has(rowKey)) next.delete(rowKey);
                    else next.add(rowKey);
                    handleExpandedRowsChange(next);
                  }}>
                    {expandedRows.has(getRowKey(row)) ? <ChevronDown size={14} style={{color: 'var(--text-muted)'}} /> : <ChevronRight size={14} style={{color: 'var(--text-muted)'}} />}
                  </td>
                )}
                {selectable && (
                  <td style={{ padding: '10px 15px 10px 20px', borderBottom: '1px solid var(--border-main)', verticalAlign: 'top' }}>
                    <input type="checkbox" checked={selectedRows.has(row) || Array.from(selectedRows).some(r => getRowKey(r) === getRowKey(row))} onChange={(e) => handleSelectRow(row, e.target.checked)} style={{ cursor: 'pointer', marginTop: '2px' }} />
                  </td>
                )}
                {visibleColumnKeys.map((colKey, cIdx) => {
                  const colDef = getColDef(colKey);
                  return (
                    <td 
                      key={cIdx} 
                      onContextMenu={(e) => {
                        if (rowContextMenuActions) {
                          e.preventDefault();
                          e.stopPropagation();
                          let cellValue = row[colKey];
                          
                          if (e.target instanceof HTMLElement && e.target.tagName !== 'TD' && e.target.innerText) {
                            cellValue = e.target.innerText.trim();
                          } else if (Array.isArray(cellValue)) {
                            cellValue = cellValue.join(', ');
                          }
                          
                          setContextMenu({ x: e.pageX, y: e.pageY, row, colKey, cellValue });
                        }
                      }}
                      style={{ padding: `10px ${cIdx === visibleColumnKeys.length - 1 ? '20px' : '15px'} 10px ${cIdx === 0 && !selectable ? '20px' : '15px'}`, color: 'var(--text-main)', verticalAlign: 'top', textAlign: 'left', width: columnWidths[colKey] ? `${columnWidths[colKey]}px` : (colDef.width || 'auto'), minWidth: columnWidths[colKey] ? `${columnWidths[colKey]}px` : (colDef.width || 'auto'), maxWidth: columnWidths[colKey] ? `${columnWidths[colKey]}px` : (colDef.width || 'auto'), borderBottom: '1px solid var(--border-main)', ...(colDef.allowOverflow ? { overflow: 'visible' } : { overflow: 'hidden', textOverflow: 'ellipsis' }) }}
                    >
                      {colDef.renderCell ? colDef.renderCell(row[colKey], row, searchQuery) : (row[colKey] !== null && row[colKey] !== undefined ? <HighlightedText text={String(row[colKey])} highlight={searchQuery} /> : <span style={{ color: 'var(--text-muted)' }}>NULL</span>)}
                    </td>
                  );
                })}
              </tr>
              {expandableRowRender && expandedRows.has(getRowKey(row)) && (
                <tr style={{ backgroundColor: 'rgba(0,0,0,0.1)' }}>
                  <td colSpan={visibleColumnKeys.length + (selectable ? 1 : 0) + 1} style={{ padding: 0, borderBottom: '1px solid var(--border-main)' }}>
                    {expandableRowRender(row)}
                  </td>
                </tr>
              )}
              </React.Fragment>
              );
            })}
            {loading && processedRows.length === 0 && (
              <tr><td colSpan={visibleColumnKeys.length + (selectable ? 1 : 0)} style={{ padding: 0 }}>
                <div style={{ position: 'sticky', left: 0, width: '100cqw', display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
                    <div className="spin-animation" style={{ width: '24px', height: '24px', border: '2px solid var(--border-main)', borderTopColor: 'var(--accent-blue)', borderRadius: '50%' }} />
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Loading database records...</span>
                  </div>
                </div>
              </td></tr>
            )}
            {!loading && !isFetching && processedRows.length === 0 && (
              <tr><td colSpan={visibleColumnKeys.length + (selectable ? 1 : 0)} style={{ padding: 0, borderBottom: pageSize > 1 ? '1px solid var(--border-main)' : 'none' }}>
                <div style={{ position: 'sticky', left: 0, width: '100cqw', display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: '100%', maxWidth: '600px' }}>
                    <EmptyState icon={<Search size={32} />} title="No results found" description={searchQuery ? `No entries match "${searchQuery}".` : "This table is currently empty."} minHeight="250px" />
                  </div>
                </div>
              </td></tr>
            )}
            {/* Zero-CLS Padding: Fill the remaining space with a height-matched empty row so the pagination footer never jumps */}
            {!allowScrollPastEnd && effectivePageSize !== 999999 && paginatedRows.length < effectivePageSize && (
              <tr>
                <td colSpan={visibleColumnKeys.length + (selectable ? 1 : 0)} style={{ height: `${(effectivePageSize - Math.max(1, paginatedRows.length)) * 37}px`, borderBottom: 'none', padding: 0 }}></td>
              </tr>
            )}
            {/* Scroll Past End Padding (must be inside tbody to preserve sticky headers) */}
            {allowScrollPastEnd && calculatedScrollPadding > 0 && (
              <tr>
                <td colSpan={visibleColumnKeys.length + (selectable ? 1 : 0)} style={{ height: `${calculatedScrollPadding}px`, border: 'none', padding: 0 }}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', backgroundColor: 'transparent', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Rows per page:</span><Dropdown options={['25', '50', '100', '500', 'All']} value={effectivePageSize === 999999 ? 'All' : effectivePageSize.toString()} onChange={(val) => { setEffectivePageSize(val === 'All' ? 999999 : Number(val)); setEffectiveCurrentPage(1); }} width="80px" direction="up" /></div>
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
            className="datatable-context-menu"
            style={{
              position: 'absolute',
              top: `${Math.min(contextMenu.y, window.innerHeight - 280)}px`,
              left: `${Math.min(contextMenu.x, window.innerWidth - 260)}px`,
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
            {contextMenu.colKey && (
              <>
                <ContextMenuItem
                  icon={<Copy size={13} />}
                  label={`Copy ${getColDef(contextMenu.colKey)?.label || contextMenu.colKey}`}
                  onClick={() => {
                    const val = contextMenu.cellValue;
                    const text = typeof val === 'object' ? JSON.stringify(val) : (val !== null && val !== undefined ? String(val) : '');
                    navigator.clipboard.writeText(text);
                    setContextMenu(null);
                  }}
                />
                <ContextMenuItem
                  icon={<Search size={13} />}
                  label="Global Search"
                  onClick={() => {
                    const val = contextMenu.cellValue;
                    const text = typeof val === 'object' ? JSON.stringify(val) : (val !== null && val !== undefined ? String(val) : '');
                    if (text) {
                      document.dispatchEvent(new CustomEvent('open-global-search', { detail: text }));
                    }
                    setContextMenu(null);
                  }}
                />
                <ContextMenuDivider />
              </>
            )}
            {rowContextMenuActions(
              contextMenu.row, 
              () => setContextMenu(null), 
              contextMenu.colKey, 
              contextMenu.cellValue, 
              (col: string, val: string) => {
                setColumnFilters(prev => ({ ...prev, [col]: new Set([val]) }));
                setEffectiveCurrentPage(1);
              },
              (col: string) => {
                setColumnFilters(prev => {
                  const next = { ...prev };
                  delete next[col];
                  return next;
                });
                setEffectiveCurrentPage(1);
              },
              () => {
                setColumnFilters({});
                setEffectiveCurrentPage(1);
              }
            )}
          </div>
        </div>,
        document.body
      )}
      <style>{`
        .data-table-th:hover .filter-icon-btn {
          opacity: 1 !important;
          pointer-events: auto !important;
        }
        .filter-icon-btn:hover {
          background-color: var(--bg-app) !important;
        }
      `}</style>
    </div>
  );
};