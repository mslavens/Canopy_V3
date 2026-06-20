import React, { useEffect, useState, useMemo } from 'react';
import { SearchBar } from '../components/SearchBar';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { DataTable, ColumnDef } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { CanopyApiClient } from '../api/client';

interface AuditLog {
  id: number;
  timestamp: string;
  action: string;
  module: string;
  details: string;
}

interface AuditLogsPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const AuditLogsPage: React.FC<AuditLogsPageProps> = ({ auth, addToast }) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!auth) return;
    let isMounted = true;

    const fetchLogs = async () => {
      try {
        const apiClient = new CanopyApiClient(auth);
        const data = await apiClient.getAuditLogs();
        if (isMounted) setLogs(data || []);
      } catch (err) {
        if (isMounted) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchLogs();
    return () => { isMounted = false; };
  }, [auth]);

  const columns: ColumnDef[] = useMemo(() => [
    { key: 'timestamp', label: 'Timestamp (Local)', renderCell: (val) => new Date(val).toLocaleString() },
    { key: 'module', label: 'Module', renderCell: (val) => <span style={{ color: 'var(--accent-blue)', fontWeight: 500 }}>{val}</span> },
    { key: 'action', label: 'Action' },
    { key: 'details', label: 'Details' }
  ], []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader 
        title="Security Audit Logs" 
        description="Record of administrative actions taken within the workspace." 
        isSticky={false}
        bottomSpacing={false}
        actions={
          <div style={{ width: '250px' }}>
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Filter audit trail..." variant="local" />
          </div>
        }
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)', margin: '0 -30px -30px -30px' }}>
        {error && (
          <div style={{ margin: '20px', backgroundColor: 'var(--bg-app)', borderLeft: '4px solid var(--status-red)', padding: '12px 15px', borderRadius: '4px', color: 'var(--status-red)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span><strong>Access Fault:</strong> {error}</span>
          </div>
        )}

        {loading ? (
          <div className="fade-in-delayed" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px', gap: '15px' }}>
            <Loader2 size={24} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />
            Decrypting audit trail...
          </div>
        ) : logs.length > 0 ? (
          <DataTable 
            columns={columns} 
            data={logs} 
            searchQuery={searchQuery} 
            exportFilename={`canopy_audit_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`} 
            selectable={true} 
            pagination={true} 
          />
        ) : (
          <EmptyState icon={<Inbox size={32} />} title="No audit events recorded" description="There is currently no administrative activity in the system logs." minHeight="250px" />
        )}
      </div>
    </div>
  );
};