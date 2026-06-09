import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface DropdownProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  width?: string;
  direction?: 'up' | 'down';
  renderOption?: (opt: string) => React.ReactNode;
}

export const Dropdown: React.FC<DropdownProps> = ({ value, options, onChange, width = '200px', direction = 'down', renderOption }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div 
      ref={containerRef} 
      style={{ position: 'relative', width }}
      onBlur={(e) => {
        // If the newly focused element is outside this dropdown container, close it.
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
          setIsOpen(false);
        }
      }}
    >
      <div
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(!isOpen);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!isOpen) setIsOpen(true);
            setTimeout(() => {
              const firstOption = containerRef.current?.querySelector('.dropdown-option') as HTMLElement;
              if (firstOption) firstOption.focus();
            }, 0);
          } else if (e.key === 'Escape') {
            setIsOpen(false);
          }
        }}
        style={{
          padding: '8px 12px',
          backgroundColor: 'var(--bg-app)',
          border: `1px solid ${isOpen ? 'var(--accent-blue)' : 'var(--border-main)'}`,
          borderRadius: '4px',
          color: 'var(--text-main)',
          fontSize: '13px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
          transition: 'border-color 0.2s ease'
        }}
      >
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
          {renderOption ? renderOption(value) : (value || 'Select...')}
        </div>
        <ChevronDown size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginLeft: '8px' }} />
      </div>

      {isOpen && (
        <div style={{ position: 'absolute', ...(direction === 'up' ? { bottom: '100%', marginBottom: '4px' } : { top: '100%', marginTop: '4px' }), left: 0, right: 0, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 100, overflow: 'hidden' }}>
          {options.map((opt) => (
            <div
              key={opt}
              className={`dropdown-option ${value === opt ? 'active' : ''}`}
              tabIndex={-1}
              onClick={() => {
                if (value !== opt) {
                  onChange(opt);
                }
                setIsOpen(false);
                containerRef.current?.querySelector('div')?.focus();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (value !== opt) {
                    onChange(opt);
                  }
                  setIsOpen(false);
                  containerRef.current?.querySelector('div')?.focus();
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  const next = e.currentTarget.nextElementSibling as HTMLElement;
                  if (next) next.focus();
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  const prev = e.currentTarget.previousElementSibling as HTMLElement;
                  if (prev) prev.focus();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setIsOpen(false);
                  containerRef.current?.querySelector('div')?.focus();
                }
              }}
            >
              {renderOption ? renderOption(opt) : opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};