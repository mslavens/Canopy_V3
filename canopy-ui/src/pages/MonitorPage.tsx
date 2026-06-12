import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Trash2, FileUp, Database, Copy, Eye } from 'lucide-react';
import { DataTable, ColumnDef } from '../components/DataTable';
import { LogImporter } from '../components/LogImporter';
import { CanopyApiClient } from '../api/client';
import { useConfirm } from '../components/ConfirmProvider';
import { SearchBar } from '../components/SearchBar';

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
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
}

export const MonitorPage: React.FC<MonitorPageProps> = ({ auth, activeSubTab, setActiveSubTab }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
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
          await client.deleteLogs('global');
          setLogs([]);
          setTotalLogs(0);
        } catch (err) {
          console.error('Failed to delete logs', err);
        }
      }
    });
  };

  const trafficColumns = useMemo<ColumnDef[]>(() => [
    { key: 'count', header: 'Count', sortable: true, width: '80px' },
    { key: 'device_name', header: 'Device Name', sortable: true, width: '160px' },
    { key: 'serial', header: 'Serial #', sortable: true, width: '140px' },
    { key: 'source_zone', header: 'From Zone', sortable: true, width: '120px' },
    { key: 'dest_zone', header: 'To Zone', sortable: true, width: '120px' },
    { key: 'source_ip', header: 'Source IP', sortable: true, width: '140px' },
    { key: 'dest_ip', header: 'Dest IP', sortable: true, width: '140px' },
    { key: 'dest_port', header: 'Dest Port', sortable: true, width: '100px' },
    { key: 'action', header: 'Action', sortable: true, width: '100px' },
    { key: 'rule_name', header: 'Rule', sortable: true, width: '160px' },
    { key: 'application', header: 'Application', sortable: true, width: '120px' },
    { key: 'bytes', header: 'Bytes', sortable: true, width: '100px' },
    { key: 'packets', header: 'Packets', sortable: true, width: '100px' }
  ], []);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (activeSubTab === 'Log Import') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '30px' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <LogImporter auth={auth} onSuccess={() => setActiveSubTab('Traffic Logs')} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', margin: '-30px' }}>
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
        toolbarTitle={
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Traffic Logs</h2>
            <SearchBar 
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search all columns..."
            />
          </div>
        }
        topRightActions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={fetchLogs} className="btn-secondary btn-sm" title="Refresh Logs">
              <RefreshCw size={14} /> Refresh
            </button>
            <button onClick={handleDeleteLogs} className="btn-danger btn-sm" title="Clear Logs">
              <Trash2 size={14} /> Clear Logs
            </button>
          </div>
        }
        rowContextMenuActions={(row, closeMenu) => (
          <>
            <button className="dropdown-option-row" onClick={() => { handleCopy(row.source_ip); closeMenu(); }}>
              <Copy size={14} /> Copy Source IP
            </button>
            <button className="dropdown-option-row" onClick={() => { handleCopy(row.dest_ip); closeMenu(); }}>
              <Copy size={14} /> Copy Destination IP
            </button>
            <button className="dropdown-option-row" onClick={() => { handleCopy(row.rule_name); closeMenu(); }}>
              <Copy size={14} /> Copy Rule Name
            </button>
            <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
            <button className="dropdown-option-row" onClick={() => { console.log('Details for', row); closeMenu(); }}>
              <Eye size={14} /> View Full Details
            </button>
          </>
        )}
      />
    </div>
  );
};
