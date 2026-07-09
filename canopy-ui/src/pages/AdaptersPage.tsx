import React, { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { CanopyApiClient } from '../api/client';
import { Loader2, Plug, ShieldCheck } from 'lucide-react';

export const AdaptersPage: React.FC<{ auth: { url: string; token: string } | null }> = ({ auth }) => {
  const [adapters, setAdapters] = useState<string[]>([]);
  const [disabledAdapters, setDisabledAdapters] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const disabledJSON = localStorage.getItem('canopy_disabled_adapters');
    if (disabledJSON) {
      try { setDisabledAdapters(JSON.parse(disabledJSON)); } catch(e) {}
    }
  }, []);

  const toggleAdapter = (adapter: string) => {
    let newList;
    if (disabledAdapters.includes(adapter)) {
      newList = disabledAdapters.filter(a => a !== adapter);
    } else {
      newList = [...disabledAdapters, adapter];
    }
    setDisabledAdapters(newList);
    localStorage.setItem('canopy_disabled_adapters', JSON.stringify(newList));
    window.dispatchEvent(new Event('canopy_adapter_toggled'));
  };

  useEffect(() => {
    let isMounted = true;
    const fetchAdapters = async () => {
      if (!auth) return;
      try {
        const apiClient = new CanopyApiClient(auth);
        const data = await apiClient.getAdapters();
        if (isMounted) setAdapters(data || []);
      } catch (err) {
        if (isMounted) setError(err instanceof Error ? err.message : 'Failed to load adapters.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchAdapters();
    return () => { isMounted = false; };
  }, []);

  return (
    <div className="page-container" style={{ padding: '0 24px' }}>
      <PageHeader
        title="Vendor Adapters"
        description="Manage installed vendor plugins and licensing."
      />

      <div style={{ marginTop: '24px' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
            <Loader2 className="spinner" size={20} />
            Loading adapters...
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--status-red)', padding: '16px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px' }}>
            {error}
          </div>
        )}

        {!loading && !error && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
            {adapters.map((adapter) => {
              const isDisabled = disabledAdapters.includes(adapter);
              return (
              <div
                key={adapter}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '12px',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  opacity: isDisabled ? 0.6 : 1,
                  transition: 'opacity 0.2s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0, textTransform: 'capitalize', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldCheck size={20} style={{ color: isDisabled ? 'var(--text-muted)' : 'var(--primary)' }} />
                    {adapter}
                  </h3>
                  <span style={{
                    background: isDisabled ? 'rgba(100, 116, 139, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                    color: isDisabled ? 'var(--text-muted)' : 'var(--status-green)',
                    padding: '4px 10px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 600
                  }}>
                    {isDisabled ? 'Unlicensed' : 'Active'}
                  </span>
                </div>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.5 }}>
                  This adapter allows Canopy to parse, ingest, and generate configuration schemas specific to {adapter.charAt(0).toUpperCase() + adapter.slice(1)}.
                </p>
                <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    License: {isDisabled ? 'Not Included' : 'Included'}
                  </span>
                  <button
                    onClick={() => toggleAdapter(adapter)}
                    style={{
                      background: isDisabled ? 'var(--accent-blue)' : 'var(--bg-surface)',
                      color: isDisabled ? 'white' : 'var(--text-main)',
                      border: isDisabled ? 'none' : '1px solid var(--border-main)',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {isDisabled ? 'Simulate License' : 'Revoke Simulation'}
                  </button>
                </div>
              </div>
            )})}

            {adapters.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                No vendor adapters currently loaded.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
