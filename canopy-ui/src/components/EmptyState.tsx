import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  minHeight?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action, minHeight = '200px' }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight, padding: '40px 20px' }}>
      {icon && <div style={{ marginBottom: '16px', color: 'var(--text-sub)', opacity: 0.8 }}>{icon}</div>}
      <h3 style={{ margin: '0 0 8px 0', fontSize: '15px', fontWeight: 600, color: 'var(--text-main)' }}>{title}</h3>
      {description && <p style={{ margin: '0 0 24px 0', fontSize: '13px', color: 'var(--text-muted)', maxWidth: '400px', lineHeight: 1.5 }}>{description}</p>}
      {action && <div>{action}</div>}
    </div>
  );
};