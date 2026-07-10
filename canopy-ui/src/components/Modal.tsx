import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
  resizable?: boolean;
  draggable?: boolean;
  fullScreen?: boolean;
  hasBackdrop?: boolean;
  zIndex?: number;
}

export const Modal: React.FC<ModalProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  size = 'md', 
  children, 
  footer,
  headerActions,
  resizable = true,
  draggable = true,
  fullScreen = false,
  hasBackdrop = true,
  zIndex = 10000
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  // Prevent background scrolling and layout shifts when modal is open
  useEffect(() => {
    if (isOpen) {
      setPosition({ x: 0, y: 0 });
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
      document.body.style.paddingRight = '0px';
    }
    return () => { 
      document.body.style.overflow = 'unset'; 
      document.body.style.paddingRight = '0px';
    };
  }, [isOpen]);

  // Focus trap
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    const initialFocusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (initialFocusable.length > 0 && !modalRef.current.contains(document.activeElement)) {
      initialFocusable[0].focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !modalRef.current) return;
      const elements = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (elements.length === 0) return;

      const firstElement = elements[0];
      const lastElement = elements[elements.length - 1];

      if (e.shiftKey && (document.activeElement === firstElement || document.activeElement === modalRef.current)) {
        lastElement.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        firstElement.focus();
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!draggable) return;
    if (e.button !== 0) return; // Only left-click drags
    const target = e.target as HTMLElement;
    // Don't drag if clicking buttons, links, inputs, or selections
    if (target.closest('button') || target.closest('a') || target.closest('input') || target.closest('select') || target.closest('textarea')) {
      return;
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const startPosX = position.x;
    const startPosY = position.y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setPosition({
        x: startPosX + dx,
        y: startPosY + dy
      });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  if (!isOpen) return null;

  const sizeMap = { sm: '400px', md: '600px', lg: '800px' };

  return (
    <div 
      style={{ 
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
        backgroundColor: fullScreen ? 'var(--bg-app)' : (hasBackdrop ? 'rgba(0, 0, 0, 0.6)' : 'transparent'), 
        backdropFilter: fullScreen ? 'none' : (hasBackdrop ? 'blur(2px)' : 'none'), 
        display: 'flex', alignItems: 'center', justifyContent: 'center', 
        zIndex: zIndex,
        pointerEvents: hasBackdrop ? 'auto' : 'none'
      }}
      onMouseDown={(e) => {
        if (!fullScreen && hasBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        ref={modalRef} 
        tabIndex={-1} 
        style={{ 
          pointerEvents: 'auto',
          backgroundColor: 'var(--bg-app)', 
          border: fullScreen ? 'none' : '1px solid var(--border-main)', 
          borderRadius: fullScreen ? '0' : '8px', 
          width: fullScreen ? '100vw' : sizeMap[size], 
          height: fullScreen ? '100vh' : 'auto',
          maxWidth: fullScreen ? '100vw' : '95vw', 
          maxHeight: fullScreen ? '100vh' : '90vh', 
          display: 'flex', 
          flexDirection: 'column', 
          boxShadow: fullScreen ? 'none' : '0 10px 30px rgba(0,0,0,0.5)', 
          overflow: 'hidden', 
          outline: 'none',
          resize: (resizable && !fullScreen) ? 'both' : 'none',
          minWidth: '320px',
          minHeight: '220px',
          transform: fullScreen ? 'none' : `translate(${position.x}px, ${position.y}px)`,
          transition: 'transform 0.05s linear' // brief smooth transition during drag moves
        }}
      >
        <div 
          onMouseDown={handleMouseDown}
          style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            padding: '15px 20px', 
            backgroundColor: 'var(--bg-surface)', 
            borderBottom: '1px solid var(--border-main)', 
            flexShrink: 0,
            cursor: draggable ? 'grab' : 'default',
            userSelect: 'none'
          }}
        >
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-main)' }}>{title}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!fullScreen && headerActions}
            <Tooltip content="Close Modal" align="right">
              <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}>
                <X size={18} />
              </button>
            </Tooltip>
          </div>
        </div>
        <div style={{ padding: '20px', overflowY: 'auto', color: 'var(--text-main)', fontSize: '13px', lineHeight: 1.5, flex: 1 }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: '15px 30px 15px 20px', backgroundColor: 'var(--bg-surface)', borderTop: '1px solid var(--border-main)', display: 'flex', justifyContent: 'flex-end', gap: '10px', flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};