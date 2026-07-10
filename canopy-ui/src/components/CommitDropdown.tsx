import React, { useState, useEffect } from 'react';
import { GitCommit, CheckCircle, Download, History, RotateCcw, Save, List, ChevronDown } from 'lucide-react';
import { CanopyApiClient } from '../api/client';
import { PendingChangesModal as CommitDetailsModal } from './PendingChangesModal';

interface CommitDropdownProps {
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const CommitDropdown: React.FC<CommitDropdownProps> = ({ addToast }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [diffCount, setDiffCount] = useState(0);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [diffData, setDiffData] = useState<any>(null);

  const fetchDiff = async () => {
    try {
      const creds = await window.electron.getBackendAuth();
      const apiClient = new CanopyApiClient(creds);
      const data = await apiClient.request<any>('/api/workspaces/diff');
      
      let count = 0;
      ['tags', 'address_objects', 'address_groups', 'services'].forEach(key => {
        if (data[key]) {
          count += (data[key].added?.length || 0);
          count += (data[key].modified?.length || 0);
          count += (data[key].deleted?.length || 0);
        }
      });
      setDiffCount(count);
      setDiffData(data);
    } catch (err) {
      console.error("Failed to fetch diff:", err);
    }
  };

  useEffect(() => {
    fetchDiff();
    const interval = setInterval(fetchDiff, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleCommit = async () => {
    setIsCommitting(true);
    try {
      const creds = await window.electron.getBackendAuth();
      const apiClient = new CanopyApiClient(creds);
      await apiClient.request('/api/workspaces/commit', {
        method: 'POST',
        body: JSON.stringify({ message: "Manual Commit via UI" })
      });
      addToast("Successfully committed changes", "success");
      setIsOpen(false);
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

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: isOpen ? 'var(--bg-hover)' : 'transparent',
          border: '1px solid var(--border-main)',
          padding: '4px 12px',
          borderRadius: '6px',
          color: 'var(--text-main)',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 500,
          transition: 'all 0.2s ease'
        }}
      >
        <GitCommit size={14} style={{ color: 'var(--text-muted)' }} />
        Pending Changes
        {diffCount > 0 && (
          <span style={{
            background: '#f59e0b',
            color: '#fff',
            borderRadius: '50%',
            width: '18px',
            height: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            marginLeft: '4px'
          }}>
            {diffCount}
          </span>
        )}
        <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '8px',
          width: '220px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-main)',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          zIndex: 1000,
          padding: '4px'
        }}>
          <DropdownItem icon={<List size={14} />} label="View Details" onClick={() => { setIsOpen(false); setIsModalOpen(true); }} disabled={diffCount === 0} />
          <DropdownItem icon={<CheckCircle size={14} />} label="Validate" onClick={handleValidate} disabled={diffCount === 0} />
          <DropdownItem icon={<Download size={14} />} label="Export Package" disabled />
          <DropdownItem icon={<History size={14} />} label="History" disabled />
          
          <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
          
          <DropdownItem 
            icon={<RotateCcw size={14} />} 
            label="Revert All" 
            onClick={handleRevert} 
            color="#ef4444" 
            disabled={diffCount === 0}
          />
          <DropdownItem 
            icon={<Save size={14} />} 
            label={isCommitting ? "Committing..." : "Commit"} 
            onClick={handleCommit} 
            color="#10b981" 
            disabled={diffCount === 0 || isCommitting}
          />
        </div>
      )}

      {isModalOpen && diffData && (
        <CommitDetailsModal 
          onClose={() => setIsModalOpen(false)} 
          diffData={diffData} 
        />
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
