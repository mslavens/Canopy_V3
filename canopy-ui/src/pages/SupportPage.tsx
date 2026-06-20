import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Dropdown } from '../components/Dropdown';
import { CanopyApiClient } from '../api/client';
import { RefreshCw, ArrowDown, Loader2 } from 'lucide-react';
import { Checkbox } from '../components/Checkbox';
import { SearchBar } from '../components/SearchBar';
import { HighlightedText } from '../components/HighlightedText';
import { useConfirm } from '../components/ConfirmProvider';
import { PageHeader } from '../components/PageHeader';

interface SupportPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const SupportPage: React.FC<SupportPageProps> = ({ auth, addToast }) => {
  const [logLevel, setLogLevel] = useState<string>(() => localStorage.getItem('canopy-log-level') || 'INFO');
  const [systemLogs, setSystemLogs] = useState<string>('');
  const [isFetchingLogs, setIsFetchingLogs] = useState<boolean>(true);
  const [isLiveTail, setIsLiveTail] = useState<boolean>(false);
  const [logSearchQuery, setLogSearchQuery] = useState<string>('');
  const [appliedLogQuery, setAppliedLogQuery] = useState<string>('');
  const [isUserScrolledUp, setIsUserScrolledUp] = useState<boolean>(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();

  useEffect(() => {
    const fetchLogLevel = async () => {
      if (!auth) return;
      try {
        const apiClient = new CanopyApiClient(auth);
        const data = await apiClient.getLogLevel();
        setLogLevel(data.level);
        localStorage.setItem('canopy-log-level', data.level);
      } catch (err) {
        console.error("Failed to fetch log level", err);
      }
    };
    fetchLogLevel();
  }, [auth]);

  const fetchSystemLogs = async () => {
    setIsFetchingLogs(true);
    try {
      if (window.electron && (window as any).electron.readLogs) {
        const logs = await (window as any).electron.readLogs();
        setSystemLogs(logs);
      } else {
        setSystemLogs('Log reading is not available in this environment.');
      }
    } catch (err) {
      setSystemLogs(`Failed to read logs: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsFetchingLogs(false);
    }
  };

  useEffect(() => {
    fetchSystemLogs();
  }, []);

  // Live Tail Polling
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isLiveTail) {
      interval = setInterval(() => {
        fetchSystemLogs();
      }, 2000); // Poll every 2 seconds
    }
    return () => clearInterval(interval);
  }, [isLiveTail]);

  // Debounce the log filter to prevent UI thread lockups when typing rapidly
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedLogQuery(logSearchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [logSearchQuery]);

  // Memoized line-by-line grep filtering
  const displayedLogs = useMemo(() => {
    if (!appliedLogQuery.trim()) return systemLogs;
    const query = appliedLogQuery.toLowerCase();
    return systemLogs.split('\n').filter(line => line.toLowerCase().includes(query)).join('\n');
  }, [systemLogs, appliedLogQuery]);

  // Only force auto-scroll if Live Tail is actively running AND the user hasn't manually scrolled up
  useEffect(() => {
    if (isLiveTail && !isUserScrolledUp && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'auto' }); // 'auto' prevents fighting the user with long smooth animations
    }
  }, [displayedLogs, isLiveTail, isUserScrolledUp]);

  // Force scroll to bottom when Live Tail is explicitly toggled on
  useEffect(() => {
    if (isLiveTail) {
      setIsUserScrolledUp(false);
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isLiveTail]);

  const handleLogScroll = () => {
    if (!logsContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsUserScrolledUp(!isAtBottom);
  };

  const commitLogLevelChange = async (newLevel: string) => {
    if (!auth) return;
    setLogLevel(newLevel);
    localStorage.setItem('canopy-log-level', newLevel);
    try {
      await new CanopyApiClient(auth).setLogLevel(newLevel);
      addToast(`System log level set to ${newLevel}`, 'success');
    } catch (err) {
      addToast('Failed to update log level', 'error');
    }
  };

  const handleLogLevelChange = (newLevel: string) => {
    if (newLevel === 'DEBUG') {
      confirm({
        title: 'Enable Debug Logging',
        message: 'Enabling DEBUG mode will generate significantly more telemetry data. This is highly useful for troubleshooting, but may contain sensitive environmental data and can impact performance if left on indefinitely.\n\nAre you sure you want to enable Debug logging?',
        onConfirm: () => {
          commitLogLevelChange(newLevel);
        }
      });
    } else {
      commitLogLevelChange(newLevel);
    }
  };

  const handleExportLogs = async () => {
    try {
      if (window.electron && window.electron.exportLogs) {
        const result = await window.electron.exportLogs();
        if (result && result.success) {
          addToast(`Logs successfully exported to: ${result.filePath}`, 'success');
        }
      } else {
        addToast('Export functionality is not available in this environment.', 'error');
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to export logs.', 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '1200px' }}>
      <PageHeader 
        title="System Support & Diagnostics" 
        description="View background telemetry and engine logs for troubleshooting." 
      />

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)', marginTop: '50px' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>Diagnostics & Troubleshooting</h3>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
          Adjust the verbosity of the background engine logs or export the unified system event logs to assist with debugging. DEBUG mode will generate significantly more telemetry data.
        </p>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Go Daemon Log Level:</label>
            <Dropdown 
              options={['DEBUG', 'INFO', 'WARN', 'ERROR']} 
              value={logLevel} 
              onChange={handleLogLevelChange} 
            />
          </div>
          <button className="btn-secondary" onClick={handleExportLogs}>
            Export System Logs
          </button>
        </div>
      </section>

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)', display: 'flex', flexDirection: 'column', marginTop: '25px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--accent-blue)' }}>Live System Logs</h3>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <SearchBar 
              value={logSearchQuery} 
              onChange={setLogSearchQuery} 
              placeholder="Filter logs..." 
              variant="local" 
              width="250px" 
            />
            <div style={{ height: '20px', width: '1px', backgroundColor: 'var(--border-main)' }} />
            
            <Checkbox checked={isLiveTail} onChange={setIsLiveTail} label="Live Tail" />
            <div style={{ height: '20px', width: '1px', backgroundColor: 'var(--border-main)' }} />
            
            <button className="btn-secondary btn-sm" onClick={fetchSystemLogs} disabled={isLiveTail} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <RefreshCw size={14} className={isLiveTail ? 'spin-animation' : ''} /> Refresh
            </button>
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <div ref={logsContainerRef} onScroll={handleLogScroll} style={{ backgroundColor: 'var(--bg-app)', padding: '15px', borderRadius: '6px', border: '1px solid var(--border-main)', height: '400px', overflowY: 'auto', color: 'var(--text-main)', fontSize: '12px', fontFamily: 'monospace', lineHeight: 1.5 }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
              {isFetchingLogs && !systemLogs ? (
                <div className="fade-in-delayed" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', color: 'var(--text-muted)', gap: '15px' }}>
                  <Loader2 size={24} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />
                  <span>Loading system logs...</span>
                </div>
              ) : displayedLogs ? (
                <HighlightedText text={displayedLogs} highlight={appliedLogQuery} />
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>No matching logs.</span>
              )}
            </pre>
            <div ref={logEndRef} />
          </div>
          
          {isLiveTail && isUserScrolledUp && (
            <button onClick={() => { setIsUserScrolledUp(false); logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }} style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--bg-element)', border: '1px solid var(--border-main)', padding: '6px 15px', borderRadius: '20px', color: 'var(--accent-blue)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ArrowDown size={14} /> Resume Auto-Scroll
            </button>
          )}
        </div>
      </section>
    </div>
  );
};