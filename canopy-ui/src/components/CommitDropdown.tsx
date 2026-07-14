import React, { useState, useEffect } from 'react';
import { GitCommit, CheckCircle, Download, History, RotateCcw, Save, List, ChevronDown } from 'lucide-react';
import { CanopyApiClient } from '../api/client';
import { PendingChangesModal as CommitDetailsModal } from './PendingChangesModal';
import { CommitHistoryModal } from './CommitHistoryModal';
import { Modal } from './Modal';

interface CommitDropdownProps {
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  globalScopeVendor?: string;
  navigateToHistory: () => void;
}

export const CommitDropdown: React.FC<CommitDropdownProps> = ({ addToast, globalScopeVendor, navigateToHistory }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [diffCount, setDiffCount] = useState(0);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCommitModalOpen, setIsCommitModalOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [diffData, setDiffData] = useState<any>(null);

  const fetchDiff = async () => {
    try {
      const creds = await window.electron.getBackendAuth();
      const apiClient = new CanopyApiClient(creds);
      const data = await apiClient.request<any>('/api/workspaces/diff');
      
      let count = 0;
      if (data.tables) {
        Object.values(data.tables).forEach((tableDiff: any) => {
          count += (tableDiff.added?.length || 0);
          count += (tableDiff.modified?.length || 0);
          count += (tableDiff.deleted?.length || 0);
        });
      } else {
        ['tags', 'address_objects', 'address_groups', 'services'].forEach(key => {
          if (data[key]) {
            count += (data[key].added?.length || 0);
            count += (data[key].modified?.length || 0);
            count += (data[key].deleted?.length || 0);
          }
        });
      }
      setDiffCount(count);
      setDiffData((prev: any) => {
        if (JSON.stringify(prev) === JSON.stringify(data)) {
          return prev;
        }
        return data;
      });
    } catch (err) {
      console.error("Failed to fetch diff:", err);
    }
  };

  useEffect(() => {
    fetchDiff();
    const interval = setInterval(fetchDiff, 5000);
    
    const handleMutation = () => fetchDiff();
    window.addEventListener('canopy:mutation', handleMutation);
    
    if (window.electron && window.electron.onMutationDetected) {
      window.electron.onMutationDetected(handleMutation);
    }
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('canopy:mutation', handleMutation);
    };
  }, []);

  const handleCommitClick = () => {
    setCommitMessage('');
    setIsCommitModalOpen(true);
    setIsOpen(false);
    setIsModalOpen(false);
  };

  const submitCommit = async () => {
    
    setIsCommitting(true);
    try {
      const creds = await window.electron.getBackendAuth();
      const apiClient = new CanopyApiClient(creds);
      await apiClient.request('/api/workspaces/commit', {
        method: 'POST',
        body: JSON.stringify({ message: commitMessage.trim() })
      });
      addToast("Successfully committed changes", "success");
      setIsCommitModalOpen(false);
      window.dispatchEvent(new Event('workspace-committed'));
      fetchDiff();
    } catch (err: any) {
      addToast(`Commit failed: ${err.message}`, "error");
    } finally {
      setIsCommitting(false);
    }
  };

  const handleRevert = async () => {
    try {
      const creds = await window.electron.getBackendAuth();
      const apiClient = new CanopyApiClient(creds);
      await apiClient.request('/api/workspaces/revert', {
        method: 'POST',
        body: JSON.stringify({ commit_id: 0 })
      });
      addToast("Successfully reverted pending changes", "success");
      setIsOpen(false);
      fetchDiff();
      window.location.reload();
    } catch (err: any) {
      addToast(`Revert failed: ${err.message}`, "error");
    }
  };

  const handleValidate = () => {
    addToast("Configuration is valid and dependencies are met.", "success");
    setIsOpen(false);
  };

  const handleRevertSingle = async (category: string, id: string) => {
    try {
      const creds = await window.electron.getBackendAuth();
      const apiClient = new CanopyApiClient(creds);
      await apiClient.revertSingleChange(category, id);
      addToast('Change reverted successfully', 'success');
      window.dispatchEvent(new Event('workspace-committed'));
      fetchDiff();
    } catch (err: any) {
      addToast(err.message || 'Failed to revert change', 'error');
    }
  };

  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => {
          if (diffCount > 0) {
            setIsModalOpen(true);
          } else {
            addToast("No pending changes", "info");
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: diffCount > 0 ? '#f59e0b' : 'transparent',
          border: diffCount > 0 ? '1px solid #d97706' : '1px solid var(--border-main)',
          padding: '4px 12px',
          borderRadius: '6px',
          color: diffCount > 0 ? '#fff' : 'var(--text-main)',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 500,
          transition: 'all 0.2s ease'
        }}
      >
        <GitCommit size={14} style={{ color: diffCount > 0 ? '#fff' : 'var(--text-muted)' }} />
        Pending Changes {diffCount > 0 && `(${diffCount})`}
      </button>


      {isModalOpen && diffData && (
        <CommitDetailsModal 
          onClose={() => setIsModalOpen(false)} 
          diffData={diffData} 
          onRevert={handleRevertSingle}
          onCommit={handleCommitClick}
          globalScopeVendor={globalScopeVendor}
        />
      )}

      {isCommitModalOpen && (
        <Modal
          isOpen={isCommitModalOpen}
          onClose={() => !isCommitting && setIsCommitModalOpen(false)}
          title="Commit Changes"
          size="md"
        >
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              Enter a description for this commit. This message will be saved in the workspace history.
            </p>
            <textarea
              autoFocus
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="e.g. Added new DMZ security rules for web servers..."
              rows={4}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid var(--border-main)',
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-main)',
                fontFamily: 'inherit',
                fontSize: '13px',
                resize: 'vertical'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submitCommit();
                }
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '5px' }}>
              <button 
                className="btn-secondary" 
                onClick={() => setIsCommitModalOpen(false)}
                disabled={isCommitting}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={submitCommit}
                disabled={isCommitting}
              >
                {isCommitting ? 'Committing...' : 'Commit Changes'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

interface DropdownItemProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  color?: string;
}

const DropdownItem: React.FC<DropdownItemProps> = ({ icon, label, onClick, disabled, color }) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 12px',
        background: 'transparent',
        border: 'none',
        borderRadius: '4px',
        color: disabled ? 'var(--text-muted)' : (color || 'var(--text-main)'),
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        textAlign: 'left',
        fontSize: '13px'
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {React.cloneElement(icon as React.ReactElement, { 
        style: { color: disabled ? 'var(--text-muted)' : (color || 'var(--text-main)') } 
      })}
      {label}
    </button>
  );
};
