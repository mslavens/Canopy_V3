import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
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
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, transform: 'translate(-50%, 0)' });

  const updateCoords = () => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      let leftVal = rect.left + rect.width / 2;
      const topVal = position === 'bottom' 
        ? rect.bottom + 8
        : rect.top - 8;
      
      let transformVal = position === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';

      if (tooltipRef.current) {
        const tooltipRect = tooltipRef.current.getBoundingClientRect();
        const tooltipWidth = tooltipRect.width;

        // Bounding check on right viewport edge
        if (leftVal + tooltipWidth / 2 > window.innerWidth - 12) {
          leftVal = window.innerWidth - 12 - tooltipWidth;
          transformVal = position === 'bottom' ? 'none' : 'translate(0, -100%)';
        }
        // Bounding check on left viewport edge
        else if (leftVal - tooltipWidth / 2 < 12) {
          leftVal = 12;
          transformVal = position === 'bottom' ? 'none' : 'translate(0, -100%)';
        }
      }

      setCoords({ 
        top: topVal + window.scrollY, 
        left: leftVal + window.scrollX,
        transform: transformVal
      });
    }
  };

  useLayoutEffect(() => {
    if (isVisible) {
      updateCoords();
      // Double check position on next tick to account for ref sizing adjustments
      const handle = requestAnimationFrame(updateCoords);
      return () => cancelAnimationFrame(handle);
    }
  }, [isVisible, content]);

  useEffect(() => {
    if (isVisible) {
      window.addEventListener('resize', updateCoords);
      window.addEventListener('scroll', updateCoords, true);
    }
    return () => {
      window.removeEventListener('resize', updateCoords);
      window.removeEventListener('scroll', updateCoords, true);
    };
  }, [isVisible]);

  return (
    <div 
      ref={wrapperRef}
      style={{ display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && createPortal(
        <div 
          ref={tooltipRef}
          style={{
            position: 'absolute',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            transform: coords.transform,
            padding: '8px 12px',
            backgroundColor: 'var(--bg-surface)', // theme-aware background surface (white in light mode, dark in dark mode)
            color: 'var(--text-main)',
            fontSize: '11px',
            lineHeight: '1.4',
            borderRadius: '6px',
            whiteSpace: 'normal',
            maxWidth: '240px',
            zIndex: 1000000,
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            border: '1px solid var(--accent-blue)', // subtle theme border accent
            pointerEvents: 'none',
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </div>
  );
};