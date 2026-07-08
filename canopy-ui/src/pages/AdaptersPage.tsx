import React, { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { CanopyApiClient } from '../api/client';
import { Loader2, Plug, ShieldCheck } from 'lucide-react';

export const AdaptersPage: React.FC<{ auth: { url: string; token: string } | null }> = ({ auth }) => {
  const [adapters, setAdapters] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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
            {adapters.map((adapter) => (
              <div 
                key={adapter} 
                style={{ 
                  background: 'var(--bg-card)', 
                  border: '1px solid var(--border-light)', 
                  borderRadius: '12px', 
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0, textTransform: 'capitalize', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldCheck size={20} style={{ color: 'var(--primary)' }}/>
                    {adapter}
                  </h3>
                  <span style={{ 
                    background: 'rgba(16, 185, 129, 0.1)', 
                    color: 'var(--status-green)', 
                    padding: '4px 10px', 
                    borderRadius: '20px', 
                    fontSize: '12px', 
                    fontWeight: 600 
                  }}>
                    Active
                  </span>
                </div>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.5 }}>
                  This adapter allows Canopy to parse, ingest, and generate configuration schemas specific to {adapter.charAt(0).toUpperCase() + adapter.slice(1)}.
                </p>
                <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'flex-end' }}>
                   <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>License: Included</span>
                </div>
              </div>
            ))}
            
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
