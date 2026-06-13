import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Trash2, FileUp, Database, Copy, Eye, Filter, FilterX, Plus } from 'lucide-react';
import { DataTable, ColumnDef } from '../components/DataTable';
import { LogImporter } from '../components/LogImporter';
import { CanopyApiClient } from '../api/client';
import { useConfirm } from '../components/ConfirmProvider';
import { SearchBar } from '../components/SearchBar';
import { PageHeader } from '../components/PageHeader';

interface LogEntry {
  id: string;
  count: number;
  device_name: string;
  serial: string;
  source_zone: string;
  dest_zone: string;
  source_ip: string;
  dest_ip: string;
  dest_port: number;
  action: string;
  protocol: string;
  rule_name: string;
  application: string;
  bytes: number;
  packets: number;
}

interface MonitorPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
}

export const MonitorPage: React.FC<MonitorPageProps> = ({ auth, addToast, activeSubTab, setActiveSubTab }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLogs, setSelectedLogs] = useState<LogEntry[]>([]);
  const confirm = useConfirm();

  const fetchLogs = async () => {
    if (!auth) return;
    setLoading(true);
    try {
      const client = new CanopyApiClient(auth);
      const response = await client.getLogs('global', limit, page * limit);
      if (response && Array.isArray(response.data)) {
        setLogs(response.data);
        setTotalLogs(response.total || 0);
      } else {
        setLogs([]);
        setTotalLogs(0);
      }
    } catch (err) {
      console.error('Failed to fetch logs', err);
      setLogs([]);
      setTotalLogs(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'Traffic Logs') {
      fetchLogs();
    }
  }, [activeSubTab, page, limit]);

  const handleDeleteLogs = () => {
    if (!auth) return;
    confirm({
      title: 'Clear All Traffic Logs',
      message: 'Are you sure you want to permanently delete all imported traffic logs? This action cannot be undone.',
      confirmText: 'Delete Logs',
      isDestructive: true,
      onConfirm: async () => {
        try {
          const client = new CanopyApiClient(auth);
          // Optimistic UI update
          setLogs([]);
          setTotalLogs(0);
          setSelectedLogs([]);
          
          await client.deleteLogs('global');
          addToast('Successfully cleared all traffic logs.', 'success');
        } catch (err: any) {
          console.error('Failed to delete logs', err);
          addToast('Failed to clear logs: ' + (err.message || String(err)), 'error');
        }
      }
    });
  };

  const handleDeleteSelectedLogs = () => {
    if (!auth || selectedLogs.length === 0) return;
    confirm({
      title: `Delete ${selectedLogs.length} Logs`,
      message: `Are you sure you want to permanently delete these ${selectedLogs.length} selected logs?`,
      confirmText: 'Delete Selected',
      isDestructive: true,
      onConfirm: async () => {
        try {
          const client = new CanopyApiClient(auth);
          const ids = selectedLogs.map(l => l.id).filter(id => id);
          if (ids.length > 0) {
            // Optimistic UI update
            setLogs(prev => prev.filter(l => !ids.includes(l.id)));
            setTotalLogs(prev => Math.max(0, prev - ids.length));
            setSelectedLogs([]);
            
            await client.deleteLogsBatch('global', ids);
            fetchLogs(); // Background refresh
            addToast(`Successfully deleted ${ids.length} selected logs.`, 'success');
          }
        } catch (err: any) {
          console.error('Failed to delete selected logs', err);
          addToast('Failed to delete selected logs: ' + (err.message || String(err)), 'error');
        }
      }
    });
  };

  const trafficColumns = useMemo<ColumnDef[]>(() => [
    { key: 'count', header: 'Count', sortable: true, width: '130px' },
    { key: 'device_name', header: 'Device Name', sortable: true, width: '240px' },
    { key: 'serial', header: 'Serial #', sortable: true, width: '200px' },
    { key: 'source_zone', header: 'From Zone', sortable: true, width: '180px' },
    { key: 'dest_zone', header: 'To Zone', sortable: true, width: '180px' },
    { key: 'source_ip', header: 'Source IP', sortable: true, width: '200px' },
    { key: 'dest_ip', header: 'Dest IP', sortable: true, width: '200px' },
    { key: 'dest_port', header: 'Dest Port', sortable: true, width: '160px' },
    { key: 'action', header: 'Action', sortable: true, width: '160px' },
    { key: 'rule_name', header: 'Rule', sortable: true, width: '220px' },
    { key: 'application', header: 'Application', sortable: true, width: '180px' },
    { key: 'bytes', header: 'Bytes', sortable: true, width: '160px' },
    { key: 'packets', header: 'Packets', sortable: true, width: '160px' }
  ], []);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (activeSubTab === 'Log Import') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <PageHeader title="Log Importer" description="Import network traffic logs from external CSV or XML files." isSticky={true} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)', marginTop: '10px' }}>
          <LogImporter auth={auth} addToast={addToast} onSuccess={() => setActiveSubTab('Traffic Logs')} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader 
        title="Traffic Logs" 
        description="Monitor, filter, and manage real-time and historical network traffic logs." 
        isSticky={true}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <SearchBar 
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search all columns..."
            />
          </div>
        }
      />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)', overflow: 'hidden', margin: '15px -30px -30px -30px' }}>
        <DataTable
            columns={trafficColumns}
            data={logs}
            searchQuery={searchQuery}
            loading={loading}
            totalRows={totalLogs}
            pagination={true}
            currentPage={page}
            rowsPerPage={limit}
            onPageChange={(newPage) => setPage(newPage)}
            onRowsPerPageChange={(newLimit) => { setLimit(newLimit); setPage(0); }}
            selectable={true}
            onSelectionChange={setSelectedLogs}
            bulkActions={
              selectedLogs.length > 0 ? (
                <button className="btn-danger btn-sm" onClick={handleDeleteSelectedLogs} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Trash2 size={14} /> Delete Selected ({selectedLogs.length})
                </button>
              ) : null
            }
            exportFilename="traffic_logs_export.csv"
            exportActions={
              <>
                <button onClick={handleDeleteLogs} className="btn-danger btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start' }} title="Clear Logs">
                  <Trash2 size={13} /> Clear All Logs
                </button>
                <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
              </>
            }
            topRightActions={
              <button 
                onClick={() => setActiveSubTab('Log Import')} 
                className="btn-secondary btn-sm" 
                title="Add Logs"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Plus size={14} /> Add Logs
              </button>
            }
            rowContextMenuActions={(row, closeMenu, colKey, cellValue, setFilterValue, clearColumnFilter, clearAllFilters) => (
              <>
                {colKey && cellValue !== undefined && cellValue !== null && setFilterValue && (
                  <button 
                    className="btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start' }}
                    onClick={() => { 
                      setFilterValue(colKey, String(cellValue)); 
                      closeMenu(); 
                    }}
                  >
                    <Filter size={13} /> Add '{String(cellValue).length > 20 ? String(cellValue).substring(0, 20) + '...' : String(cellValue)}' to Filter
                  </button>
                )}
                {colKey && clearColumnFilter && (
                  <button 
                    className="btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start' }}
                    onClick={() => { 
                      clearColumnFilter(colKey); 
                      closeMenu(); 
                    }}
                  >
                    <FilterX size={13} /> Clear Filter for Column
                  </button>
                )}
                {clearAllFilters && (
                  <button 
                    className="btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start' }}
                    onClick={() => { 
                      clearAllFilters(); 
                      closeMenu(); 
                    }}
                  >
                    <FilterX size={13} /> Clear All Filters
                  </button>
                )}
                <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                <button 
                  className="btn-secondary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start', color: 'var(--text-danger)' }}
                  onClick={() => { 
                    setConfirmModal({
                      isOpen: true,
                      title: 'Delete Log',
                      message: 'Are you sure you want to permanently delete this log?',
                      confirmText: 'Delete',
                      isDestructive: true,
                      onConfirm: async () => {
                        try {
                          const client = new CanopyApiClient(auth);
                          setLogs(prev => prev.filter(l => l.id !== row.id));
                          setTotalLogs(prev => Math.max(0, prev - 1));
                          
                          await client.deleteLogsBatch('global', [row.id]);
                          fetchLogs();
                          addToast('Successfully deleted log.', 'success');
                        } catch (err: any) {
                          console.error('Failed to delete log', err);
                          addToast('Failed to delete log: ' + (err.message || String(err)), 'error');
                        }
                      }
                    });
                    closeMenu(); 
                  }}
                >
                  <Trash2 size={13} /> Delete Log
                </button>
              </>
            )}
          />
      </div>
    </div>
  );
};
