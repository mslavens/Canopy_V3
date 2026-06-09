import React, { useState } from 'react';

interface TooltipProps {
  content: string;
  align?: 'left' | 'center' | 'right';
  position?: 'top' | 'bottom';
  children: React.ReactNode;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, align = 'center', position = 'bottom', children }) => {
  const [isVisible, setIsVisible] = useState(false);

  let alignmentStyle: React.CSSProperties = {
    left: '50%',
    transform: 'translateX(-50%)',
  };

  if (align === 'left') {
    alignmentStyle = { left: '0' };
  } else if (align === 'right') {
    alignmentStyle = { right: '0' };
  }

  const verticalStyle: React.CSSProperties = position === 'bottom'
    ? { top: '100%', marginTop: '8px' }
    : { bottom: '100%', marginBottom: '8px' };

  return (
    <div 
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', zIndex: isVisible ? 1000 : undefined }}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div style={{
          position: 'absolute',
          ...verticalStyle,
          padding: '6px 10px',
          backgroundColor: 'var(--bg-element)',
          color: 'var(--text-main)',
          fontSize: '11px',
          borderRadius: '4px',
          whiteSpace: 'nowrap',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          border: '1px solid var(--border-main)',
          pointerEvents: 'none',
          ...alignmentStyle
        }}>
          {content}
        </div>
      )}
    </div>
  );
};