import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, Database, Globe, Layers, Server, ChevronDown, FileText } from 'lucide-react';
import { EmptyState } from './EmptyState';

export interface SearchableScopeDropdownProps {
  value: string;
  options: { label: string; value: string; depth: number; type: 'global' | 'shared' | 'device-group' | 'firewall' | 'template' | 'template-stack' }[];
  onChange: (value: string) => void;
  scopeNameMap: Record<string, string>;
  ruleCounts?: Record<string, number>;
  hasValuesMap?: Record<string, boolean>;
}

export const SearchableScopeDropdown: React.FC<SearchableScopeDropdownProps> = ({ value, options, onChange, scopeNameMap, ruleCounts, hasValuesMap }) => {
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
    let result = options;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matches = options.filter(o => o.label.toLowerCase().includes(q) || o.value === 'show-all');
      
      const seen = new Set<string>();
      result = matches.filter(opt => {
        if (opt.value === 'show-all') return true;
        if (seen.has(opt.value)) return false;
        seen.add(opt.value);
        return true;
      });
    }
    
    const showAllIndex = result.findIndex(o => o.value === 'show-all');
    if (showAllIndex > 0) {
      const showAllOpt = result[showAllIndex];
      const withoutShowAll = result.filter(o => o.value !== 'show-all');
      return [showAllOpt, ...withoutShowAll];
    }
    return result;
  }, [options, searchQuery]);

  const showAllOption = filteredOptions.find(o => o.value === 'show-all');
  const scrollableOptions = filteredOptions.filter(o => o.value !== 'show-all');

  const lastOption = scrollableOptions[scrollableOptions.length - 1];
  const lastDepth = lastOption ? lastOption.depth : 0;
  // Container inner height is ~269px. We use 268px to perfectly align exactly beneath the 1px sticky box-shadow.
  const calculatedPaddingBottom = Math.max(0, 268 - ((lastDepth + 1) * 32));

  const renderOptionNode = (opt: SearchableScopeDropdownProps['options'][0], overrideSticky?: boolean) => {
    const isSelected = opt.value === value;
    const isHeader = opt.value.startsWith('header-');
    const isSticky = overrideSticky !== undefined ? overrideSticky : (!searchQuery && opt.type !== 'firewall');
    return (
      <div
        key={opt.value}
        tabIndex={-1}
        onClick={() => {
          if (isHeader) return;
          onChange(opt.value);
          setIsOpen(false);
        }}
        onKeyDown={(e) => {
          if (isHeader) return;
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
          height: '32px',
          boxSizing: 'border-box',
          padding: '0 12px',
          paddingLeft: searchQuery ? '12px' : `${opt.depth * 16 + 12}px`,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          cursor: isHeader ? 'default' : 'pointer',
          fontSize: '12px',
          color: isHeader ? 'var(--text-muted)' : (isSelected ? 'var(--text-main)' : 'var(--text-muted)'),
          backgroundColor: isSelected && !isHeader ? 'var(--bg-element)' : 'var(--bg-surface)',
          transition: 'background-color 0.15s ease',
          fontWeight: isSelected || isHeader ? 600 : 400,
          textTransform: isHeader ? 'uppercase' : 'none',
          letterSpacing: isHeader ? '0.5px' : 'normal',
          outline: 'none',
          ...(isSticky ? {
            position: 'sticky',
            top: `${opt.depth * 32}px`,
            zIndex: 20 - opt.depth,
            borderBottom: 'none',
            boxShadow: `0 1px 0 ${isSelected && !isHeader ? 'var(--bg-element)' : 'var(--bg-surface)'}`
          } : {})
        }}
        className={`dropdown-option-row ${isSelected && !isHeader ? 'active' : ''}`}
        data-depth={opt.depth}
        onMouseEnter={(e) => { if (!isHeader) e.currentTarget.style.backgroundColor = 'var(--bg-element)'; }}
        onMouseLeave={(e) => { if (!isSelected || isHeader) e.currentTarget.style.backgroundColor = 'var(--bg-surface)'; }}
      >
        {opt.type === 'global' && !isHeader && <Database size={12} className="text-accent" />}
        {opt.type === 'shared' && !isHeader && <Globe size={12} style={{ color: 'var(--accent-blue)' }} />}
        {opt.type === 'device-group' && <Layers size={12} style={{ color: 'var(--accent-purple)' }} />}
        {opt.type === 'template-stack' && <Layers size={12} style={{ color: 'var(--accent-blue)' }} />}
        {opt.type === 'template' && <FileText size={12} style={{ color: 'var(--text-muted)' }} />}
        {opt.type === 'firewall' && <Server size={12} style={{ color: 'var(--text-muted)' }} />}
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '6px' }}>
          {opt.label}
          {hasValuesMap && hasValuesMap[opt.value] && (
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--accent-blue)', flexShrink: 0 }} title="Has configured values" />
          )}
        </span>
        {ruleCounts && ruleCounts[opt.value] !== undefined && ruleCounts[opt.value] > 0 && (
          <span style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            fontWeight: 600,
            marginLeft: 'auto',
            fontFamily: 'var(--font-mono, monospace)',
            letterSpacing: '0.5px'
          }}>
            [{ruleCounts[opt.value]}]
          </span>
        )}
      </div>
    );
  };

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
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100005,
        padding: '4px 0',
        overflow: 'hidden'
      }}
    >
      {showAllOption && (
        <div style={{ borderBottom: '1px solid var(--border-main)', paddingBottom: '4px', marginBottom: '4px', zIndex: 100, flexShrink: 0 }}>
          {renderOptionNode(showAllOption, false)}
        </div>
      )}
      {/* Options list */}
      <div 
        className="portal-scope-dropdown-scroll" 
        style={{ overflowY: 'scroll', flex: 1, paddingBottom: `${calculatedPaddingBottom}px` }}
        ref={(node) => {
          if (node && !node.dataset.scrolled) {
            const selectedIndex = scrollableOptions.findIndex(o => o.value === value);
            if (selectedIndex !== -1) {
              const depth = scrollableOptions[selectedIndex].depth;
              node.scrollTop = (selectedIndex - depth) * 32;
            }
            node.dataset.scrolled = 'true';
          }
        }}
      >
        {scrollableOptions.length === 0 ? (
          <div style={{ padding: '12px' }}>
            <EmptyState icon={<Search size={24} />} title="No scopes match search" description="Try adjusting your query." minHeight="100px" />
          </div>
        ) : (
          searchQuery ? (
            scrollableOptions.map(opt => renderOptionNode(opt))
          ) : (
            (() => {
              const rootNodes: { opt: SearchableScopeDropdownProps['options'][0]; children: any[] }[] = [];
              const stack: { opt: SearchableScopeDropdownProps['options'][0]; children: any[] }[] = [];

              for (const opt of scrollableOptions) {
                const node = { opt, children: [] };
                while (stack.length > 0 && stack[stack.length - 1].opt.depth >= opt.depth) {
                  stack.pop();
                }
                if (stack.length === 0) {
                  rootNodes.push(node);
                } else {
                  stack[stack.length - 1].children.push(node);
                }
                stack.push(node);
              }

              const renderTree = (nodes: any[]): React.ReactNode => {
                return nodes.map(node => (
                  <div key={node.opt.value} style={{ display: 'flex', flexDirection: 'column' }}>
                    {renderOptionNode(node.opt)}
                    {node.children.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {renderTree(node.children)}
                      </div>
                    )}
                  </div>
                ));
              };

              return renderTree(rootNodes);
            })()
          )
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
              {(selectedOption?.type === 'device-group' || selectedOption?.type === 'template-stack') && <Layers size={13} />}
              {selectedOption?.type === 'template' && <Layers size={13} style={{ color: 'var(--text-muted)' }} />}
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
