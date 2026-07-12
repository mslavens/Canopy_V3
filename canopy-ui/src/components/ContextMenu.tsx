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
        color: danger ? 'var(--status-down)' : 'inherit',
        width: '100%',
        textAlign: 'left',
        padding: '6px 8px',
        background: 'transparent'
      }}
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {icon && <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>}
      {label}
    </button>
  );
};

export const ContextMenuDivider: React.FC = () => {
  return <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />;
};
