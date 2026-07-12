import React, { useRef, useEffect } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
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
  onClose
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = () => {
    onChange('');
    inputRef.current?.focus(); // Best practice: return focus to input after clearing
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
    <div style={{ position: 'relative', width, display: 'flex', alignItems: 'center' }}>
      <div style={{ position: 'absolute', left: '10px', display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}>
        <Search size={14} />
      </div>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus={autoFocus}
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
    </div>
  );
};