import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Plus, X, Layers, Package, Hash, Tag, RotateCcw, Trash2, Search, CheckSquare, Square } from 'lucide-react';

interface ObjectRef {
  id: number;
  name: string;
  device_uuid: string;
  type: string;
  value?: string;
  member_list?: string;
}

interface TokenizedFieldEditorProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: ObjectRef[];
  addToast?: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const TokenizedFieldEditor: React.FC<TokenizedFieldEditorProps> = ({ values, onChange, options, addToast }) => {
  const [inputValue, setInputValue] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [popoverToken, setPopoverToken] = useState<string | null>(null);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setPopoverToken(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const optionsMap = useMemo(() => {
    const map = new Map<string, ObjectRef>();
    options.forEach(o => {
      map.set(o.name, o);
    });
    return map;
  }, [options]);

  const visibleValues = useMemo(() => {
    if (!filterQuery) return values;
    const q = filterQuery.toLowerCase();
    return values.filter(v => v.toLowerCase().includes(q) || (optionsMap.get(v)?.value || '').toLowerCase().includes(q));
  }, [values, filterQuery, optionsMap]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTokens(inputValue);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    addTokens(pastedText);
  };

  const addTokens = (rawText: string) => {
    const newTokens = rawText.split(/[\n,]+/).map(t => t.trim()).filter(t => t.length > 0);
    if (newTokens.length === 0) return;
    
    const nextValues = [...values];
    newTokens.forEach(t => {
      if (!nextValues.includes(t)) nextValues.push(t);
    });
    
    onChange(nextValues);
    setInputValue('');
  };

  const removeToken = (tokenToRemove: string) => {
    onChange(values.filter(v => v !== tokenToRemove));
    const nextSelected = new Set(selectedTokens);
    nextSelected.delete(tokenToRemove);
    setSelectedTokens(nextSelected);
    setPopoverToken(null);
  };

  const bulkRemoveSelected = () => {
    if (selectedTokens.size === 0) return;
    onChange(values.filter(v => !selectedTokens.has(v)));
    setSelectedTokens(new Set());
    setPopoverToken(null);
  };

  const toggleSelectAll = () => {
    if (selectedTokens.size === visibleValues.length && visibleValues.length > 0) {
      setSelectedTokens(new Set());
    } else {
      setSelectedTokens(new Set(visibleValues));
    }
  };

  const toggleSelectToken = (token: string) => {
    const next = new Set(selectedTokens);
    if (next.has(token)) next.delete(token);
    else next.add(token);
    setSelectedTokens(next);
  };

  const getDeepMembers = (groupName: string): string[] => {
    const members = new Set<string>();
    const visit = (name: string, visited = new Set<string>()) => {
      if (visited.has(name)) return;
      visited.add(name);
      const opt = optionsMap.get(name);
      if (opt && opt.member_list) {
        opt.member_list.split(',').forEach(m => visit(m.trim(), visited));
      } else {
        members.add(name);
      }
    };
    visit(groupName);
    return Array.from(members);
  };

  const handleExpandMembers = (token: string) => {
    const opt = optionsMap.get(token);
    if (!opt || !opt.member_list) return;

    const membersToAdd = getDeepMembers(token);
    const existingSet = new Set(values);
    existingSet.delete(token);

    let skipped = 0;
    let removed = 0;
    
    const membersCoverage = new Set<string>();
    membersToAdd.forEach(m => {
      membersCoverage.add(m);
      getDeepMembers(m).forEach(child => membersCoverage.add(child));
    });

    const finalExisting = new Set<string>();
    existingSet.forEach(val => {
      if (membersCoverage.has(val)) {
        removed++;
      } else {
        finalExisting.add(val);
      }
    });

    const existingCoverage = new Set<string>();
    finalExisting.forEach(val => {
      existingCoverage.add(val);
      getDeepMembers(val).forEach(child => existingCoverage.add(child));
    });

    const finalMembersToAdd = new Set<string>();
    membersToAdd.forEach(m => {
      if (existingCoverage.has(m)) {
        skipped++; 
      } else {
        finalMembersToAdd.add(m);
      }
    });

    finalMembersToAdd.forEach(m => finalExisting.add(m));
    onChange(Array.from(finalExisting));
    
    const nextSelected = new Set(selectedTokens);
    nextSelected.delete(token);
    setSelectedTokens(nextSelected);
    setPopoverToken(null);
    
    const msgs = [`Added ${finalMembersToAdd.size} items`];
    if (skipped > 0) msgs.push(`${skipped} skipped (overlap)`);
    if (removed > 0) msgs.push(`${removed} removed (redundant)`);
    
    if (addToast) {
      addToast(`Expanded ${token}: ${msgs.join(', ')}`, 'success');
    }
  };

  const isAllVisibleSelected = visibleValues.length > 0 && selectedTokens.size === visibleValues.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', border: '1px solid var(--border-main)', borderRadius: '6px', backgroundColor: 'var(--bg-app)', overflow: 'hidden' }} ref={containerRef}>
      
      {/* TOOLBAR */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', borderBottom: '1px solid var(--border-main)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
        <button onClick={toggleSelectAll} style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          {isAllVisibleSelected ? <CheckSquare size={16} style={{ color: 'var(--accent-blue)' }} /> : <Square size={16} />}
        </button>
        
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--border-main)', borderRadius: '4px', padding: '4px 8px', backgroundColor: 'var(--bg-surface)' }}>
          <Search size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: '12px', color: 'var(--text-main)', padding: 0 }}
            placeholder="Filter selected..."
          />
        </div>

        {selectedTokens.size > 0 && (
          <button 
            onClick={bulkRemoveSelected} 
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', color: 'var(--status-red)', cursor: 'pointer', fontSize: '12px', padding: '4px 8px', borderRadius: '4px' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <Trash2 size={14} /> Remove ({selectedTokens.size})
          </button>
        )}
      </div>

      {/* LIST VIEW */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }} className="custom-scrollbar">
        {visibleValues.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '12px', padding: '32px' }}>
            {values.length === 0 ? 'No inputs. Add some below.' : 'No items match your filter.'}
          </div>
        )}
        
        {visibleValues.map((val) => {
          const opt = optionsMap.get(val);
          const isGroup = opt?.member_list !== undefined && opt.member_list !== null;
          const isObject = opt !== undefined && !isGroup;
          
          let iconColor = 'var(--text-muted)';
          if (isGroup) iconColor = '#60a5fa';
          else if (isObject) iconColor = '#10b981'; // Canopy 1.0 style green for object

          const isSelected = selectedTokens.has(val);

          return (
            <div 
              key={val} 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px', 
                padding: '8px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.05)' : 'transparent',
                position: 'relative'
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = isSelected ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255,255,255,0.03)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = isSelected ? 'rgba(56, 189, 248, 0.05)' : 'transparent'}
            >
              <button 
                onClick={() => toggleSelectToken(val)} 
                style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                {isSelected ? <CheckSquare size={16} style={{ color: 'var(--accent-blue)' }} /> : <Square size={16} />}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, overflow: 'hidden' }}>
                <span style={{ color: iconColor, display: 'flex', alignItems: 'center' }}>
                  {isGroup ? <Layers size={14} /> : isObject ? <Package size={14} /> : <Hash size={14} />}
                </span>
                
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                  {val}
                </span>

                {opt && opt.value && (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    [{opt.value}]
                  </span>
                )}
              </div>

              {isGroup && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPopoverToken(popoverToken === val ? null : val);
                  }}
                  style={{ background: 'transparent', border: 'none', padding: '4px', color: 'var(--accent-blue)', cursor: 'pointer', borderRadius: '4px' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.1)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  title="Expand to Members"
                >
                  <Layers size={14} />
                </button>
              )}

              {/* EXPANSION POPOVER */}
              {popoverToken === val && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: '12px',
                  width: '260px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-main)',
                  borderRadius: '6px',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                  zIndex: 50,
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-main)', paddingBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{val}</span>
                    <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Group</span>
                  </div>
                  
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExpandMembers(val);
                    }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      backgroundColor: 'rgba(217, 119, 6, 0.1)',
                      border: '1px solid rgba(217, 119, 6, 0.3)',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#fbbf24',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(217, 119, 6, 0.2)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(217, 119, 6, 0.1)'}
                  >
                    <RotateCcw size={14} /> Expand to Members
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* INPUT ROW */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px', borderTop: '1px solid var(--border-main)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
        <Plus size={16} style={{ color: 'var(--text-muted)', marginRight: '8px' }} />
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={() => {
            if (inputValue.trim()) addTokens(inputValue);
          }}
          style={{
            flex: 1,
            background: 'transparent',
            outline: 'none',
            border: 'none',
            fontSize: '13px',
            fontFamily: 'monospace',
            color: 'var(--text-main)',
            padding: 0
          }}
          placeholder="Paste IPs, CIDRs, or Object names..."
          autoComplete="off"
        />
      </div>
    </div>
  );
};
