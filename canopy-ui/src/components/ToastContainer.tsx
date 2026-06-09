import React from 'react';
import { X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
  timestamp: Date;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  // Roladex: Limit to a maximum of 5 visible toasts at any given time
  const visibleToasts = toasts.slice(-5);

  return (
    <div style={{ position: 'fixed', bottom: '50px', right: '20px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 100000 }}>
      {visibleToasts.map(toast => (
        <div key={toast.id} style={{ 
          backgroundColor: 'var(--bg-surface)', 
          color: 'var(--text-main)', 
          padding: '12px 16px', 
          borderRadius: '6px', 
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', 
          borderLeft: `4px solid ${toast.type === 'error' ? 'var(--status-red)' : (toast.type === 'success' ? 'var(--status-green)' : 'var(--accent-blue)')}`,
          fontWeight: 500, 
          fontSize: '13px',
          width: '320px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px'
        }}>
          <div style={{ wordBreak: 'break-word', paddingTop: '1px' }}>{toast.message}</div>
          <button onClick={() => onDismiss(toast.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, display: 'flex' }}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};