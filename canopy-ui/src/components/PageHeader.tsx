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
    padding: '30px 0 15px 0',
    margin: '-30px 0 0 0',
    height: '105px'
  } : {
    flexShrink: 0,
    padding: '0 0 20px 0',
    height: '85px'
  };

  return (
    <div style={{ 
      backgroundColor: 'var(--bg-app)', 
      display: 'flex', 
      flexDirection: 'column', 
      gap: '10px', 
      ...stickyStyles
    }}>
      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{title}</h2>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '32px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>{description}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {actions}
        </div>
      </div>
    </div>
  );
};