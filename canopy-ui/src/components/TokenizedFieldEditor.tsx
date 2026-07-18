import React, { useState, useRef, useMemo, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, Layers, Package, Hash, Tag, RotateCcw, Trash2, Search, CheckSquare, Square, Globe, Zap, ChevronRight } from 'lucide-react';

interface ObjectRef {
  id: number;
  name: string;
  device_uuid: string;
  type: string;
  value?: string;
  member_list?: string;
}

const ipToInt = (ip: string) => {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const num = parts.reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  return num;
};

const isIpInCidr = (ip: string, cidr: string) => {
  const ipNum = ipToInt(ip);
  if (ipNum === null) return false;
  const [network, bits] = cidr.split('/');
  if (!network || !bits) return false;
  const netNum = ipToInt(network);
  if (netNum === null) return false;
  const maskBits = parseInt(bits, 10);
  if (isNaN(maskBits) || maskBits < 0 || maskBits > 32) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
};

const ConfirmSwapModal = ({ dialogData, onConfirm, onCancel }: any) => {
  const [excluded, setExcluded] = useState(new Set<string>());
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
      <div style={{ width: '450px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '8px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--text-main)' }}>Confirm Swap</h3>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ padding: '20px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Are you sure you want to swap <strong style={{ color: 'var(--accent-blue)' }}>{dialogData.oldVal}</strong> for <strong style={{ color: '#a78bfa' }}>{dialogData.newVal}</strong>?
          {dialogData.redundantItems.length > 0 && (
            <>
              <div style={{ marginTop: '12px', marginBottom: '8px', color: 'var(--text-main)' }}>The following items are already covered by {dialogData.newVal} and will be removed:</div>
              <div style={{ border: '1px solid var(--border-main)', borderRadius: '6px', maxHeight: '180px', overflowY: 'auto', backgroundColor: 'var(--bg-surface)' }}>
                {dialogData.redundantItems.map((item: string) => {
                  const isKept = excluded.has(item);
                  return (
                    <label key={item} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: '1px solid var(--border-main)', cursor: 'pointer', backgroundColor: isKept ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                      <input type="checkbox" checked={!isKept} onChange={(e) => {
                        const next = new Set(excluded);
                        if (e.target.checked) next.delete(item);
                        else next.add(item);
                        setExcluded(next);
                      }} />
                      <span style={{ textDecoration: !isKept ? 'line-through' : 'none', color: !isKept ? 'var(--status-red)' : 'var(--text-main)' }}>{item}</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-main)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'rgba(255,255,255,0.02)' }}>
          <button onClick={onCancel} style={{ padding: '6px 16px', background: 'transparent', border: '1px solid var(--border-main)', color: 'var(--text-main)', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>Cancel</button>
          <button onClick={() => onConfirm(excluded)} style={{ padding: '6px 16px', background: '#a78bfa', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>Confirm Swap</button>
        </div>
      </div>
    </div>
  );
};

interface TokenizedFieldEditorProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: ObjectRef[];
  addToast?: (message: string, type?: 'info' | 'success' | 'error') => void;
  scopeNameMap?: Record<string, string>;
  groupTolerance?: number;
}

export const TokenizedFieldEditor: React.FC<TokenizedFieldEditorProps> = ({ 
  values, 
  onChange, 
  options, 
  addToast,
  scopeNameMap = {},
  groupTolerance = 0
}) => {
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
  
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const [expandedParent, setExpandedParent] = useState<string | null>(null);
  const [inspectGroupOpen, setInspectGroupOpen] = useState(false);
  const [groupMembershipsOpen, setGroupMembershipsOpen] = useState(true);
  const [exactMatchesOpen, setExactMatchesOpen] = useState(false);
  const [subnetsOpen, setSubnetsOpen] = useState(false);
  
  const [confirmSwapDialog, setConfirmSwapDialog] = useState<{
    isOpen: boolean;
    oldVal: string;
    newVal: string;
    redundantItems: string[];
  } | null>(null);

  // Close popover and dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && popoverRef.current.contains(event.target as Node)) {
        return;
      }
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

  useLayoutEffect(() => {
    if (popoverToken) {
      const isRaw = optionsMap.get(popoverToken) === undefined;
      setInspectGroupOpen(false);
      setGroupMembershipsOpen(!isRaw);
      setExactMatchesOpen(isRaw);
      setSubnetsOpen(false);

      const rowEl = rowRefs.current.get(popoverToken);
      if (rowEl) {
        const rect = rowEl.getBoundingClientRect();
        let top = rect.top;
        if (top + 400 > window.innerHeight - 100) {
          top = Math.max(20, window.innerHeight - 500);
        }
        setPopoverPos({
          top,
          left: rect.right + 12
        });
      }
    }
  }, [popoverToken]);
  
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

    const membersToAdd = opt.member_list.split(',').map(m => m.trim());
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

  const handleSwapRawToken = (rawVal: string, objName: string) => {
    const nextValues = values.map(v => v === rawVal ? objName : v);
    const finalSet = new Set(nextValues);
    onChange(Array.from(finalSet));
    
    setPopoverToken(null);
    if (addToast) {
      addToast(`Swapped ${rawVal} for ${objName}`, 'success');
    }
  };
  
  // Clear expandedParent when popover closes
  useEffect(() => {
    if (!popoverToken) {
      setExpandedParent(null);
      setInspectGroupOpen(false);
      setGroupMembershipsOpen(true);
      setExactMatchesOpen(false);
      setSubnetsOpen(false);
    }
  }, [popoverToken]);
  
  const isDeepMember = (groupName: string, targetToken: string): boolean => {
    let found = false;
    const visit = (name: string, visited = new Set<string>()) => {
      if (found || visited.has(name)) return;
      visited.add(name);
      const opt = optionsMap.get(name);
      if (opt && opt.member_list) {
        opt.member_list.split(',').forEach(m => {
          const mTrim = m.trim();
          if (mTrim === targetToken) {
            found = true;
          } else {
            visit(mTrim, visited);
          }
        });
      }
    };
    visit(groupName);
    return found;
  };

  const renderMemberTree = (memberName: string, indent: number, currentlyCoveredLeaves: Set<string>) => {
    const mOpt = optionsMap.get(memberName);
    const isGroup = mOpt && mOpt.member_list;
    const memberLeaves = getDeepMembers(memberName);
    const isCovered = memberLeaves.length > 0 && memberLeaves.every(l => currentlyCoveredLeaves.has(l));

    return (
      <div key={memberName} style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `4px 8px 4px ${8 + indent * 16}px`, borderBottom: '1px solid rgba(255,255,255,0.05)', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
            {isGroup ? <Layers size={12} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} /> : <Package size={12} style={{ color: '#10b981', flexShrink: 0 }} />}
            <span title={`${memberName}${mOpt && mOpt.value ? `\nValue: ${mOpt.value}` : ''}`} style={{ fontSize: '11px', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{memberName}</span>
          </div>
          {isCovered 
            ? <span style={{ fontSize: '9px', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '2px 0', width: '28px', justifyContent: 'center', borderRadius: '4px', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, display: 'inline-flex' }}>✓ C</span>
            : <span style={{ fontSize: '9px', backgroundColor: 'rgba(167, 139, 250, 0.15)', color: '#a78bfa', border: '1px solid rgba(167, 139, 250, 0.3)', padding: '2px 0', width: '28px', justifyContent: 'center', borderRadius: '4px', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, display: 'inline-flex' }}>+ N</span>
          }
        </div>
        {isGroup && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {mOpt?.member_list?.split(',').map(m => renderMemberTree(m.trim(), indent + 1, currentlyCoveredLeaves))}
          </div>
        )}
      </div>
    );
  };

  const getParentGroups = (token: string): ObjectRef[] => {
    return options.filter(o => o.member_list && isDeepMember(o.name, token));
  };
  
  const handleSwapGroup = (oldVal: string, newVal: string) => {
    const groupCoverage = new Set(getDeepMembers(newVal));
    const current = values.filter(v => v !== oldVal);
    const redundantItems: string[] = [];
    current.forEach(v => {
      const vLeaves = getDeepMembers(v);
      if (vLeaves.length > 0 && vLeaves.every(l => groupCoverage.has(l))) {
        redundantItems.push(v);
      }
    });

    if (redundantItems.length > 0) {
      setConfirmSwapDialog({ isOpen: true, oldVal, newVal, redundantItems });
      setPopoverToken(null);
    } else {
      const finalCleaned = [...current, newVal];
      onChange(finalCleaned);
      setPopoverToken(null);
      if (addToast) addToast(`Swapped ${oldVal} for ${newVal}`, 'success');
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
          const isRaw = opt === undefined;
          
          const valIp = opt?.value || val;
          let matchingObjects = options.filter(o => !o.member_list && o.value === valIp && o.name !== val);
          let matchingCidrs: ObjectRef[] = [];
          if (!valIp.includes('/')) {
            matchingCidrs = options.filter(o => !o.member_list && o.value && o.value.includes('/') && isIpInCidr(valIp, o.value) && o.name !== val);
          }
          
          let iconColor = 'var(--text-muted)';
          if (isGroup) iconColor = '#60a5fa';
          else if (isObject) iconColor = '#10b981'; // Canopy 1.0 style green for object

          const isSelected = selectedTokens.has(val);

          return (
            <div 
              key={val} 
              ref={(el) => {
                if (el) rowRefs.current.set(val, el);
                else rowRefs.current.delete(val);
              }}
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

              {(() => {
                let parentsCount = 0;
                if (!isRaw) {
                  const currentlyCoveredLeaves = new Set<string>();
                  values.forEach(v => {
                    getDeepMembers(v).forEach(l => currentlyCoveredLeaves.add(l));
                  });
                  getDeepMembers(val).forEach(l => currentlyCoveredLeaves.add(l));

                  const parents = getParentGroups(val).filter(parent => {
                     const leaves = getDeepMembers(parent.name);
                     let coveredLeavesCount = 0;
                     leaves.forEach(l => {
                       if (currentlyCoveredLeaves.has(l)) coveredLeavesCount++;
                     });
                     const toleranceRatio = leaves.length > 0 ? coveredLeavesCount / leaves.length : 0;
                     return toleranceRatio >= groupTolerance;
                  });
                  parentsCount = parents.length;
                }

                const totalInsights = parentsCount + matchingObjects.length + matchingCidrs.length;

                if (totalInsights > 0) {
                  return (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPopoverToken(popoverToken === val ? null : val);
                      }}
                      style={{ background: 'rgba(251, 191, 36, 0.15)', border: '1px solid rgba(251, 191, 36, 0.3)', padding: '2px 8px', color: '#fbbf24', cursor: 'pointer', borderRadius: '12px', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(251, 191, 36, 0.25)'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(251, 191, 36, 0.15)'}
                      title="View Insights"
                    >
                      <Zap size={12} fill="currentColor" /> {totalInsights} Insight{totalInsights > 1 ? 's' : ''}
                    </button>
                  );
                }

                return (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPopoverToken(popoverToken === val ? null : val);
                    }}
                    style={{ background: 'transparent', border: 'none', padding: '4px', color: 'var(--accent-blue)', cursor: 'pointer', borderRadius: '4px' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.1)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    title="View Options"
                  >
                    <Layers size={14} />
                  </button>
                );
              })()}

              {/* EXPANSION POPOVER */}
              {popoverToken === val && createPortal(
                <div 
                  ref={popoverRef}
                  style={{
                  position: 'fixed',
                  top: popoverPos.top,
                  left: popoverPos.left,
                  width: '320px',
                  maxHeight: '400px',
                  overflowY: 'scroll',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-main)',
                  borderRadius: '6px',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                  zIndex: 100,
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }} className="custom-scrollbar">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-main)', paddingBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {isRaw ? val : `Options for ${val}:`}
                    </span>
                    <button onClick={() => setPopoverToken(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={14} /></button>
                  </div>
                  
                  {isGroup && opt && (() => {
                    const currentlyCoveredLeaves = new Set<string>();
                    values.forEach(v => {
                      getDeepMembers(v).forEach(l => currentlyCoveredLeaves.add(l));
                    });
                    getDeepMembers(val).forEach(l => currentlyCoveredLeaves.add(l));

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div 
                          onClick={() => setInspectGroupOpen(!inspectGroupOpen)}
                          style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                        >
                          <ChevronRight size={12} style={{ transform: inspectGroupOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} /> Inspect Group ({opt.member_list?.split(',').length || 0} Members)
                        </div>
                        {inspectGroupOpen && (
                          <div style={{ border: '1px solid var(--border-main)', borderRadius: '4px', padding: '4px', backgroundColor: 'rgba(255,255,255,0.02)', maxHeight: '160px', overflowY: 'auto' }}>
                            {opt.member_list?.split(',').map(m => m.trim()).map(member => renderMemberTree(member, 0, currentlyCoveredLeaves))}
                          </div>
                        )}
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleExpandMembers(val); }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '8px 12px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-main)', cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--bg-app)'}
                        >
                          <RotateCcw size={14} /> Expand to Members
                        </button>
                      </div>
                    );
                  })()}

                  {!isRaw && (() => {
                    const parents = getParentGroups(val);
                    if (parents.length === 0) return null;
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                        <div 
                          onClick={() => setGroupMembershipsOpen(!groupMembershipsOpen)}
                          style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                        >
                          <ChevronRight size={12} style={{ transform: groupMembershipsOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} /> Group Memberships
                        </div>
                        {groupMembershipsOpen && (() => {
                           const currentlyCoveredLeaves = new Set<string>();
                           values.forEach(v => {
                             getDeepMembers(v).forEach(l => currentlyCoveredLeaves.add(l));
                           });
                           getDeepMembers(val).forEach(l => currentlyCoveredLeaves.add(l));

                           return parents
                            .map(parent => {
                               const leaves = getDeepMembers(parent.name);
                               let coveredLeavesCount = 0;
                               leaves.forEach(l => {
                                 if (currentlyCoveredLeaves.has(l)) coveredLeavesCount++;
                               });
                               
                               const pMembers = parent.member_list ? parent.member_list.split(',').map(m => m.trim()) : [];
                               let nestedGroupsCount = 0;
                               pMembers.forEach(m => {
                                 const mOpt = optionsMap.get(m);
                                 if (mOpt && mOpt.member_list) nestedGroupsCount++;
                               });

                               const toleranceRatio = leaves.length > 0 ? coveredLeavesCount / leaves.length : 0;
                               return { parent, pMembers, leaves, coveredLeavesCount, nestedGroupsCount, toleranceRatio };
                            })
                            .filter(item => item.toleranceRatio >= groupTolerance)
                            .map(({ parent, pMembers, leaves, coveredLeavesCount, nestedGroupsCount }) => {
                             return (
                               <div key={parent.name} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                 <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-main)', borderRadius: '4px' }}>
                                   <div 
                                     onClick={(e) => { e.stopPropagation(); setExpandedParent(expandedParent === parent.name ? null : parent.name); }}
                                     style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', cursor: 'pointer', flex: 1 }}
                                   >
                                     <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                       <span style={{ fontSize: '12px', color: 'var(--text-main)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                         <ChevronRight size={12} style={{ color: 'var(--text-muted)', transform: expandedParent === parent.name ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} /> {parent.name}
                                       </span>
                                     </div>
                                     <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '18px', marginTop: '2px' }}>{coveredLeavesCount} / {leaves.length} leaf members covered ({nestedGroupsCount} nested)</span>
                                   </div>
                                   <button 
                                     onClick={(e) => { e.stopPropagation(); handleSwapGroup(val, parent.name); }}
                                     style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', backgroundColor: '#a78bfa', color: 'white', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                                   >
                                     <Layers size={12} /> Swap
                                   </button>
                                 </div>
                                 {expandedParent === parent.name && (
                                   <div style={{ marginLeft: '18px', border: '1px solid var(--border-main)', borderRadius: '4px', padding: '4px', backgroundColor: 'rgba(255,255,255,0.02)', maxHeight: '160px', overflowY: 'auto' }}>
                                      {pMembers.map(member => renderMemberTree(member, 0, currentlyCoveredLeaves))}
                                   </div>
                                 )}
                               </div>
                             );
                          });
                        })()}
                      </div>
                    );
                  })()}

                  {matchingObjects.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                      <div 
                        onClick={() => setExactMatchesOpen(!exactMatchesOpen)}
                        style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                      >
                        <ChevronRight size={12} style={{ transform: exactMatchesOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} /> Exact 1:1 Matches ({matchingObjects.length})
                      </div>
                      {exactMatchesOpen && matchingObjects.map(match => (
                        <div key={match.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-main)', borderRadius: '4px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{match.name}</span>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{match.value}</span>
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSwapRawToken(val, match.name);
                            }}
                            style={{ padding: '4px 8px', backgroundColor: 'var(--accent-blue)', color: 'white', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#3b82f6'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--accent-blue)'}
                          >
                            Swap
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {matchingCidrs.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                      <div 
                        onClick={() => setSubnetsOpen(!subnetsOpen)}
                        style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                      >
                        <ChevronRight size={12} style={{ transform: subnetsOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} /> Containing Subnets ({matchingCidrs.length})
                      </div>
                      {subnetsOpen && matchingCidrs.map(match => (
                        <div key={match.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-main)', borderRadius: '4px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{match.name}</span>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{match.value}</span>
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSwapRawToken(val, match.name);
                            }}
                            style={{ padding: '4px 8px', backgroundColor: 'var(--accent-blue)', color: 'white', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#3b82f6'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--accent-blue)'}
                          >
                            Swap
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>, document.body
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
      {confirmSwapDialog?.isOpen && createPortal(
        <ConfirmSwapModal 
          dialogData={confirmSwapDialog}
          onCancel={() => setConfirmSwapDialog(null)}
          onConfirm={(excluded: Set<string>) => {
            const current = values.filter(v => v !== confirmSwapDialog.oldVal);
            const finalCleaned = current.filter(v => !confirmSwapDialog.redundantItems.includes(v) || excluded.has(v));
            if (!finalCleaned.includes(confirmSwapDialog.newVal)) finalCleaned.push(confirmSwapDialog.newVal);
            onChange(finalCleaned);
            setConfirmSwapDialog(null);
            if (addToast) {
              const removedCount = confirmSwapDialog.redundantItems.length - excluded.size;
              addToast(`Swapped ${confirmSwapDialog.oldVal} for ${confirmSwapDialog.newVal}${removedCount > 0 ? ` and removed ${removedCount} redundant items` : ''}`, 'success');
            }
          }}
        />, document.body
      )}
    </div>
  );
};
