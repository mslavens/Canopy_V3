import React, { useRef, useEffect, useState } from 'react';
import { Search, X, ChevronUp, ChevronDown, Clock, Trash2 } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface SearchBarProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  width?: string;
  variant?: 'global' | 'local';
  matchCount?: number;
  currentMatch?: number;
  onNext?: () => void;
  onPrev?: () => void;
  autoFocus?: boolean;
  onClose?: () => void;
  historyKey?: string;
  onSearch?: (val: string) => void;
  compact?: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({ 
  value, 
  onChange, 
  placeholder = 'Search...', 
  width = '300px', 
  variant = 'local',
  matchCount,
  currentMatch = 0,
  onNext,
  onPrev,
  autoFocus = false,
  onClose,
  historyKey,
  onSearch,
  compact = false
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const compactContainerRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isCompactExpanded, setIsCompactExpanded] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (compactContainerRef.current && !compactContainerRef.current.contains(e.target as Node)) {
        setIsCompactExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (historyKey) {
      try {
        const stored = localStorage.getItem(`search-history-${historyKey}`);
        if (stored) {
          setHistory(JSON.parse(stored));
        } else {
          setHistory([]);
        }
      } catch (e) {
        console.error('Failed to load search history', e);
        setHistory([]);
      }
    } else {
      setHistory([]);
    }
  }, [historyKey]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(event.target as Node) && inputRef.current && !inputRef.current.contains(event.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const saveHistory = (query: string) => {
    if (!historyKey || !query.trim()) return;
    const trimmed = query.trim();
    setHistory(prev => {
      const filtered = prev.filter(item => item !== trimmed);
      const next = [trimmed, ...filtered].slice(0, 10);
      try {
        localStorage.setItem(`search-history-${historyKey}`, JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save search history', e);
      }
      return next;
    });
  };

  const clearHistory = () => {
    if (!historyKey) return;
    setHistory([]);
    try {
      localStorage.removeItem(`search-history-${historyKey}`);
    } catch (e) {}
  };

  const handleClear = () => {
    if (historyKey && value.trim()) {
      saveHistory(value);
    }
    onChange('');
    inputRef.current?.focus(); // Best practice: return focus to input after clearing
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (historyKey && value.trim()) {
        saveHistory(value);
      }
      if (onSearch) {
        onSearch(value);
      }
      setShowHistory(false);
    }

    // Only intercept these keys if we are in "local" search mode with active matches
    if (matchCount !== undefined && matchCount > 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          onPrev?.();
        } else {
          onNext?.();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        onNext?.();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        onPrev?.();
      }
    }
  };

  // Intercept Ctrl+F / Cmd+F to focus the local search bar if it's currently visible on screen
  useEffect(() => {
    const handleGlobalCtrlF = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (variant === 'local' && inputRef.current) {
          const rect = inputRef.current.getBoundingClientRect();
          // Ensure the search bar is actually visible on the viewport (e.g. not hidden in a closed sliding drawer)
          const isVisible = rect.width > 0 && rect.height > 0 && rect.left < window.innerWidth && rect.right > 0;
          
          if (isVisible) {
            e.preventDefault();
            inputRef.current.focus();
            inputRef.current.select(); // Highlight existing text for quick replacement
          }
        }
      }
    };

    document.addEventListener('keydown', handleGlobalCtrlF);
    return () => document.removeEventListener('keydown', handleGlobalCtrlF);
  }, [variant]);

  const bgColor = variant === 'global' ? 'var(--bg-app)' : 'var(--bg-surface)';
  const fontSize = variant === 'global' ? '12px' : '13px';
  const hasXButton = !!onClose || !!value;
  const showMatchCount = !!value && matchCount !== undefined;
  const paddingRight = showMatchCount ? '105px' : (hasXButton ? '28px' : '12px');
  const padding = variant === 'global' ? `6px ${paddingRight} 6px 32px` : `8px ${paddingRight} 8px 32px`;

  return (
    <div ref={compactContainerRef} style={{ position: 'relative', display: 'flex' }}>
      {compact && (
        <Tooltip content="Search" disabled={isCompactExpanded}>
          <button 
            onClick={() => {
              setIsCompactExpanded(!isCompactExpanded);
              if (!isCompactExpanded) {
                setTimeout(() => inputRef.current?.focus(), 50);
              }
            }}
            aria-label="Search"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isCompactExpanded ? 'var(--bg-element)' : 'transparent', border: '1px solid var(--border-main)',
              borderRadius: '6px', color: 'var(--text-main)', cursor: 'pointer',
              padding: '6px', transition: 'all 0.2s', minWidth: '30px', height: '30px'
            }}
          >
            <Search size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </Tooltip>
      )}

      {(!compact || isCompactExpanded) && (
        <div style={compact ? {
          position: 'absolute', top: '100%', right: 0, marginTop: '8px', zIndex: 3000, width: '300px'
        } : { width: '100%', display: 'flex' }}>
          <div style={{ position: 'relative', width, display: 'flex', alignItems: 'center', boxShadow: compact ? '0 4px 12px rgba(0,0,0,0.2)' : 'none', borderRadius: '4px' }}>
            <div style={{ position: 'absolute', left: '10px', display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}>
        <Search size={14} />
      </div>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (historyKey && !showHistory) setShowHistory(true);
        }}
        onKeyDown={handleKeyDown}
        autoFocus={autoFocus}
        onFocus={() => { if (historyKey && history.length > 0) setShowHistory(true); }}
        style={{
          width: '100%', padding, borderRadius: '4px', border: '1px solid var(--border-main)',
          backgroundColor: bgColor, color: 'var(--text-main)', fontSize, outline: 'none'
        }}
      />
      {(value || onClose) && (
        <>
          {showMatchCount && (
            <div style={{
              position: 'absolute', right: '28px', top: '50%', transform: 'translateY(-50%)',
              display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '11px'
            }}>
              <span>{matchCount > 0 ? currentMatch + 1 : 0}/{matchCount}</span>
              <div style={{ display: 'flex', gap: '2px' }}>
                <button type="button" onClick={onPrev} onMouseDown={e => e.preventDefault()} style={{ background: 'var(--bg-element)', border: '1px solid var(--border-main)', borderRadius: '4px', color: 'var(--text-main)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}><ChevronUp size={12} /></button>
                <button type="button" onClick={onNext} onMouseDown={e => e.preventDefault()} style={{ background: 'var(--bg-element)', border: '1px solid var(--border-main)', borderRadius: '4px', color: 'var(--text-main)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}><ChevronDown size={12} /></button>
              </div>
              <div style={{ height: '14px', width: '1px', backgroundColor: 'var(--border-main)' }} />
            </div>
          )}

          {hasXButton && (
            <div style={{ position: 'absolute', right: '6px', display: 'flex' }}>
              <Tooltip content={onClose ? "Close" : "Clear search"} align="right">
                <button
                  type="button"
                  onClick={onClose ? onClose : handleClear}
                  onMouseDown={e => e.preventDefault()}
                  aria-label={onClose ? "Close" : "Clear search"}
                  style={{
                    background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', 
                    fontSize: '16px', padding: '2px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                >
                  <X size={14} />
                </button>
              </Tooltip>
            </div>
          )}
        </>
      )}

      {showHistory && !value && history.length > 0 && (
        <div ref={historyRef} style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px',
          backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)',
          borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.25)', zIndex: 1000,
          display: 'flex', flexDirection: 'column', overflow: 'hidden'
        }}>
          <div style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-main)' }}>
            Recent Searches
          </div>
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {history.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  onChange(item);
                  if (onSearch) onSearch(item);
                  saveHistory(item);
                  setShowHistory(false);
                  inputRef.current?.blur();
                }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 12px', background: 'none', border: 'none', borderBottom: idx < history.length - 1 ? '1px solid var(--border-main)' : 'none',
                  color: 'var(--text-main)', fontSize: '13px', cursor: 'pointer', textAlign: 'left'
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <Clock size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item}</span>
              </button>
            ))}
          </div>
          <div style={{ padding: '4px', borderTop: '1px solid var(--border-main)' }}>
            <button
              type="button"
              onClick={() => {
                clearHistory();
                setShowHistory(false);
                inputRef.current?.focus();
              }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                padding: '6px', background: 'none', border: 'none', borderRadius: '4px',
                color: 'var(--status-red)', fontSize: '12px', cursor: 'pointer'
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <Trash2 size={12} /> Clear History
            </button>
          </div>
        </div>
      )}
          </div>
        </div>
      )}
    </div>
  );
};