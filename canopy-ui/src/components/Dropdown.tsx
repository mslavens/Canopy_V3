import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

interface DropdownProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  width?: string;
  direction?: 'up' | 'down';
  renderOption?: (opt: string) => React.ReactNode;
  searchable?: boolean;
  variant?: 'default' | 'inline';
}

export const Dropdown: React.FC<DropdownProps> = ({ 
  value, 
  options, 
  onChange, 
  width = '200px', 
  direction = 'down', 
  renderOption,
  searchable = true,
  variant = 'default'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, maxHeight: 220, placement: 'down', ready: false });

  const updateCoords = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      let placement = direction;
      
      if (placement === 'down' && spaceBelow < 240 && spaceAbove > spaceBelow) {
        placement = 'up';
      } else if (placement === 'up' && spaceAbove < 240 && spaceBelow > spaceAbove) {
        placement = 'down';
      }

      let top = 0;
      let maxHeight = 220;

      if (placement === 'down') {
        top = rect.bottom + window.scrollY + 4;
        maxHeight = Math.min(220, Math.max(100, spaceBelow - 16));
      } else {
        top = rect.top + window.scrollY - 4;
        maxHeight = Math.min(220, Math.max(100, spaceAbove - 16));
      }

      setCoords({
        top,
        left: rect.left + window.scrollX,
        width: rect.width,
        maxHeight,
        placement,
        ready: true
      });
    }
  };

  useEffect(() => {
    if (isOpen) {
      updateCoords();
      window.addEventListener('resize', updateCoords);
      window.addEventListener('scroll', updateCoords, true);
    } else {
      setSearchQuery('');
      setCoords(prev => ({ ...prev, ready: false }));
    }
    return () => {
      window.removeEventListener('resize', updateCoords);
      window.removeEventListener('scroll', updateCoords, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        const input = document.querySelector('.portal-dropdown-menu input') as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 50);
    }
  }, [isOpen, coords.ready]);

  useEffect(() => {
    if (isOpen && coords.ready) {
      setTimeout(() => {
        const menu = document.querySelector('.portal-dropdown-menu');
        const activeOption = menu?.querySelector('.dropdown-option.active') as HTMLElement;
        if (activeOption) {
          activeOption.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
      }, 50);
    }
  }, [isOpen, coords.ready]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        const portalDropdowns = document.querySelectorAll('.portal-dropdown-menu');
        let clickedInsidePortal = false;
        portalDropdowns.forEach(el => {
          if (el.contains(event.target as Node)) clickedInsidePortal = true;
        });
        if (!clickedInsidePortal) {
          setIsOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = searchable 
    ? options.filter(opt => opt.toLowerCase().includes(searchQuery.toLowerCase()))
    : options;

  const dropdownMenu = (isOpen && coords.ready) ? (
    <div 
      className="portal-dropdown-menu"
      style={{ 
        position: 'absolute', 
        top: `${coords.top}px`, 
        left: `${coords.left}px`, 
        width: `${coords.width}px`, 
        backgroundColor: 'var(--bg-surface)', 
        border: '1px solid var(--border-main)', 
        borderRadius: '4px', 
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)', 
        zIndex: 100000, 
        maxHeight: `${coords.maxHeight}px`,
        overflowY: 'auto',
        color: 'var(--text-main)',
        transform: coords.placement === 'up' ? 'translateY(-100%)' : 'none',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {searchable && (
        <div style={{ padding: '8px', borderBottom: '1px solid var(--border-main)', backgroundColor: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 1 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                const firstOption = document.querySelector('.portal-dropdown-menu .dropdown-option') as HTMLElement;
                if (firstOption) firstOption.focus();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setIsOpen(false);
                containerRef.current?.querySelector('div')?.focus();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (filteredOptions.length > 0) {
                  onChange(filteredOptions[0]);
                  setIsOpen(false);
                  containerRef.current?.querySelector('div')?.focus();
                }
              }
            }}
            placeholder="Search..."
            autoFocus
            style={{
              width: '100%',
              padding: '6px 8px',
              fontSize: '12px',
              border: '1px solid var(--border-main)',
              borderRadius: '4px',
              backgroundColor: 'var(--bg-base)',
              color: 'var(--text-main)',
              outline: 'none'
            }}
          />
        </div>
      )}

      <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
        {filteredOptions.length === 0 ? (
          <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>
            No options found
          </div>
        ) : (
          filteredOptions.map((opt) => (
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
                  if (prev) {
                    prev.focus();
                  } else {
                    const input = document.querySelector('.portal-dropdown-menu input') as HTMLInputElement;
                    if (input) input.focus();
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setIsOpen(false);
                  containerRef.current?.querySelector('div')?.focus();
                }
              }}
            >
              {renderOption ? renderOption(opt) : opt}
            </div>
          ))
        )}
      </div>
    </div>
  ) : null;

  return (
    <div 
      ref={containerRef} 
      style={{ position: 'relative', width }}
      onBlur={(e) => {
        setTimeout(() => {
          const activeEl = document.activeElement;
          const isInsidePortal = activeEl && activeEl.closest('.portal-dropdown-menu');
          if (!containerRef.current?.contains(activeEl) && !isInsidePortal) {
            setIsOpen(false);
          }
        }, 50);
      }}
    >
      <div
        tabIndex={searchable && isOpen ? -1 : 0}
        onClick={() => {
          if (!isOpen) {
            setIsOpen(true);
          }
        }}
        onKeyDown={(e) => {
          if (searchable && isOpen) return; // input handles keydown
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(!isOpen);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!isOpen) setIsOpen(true);
            setTimeout(() => {
              const menu = document.querySelector('.portal-dropdown-menu');
              const firstOption = menu?.querySelector('.dropdown-option') as HTMLElement;
              if (firstOption) firstOption.focus();
            }, 50);
          } else if (e.key === 'Escape') {
            setIsOpen(false);
          }
        }}
        style={{
          padding: variant === 'inline' ? '2px 8px' : '8px 12px',
          backgroundColor: variant === 'inline' ? 'transparent' : 'var(--bg-app)',
          border: variant === 'inline' ? 'none' : `1px solid ${isOpen ? 'var(--accent-blue)' : 'var(--border-main)'}`,
          borderRadius: '4px',
          color: 'var(--text-main)',
          fontSize: variant === 'inline' ? '12px' : '13px',
          fontWeight: variant === 'inline' ? 600 : 400,
          cursor: searchable && isOpen ? 'text' : 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
          transition: 'border-color 0.2s ease',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
          {searchable && isOpen ? (
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={typeof value === 'string' && value ? value : 'Search...'}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsOpen(false);
                  containerRef.current?.focus();
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setTimeout(() => {
                    const menu = document.querySelector('.portal-dropdown-menu');
                    const firstOption = menu?.querySelector('.dropdown-option') as HTMLElement;
                    if (firstOption) firstOption.focus();
                  }, 50);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  // If there are filtered options, select the first one on enter
                  if (filteredOptions.length > 0) {
                    onChange(filteredOptions[0]);
                    setIsOpen(false);
                    setSearchQuery('');
                  } else if (searchQuery.trim().length > 0) {
                    // Allow free-form entry if no matching options exist
                    onChange(searchQuery.trim());
                    setIsOpen(false);
                    setSearchQuery('');
                  }
                }
              }}
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-main)',
                fontSize: '13px',
                outline: 'none',
                padding: 0,
                margin: 0
              }}
            />
          ) : (
            renderOption ? renderOption(value) : (value || 'Select...')
          )}
        </div>
        <ChevronDown 
          size={16} 
          style={{ color: 'var(--text-muted)', flexShrink: 0, marginLeft: '8px', cursor: 'pointer' }}
          onClick={(e) => {
            if (isOpen) {
              e.stopPropagation();
              setIsOpen(false);
            }
          }}
        />
      </div>

      {isOpen && dropdownMenu && createPortal(dropdownMenu, document.body)}
    </div>
  );
};