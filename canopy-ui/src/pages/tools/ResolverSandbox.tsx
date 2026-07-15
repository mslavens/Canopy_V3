import React, { useState } from 'react';

import { Search, MapPin, Bug } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { CanopyApiClient } from '../../api/client';
import { EmptyState } from '../../components/EmptyState';

interface ResolverSandboxProps {
  apiClient?: CanopyApiClient;
}

export const ResolverSandbox: React.FC<ResolverSandboxProps> = ({ apiClient }) => {
  const [ipAddress, setIpAddress] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleResolve = async () => {
    if (!ipAddress.trim() || !apiClient) return;
    
    setIsResolving(true);
    setError(null);
    setResults(null);

    try {
      const data = await apiClient.resolveSandboxIp(ipAddress.trim(), deviceId.trim() || undefined);
      if (data && data.matches) {
        setResults(data.matches);
      } else {
        setResults([]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resolve IP.');
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader 
        title="Resolver Sandbox" 
        description="Simulate how the firewall's mathematical engine determines routing and zone placement for an IP address." 
      />
      
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* Left Side: Inputs */}
        <div style={{ width: '320px', padding: '25px', borderRight: '1px solid var(--border-main)', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>Search IP Address <span style={{ color: 'var(--status-red)' }}>*</span></label>
            <input 
              type="text" 
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleResolve()}
              placeholder="e.g. 10.1.1.5"
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-main)',
                borderRadius: '6px',
                color: 'var(--text-main)',
                fontSize: '14px',
                width: '100%',
                outline: 'none',
                fontFamily: 'monospace'
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--accent-blue)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--border-main)'}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>Target Device <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}>(Optional)</span></label>
            <input 
              type="text" 
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleResolve()}
              placeholder="Device UUID (leave blank for all)"
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-main)',
                borderRadius: '6px',
                color: 'var(--text-main)',
                fontSize: '13px',
                width: '100%',
                outline: 'none'
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--accent-blue)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--border-main)'}
            />
          </div>

          <button 
            onClick={handleResolve}
            disabled={!ipAddress || isResolving}
            className="btn-primary"
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '10px', marginTop: '10px' }}
          >
            <Search size={16} /> 
            {isResolving ? 'Resolving...' : 'Execute Search'}
          </button>
        </div>

        {/* Right Side: Results */}
        <div style={{ flex: 1, backgroundColor: 'var(--bg-surface)', padding: '25px', overflowY: 'auto' }}>
          {error && (
            <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid var(--status-red)', color: 'var(--status-red)', fontSize: '13px', borderRadius: '4px', marginBottom: '20px' }}>
              {error}
            </div>
          )}

          {!results && !error && !isResolving && (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState 
                icon={<Bug size={40} />} 
                title="Ready for Execution" 
                description="Enter an IP address and click Execute Search to test routing logic." 
              />
            </div>
          )}

          {results && results.length === 0 && (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState 
                icon={<Search size={40} />} 
                title="No Matches Found" 
                description={`Could not find any routing table or interface matches for ${ipAddress}.`} 
              />
            </div>
          )}

          {results && results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MapPin size={18} style={{ color: 'var(--accent-purple)' }} />
                Resolved Locations ({results.length})
              </h3>
              
              {results.map((match, idx) => (
                <div key={idx} style={{ 
                  backgroundColor: 'var(--bg-app)', 
                  border: '1px solid var(--border-main)', 
                  borderRadius: '8px', 
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)' }}>{match.device_name || match.device_uuid}</div>
                    <div style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '4px', backgroundColor: match.type.includes('Interface') ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)', color: match.type.includes('Interface') ? 'var(--status-green)' : 'var(--accent-blue)', fontWeight: 600, textTransform: 'uppercase' }}>
                      {match.type}
                    </div>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Zone</span>
                      <span style={{ fontSize: '13px', color: 'var(--text-main)', fontFamily: 'monospace' }}>{match.zone || 'Unknown'}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Interface</span>
                      <span style={{ fontSize: '13px', color: 'var(--text-main)', fontFamily: 'monospace' }}>{match.interface || 'None'}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Virtual Router</span>
                      <span style={{ fontSize: '13px', color: 'var(--text-main)', fontFamily: 'monospace' }}>{match.virtual_router || 'default'}</span>
                    </div>
                    {match.route_name && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Route Name</span>
                        <span style={{ fontSize: '13px', color: 'var(--text-main)' }}>{match.route_name}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
