import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, Database, Globe, Layers, Server, ChevronDown } from 'lucide-react';
import { EmptyState } from './EmptyState';

export interface SearchableScopeDropdownProps {
  value: string;
  options: { label: string; value: string; depth: number; type: 'global' | 'shared' | 'device-group' | 'firewall' }[];
  onChange: (value: string) => void;
  scopeNameMap: Record<string, string>;
}

export const SearchableScopeDropdown: React.FC<SearchableScopeDropdownProps> = ({ value, options, onChange, scopeNameMap }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 280, ready: false });

  const updateCoords = () => {
    if (dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
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
      setCoords(prev => ({ ...prev, ready: false }));
    }
    return () => {
      window.removeEventListener('resize', updateCoords);
      window.removeEventListener('scroll', updateCoords, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && coords.ready) {
      setTimeout(() => {
        const menu = document.querySelector('.portal-scope-dropdown-menu');
        const activeOption = menu?.querySelector('.dropdown-option-row.active') as HTMLElement;
        if (activeOption) {
          activeOption.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
      }, 50);
    }
  }, [isOpen, coords.ready]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        const portalDropdown = document.querySelector('.portal-scope-dropdown-menu');
        if (portalDropdown && portalDropdown.contains(e.target as Node)) {
          return;
        }
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value);

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const q = searchQuery.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, searchQuery]);

  const dropdownMenu = (isOpen && coords.ready) ? (
    <div
      className="portal-scope-dropdown-menu"
      style={{
        position: 'absolute',
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        width: `${coords.width}px`,
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-main)',
        borderRadius: '4px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        maxHeight: '320px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100005
      }}
    >
      {/* Options list */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
        {filteredOptions.length === 0 ? (
          <div style={{ padding: '12px' }}>
            <EmptyState icon={<Search size={24} />} title="No scopes match search" description="Try adjusting your query." minHeight="100px" />
          </div>
        ) : (
          filteredOptions.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                tabIndex={-1}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onChange(opt.value);
                    setIsOpen(false);
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
                  }
                }}
                style={{
                  padding: '8px 12px',
                  paddingLeft: `${opt.depth * 16 + 12}px`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  color: isSelected ? 'var(--text-main)' : 'var(--text-muted)',
                  backgroundColor: isSelected ? 'var(--bg-element)' : 'transparent',
                  transition: 'background-color 0.15s ease',
                  fontWeight: isSelected ? 600 : 400,
                  outline: 'none'
                }}
                className={`dropdown-option-row ${isSelected ? 'active' : ''}`}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {opt.type === 'global' && <Database size={12} className="text-accent" />}
                {opt.type === 'shared' && <Globe size={12} style={{ color: 'var(--accent-blue)' }} />}
                {opt.type === 'device-group' && <Layers size={12} />}
                {opt.type === 'firewall' && <Server size={12} style={{ color: 'var(--text-muted)' }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {opt.label}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  ) : null;

  return (
    <div ref={dropdownRef} style={{ position: 'relative', width: '280px', zIndex: 900 }}>
      <div
        onClick={() => {
          if (!isOpen) {
            setIsOpen(true);
            setSearchQuery('');
          }
        }}
        style={{
          height: '34px',
          padding: '0 12px',
          backgroundColor: 'var(--bg-app)',
          border: `1px solid ${isOpen ? 'var(--accent-blue)' : 'var(--border-main)'}`,
          borderRadius: '4px',
          color: 'var(--text-main)',
          fontSize: '13px',
          cursor: isOpen ? 'text' : 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
          transition: 'border-color 0.2s ease',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {isOpen ? (
            <>
              <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={selectedOption ? selectedOption.label : 'Search scope...'}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsOpen(false);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setTimeout(() => {
                      const menu = document.querySelector('.portal-scope-dropdown-menu');
                      const firstOption = menu?.querySelector('.dropdown-option-row') as HTMLElement;
                      if (firstOption) firstOption.focus();
                    }, 50);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (filteredOptions.length > 0) {
                      onChange(filteredOptions[0].value);
                      setIsOpen(false);
                    }
                  }
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-main)',
                  fontSize: '13px',
                  fontWeight: 500,
                  outline: 'none',
                  padding: 0,
                  margin: 0,
                  width: '100%'
                }}
              />
            </>
          ) : (
            <>
              {selectedOption?.type === 'global' && <Database size={13} className="text-accent" />}
              {selectedOption?.type === 'shared' && <Globe size={13} style={{ color: 'var(--accent-blue)' }} />}
              {selectedOption?.type === 'device-group' && <Layers size={13} />}
              {selectedOption?.type === 'firewall' && <Server size={13} style={{ color: 'var(--text-muted)' }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                {selectedOption ? selectedOption.label : 'Select scope...'}
              </span>
            </>
          )}
        </div>
        <ChevronDown
          size={14}
          style={{ color: 'var(--text-muted)', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease', cursor: 'pointer' }}
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
