import React, { useState, useEffect, useRef } from 'react';
import { X, Trash2, BellOff } from 'lucide-react';
import { ToastMessage } from './ToastContainer';
import { SearchBar } from './SearchBar';
import { HighlightedText } from './HighlightedText';
import { EmptyState } from './EmptyState';
import { Tooltip } from './Tooltip';

interface NotificationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  history: ToastMessage[];
  onClearAll: () => void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({ isOpen, onClose, history, onClearAll }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const drawerRef = useRef<HTMLDivElement>(null);

  const filteredHistory = history.filter(n =>
    n.message.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Focus trap
  useEffect(() => {
    if (!isOpen || !drawerRef.current) return;

    const initialFocusable = drawerRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (initialFocusable.length > 0 && !drawerRef.current.contains(document.activeElement)) {
      initialFocusable[0].focus();
    }

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !drawerRef.current) return;
      const elements = drawerRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (elements.length === 0) return;

      const firstElement = elements[0];
      const lastElement = elements[elements.length - 1];

      if (e.shiftKey && (document.activeElement === firstElement || document.activeElement === drawerRef.current)) {
        lastElement.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        firstElement.focus();
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleTabKey);
    return () => document.removeEventListener('keydown', handleTabKey);
  }, [isOpen]);

  return (
    <>
      {/* Background Overlay */}
      {isOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10001 }} onClick={onClose} />
      )}
      
      {/* Sliding Drawer */}
      <div ref={drawerRef} tabIndex={-1} style={{
        position: 'fixed', top: 0, right: 0, bottom: '36px', width: '350px',
        backgroundColor: 'var(--bg-app)', borderLeft: '1px solid var(--border-main)',
        boxShadow: '-4px 0 15px rgba(0,0,0,0.2)', zIndex: 10002, outline: 'none',
        transform: isOpen ? 'translateX(0)' : 'translateX(calc(100% + 20px))',
        transition: 'transform 0.2s ease-in-out',
        display: 'flex', flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-main)' }}>System Notifications</h2>
          <Tooltip content="Close Drawer" align="right">
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}><X size={18} /></button>
          </Tooltip>
        </div>

        {/* Toolbar */}
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border-main)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search event history..." width="100%" />
          <button onClick={onClearAll} disabled={history.length === 0} style={{ alignSelf: 'flex-end', background: 'transparent', border: 'none', color: history.length === 0 ? 'var(--text-muted)' : 'var(--status-red)', fontSize: '12px', cursor: history.length === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Trash2 size={14} /> Clear History
          </button>
        </div>

        {/* Notification List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '15px 20px' }}>
          {filteredHistory.length === 0 ? (
            <EmptyState icon={<BellOff size={24} />} title="No notifications found" description={searchQuery ? "No events match your search query." : "You have no system notifications."} minHeight="200px" />
          ) : (
            filteredHistory.map(n => (
              <div key={n.id} style={{ padding: '12px', marginBottom: '10px', borderRadius: '6px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderLeft: `4px solid ${n.type === 'error' ? 'var(--status-red)' : n.type === 'success' ? 'var(--status-green)' : 'var(--accent-blue)'}` }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>{n.timestamp.toLocaleTimeString()}</div>
                <div style={{ fontSize: '13px', color: 'var(--text-main)' }}><HighlightedText text={n.message} highlight={searchQuery} /></div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};