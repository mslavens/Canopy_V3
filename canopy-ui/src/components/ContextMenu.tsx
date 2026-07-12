import React from 'react';

interface ContextMenuItemProps {
  icon?: React.ReactNode;
  label: React.ReactNode;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
  disabled?: boolean;
}

export const ContextMenuItem: React.FC<ContextMenuItemProps> = ({ icon, label, onClick, danger, disabled }) => {
  return (
    <button
      className="btn-secondary btn-sm"
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        border: 'none',
        justifyContent: 'flex-start',
        color: danger ? 'var(--status-red)' : 'inherit',
        width: '100%',
        textAlign: 'left',
        padding: '6px 8px',
        background: 'transparent'
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {icon && (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            color: danger ? 'var(--status-red)' : 'var(--text-muted)'
          }}
        >
          {icon}
        </span>
      )}
      {label}
    </button>
  );
};

export const ContextMenuDivider: React.FC = () => {
  return <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />;
};

export const ContextMenuHeader: React.FC<{ label: string | React.ReactNode }> = ({ label }) => {
  return (
    <div style={{ padding: '4px 10px 8px 10px', fontSize: '11px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-main)', marginBottom: '4px', fontWeight: 600 }}>
      {label}
    </div>
  );
};
