import React, { useState, useRef, useMemo, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, Layers, Package, Hash, Tag, RotateCcw, Trash2, Search, CheckSquare, Square, Globe } from 'lucide-react';

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
  scopeNameMap?: Record<string, string>;
}

export const TokenizedFieldEditor: React.FC<TokenizedFieldEditorProps> = ({ values, onChange, options, addToast, scopeNameMap = {} }) => {
  const [inputValue, setInputValue] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [popoverToken, setPopoverToken] = useState<string | null>(null);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  
  // Pick List state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownSearch, setDropdownSearch] = useState('');
  const [dropdownTab, setDropdownTab] = useState<'all' | 'objects' | 'groups'>('all');
  const [dropdownPos, setDropdownPos] = useState({ bottom: 0, left: 0 });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  // Close popover and dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setPopoverToken(null);
      }
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) && !(event.target as Element).closest('.add-button-trigger')) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useLayoutEffect(() => {
    if (dropdownOpen && addButtonRef.current) {
      const rect = addButtonRef.current.getBoundingClientRect();
      setDropdownPos({
        bottom: window.innerHeight - rect.bottom,
        left: rect.right + 12
      });
    }
  }, [dropdownOpen]);
  
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

  const dropdownOptions = useMemo(() => {
    let filtered = options;
    if (dropdownTab === 'objects') {
      filtered = filtered.filter(o => o.member_list === undefined || o.member_list === null);
    } else if (dropdownTab === 'groups') {
      filtered = filtered.filter(o => o.member_list !== undefined && o.member_list !== null);
    }

    if (!dropdownSearch) return filtered;
    const q = dropdownSearch.toLowerCase();
    return filtered.filter(o => o.name.toLowerCase().includes(q) || (o.value || '').toLowerCase().includes(q));
  }, [options, dropdownSearch, dropdownTab]);

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
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', border: '1px solid var(--border-main)', borderRadius: '6px', backgroundColor: 'var(--bg-app)', overflow: 'visible' }} ref={containerRef}>
      
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

      {/* BUTTON ROW WITH PICK LIST */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', borderTop: '1px solid var(--border-main)', position: 'relative', backgroundColor: 'var(--bg-app)' }}>
        
        <button 
          onClick={() => {
            onChange(['any']);
            setDropdownOpen(false);
          }}
          style={{
            padding: '6px 16px',
            backgroundColor: 'transparent',
            color: 'var(--text-muted)',
            border: '1px solid var(--border-main)',
            borderRadius: '4px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-main)'; e.currentTarget.style.borderColor = 'var(--text-muted)'; e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-main)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          Set Any
        </button>

        <div style={{ position: 'relative' }}>
          <button 
            ref={addButtonRef}
            className="add-button-trigger"
            onClick={() => {
              setDropdownOpen(!dropdownOpen);
              setDropdownSearch('');
            }}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              padding: '6px 16px', 
              backgroundColor: 'var(--accent-blue)', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px', 
              fontSize: '13px', 
              fontWeight: 600, 
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#3b82f6'} // hover lighter
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--accent-blue)'}
          >
            <Plus size={16} /> Add
          </button>

          {dropdownOpen && createPortal(
            <div 
              ref={dropdownRef}
              style={{
                position: 'fixed',
                bottom: dropdownPos.bottom,
                left: dropdownPos.left,
                width: '320px',
                height: '400px',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-main)',
                borderRadius: '8px',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
            >
            <div style={{ padding: '12px 12px 0 12px', borderBottom: '1px solid var(--border-main)', backgroundColor: 'var(--bg-app)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>Select Object</span>
                <button 
                  onClick={() => setDropdownOpen(false)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                >
                  <X size={16} />
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--accent-blue)', borderRadius: '4px', padding: '6px 8px', backgroundColor: 'var(--bg-surface)' }}>
                <Search size={14} style={{ color: 'var(--text-muted)' }} />
                <input
                  autoFocus
                  value={dropdownSearch}
                  onChange={(e) => setDropdownSearch(e.target.value)}
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: '12px', color: 'var(--text-main)', padding: 0 }}
                  placeholder="Search objects..."
                />
                {dropdownSearch && (
                  <button 
                    onClick={() => setDropdownSearch('')}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px' }}>
                <button 
                  onClick={() => setDropdownTab('all')} 
                  style={{ background: 'none', border: 'none', borderBottom: dropdownTab === 'all' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: dropdownTab === 'all' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, padding: '4px 0', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseEnter={e => { if (dropdownTab !== 'all') e.currentTarget.style.color = 'var(--text-main)'; }}
                  onMouseLeave={e => { if (dropdownTab !== 'all') e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  All
                </button>
                <button 
                  onClick={() => setDropdownTab('objects')} 
                  style={{ background: 'none', border: 'none', borderBottom: dropdownTab === 'objects' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: dropdownTab === 'objects' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, padding: '4px 0', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseEnter={e => { if (dropdownTab !== 'objects') e.currentTarget.style.color = 'var(--text-main)'; }}
                  onMouseLeave={e => { if (dropdownTab !== 'objects') e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  Objects
                </button>
                <button 
                  onClick={() => setDropdownTab('groups')} 
                  style={{ background: 'none', border: 'none', borderBottom: dropdownTab === 'groups' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: dropdownTab === 'groups' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, padding: '4px 0', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseEnter={e => { if (dropdownTab !== 'groups') e.currentTarget.style.color = 'var(--text-main)'; }}
                  onMouseLeave={e => { if (dropdownTab !== 'groups') e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  Groups
                </button>
              </div>
            </div>
            
            <div style={{ overflowY: 'auto', flex: 1 }} className="custom-scrollbar">
              {dropdownOptions.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                  No objects found matching "{dropdownSearch}"
                </div>
              ) : (
                <>
                  {dropdownOptions.slice(0, 100).map(opt => {
                    const isGroup = opt.member_list !== undefined && opt.member_list !== null;
                    let iconColor = '#10b981'; // Green
                    if (isGroup) iconColor = '#60a5fa'; // Blue
                    
                    const scopeName = scopeNameMap[opt.device_uuid] || 'Shared';
                    const isShared = scopeName.toLowerCase().includes('shared');
                    const isAlreadyAdded = values.includes(opt.name);

                    return (
                    <div 
                      key={opt.id}
                      onClick={() => {
                        if (!isAlreadyAdded) {
                          addTokens(opt.name);
                        }
                      }}
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '12px', 
                        padding: '10px 12px', 
                        borderBottom: '1px solid rgba(255,255,255,0.02)',
                        cursor: isAlreadyAdded ? 'default' : 'pointer',
                        opacity: isAlreadyAdded ? 0.4 : 1,
                        transition: 'background-color 0.1s'
                      }}
                      onMouseEnter={e => { if (!isAlreadyAdded) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'; }}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      {isAlreadyAdded ? (
                        <div style={{ color: 'var(--accent-blue)', display: 'flex', alignItems: 'center' }}>
                          <CheckSquare size={14} />
                        </div>
                      ) : (
                        <div style={{ color: iconColor, display: 'flex', alignItems: 'center' }}>
                          {isGroup ? <Layers size={14} /> : <Package size={14} />}
                        </div>
                      )}
                      
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {opt.name}
                        </span>
                        {opt.value && (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {opt.value}
                          </span>
                        )}
                      </div>
                      
                      {scopeName && (
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '4px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          border: `1px solid ${isShared ? 'rgba(249, 115, 22, 0.3)' : 'var(--border-main)'}`,
                          color: isShared ? '#f97316' : 'var(--text-muted)',
                          backgroundColor: isShared ? 'rgba(249, 115, 22, 0.1)' : 'transparent',
                          fontSize: '10px',
                          fontWeight: 500
                        }}>
                          {isShared && <Globe size={10} />}
                          {scopeName}
                        </div>
                      )}
                    </div>
                  );
                })}
                {dropdownOptions.length > 100 && (
                  <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic', backgroundColor: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    + {(dropdownOptions.length - 100).toLocaleString()} more items. Please use search.
                  </div>
                )}
                </>
              )}
            </div>
          </div>,
          document.body
          )}
        </div>
      </div>
    </div>
  );
};
