import React from 'react';
import { Tooltip } from './Tooltip';

interface VariableResolverProps {
  raw: string;
  resolved: string;
}

export const VariableResolver: React.FC<VariableResolverProps> = ({ raw, resolved }) => {
  if (!raw) return <span>-</span>;
  
  if (raw === resolved) {
    return <span>{raw}</span>;
  }

  // It's resolved!
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <Tooltip content={`Derived from variable: ${raw}`}>
        <span 
          style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            backgroundColor: 'var(--bg-surface-hover)',
            padding: '2px 6px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            border: '1px solid var(--border-main)',
            cursor: 'help'
          }}
        >
          {raw}
        </span>
      </Tooltip>
      <span>{resolved}</span>
    </div>
  );
};
