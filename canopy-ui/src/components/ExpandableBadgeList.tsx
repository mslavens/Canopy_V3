import React, { useState } from 'react';

interface ExpandableBadgeListProps {
  items: any[];
  renderItem: (item: any, index: number) => React.ReactNode;
  limit?: number;
}

export const ExpandableBadgeList: React.FC<ExpandableBadgeListProps> = ({ items, renderItem, limit = 5 }) => {
  const [expanded, setExpanded] = useState(false);

  if (!items || items.length === 0) {
    return <span style={{ color: 'var(--text-muted)' }}>any</span>;
  }

  const visibleItems = expanded ? items : items.slice(0, limit);
  const hiddenCount = items.length - limit;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
      {visibleItems.map((item, idx) => renderItem(item, idx))}
      
      {!expanded && hiddenCount > 0 && (
        <span 
          style={{ fontSize: '11px', color: 'var(--accent-blue)', cursor: 'pointer', padding: '0 4px' }}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          title="Show all items"
        >
          +{hiddenCount} more (click to expand)
        </span>
      )}
      
      {expanded && hiddenCount > 0 && (
        <span 
          style={{ fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 4px' }}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(false);
          }}
        >
          (collapse)
        </span>
      )}
    </div>
  );
};
