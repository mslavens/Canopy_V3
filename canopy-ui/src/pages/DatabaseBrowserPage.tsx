import React, { useState, useMemo } from 'react';
import { SearchBar } from '../components/SearchBar';
import { AlertTriangle, Database, Loader2 } from 'lucide-react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

interface DBResponse {
  columns: string[];
  rows: Record<string, any>[];
}

interface DatabaseBrowserPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const DatabaseBrowserPage: React.FC<DatabaseBrowserPageProps> = ({ auth, addToast }) => {
  const [query, setQuery] = useState("SELECT name FROM sqlite_master WHERE type='table';");
  const [data, setData] = useState<DBResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pageSearchQuery, setPageSearchQuery] = useState('');

  const apiClient = useMemo(() => auth ? new CanopyApiClient(auth) : null, [auth]);

  const runQuery = async (overrideQuery?: string) => {
    if (!apiClient) return;
    const q = overrideQuery || query;
    if (!q.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const resData = await apiClient.queryDb(q);
      setData(resData);
      addToast('Query executed successfully.', 'success');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to query database';
      setError(errMsg);
      addToast(errMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const tableColumns: ColumnDef[] = useMemo(() => {
    return (data?.columns || []).map(col => ({ key: col, label: col }));
  }, [data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader 
        title="Database Browser" 
        description="Direct read-only interface to the SQLite offline vault." 
        isSticky={false}
        actions={
          <SearchBar value={pageSearchQuery} onChange={setPageSearchQuery} placeholder="Filter results..." variant="local" />
        }
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)' }}>
        <div style={{ flexShrink: 0, padding: '20px 0', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input 
              type="text" 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter SELECT query..."
              onKeyDown={(e) => e.key === 'Enter' && runQuery()}
              style={{ 
                flex: 1, padding: '10px 12px', borderRadius: '4px', border: '1px solid var(--border-main)', 
                backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '13px', outline: 'none',
                fontFamily: 'monospace'
              }}
            />
            <button className="btn-primary" onClick={() => runQuery()} disabled={loading}>
              Execute
            </button>
          </div>
  
          {/* Quick action schema buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {['devices', 'network_topology', 'license_vault', 'secrets_vault'].map(table => (
              <button key={table} className="btn-secondary" onClick={() => { const q = `SELECT * FROM ${table};`; setQuery(q); runQuery(q); }} style={{ padding: '4px 10px', fontSize: '11px' }}>
                {table}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ margin: '20px', backgroundColor: 'var(--bg-app)', borderLeft: '4px solid var(--status-red)', padding: '12px 15px', borderRadius: '4px', color: 'var(--status-red)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span><strong>Syntax Fault:</strong> {error}</span>
          </div>
        )}

        {loading && !data ? (
          <div className="fade-in-delayed" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px', gap: '15px' }}>
            <Loader2 size={24} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />
            Executing query...
          </div>
        ) : data && data.columns.length > 0 ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s ease', pointerEvents: loading ? 'none' : 'auto' }}>
             <DataTable columns={tableColumns} data={data.rows} searchQuery={pageSearchQuery} exportFilename={`database_query_results_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`} />
          </div>
        ) : (!error && !loading && <EmptyState icon={<Database size={32} />} title="No data columns returned" description="Execute a valid SELECT query to populate this data grid." minHeight="250px" />)}
      </div>
    </div>
  );
};