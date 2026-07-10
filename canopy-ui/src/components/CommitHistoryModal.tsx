import React, { useState, useEffect } from 'react';
import { CanopyApiClient } from '../api/client';
import { History, Clock, GitCommit, Undo2, RotateCcw } from 'lucide-react';
import { useConfirm } from './ConfirmProvider';

interface CommitHistoryModalProps {
  onClose: () => void;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

interface CommitData {
  id: number;
  message: string;
  timestamp: string;
}

export const CommitHistoryModal: React.FC<CommitHistoryModalProps> = ({ onClose, addToast }) => {
  const [commits, setCommits] = useState<CommitData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCommit, setSelectedCommit] = useState<CommitData | null>(null);
  const [isReverting, setIsReverting] = useState(false);
  const { confirm } = useConfirm();

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const creds = await window.electron.getBackendAuth();
      const apiClient = new CanopyApiClient(creds);
      const data = await apiClient.getCommitHistory();
      setCommits(data || []);
      if (data && data.length > 0) {
        setSelectedCommit(data[0]);
      }
    } catch (err: any) {
      addToast(`Failed to fetch history: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRevert = async (commit: CommitData) => {
    confirm({
      title: 'Revert Workspace Configuration',
      message: `Are you sure you want to revert the workspace to commit #${commit.id} ("${commit.message}")? \n\nThis will completely overwrite the active workspace configuration with the state from ${new Date(commit.timestamp).toLocaleString()}. This action cannot be easily undone.`,
      confirmText: 'Revert Configuration',
      isDestructive: true,
      onConfirm: async () => {
        setIsReverting(true);
        try {
          const creds = await window.electron.getBackendAuth();
          const apiClient = new CanopyApiClient(creds);
          await apiClient.revertToCommit(commit.id);
          addToast(`Workspace reverted to commit #${commit.id}`, 'success');
          onClose();
          window.location.reload();
        } catch (err: any) {
          addToast(`Revert failed: ${err.message}`, 'error');
        } finally {
          setIsReverting(false);
        }
      }
    });
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px',
      zIndex: 10000
    }}>
      <div style={{
        width: '100%',
        maxWidth: '1000px',
        height: '80vh',
        backgroundColor: 'var(--bg-surface)',
        borderRadius: '8px',
        border: '1px solid var(--border-main)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={18} color="var(--accent-blue)" />
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Commit History</h2>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar */}
          <div style={{ width: '300px', borderRight: '1px solid var(--border-main)', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-main)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-main)', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Timeline
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
              ) : commits.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>No commits found.</div>
              ) : (
                commits.map(commit => (
                  <div
                    key={commit.id}
                    onClick={() => setSelectedCommit(commit)}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--border-main)',
                      cursor: 'pointer',
                      backgroundColor: selectedCommit?.id === commit.id ? 'var(--bg-hover)' : 'transparent',
                      borderLeft: selectedCommit?.id === commit.id ? '3px solid var(--accent-blue)' : '3px solid transparent'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>#{commit.id}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {new Date(commit.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {commit.message}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Details Pane */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '30px', overflowY: 'auto' }}>
            {selectedCommit ? (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <GitCommit size={20} color="var(--accent-blue)" />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Commit #{selectedCommit.id}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
                      <Clock size={14} />
                      {new Date(selectedCommit.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div style={{ padding: '20px', backgroundColor: 'var(--bg-main)', borderRadius: '8px', border: '1px solid var(--border-main)', marginBottom: '30px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '10px' }}>
                    Commit Message
                  </div>
                  <div style={{ fontSize: '14px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                    {selectedCommit.message}
                  </div>
                </div>

                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div style={{ padding: '20px', backgroundColor: 'rgba(239, 68, 68, 0.05)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#ef4444', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <RotateCcw size={16} />
                      Danger Zone
                    </h4>
                    <p style={{ margin: '0 0 15px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                      Reverting to this commit will replace your active workspace configuration with the exact state from this snapshot. Any uncommitted changes will be lost.
                    </p>
                    <button
                      className="btn-secondary"
                      onClick={() => handleRevert(selectedCommit)}
                      disabled={isReverting}
                      style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.5)' }}
                    >
                      {isReverting ? 'Reverting...' : `Revert to Commit #${selectedCommit.id}`}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                Select a commit from the timeline to view details
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
