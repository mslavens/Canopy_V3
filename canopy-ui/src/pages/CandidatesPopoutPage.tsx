import React, { useState, useEffect } from 'react';
import { GitMerge, Loader2, Shield } from 'lucide-react';

export const CandidatesPopoutPage: React.FC = () => {
  const [candidates, setCandidates] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('canopy-candidates-data');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [isGenerating, setIsGenerating] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('canopy-candidates-generating');
      return saved ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });

  const [analysisColumns, setAnalysisColumns] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('canopy-candidates-columns');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [availableColumns, setAvailableColumns] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('canopy-candidates-available-columns');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Listen for storage events from the main window to update candidate rule state in real time
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      try {
        if (e.key === 'canopy-candidates-data' && e.newValue) {
          setCandidates(JSON.parse(e.newValue));
        } else if (e.key === 'canopy-candidates-generating' && e.newValue) {
          setIsGenerating(JSON.parse(e.newValue));
        } else if (e.key === 'canopy-candidates-columns' && e.newValue) {
          setAnalysisColumns(JSON.parse(e.newValue));
        } else if (e.key === 'canopy-candidates-available-columns' && e.newValue) {
          setAvailableColumns(JSON.parse(e.newValue));
        }
      } catch (err) {
        console.error("Failed to sync storage change in popout:", err);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      backgroundColor: 'var(--bg-app)',
      color: 'var(--text-main)',
      overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        padding: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-main)',
        flexShrink: 0
      }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <GitMerge size={16} color="var(--accent-purple)" /> Candidate Rules (Popout View)
          {isGenerating && <Loader2 size={14} className="animate-spin" color="var(--text-muted)" />}
        </h3>
      </div>

      <div style={{
        flex: 1,
        overflow: 'auto',
        opacity: isGenerating && candidates.length > 0 ? 0.5 : 1,
        transition: 'opacity 0.2s',
        pointerEvents: isGenerating ? 'none' : 'auto'
      }}>
        {isGenerating && candidates.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)' }}>
            <Loader2 size={24} className="animate-spin" />
            <span style={{ marginLeft: '12px' }}>Executing Passes...</span>
          </div>
        ) : candidates.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            justifyContent: 'center',
            alignItems: 'center',
            height: '80%',
            color: 'var(--text-muted)',
            border: '1px dashed var(--border-main)',
            borderRadius: '8px',
            margin: '32px'
          }}>
            <Shield size={32} color="var(--text-muted)" />
            <span>No candidates generated. Configure your passes in the main window Heatmap page and click Generate.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {[candidates[candidates.length - 1]].filter(Boolean).map((passResult: any, idx) => (
              <div key={idx} style={{ backgroundColor: 'var(--bg-surface)', overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left', whiteSpace: 'nowrap' }}>
                    <thead>
                      <tr>
                        {analysisColumns.map(col => (
                          <th key={col} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-main)', color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface)' }}>
                            {availableColumns.find(c => c === col) || col}
                          </th>
                        ))}
                        <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-main)', color: 'var(--text-muted)', width: '100px', backgroundColor: 'var(--bg-surface)' }}>Hits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {passResult.rules.map((rule: any, ruleIdx: number) => (
                        <tr key={ruleIdx} style={{ borderBottom: '1px solid var(--border-main)' }}>
                          {analysisColumns.map(col => {
                            const val = rule[col];
                            let displayVal = val;
                            if (Array.isArray(val)) {
                              displayVal = val.join(', ');
                            } else if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
                              try { displayVal = JSON.parse(val).join(', '); } catch (e) { displayVal = val; }
                            }

                            return (
                              <td key={col} style={{ padding: '12px 16px', color: 'var(--text-main)', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={displayVal || '-'}>
                                {displayVal || '-'}
                              </td>
                            );
                          })}
                          <td style={{ padding: '12px 16px', color: 'var(--text-main)', fontWeight: 600 }}>
                            {rule.count?.toLocaleString() || 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
