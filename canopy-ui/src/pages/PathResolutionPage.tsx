import React, { useEffect, useState } from 'react';
import { SearchBar } from '../components/SearchBar';
import { HighlightedText } from '../components/HighlightedText';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { CanopyApiClient } from '../api/client';
import { PageHeader } from '../components/PageHeader';

interface PathResolution {
  source_ip: string;
  destination_ip: string;
  ingress_device_uuid: string;
  egress_device_uuid: string;
  hop_device_uuids: string[];
}

interface PathResolutionPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const PathResolutionPage: React.FC<PathResolutionPageProps> = ({ auth, addToast }) => {
  const [pathData, setPathData] = useState<PathResolution | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pageSearchQuery, setPageSearchQuery] = useState<string>('');

  useEffect(() => {
    // Only fetch once the secure engine token is provided by the global shell
    if (!auth) return;

    let isMounted = true;
    setLoading(true);

    const fetchPathResolution = async () => {
      try {
        const apiClient = new CanopyApiClient(auth);
        const data = await apiClient.resolvePath('10.99.3.45', '192.168.50.112');
        
        if (isMounted) {
          setPathData(data);
          addToast('Path resolution synchronized successfully.', 'success');
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Failed to query routing engine';
        if (isMounted) {
          setError(errMsg);
          addToast(errMsg, 'error');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchPathResolution();

    return () => { isMounted = false; };
  }, [auth]);

  if (loading) return <div className="fade-in-delayed" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px', gap: '15px', height: '400px' }}><Loader2 size={24} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />Evaluating network transit paths...</div>;
  if (error) return <div style={{ backgroundColor: 'var(--bg-surface)', borderLeft: '4px solid var(--status-red)', padding: '12px 15px', borderRadius: '4px', color: 'var(--status-red)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}><AlertTriangle size={14} style={{ flexShrink: 0 }} /><span><strong>Query Fault:</strong> {error}</span></div>;
  if (!pathData) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', maxWidth: '1200px' }}>
      <PageHeader 
        title="Path Resolution Analysis" 
        description="Evaluate end-to-end network transit paths and security policy enforcement." 
        actions={
          <SearchBar historyKey="pathresolution-search-history" value={pageSearchQuery} onChange={setPageSearchQuery} placeholder="Search this page..." variant="local" />
        }
      />
      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
        <h3 style={{ color: 'var(--accent-purple)', margin: '0 0 15px 0', fontSize: '14px', textTransform: 'uppercase' }}>Live Routing Map</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <tbody>
            <tr>
              <td style={{ padding: '8px 0', color: 'var(--text-sub)', width: '200px' }}>Source Lookup Vector</td>
              <td style={{ padding: '8px 0', fontFamily: 'monospace', color: 'var(--status-green)' }}><HighlightedText text={pathData.source_ip} highlight={pageSearchQuery} /></td>
            </tr>
            <tr>
              <td style={{ padding: '8px 0', color: 'var(--text-sub)' }}>Destination Lookup Vector</td>
              <td style={{ padding: '8px 0', fontFamily: 'monospace', color: 'var(--status-red)' }}><HighlightedText text={pathData.destination_ip} highlight={pageSearchQuery} /></td>
            </tr>
            <tr>
              <td style={{ padding: '8px 0', color: 'var(--text-sub)' }}>Ingress Enforcement Anchor</td>
              <td style={{ padding: '8px 0', fontFamily: 'monospace' }}><HighlightedText text={pathData.ingress_device_uuid} highlight={pageSearchQuery} /></td>
            </tr>
            <tr>
              <td style={{ padding: '8px 0', color: 'var(--text-sub)' }}>Egress Enforcement Anchor</td>
              <td style={{ padding: '8px 0', fontFamily: 'monospace' }}><HighlightedText text={pathData.egress_device_uuid} highlight={pageSearchQuery} /></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
        <h3 style={{ color: 'var(--accent-purple)', margin: '0 0 10px 0', fontSize: '14px', textTransform: 'uppercase' }}>Computed Infrastructure Hop Chain</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '15px' }}>
          {pathData.hop_device_uuids.map((uuid, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ backgroundColor: 'var(--bg-element)', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', fontFamily: 'monospace', border: '1px solid var(--border-accent)' }}><HighlightedText text={uuid} highlight={pageSearchQuery} /></div>
              {idx < pathData.hop_device_uuids.length - 1 && <span style={{ color: 'var(--text-sub)' }}>&rarr;</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};