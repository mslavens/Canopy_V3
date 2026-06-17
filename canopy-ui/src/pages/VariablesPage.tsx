import React, { useState, useEffect, useMemo } from 'react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { SearchBar } from '../components/SearchBar';
import { FileCode2, Loader2 } from 'lucide-react';

interface VariablesPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const VariablesPage: React.FC<VariablesPageProps> = ({ auth, addToast }) => {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [variables, setVariables] = useState<any[]>([]);

  const apiClient = useMemo(() => (auth ? new CanopyApiClient(auth) : null), [auth]);

  const fetchVariables = async () => {
    if (!apiClient) return;
    try {
      setLoading(true);
      const res = await apiClient.getVariables();
      setVariables(res || []);
    } catch (err) {
      console.error('Failed to load variables:', err);
      addToast(err instanceof Error ? err.message : 'Failed to query template variables.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVariables();
  }, [apiClient]);

  const columns: ColumnDef[] = useMemo(
    () => [
      { key: 'scope', label: 'Context / Scope' },
      { key: 'name', label: 'Variable Name' },
      { key: 'type', label: 'Type' },
      { key: 'value', label: 'Value' },
    ],
    []
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      <PageHeader
        title="Template Variables"
        description="Inspect variables extracted from templates and device configurations."
        actions={<SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search variables..." variant="local" />}
      />

      {/* Main Grid */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div
            className="fade-in-delayed"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '13px',
              gap: '15px',
              minHeight: '300px',
            }}
          >
            <Loader2 size={24} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />
            Loading template variables...
          </div>
        ) : variables.length > 0 ? (
          <DataTable
            columns={columns}
            data={variables}
            searchQuery={searchQuery}
            exportFilename={`canopy_variables_${new Date().toISOString().slice(0, 10)}.csv`}
          />
        ) : (
          <EmptyState
            icon={<FileCode2 size={32} />}
            title="No Variables Configured"
            description="No template variables found in the database. Ensure XML imports have completed successfully."
            minHeight="300px"
          />
        )}
      </div>
    </div>
  );
};
