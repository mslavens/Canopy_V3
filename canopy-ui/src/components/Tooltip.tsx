import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: string;
  align?: 'left' | 'center' | 'right';
  position?: 'top' | 'bottom';
  children: React.ReactNode;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, align = 'center', position = 'bottom', children }) => {
  const [isVisible, setIsVisible] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const updateCoords = () => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const leftVal = rect.left + window.scrollX + rect.width / 2;
      const topVal = position === 'bottom' 
        ? rect.bottom + window.scrollY + 8
        : rect.top + window.scrollY - 8;
      setCoords({ top: topVal, left: leftVal });
    }
  };

  useEffect(() => {
    if (isVisible) {
      updateCoords();
      window.addEventListener('resize', updateCoords);
      window.addEventListener('scroll', updateCoords, true);
    }
    return () => {
      window.removeEventListener('resize', updateCoords);
      window.removeEventListener('scroll', updateCoords, true);
    };
  }, [isVisible]);

  const transformVal = position === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';

  return (
    <div 
      ref={wrapperRef}
      style={{ display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && createPortal(
        <div style={{
          position: 'absolute',
          top: `${coords.top}px`,
          left: `${coords.left}px`,
          transform: transformVal,
          padding: '6px 10px',
          backgroundColor: 'var(--bg-surface)',
          color: 'var(--text-main)',
          fontSize: '11px',
          borderRadius: '4px',
          whiteSpace: 'nowrap',
          zIndex: 1000000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          border: '1px solid var(--border-main)',
          pointerEvents: 'none',
        }}>
          {content}
        </div>,
        document.body
      )}
    </div>
  );
};