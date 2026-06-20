import React from 'react';

interface PageHeaderProps {
  title: string;
  description: string;
  actions?: React.ReactNode;
  isSticky?: boolean;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions, isSticky = true }) => {
  const stickyStyles: React.CSSProperties = isSticky ? {
    position: 'sticky',
    top: '-30px',
    zIndex: 10,
    padding: '30px 0 0 0',
    margin: '-30px 0 25px 0'
  } : {
    flexShrink: 0,
    margin: '0 0 25px 0'
  };

  return (
    <div style={{ 
      backgroundColor: 'var(--bg-app)', 
      display: 'flex', 
      flexDirection: 'column', 
      ...stickyStyles
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', gap: '24px', minHeight: '64px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{title}</h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>{description}</p>
          </div>
          
          {actions && (
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              {actions}
            </div>
          )}
        </div>
        <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%' }} />
      </div>
    </div>
  );
};