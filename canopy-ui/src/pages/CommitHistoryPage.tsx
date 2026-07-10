import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CanopyApiClient } from '../api/client';
import { History, Clock, GitCommit, RotateCcw, FileJson, ArrowRight, CornerUpLeft, PlusCircle, MinusCircle, Edit2, Play, ChevronLeft, Code, Upload } from 'lucide-react';
import { useConfirm } from '../components/ConfirmProvider';
import { DataTable, ColumnDef } from '../components/DataTable';
import { HighlightedText } from '../components/HighlightedText';
import { Dropdown } from '../components/Dropdown';

interface CommitHistoryPageProps {
  globalScopeVendor?: string;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

interface CommitData {
  id: number;
  message: string;
  timestamp: string;
}

interface CommitCounts {
  added: number;
  deleted: number;
  modified: number;
  total: number;
}

export const CommitHistoryPage: React.FC<CommitHistoryPageProps> = ({ globalScopeVendor, addToast }) => {
  const [commits, setCommits] = useState<CommitData[]>([]);
  const [loading, setLoading] = useState(true);
  
  // State for view toggle
  const [viewMode, setViewMode] = useState<'history' | 'compare'>('history');
  const [selectedCommits, setSelectedCommits] = useState<CommitData[]>([]);
  const [selectedHistoryRows, setSelectedHistoryRows] = useState<any[]>([]);
  
  // Counts fetching state
  const [commitCounts, setCommitCounts] = useState<Record<number, CommitCounts>>({});
  
  // Compare view state
  const [diffData, setDiffData] = useState<any>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [selectedChangeRow, setSelectedChangeRow] = useState<any>(null);

  const confirm = useConfirm();
  const mountedRef = useRef(true);

  const handleHistorySelectionChange = React.useCallback((selected: any[]) => {
    setSelectedHistoryRows(selected);
  }, []);

  const handleChangeSelectionChange = React.useCallback((selected: any[]) => {
    if (selected.length > 0) setSelectedChangeRow(selected[0]);
    else setSelectedChangeRow(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchHistory();
    return () => { mountedRef.current = false; };
  }, []);

  const fetchHistory = async () => {
    try {
      const creds = await window.electron.getBackendAuth();
      const apiClient = new CanopyApiClient(creds);
      const data = await apiClient.getCommitHistory();
      if (mountedRef.current) {
        setCommits(data || []);
      }
    } catch (err: any) {
      if (mountedRef.current) addToast(`Failed to fetch history: ${err.message}`, 'error');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (commits.length > 0) {
      fetchCountsForCommits(commits);
    }
  }, [commits]);

  const fetchCountsForCommits = async (commitsList: CommitData[]) => {
    try {
      const creds = await window.electron.getBackendAuth();
      const apiClient = new CanopyApiClient(creds);
      
      for (const commit of commitsList) {
        if (!mountedRef.current) break;
        if (commitCounts[commit.id]) continue;
        
        try {
          const diff = await apiClient.getCommitDiff(commit.id);
          if (!mountedRef.current) break;
          
          let added = 0;
          let modified = 0;
          let deleted = 0;
          
          const countCategory = (cat: any) => {
            if (!cat) return;
            added += (cat.added || []).length;
            modified += (cat.modified || []).length;
            deleted += (cat.deleted || []).length;
          };

          if (diff) {
            countCategory(diff.address_objects);
            countCategory(diff.address_groups);
            countCategory(diff.services);
            countCategory(diff.tags);
          }
          
          setCommitCounts(prev => ({
            ...prev,
            [commit.id]: { added, modified, deleted, total: added + modified + deleted }
          }));
        } catch (err) {
          console.error(`Failed to get diff for commit ${commit.id}`, err);
        }
      }
    } catch (e) {
      console.error("Failed to authenticate for background counts fetch", e);
    }
  };

  const handleEnterCompareMode = async (selected: CommitData[]) => {
    if (selected.length === 0) return;
    
    // Sort to ensure we compare oldest (base) against newest (target)
    const sorted = [...selected].sort((a, b) => a.id - b.id);
    setSelectedCommits(sorted);
    setViewMode('compare');
    setLoadingDiff(true);
    setDiffData(null);
    setSelectedChangeRow(null);
    
    try {
      const creds = await window.electron.getBackendAuth();
      const apiClient = new CanopyApiClient(creds);
      let diff;
      
      if (sorted.length === 1) {
        // Compare against its predecessor
        diff = await apiClient.getCommitDiff(sorted[0].id);
      } else {
        // Compare base to target
        diff = await apiClient.compareCommits(sorted[0].id, sorted[1].id);
      }
      setDiffData(diff);
    } catch (err: any) {
      addToast(`Failed to load commit diff: ${err.message}`, 'error');
    } finally {
      setLoadingDiff(false);
    }
  };

  const handleExitCompareMode = () => {
    setViewMode('history');
    setSelectedCommits([]);
    setDiffData(null);
    setSelectedChangeRow(null);
  };

  const handleRevert = async () => {
    if (selectedCommits.length === 0) return;
    // Always revert to the latest selected commit
    const commit = selectedCommits[selectedCommits.length - 1];

    confirm({
      title: 'Revert Workspace Configuration',
      message: `Are you sure you want to revert the workspace to commit #${commit.id}? \n\nThis will completely overwrite the active workspace configuration with the state from ${new Date(commit.timestamp).toLocaleString()}. This action cannot be easily undone.`,
      confirmText: 'Revert Configuration',
      isDestructive: true,
      onConfirm: async () => {
        setIsReverting(true);
        try {
          const creds = await window.electron.getBackendAuth();
          const apiClient = new CanopyApiClient(creds);
          await apiClient.revertToCommit(commit.id);
          addToast(`Workspace reverted to commit #${commit.id}`, 'success');
          window.location.reload();
        } catch (err: any) {
          addToast(`Revert failed: ${err.message}`, 'error');
        } finally {
          setIsReverting(false);
        }
      }
    });
  };

  // --- HISTORY VIEW COLUMNS ---
  const historyColumns: ColumnDef[] = useMemo(() => [
    {
      key: 'id',
      label: 'Version',
      width: '160px',
      renderCell: (val, row) => {
        const isLatest = commits.length > 0 && commits[0].id === val;
        return (
          <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
            {val} {isLatest && <span style={{ fontSize: '10px', backgroundColor: 'var(--accent-blue)', color: 'white', padding: '1px 4px', borderRadius: '4px' }}>(Running)</span>}
          </span>
        );
      }
    },
    {
      key: 'committed_by',
      label: 'Committed By',
      width: '180px',
      renderCell: () => <span style={{ color: 'var(--text-muted)' }}>admin</span>
    },
    {
      key: 'timestamp',
      label: 'Commit Date',
      width: '210px',
      renderCell: (val) => new Date(val).toLocaleString()
    },
    {
      key: 'changes',
      label: 'Object Changes',
      width: '300px',
      renderCell: (_, row) => {
        const counts = commitCounts[row.id];
        if (!counts) {
          return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '12px' }}>Analyzing...</span>;
        }
        return (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' }}>
            <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', width: '60px', minWidth: '60px', flexShrink: 0 }} title="Added"><PlusCircle size={14}/> {counts.added}</span>
            <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px', width: '60px', minWidth: '60px', flexShrink: 0 }} title="Deleted"><MinusCircle size={14}/> {counts.deleted}</span>
            <span style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px', width: '60px', minWidth: '60px', flexShrink: 0 }} title="Modified"><Edit2 size={14}/> {counts.modified}</span>
            <button 
              onClick={(e) => { e.stopPropagation(); handleEnterCompareMode([row]); }} 
              style={{ color: 'var(--accent-blue)', background: 'rgba(59, 130, 246, 0.1)', padding: '2px 8px', borderRadius: '4px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500, marginLeft: '4px', minWidth: '60px', justifyContent: 'flex-start' }}
            >
              <FileJson size={13} /> {counts.total}
            </button>
          </div>
        );
      }
    },
    {
      key: 'message',
      label: 'Description',
      width: '100%'
    }
  ], [commitCounts, commits]);

  // --- COMPARE VIEW DATA & COLUMNS ---
  const changesList = useMemo(() => {
    const list: any[] = [];
    if (!diffData) return list;

    const getDisplayName = (item: any) => {
      if (!item || !item.name) return 'Unknown Object';
      if (typeof item.name === 'string') return item.name;
      return item.name.new || item.name.old || 'Unknown Object';
    };

    const getVendorName = (item: any) => {
      const uuid = item?.device_uuid || item?.deviceUuid || item?.scope;
      let vendor = globalScopeVendor || 'Unknown';
      if (uuid) {
        if (uuid.includes('paloalto-')) vendor = 'Palo Alto';
        else if (uuid.includes('fortinet-')) vendor = 'Fortinet';
        else if (uuid.includes('cisco-')) vendor = 'Cisco';
        else if (uuid.includes('checkpoint-')) vendor = 'Check Point';
        else if (uuid.includes('juniper-')) vendor = 'Juniper';
      }
      return vendor;
    };

    const processCategory = (categoryName: string, categoryData: any) => {
      if (!categoryData) return;
      
      (categoryData.added || []).forEach((item: any) => {
        const dName = getDisplayName(item);
        const scopeUUID = item?.device_uuid || item?.deviceUuid || item?.scope || 'global';
        list.push({
          id: `add_${categoryName}_${dName}_${scopeUUID}`,
          operation: 'add',
          table: categoryName,
          vendor: getVendorName(item),
          scope: scopeUUID === 'global' ? 'Global' : scopeUUID,
          name: dName,
          details: item
        });
      });

      (categoryData.modified || []).forEach((item: any) => {
        const dName = getDisplayName(item);
        const scopeUUID = (item.new || item)?.device_uuid || (item.new || item)?.deviceUuid || (item.new || item)?.scope || 'global';
        list.push({
          id: `mod_${categoryName}_${dName}_${scopeUUID}`,
          operation: 'edit',
          table: categoryName,
          vendor: getVendorName(item.new || item),
          scope: scopeUUID === 'global' ? 'Global' : scopeUUID,
          name: dName,
          details: item
        });
      });

      (categoryData.deleted || []).forEach((item: any) => {
        const dName = getDisplayName(item);
        const scopeUUID = item?.device_uuid || item?.deviceUuid || item?.scope || 'global';
        list.push({
          id: `del_${categoryName}_${dName}_${scopeUUID}`,
          operation: 'delete',
          table: categoryName,
          vendor: getVendorName(item),
          scope: scopeUUID === 'global' ? 'Global' : scopeUUID,
          name: dName,
          details: item
        });
      });
    };

    processCategory('addressObjects', diffData.address_objects);
    processCategory('addressGroups', diffData.address_groups);
    processCategory('services', diffData.services);
    processCategory('tags', diffData.tags);

    return list;
  }, [diffData, globalScopeVendor]);

  const compareColumns: ColumnDef[] = useMemo(() => [
    { 
      key: 'name', 
      label: 'Object Name',
      width: '100%',
      renderCell: (val, _, searchQuery) => <HighlightedText text={val} highlight={searchQuery || ''} />
    },
    { key: 'table', label: 'Object Type', width: '180px' },
    { key: 'vendor', label: 'Vendor Location', width: '160px' },
    { key: 'scope', label: 'Scope', width: '200px' },
    {
      key: 'operation',
      label: 'Operation',
      width: '150px',
      renderCell: (val) => {
        if (val === 'add') return <span style={{ color: '#10b981', fontWeight: 600 }}>add</span>;
        if (val === 'delete') return <span style={{ color: '#ef4444', fontWeight: 600 }}>delete</span>;
        return <span style={{ color: '#f59e0b', fontWeight: 600 }}>edit</span>;
      }
    }
  ], []);

  const renderDiffViewer = () => {
    if (!selectedChangeRow) {
      return (
        <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          Select an object change from the list above to view the code diff.
        </div>
      );
    }
    
    const { operation, details } = selectedChangeRow;

    if (operation === 'add' || operation === 'delete') {
      return (
        <pre style={{ margin: 0, padding: '16px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: operation === 'add' ? '#10b981' : '#ef4444', fontFamily: 'monospace', fontSize: '13px', height: '100%', overflowY: 'auto' }}>
          {JSON.stringify(details, null, 2)}
        </pre>
      );
    }
    
    if (operation === 'edit') {
      // The backend returns a flat object with property keys mapping to {old: ..., new: ...}
      const changedKeys = Object.keys(details).filter(k => k !== 'id' && typeof details[k] === 'object' && details[k] !== null && ('old' in details[k] || 'new' in details[k]));

      if (changedKeys.length === 0) {
        return (
          <pre style={{ margin: 0, padding: '16px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#f59e0b', fontFamily: 'monospace', fontSize: '13px', height: '100%', overflowY: 'auto' }}>
            {JSON.stringify(details, null, 2)}
          </pre>
        );
      }

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px', height: '100%', overflowY: 'auto' }}>
          {changedKeys.map(key => {
            const oldVal = details[key].old;
            const newVal = details[key].new;
            if (JSON.stringify(oldVal) === JSON.stringify(newVal)) return null;

            return (
              <div key={key} style={{ fontFamily: 'monospace', fontSize: '13px', backgroundColor: 'var(--bg-app)', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-main)' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px', borderBottom: '1px solid var(--border-main)', paddingBottom: '4px' }}>Property: {key}</div>
                <div style={{ color: '#ef4444', marginBottom: '4px' }}>- {JSON.stringify(oldVal)}</div>
                <div style={{ color: '#10b981' }}>+ {JSON.stringify(newVal)}</div>
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Custom Header Block mimicking Objects/Policies/DeviceManagement */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', gap: '24px', minHeight: '64px' }}>
            {viewMode === 'history' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Config Audit &amp; Commit History</h2>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                  Review the timeline of changes made to your active workspace, inspect diffs, and revert to previous states if necessary.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <button 
                  className="btn-secondary btn-sm" 
                  onClick={handleExitCompareMode}
                  style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <ChevronLeft size={16} /> Back
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Compare Versions</h2>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                    Viewing changes {selectedCommits.length === 1 ? `for Commit #${selectedCommits[0].id}` : `between Commit #${selectedCommits[0].id} and #${selectedCommits[1].id}`}
                  </p>
                </div>
              </div>
            )}
          </div>
          <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%' }} />
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {viewMode === 'history' ? (
          <div style={{ flex: 1, padding: '0', margin: '0 -30px -30px -30px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            <DataTable
              columns={historyColumns}
              data={commits}
              loading={loading}
              pagination={true}
              selectable={true}
              onSelectionChange={handleHistorySelectionChange}
              onRowDoubleClick={(row) => handleEnterCompareMode([row])}
              rowStyle={(row) => ({ cursor: 'pointer' })}
              bulkActions={
                selectedHistoryRows.length > 0 && selectedHistoryRows.length <= 2 ? (
                  <button 
                    className="btn-primary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => handleEnterCompareMode(selectedHistoryRows)}
                  >
                    <GitCommit size={14} /> Compare Version
                  </button>
                ) : null
              }
              toolbarTitle={<span style={{ fontWeight: 600, fontSize: '15px' }}>Commit History</span>}
              exportActions={
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <button 
                    disabled 
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%', opacity: 0.5 }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <Code size={13} style={{ color: 'var(--text-muted)' }} /> Generate CLI
                  </button>
                  <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '2px 0' }} />
                  <button 
                    disabled 
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%', opacity: 0.5 }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <Upload size={13} style={{ color: 'var(--text-muted)' }} /> Export Change Package
                  </button>
                </div>
              }
              topRightActions={
                <button 
                  className="btn-danger btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  onClick={() => {
                    const commit = selectedHistoryRows[0];
                    confirm({
                      title: 'Revert Workspace Configuration',
                      message: `Are you sure you want to revert the workspace to commit #${commit.id}? \n\nThis will completely overwrite the active workspace configuration with the state from ${new Date(commit.timestamp).toLocaleString()}. This action cannot be easily undone.`,
                      confirmText: 'Revert Configuration',
                      isDestructive: true,
                      onConfirm: async () => {
                        setIsReverting(true);
                        try {
                          const creds = await window.electron.getBackendAuth();
                          const apiClient = new CanopyApiClient(creds);
                          await apiClient.revertToCommit(commit.id);
                          addToast(`Workspace reverted to commit #${commit.id}`, 'success');
                          window.location.reload();
                        } catch (err: any) {
                          addToast(`Revert failed: ${err.message}`, 'error');
                        } finally {
                          setIsReverting(false);
                        }
                      }
                    });
                  }}
                  disabled={selectedHistoryRows.length !== 1}
                  title={selectedHistoryRows.length !== 1 ? "Select exactly 1 version to revert to" : "Revert Workspace"}
                >
                  <RotateCcw size={14} /> Revert Version
                </button>
              }
            />
          </div>
        ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, margin: '0 -30px -30px -30px' }}>
          {/* Top half: Changes List */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, padding: '0', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <DataTable
                columns={compareColumns}
                data={changesList}
                loading={loadingDiff}
                pagination={true}
                selectable={true}
                onSelectionChange={handleChangeSelectionChange}
                exportActions={
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <button 
                      disabled 
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%', opacity: 0.5 }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <Code size={13} style={{ color: 'var(--text-muted)' }} /> Generate CLI
                    </button>
                    <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '2px 0' }} />
                    <button 
                      disabled 
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%', opacity: 0.5 }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <Upload size={13} style={{ color: 'var(--text-muted)' }} /> Export Change Package
                    </button>
                  </div>
                }
                topRightActions={
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      className="btn-danger btn-sm"
                      onClick={handleRevert}
                      disabled={isReverting}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <RotateCcw size={14} />
                      {isReverting ? 'Reverting...' : `Revert to v${selectedCommits[selectedCommits.length - 1].id}`}
                    </button>
                  </div>
                }
              />
            </div>
          </div>

          {/* Bottom Half: Split Pane for Diff */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-surface)', borderTop: '1px solid var(--border-main)' }}>
            <div style={{ padding: '8px 30px', borderBottom: '1px solid var(--border-main)', backgroundColor: 'var(--bg-element)', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Object Level Changes
            </div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                {renderDiffViewer()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
