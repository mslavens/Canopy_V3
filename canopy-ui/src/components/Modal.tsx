import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, size = 'md', children, footer }) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // Prevent background scrolling when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
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

  if (!isOpen) return null;

  const sizeMap = { sm: '400px', md: '600px', lg: '800px' };

  return (
    <div 
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={modalRef} tabIndex={-1} style={{ backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '8px', width: sizeMap[size], maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', overflow: 'hidden', outline: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-main)' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-main)' }}>{title}</h2>
          <Tooltip content="Close Modal" align="right">
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}>
              <X size={18} />
            </button>
          </Tooltip>
        </div>
        <div style={{ padding: '20px', overflowY: 'auto', color: 'var(--text-main)', fontSize: '13px', lineHeight: 1.5 }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: '15px 20px', backgroundColor: 'var(--bg-surface)', borderTop: '1px solid var(--border-main)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};