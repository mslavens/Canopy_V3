import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Database, Trash2, FileUp } from 'lucide-react';
import { DataTable, ColumnDef } from '../components/DataTable';
import { LogImporter } from '../components/LogImporter';
import { CanopyApiClient } from '../api/client';
import { useConfirm } from '../components/ConfirmProvider';
import { SearchBar } from '../components/SearchBar';

interface LogEntry {
  id: string;
  count: number;
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
}

export const MonitorPage: React.FC<MonitorPageProps> = ({ auth }) => {
  const [activeTab, setActiveTab] = useState<'traffic' | 'threat' | 'import'>('traffic');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const confirm = useConfirm();

  const fetchLogs = async () => {
    if (!auth) return;
    setLoading(true);
    try {
      const client = new CanopyApiClient(auth);
      const response = await client.getLogs('global', 1000);
      if (Array.isArray(response)) {
        setLogs(response);
      } else {
        setLogs([]);
      }
    } catch (err) {
      console.error('Failed to fetch logs', err);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'traffic') {
      fetchLogs();
    }
  }, [activeTab]);

  const handleDeleteLogs = async () => {
    if (!auth) return;
    if (await confirm({
      title: 'Clear All Traffic Logs',
      message: 'Are you sure you want to permanently delete all imported traffic logs? This action cannot be undone.',
      confirmText: 'Delete Logs',
      confirmStyle: 'danger'
    })) {
      try {
        const client = new CanopyApiClient(auth);
        await client.deleteLogs('global');
        setLogs([]);
      } catch (err) {
        console.error('Failed to delete logs', err);
      }
    }
  };

  const trafficColumns = useMemo<ColumnDef<LogEntry>[]>(() => [
    { key: 'count', header: 'Count', sortable: true, width: '80px' },
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '30px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>Monitor</h1>
        
        <div style={{ display: 'flex', gap: '12px' }}>
          {activeTab !== 'import' && (
            <SearchBar 
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search logs..."
            />
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid var(--border-color)' }}>
        <button
          className={`tab-item ${activeTab === 'traffic' ? 'active' : ''}`}
          onClick={() => setActiveTab('traffic')}
        >
          <Database size={16} /> Traffic Logs
        </button>
        <button
          className={`tab-item ${activeTab === 'threat' ? 'active' : ''}`}
          onClick={() => setActiveTab('threat')}
        >
          <Database size={16} /> Threat Logs
        </button>
        <button
          className={`tab-item ${activeTab === 'import' ? 'active' : ''}`}
          onClick={() => setActiveTab('import')}
        >
          <FileUp size={16} /> Import Logs
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'import' ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px' }}>
            <LogImporter auth={auth} onSuccess={() => setActiveTab('traffic')} />
          </div>
        ) : (
          <div style={{ flex: 1, margin: '0 -30px -30px -30px', display: 'flex', flexDirection: 'column' }}>
            <DataTable
              key={activeTab}
              loading={loading}
              toolbarTitle={<h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{activeTab === 'traffic' ? 'Traffic' : 'Threat'}</h2>}
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
              columns={trafficColumns}
              data={logs}
              searchQuery={searchQuery}
            />
          </div>
        )}
      </div>
    </div>
  );
};
