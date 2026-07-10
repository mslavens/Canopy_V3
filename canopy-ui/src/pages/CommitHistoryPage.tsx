import React, { useState, useEffect } from 'react';
import { CanopyApiClient } from '../api/client';
import { History, Clock, GitCommit, Undo2, RotateCcw, Search, ChevronDown, ChevronRight, X } from 'lucide-react';
import { useConfirm } from '../components/ConfirmProvider';
import { ToastMessage } from '../components/ToastContainer';

interface CommitHistoryPageProps {
  globalScopeVendor?: string;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

interface CommitData {
  id: number;
  message: string;
  timestamp: string;
}

export const CommitHistoryPage: React.FC<CommitHistoryPageProps> = ({ globalScopeVendor, addToast }) => {
  const [commits, setCommits] = useState<CommitData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCommit, setSelectedCommit] = useState<CommitData | null>(null);
  const [diffData, setDiffData] = useState<any>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const confirm = useConfirm();

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const creds = await window.electron.getBackendAuth();
      const apiClient = new CanopyApiClient(creds);
      const data = await apiClient.getCommitHistory();
      setCommits(data || []);
      if (data && data.length > 0) {
        handleSelectCommit(data[0]);
      }
    } catch (err: any) {
      addToast(`Failed to fetch history: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCommit = async (commit: CommitData) => {
    setSelectedCommit(commit);
    setLoadingDiff(true);
    setDiffData(null);
    setExpandedRows(new Set());
    
    try {
      const creds = await window.electron.getBackendAuth();
      const apiClient = new CanopyApiClient(creds);
      const diff = await apiClient.getCommitDiff(commit.id);
      setDiffData(diff);
    } catch (err: any) {
      addToast(`Failed to load commit diff: ${err.message}`, 'error');
    } finally {
      setLoadingDiff(false);
    }
  };

  const handleRevert = async (commit: CommitData) => {
    confirm({
      title: 'Revert Workspace Configuration',
      message: `Are you sure you want to revert the workspace to commit #${commit.id} ("${commit.message}")? \n\nThis will completely overwrite the active workspace configuration with the state from ${new Date(commit.timestamp).toLocaleString()}. This action cannot be easily undone.`,
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

  // Process diffData into table rows (same logic as PendingChangesModal)
  const changes: any[] = [];
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
    
    // Added
    (categoryData.added || []).forEach((item: any) => {
      const dName = getDisplayName(item);
      const vendor = getVendorName(item);
      changes.push({
        id: `add_${categoryName}_${dName}`,
        type: 'ADD',
        table: categoryName,
        vendor: vendor,
        name: dName,
        description: `Added ${dName} to ${categoryName}`,
        details: item,
        dbId: item.id
      });
    });

    // Modified
    (categoryData.modified || []).forEach((item: any) => {
      const dName = getDisplayName(item);
      const vendor = getVendorName(item.new || item);
      changes.push({
        id: `mod_${categoryName}_${dName}`,
        type: 'UPDATE',
        table: categoryName,
        vendor: vendor,
        name: dName,
        description: `Updated ${dName} in ${categoryName}`,
        details: item,
        dbId: item.id
      });
    });

    // Deleted
    (categoryData.deleted || []).forEach((item: any) => {
      const dName = getDisplayName(item);
      const vendor = getVendorName(item);
      changes.push({
        id: `del_${categoryName}_${dName}`,
        type: 'DELETE',
        table: categoryName,
        vendor: vendor,
        name: dName,
        description: `Deleted ${dName} from ${categoryName}`,
        details: item,
        dbId: item.id
      });
    });
  };

  if (diffData) {
    processCategory('addressObjects', diffData.address_objects);
    processCategory('addressGroups', diffData.address_groups);
    processCategory('services', diffData.services);
    processCategory('tags', diffData.tags);
  }

  const filteredChanges = changes.filter(c => 
    (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
    (c.table || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleRow = (id: string) => {
    const newSet = new Set(expandedRows);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedRows(newSet);
  };

  const renderBadge = (type: string) => {
    if (type === 'ADD') return <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>ADD</span>;
    if (type === 'DELETE') return <span style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>DELETE</span>;
    return <span style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>UPDATE</span>;
  };

  const renderDiffDetails = (change: any) => {
    if (change.type === 'ADD' || change.type === 'DELETE') {
      return (
        <div style={{ backgroundColor: 'var(--bg-main)', padding: '16px', borderRadius: '6px', fontSize: '13px', border: '1px solid var(--border-main)', margin: '10px 20px 10px 60px' }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-main)', fontFamily: 'monospace' }}>
            {JSON.stringify(change.details, null, 2)}
          </pre>
        </div>
      );
    }
    if (change.type === 'UPDATE') {
      const oldKeys = Object.keys(change.details.old || {});
      const newKeys = Object.keys(change.details.new || {});
      const allKeys = Array.from(new Set([...oldKeys, ...newKeys]));

      return (
        <div style={{ backgroundColor: 'var(--bg-main)', padding: '16px', borderRadius: '6px', fontSize: '13px', border: '1px solid var(--border-main)', margin: '10px 20px 10px 60px' }}>
          {allKeys.map(key => {
            const oldVal = change.details.old[key];
            const newVal = change.details.new[key];
            if (JSON.stringify(oldVal) === JSON.stringify(newVal)) return null;

            return (
              <div key={key} style={{ fontFamily: 'monospace', marginBottom: '8px' }}>
                <div style={{ color: '#ef4444' }}>- {key}: {JSON.stringify(oldVal)}</div>
                <div style={{ color: '#10b981' }}>+ {key}: {JSON.stringify(newVal)}</div>
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-main)' }}>
      {/* Header */}
      <div style={{ padding: '20px 30px', borderBottom: '1px solid var(--border-main)', backgroundColor: 'var(--bg-surface)' }}>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <History size={24} color="var(--accent-blue)" />
          Commit History
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '14px' }}>
          Review the timeline of changes made to your active workspace, inspect diffs, and revert to previous states if necessary.
        </p>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar - Timeline */}
        <div style={{ width: '320px', borderRight: '1px solid var(--border-main)', backgroundColor: 'var(--bg-surface)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-main)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '12px' }}>
            Timeline
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading timeline...</div>
            ) : commits.length === 0 ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>No commits found in this workspace.</div>
            ) : (
              commits.map(commit => (
                <div
                  key={commit.id}
                  onClick={() => handleSelectCommit(commit)}
                  style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid var(--border-main)',
                    cursor: 'pointer',
                    backgroundColor: selectedCommit?.id === commit.id ? 'var(--bg-hover)' : 'transparent',
                    borderLeft: selectedCommit?.id === commit.id ? '3px solid var(--accent-blue)' : '3px solid transparent',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '14px' }}>Commit #{commit.id}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {new Date(commit.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {commit.message}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Main Details Panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--bg-main)' }}>
          {selectedCommit ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              
              {/* Selected Commit Header */}
              <div style={{ padding: '24px 30px', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, marginRight: '30px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: 'var(--bg-element)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <GitCommit size={20} color="var(--accent-blue)" />
                    </div>
                    <div>
                      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Commit #{selectedCommit.id}</h2>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
                        <Clock size={14} />
                        {new Date(selectedCommit.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '16px', backgroundColor: 'var(--bg-main)', borderRadius: '6px', border: '1px solid var(--border-main)', fontSize: '14px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                    {selectedCommit.message}
                  </div>
                </div>

                <div style={{ width: '250px', padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.05)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <h4 style={{ margin: '0 0 8px 0', color: '#ef4444', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <RotateCcw size={16} />
                    Danger Zone
                  </h4>
                  <p style={{ margin: '0 0 16px 0', color: 'var(--text-muted)', fontSize: '12px', lineHeight: '1.4' }}>
                    Reverting will completely overwrite the active workspace configuration with this snapshot.
                  </p>
                  <button
                    className="btn-secondary"
                    onClick={() => handleRevert(selectedCommit)}
                    disabled={isReverting}
                    style={{ width: '100%', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.5)', justifyContent: 'center' }}
                  >
                    {isReverting ? 'Reverting...' : `Revert Workspace`}
                  </button>
                </div>
              </div>

              {/* Data Table */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '24px 30px' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600 }}>Changes Included in Commit</h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-main)', overflow: 'hidden' }}>
                  {/* Search */}
                  <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-main)', backgroundColor: 'var(--bg-surface)' }}>
                    <div style={{ position: 'relative', width: '300px' }}>
                      <Search size={16} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
                      <input 
                        type="text" 
                        placeholder="Filter by name, description, or table..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 12px 8px 36px',
                          backgroundColor: 'var(--bg-main)',
                          border: '1px solid var(--border-main)',
                          borderRadius: '6px',
                          color: 'var(--text-main)',
                          outline: 'none',
                          fontSize: '13px'
                        }}
                      />
                    </div>
                  </div>

                  {/* Table Header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '40px 100px 100px 150px 1fr 1fr', padding: '12px 20px', borderBottom: '1px solid var(--border-main)', fontWeight: 600, color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', backgroundColor: 'var(--bg-element)' }}>
                    <div></div>
                    <div>Type</div>
                    <div>Vendor</div>
                    <div>Table</div>
                    <div>Name</div>
                    <div>Description</div>
                  </div>

                  {/* Table Body */}
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {loadingDiff ? (
                      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Analyzing commit diff...</div>
                    ) : filteredChanges.length === 0 ? (
                      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        {searchQuery ? 'No matching changes found.' : 'This commit did not introduce any object changes.'}
                      </div>
                    ) : (
                      filteredChanges.map(change => (
                        <React.Fragment key={change.id}>
                          <div 
                            onClick={() => toggleRow(change.id)}
                            style={{ 
                              display: 'grid', 
                              gridTemplateColumns: '40px 100px 100px 150px 1fr 1fr', 
                              padding: '12px 20px', 
                              borderBottom: '1px solid var(--border-main)',
                              alignItems: 'center',
                              cursor: 'pointer',
                              backgroundColor: expandedRows.has(change.id) ? 'var(--bg-element)' : 'transparent',
                              fontSize: '13px',
                              transition: 'background-color 0.15s ease'
                            }}
                            onMouseEnter={(e) => { if (!expandedRows.has(change.id)) e.currentTarget.style.backgroundColor = 'var(--bg-hover)' }}
                            onMouseLeave={(e) => { if (!expandedRows.has(change.id)) e.currentTarget.style.backgroundColor = 'transparent' }}
                          >
                            <div style={{ color: 'var(--text-muted)' }}>
                              {expandedRows.has(change.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </div>
                            <div>{renderBadge(change.type)}</div>
                            <div style={{ color: 'var(--text-muted)' }}>{change.vendor}</div>
                            <div style={{ color: 'var(--text-muted)' }}>{change.table}</div>
                            <div style={{ fontWeight: 500 }}>{change.name}</div>
                            <div style={{ color: 'var(--text-muted)' }}>{change.description}</div>
                          </div>
                          {expandedRows.has(change.id) && renderDiffDetails(change)}
                        </React.Fragment>
                      ))
                    )}
                  </div>
                </div>
              </div>

            </div>
          ) : (
            <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              Select a commit from the timeline to view details and preview changes
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
