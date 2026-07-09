import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useObjectDependencies, ObjectDataSources, DependencyCandidate } from './useObjectDependencies';
import { AlertTriangle, ChevronDown } from 'lucide-react';

export interface MoveDialogState {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  onConfirm: () => void;
  isDestructive: boolean;
  confirmText: string;
  initialWidth?: number;
  initialHeight?: number;
  onClose?: () => void;
  cancelText?: string;
}

const ResolutionDropdown = ({ value, onChange, placeholder }: any) => {
    const [isOpen, setIsOpen] = useState(false);
    const buttonRef = useRef<HTMLDivElement>(null);
    const [coords, setCoords] = useState({ top: 0, left: 0 });

    useEffect(() => {
        const handleScroll = () => {
            if (isOpen) setIsOpen(false);
        };

        if (isOpen) {
            window.addEventListener('scroll', handleScroll, true);
            window.addEventListener('resize', handleScroll);
        }
        
        return () => {
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', handleScroll);
        };
    }, [isOpen]);

    const toggleOpen = () => {
        if (!isOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setCoords({
                top: rect.bottom + 4,
                left: rect.left
            });
        }
        setIsOpen(!isOpen);
    };

    const options = [
        { label: 'Link (Use Target)', value: 'link' },
        { label: 'Replace Target', value: 'replace' },
        { label: 'Keep Both (Copy)', value: 'copy' },
        { type: 'separator' },
        { label: 'Cascade Link', value: 'cascade-link' },
        { label: 'Cascade Replace', value: 'cascade-replace' },
        { label: 'Cascade Copy', value: 'cascade-copy' },
    ];

    const currentLabel = options.find(o => (o as any).value === value)?.label || placeholder || 'Link (Use Target)';

    return (
        <>
            <div className="relative inline-block ml-2" ref={buttonRef}>
                <button
                    onClick={toggleOpen}
                    className="flex items-center justify-between gap-2 text-[11px] bg-[var(--bg-app)] border border-[var(--border-main)] rounded-md text-[var(--text-main)] px-3 py-1.5 hover:border-[var(--accent-blue)] transition-all outline-none focus:border-[var(--accent-blue)] w-40 shadow-sm"
                >
                    <span className="truncate font-medium">{currentLabel}</span>
                    <ChevronDown size={12} className="shrink-0 opacity-60" />
                </button>
            </div>
            {isOpen && createPortal(
                <>
                <div className="fixed inset-0 z-[9998]" onClick={() => setIsOpen(false)} />
                <div 
                    className="fixed z-[9999] w-40 bg-[var(--bg-surface)] border border-[var(--border-main)] rounded-lg shadow-2xl overflow-hidden py-1"
                    style={{ top: coords.top, left: coords.left }}
                >
                    {options.map((opt: any, idx) => (
                        opt.type === 'separator' ? (
                            <div key={idx} className="h-px bg-[var(--border-main)] my-1 mx-2" />
                        ) : (
                            <button
                                key={opt.value}
                                onClick={() => {
                                    onChange(opt.value);
                                    setIsOpen(false);
                                }}
                                className="w-full text-left px-3 py-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-element)] hover:text-[var(--text-main)] transition-colors block font-medium"
                            >
                                {opt.label}
                            </button>
                        )
                    ))}
                </div>
                </>
            , document.body)}
        </>
    );
};

const formatTypeLabelV1 = (t: string) => {
    if (!t) return 'Unknown';
    if (t === 'address') return 'Address Object';
    if (t === 'addressGroup') return 'Address Group';
    if (t === 'service') return 'Service';
    if (t === 'serviceGroup') return 'Service Group';
    if (t === 'application') return 'Application';
    if (t === 'applicationGroup') return 'Application Group';
    if (t === 'tag') return 'Tag';
    if (t === 'securityRule') return 'Security Rule';
    return t.charAt(0).toUpperCase() + t.slice(1);
};

const DependencyList = ({ dependencies, resolutions, setResolutions, actionType }: any) => {
    const [expanded, setExpanded] = useState<Record<number, boolean>>({});
    
    const toggle = (i: number) => setExpanded(prev => ({...prev, [i]: !prev[i]}));
    
    const setResolution = (id: string | number, val: string) => {
        const newRes = { ...resolutions };
        if (val.startsWith('cascade-')) {
            const action = val.replace('cascade-', '');
            newRes[id] = action;
            
            const visited = new Set();
            const applyToDescendants = (parentId: string | number) => {
                if (visited.has(parentId)) return;
                visited.add(parentId);
                
                const children = dependencies.filter((d: any) => d.parent.id === parentId);
                children.forEach((child: any) => {
                    if (child.status === 'conflict') {
                        newRes[child.dep.id] = action;
                        applyToDescendants(child.dep.id);
                    }
                });
            };
            applyToDescendants(id);
        } else {
            newRes[id] = val;
        }
        setResolutions(newRes);
    };

    const conflicts = dependencies.filter((d: any) => d.status === 'conflict');
    const handleBulkResolution = (val: string) => {
        const action = val.replace('cascade-', '');
        const newRes = { ...resolutions };
        conflicts.forEach((d: any) => {
            newRes[d.dep.id] = action;
        });
        setResolutions(newRes);
    };
    
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* V1 Legend Card Style */}
          <div style={{
              padding: '12px',
              backgroundColor: 'rgba(24, 24, 37, 0.8)',
              borderRadius: '6px',
              border: '1px solid var(--border-main)',
              fontSize: '11px',
              color: 'var(--text-muted)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '8px 16px',
              marginBottom: '4px'
          }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--status-red)', fontWeight: 'bold', width: '56px', flexShrink: 0 }}>[Create]</span>
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>Missing in target, will create new</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--status-warn)', fontWeight: 'bold', width: '56px', flexShrink: 0 }}>[Link]</span>
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>Found in target, will link to existing</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'orange', fontWeight: 'bold', width: '56px', flexShrink: 0 }}>[Diff]</span>
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>Found in target, but properties differ</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--status-green)', fontWeight: 'bold', width: '56px', flexShrink: 0 }}>[Keep]</span>
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>Already properly linked in target</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--accent-blue)', fontWeight: 'bold', width: '56px', flexShrink: 0 }}>{actionType === 'move' ? '[Move]' : '[Copy]'}</span>
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>This dependency is also being {actionType === 'move' ? 'moved' : 'copied'}</span>
              </div>
          </div>

          {conflicts.length > 1 && (
              <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 8px',
                  backgroundColor: 'rgba(24, 24, 37, 0.5)',
                  border: '1px solid var(--border-main)',
                  borderRadius: '4px'
              }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {conflicts.length} Conflicts
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-sub)' }}>Set all to:</span>
                      <ResolutionDropdown 
                          value="" 
                          onChange={handleBulkResolution} 
                          placeholder="Bulk Action..."
                      />
                  </div>
              </div>
          )}

          {/* V1 Outer Border Panel */}
          <ul style={{
              listStyleType: 'none',
              padding: '8px 12px',
              margin: 0,
              fontSize: '12px',
              color: 'var(--text-muted)',
              maxHeight: '260px',
              overflowY: 'auto',
              backgroundColor: 'rgba(15, 15, 20, 0.5)',
              borderRadius: '6px',
              border: '1px solid var(--border-main)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
          }}>
          {dependencies.map((d: any, i: number) => (
              <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {d.status === 'missing' && <span style={{ color: 'var(--status-red)', fontWeight: 'bold', width: '56px', flexShrink: 0 }}>[Create]</span>}
                      {d.status === 'exists' && <span style={{ color: 'var(--status-warn)', fontWeight: 'bold', width: '56px', flexShrink: 0 }}>[Link]</span>}
                      {d.status === 'conflict' && <span style={{ color: 'orange', fontWeight: 'bold', width: '56px', flexShrink: 0 }}>[Diff]</span>}
                      {d.status === 'mapped' && <span style={{ color: 'var(--status-green)', fontWeight: 'bold', width: '56px', flexShrink: 0 }}>[Keep]</span>}
                      {d.status === 'moving' && <span style={{ color: 'var(--accent-blue)', fontWeight: 'bold', width: '56px', flexShrink: 0 }}>{actionType === 'move' ? '[Move]' : '[Copy]'}</span>}
                      
                      <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', flex: 1 }}>
                          <span style={{ color: 'var(--text-main)' }}>{d.parent.name}</span> uses <span style={{ color: 'var(--text-main)' }}>{d.dep.name}</span> <span style={{ color: 'var(--text-sub)' }}>({formatTypeLabelV1(d.type).toLowerCase()})</span>
                      </span>
                      
                      {d.status === 'conflict' && (
                          <ResolutionDropdown 
                              value={resolutions[d.dep.id] || 'link'}
                              onChange={(val: string) => setResolution(d.dep.id, val)}
                          />
                      )}

                      {d.status === 'conflict' && d.diff && (
                          <button 
                              onClick={() => toggle(i)}
                              style={{
                                  fontSize: '10px',
                                  backgroundColor: 'var(--bg-element)',
                                  border: '1px solid var(--border-main)',
                                  color: 'var(--text-main)',
                                  padding: '2px 6px',
                                  borderRadius: '3px'
                              }}
                          >
                              {expanded[i] ? 'Hide' : 'View'} Diff
                          </button>
                      )}
                  </div>
                  {expanded[i] && d.diff && (
                      <div style={{
                          marginLeft: '64px',
                          backgroundColor: 'var(--bg-app)',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-main)',
                          fontSize: '10px',
                          fontFamily: 'monospace'
                      }}>
                          <div style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr 1fr',
                              gap: '8px',
                              borderBottom: '1px solid var(--border-main)',
                              paddingBottom: '4px',
                              marginBottom: '4px',
                              fontWeight: 'bold',
                              color: 'var(--text-muted)',
                              textTransform: 'uppercase',
                              fontSize: '9px',
                              letterSpacing: '0.05em'
                          }}>
                              <div>Field</div>
                              <div>Source ({actionType === 'move' ? 'Moving' : 'Copying'})</div>
                              <div>Target (Existing)</div>
                          </div>
                          {Object.entries(d.diff).map(([field, vals]: [string, any]) => (
                              <div key={field} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', padding: '2px 0' }}>
                                  <div style={{ color: 'var(--text-sub)', textTransform: 'capitalize' }}>{field}</div>
                                  <div style={{ color: 'var(--accent-blue)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={vals.source}>{vals.source || '(empty)'}</div>
                                  <div style={{ color: 'var(--status-warn)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={vals.target}>{vals.target || '(empty)'}</div>
                              </div>
                          ))}
                      </div>
                  )}
              </li>
          ))}
          </ul>
      </div>
    );
};

const MovePreview = ({ summary, actionType }: any) => {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '13px', color: 'var(--text-main)' }}>
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>The following actions will be performed:</p>
            
            {summary.moving.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--accent-blue)' }}>
                        {actionType === 'move' ? 'Moving' : 'Copying'} ({summary.moving.length})
                    </div>
                    <ul style={{ listStyleType: 'disc', paddingLeft: '20px', margin: 0, color: 'var(--text-muted)' }}>
                        {summary.moving.map((item: any, i: number) => (
                            <li key={i} style={{ marginBottom: '2px' }}>
                                <span style={{ color: 'var(--text-main)' }}>{item.name}</span> <span style={{ color: 'var(--text-sub)' }}>({formatTypeLabelV1(item.type)})</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {summary.creating.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--status-green)' }}>
                        Creating Dependencies ({summary.creating.length})
                    </div>
                    <ul style={{ listStyleType: 'disc', paddingLeft: '20px', margin: 0, color: 'var(--text-muted)' }}>
                        {summary.creating.map((item: any, i: number) => (
                            <li key={i} style={{ marginBottom: '2px' }}>
                                <span style={{ color: 'var(--text-main)' }}>{item.name}</span> <span style={{ color: 'var(--text-sub)' }}>({formatTypeLabelV1(item.type)})</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {summary.updating.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontWeight: 'bold', color: 'orange' }}>
                        Overwriting Dependencies ({summary.updating.length})
                    </div>
                    <ul style={{ listStyleType: 'disc', paddingLeft: '20px', margin: 0, color: 'var(--text-muted)' }}>
                        {summary.updating.map((item: any, i: number) => (
                            <li key={i} style={{ marginBottom: '2px' }}>
                                <span style={{ color: 'var(--text-main)' }}>{item.name}</span> <span style={{ color: 'var(--text-sub)' }}>({formatTypeLabelV1(item.type)})</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            
            {summary.linking.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--status-warn)' }}>
                        Linking to Existing ({summary.linking.length})
                    </div>
                    <ul style={{ listStyleType: 'disc', paddingLeft: '20px', margin: 0, color: 'var(--text-muted)' }}>
                        {summary.linking.map((item: any, i: number) => (
                            <li key={i} style={{ marginBottom: '2px' }}>
                                <span style={{ color: 'var(--text-main)' }}>{item.name}</span> <span style={{ color: 'var(--text-sub)' }}>({formatTypeLabelV1(item.type)})</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export const useObjectMove = (
  dataSources: ObjectDataSources,
  apiClient: any,
  refreshData: () => void,
  getScopeHierarchy: (uuid: string) => string[],
  scopeNameMap?: Record<string, string>,
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void,
  firewalls?: any[]
) => {
  const { getDependencies } = useObjectDependencies();
  const [resolutions, setResolutions] = useState<Record<string | number, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [moveConfirmDialog, setMoveConfirmDialog] = useState<MoveDialogState>({
    isOpen: false,
    title: '',
    message: null,
    onConfirm: () => {},
    isDestructive: false,
    confirmText: 'Move'
  });

  const isVisible = useCallback((targetScopeUuid: string, objectScopeUuid: string) => {
    if (!objectScopeUuid || objectScopeUuid === 'paloalto-dg-shared' || objectScopeUuid === 'paloalto-panorama-global') return true;
    if (!targetScopeUuid || targetScopeUuid === 'paloalto-dg-shared' || targetScopeUuid === 'paloalto-panorama-global') return false; 
    
    if (objectScopeUuid === targetScopeUuid) return true;

    // Resolve firewall scope IDs mapping to database format
    let realTargetUuid = targetScopeUuid;
    if (targetScopeUuid.startsWith('fw-') && firewalls) {
      const serial = targetScopeUuid.replace('fw-', '');
      const fw = firewalls.find((f: any) => f.serial === serial);
      if (fw) {
        realTargetUuid = `paloalto-fw-${fw.name}-${fw.serial}`;
      }
    }
    if (objectScopeUuid === realTargetUuid) return true;

    const hierarchy = getScopeHierarchy(targetScopeUuid);
    return hierarchy.includes(objectScopeUuid);
  }, [getScopeHierarchy, firewalls]);

  const move = useCallback(async (items: DependencyCandidate[], type: string, targetScopeUuid: string, actionType: 'move' | 'clone' = 'move') => {
    setIsProcessing(true);
    try {
      if (!items || items.length === 0) {
          setIsProcessing(false);
          return;
      }
      
      const MAX_SCAN_DEPTH = 5;
      let scanLimitReached = false;

      // Resolve database scope UUID if target scope is a firewall
      let realTargetScopeUuid = targetScopeUuid;
      if (targetScopeUuid.startsWith('fw-') && firewalls) {
          const serial = targetScopeUuid.replace('fw-', '');
          const fw = firewalls.find((f: any) => f.serial === serial);
          if (fw) {
              realTargetScopeUuid = `paloalto-fw-${fw.name}-${fw.serial}`;
          }
      }

      // 1. Check INCOMING dependencies (Who uses these items?)
      const incomingDependencies: any[] = [];
      for (const item of items) {
          if (item.device_uuid === realTargetScopeUuid && actionType === 'move') continue;
          const deps = await getDependencies(item, type, dataSources, apiClient);
          if (deps.length > 0) {
              incomingDependencies.push({ item, deps });
          }
      }

      // 2. Check OUTGOING dependencies (Who do these items use?)
      const outgoingDependencies: any[] = [];
      const queue = items.map(i => ({ item: i, type: type }));
      const visitedIds = new Set(items.map(i => i.id));

      const getScanConfig = (item: DependencyCandidate, itemType: string) => {
          const configs = [];
          if (item.tags && item.tags.length > 0) {
              configs.push({ refs: item.tags, refType: 'tag', table: dataSources.tags });
          }
          
          let membersList: string[] = [];
          if (item.member_list) membersList = item.member_list.split(',');
          else if (Array.isArray(item.members)) membersList = item.members;

          if (membersList.length > 0) {
              if (itemType === 'addressGroup') {
                  configs.push({ refs: membersList, refType: 'address', table: dataSources.addresses });
                  configs.push({ refs: membersList, refType: 'addressGroup', table: dataSources.addressGroups });
              } else if (itemType === 'serviceGroup') {
                  configs.push({ refs: membersList, refType: 'service', table: dataSources.services });
                  configs.push({ refs: membersList, refType: 'serviceGroup', table: dataSources.serviceGroups });
              } else if (itemType === 'applicationGroup') {
                  configs.push({ refs: membersList, refType: 'application', table: dataSources.applications });
                  configs.push({ refs: membersList, refType: 'applicationGroup', table: dataSources.applicationGroups });
              }
          }
          return configs;
      };

      let head = 0;
      while(head < queue.length) {
          if (head > 50) {
              scanLimitReached = true;
              break;
          }
          const { item, type: itemType } = queue[head++];
          const configs = getScanConfig(item, itemType);

          for (const config of configs) {
              if (!config.table) continue;
              const allRefs = config.table;
              const usedRefs = allRefs.filter(r => config.refs.includes(r.id) || config.refs.includes(r.name));

              for (const ref of usedRefs) {
                  const isMoving = items.some(i => i.id === ref.id);
                  const visible = isVisible(targetScopeUuid, ref.device_uuid);
                  
                  let status = 'mapped';
                  let diff: any = null;

                  if (isMoving) {
                      status = 'moving';
                  } else if (visitedIds.has(ref.id)) {
                      status = 'moving'; 
                  } else if (!visible) {
                      const existing = config.table.find(r => r.name === ref.name && r.device_uuid === realTargetScopeUuid);
                      if (existing) {
                          // Check content mismatch/diff
                          const fields = ['value', 'type', 'protocol', 'destination_port', 'category', 'risk', 'color', 'description', 'member_list'];
                          const currentDiff: any = {};
                          let hasDiff = false;
                          for (const f of fields) {
                              const sVal = ref[f] ?? '';
                              const tVal = existing[f] ?? '';
                              if (sVal != tVal) {
                                  currentDiff[f] = { source: sVal, target: tVal };
                                  hasDiff = true;
                              }
                          }
                          if (hasDiff) {
                              status = 'conflict';
                              diff = currentDiff;
                          } else {
                              status = 'exists';
                          }
                      }
                      else status = 'missing';
                  }

                  if (status !== 'mapped') {
                      outgoingDependencies.push({ parent: item, dep: ref, type: config.refType, table: config.table, status, diff });
                      
                      if ((status === 'missing' || status === 'conflict') && !visitedIds.has(ref.id)) {
                          visitedIds.add(ref.id);
                          queue.push({ item: ref, type: config.refType });
                      }
                  }
              }
          }
      }

      const dependenciesToFix = outgoingDependencies.filter(d => d.status === 'missing' || d.status === 'exists' || d.status === 'conflict');
      
      const initialRes: Record<string | number, string> = {};
      dependenciesToFix.forEach(d => {
          if (d.status === 'conflict' || d.status === 'exists') initialRes[d.dep.id] = 'link';
      });
      setResolutions(initialRes);

      const calculatePlan = (currentResolutions: Record<string | number, string>) => {
          const ops: any[] = [];
          const summary = { moving: [] as any[], creating: [] as any[], updating: [] as any[], linking: [] as any[] };
          const idRemap: Record<string, string> = {}; 
          
          const targetScopeName = scopeNameMap ? (scopeNameMap[targetScopeUuid] || 'Shared') : 'Shared';

          if (dependenciesToFix.length > 0) {
              const uniqueMissing = [...new Map(dependenciesToFix.map(m => [m.dep.id, m])).values()];
              
              for (const { dep, table: depTable, type: depRefType } of uniqueMissing) {
                  const resolution = currentResolutions[dep.id] || 'link';
                  const existingInTarget = depTable.find((x: any) => x.name === dep.name && x.device_uuid === realTargetScopeUuid);

                  if (existingInTarget && resolution === 'link') {
                      idRemap[dep.name] = existingInTarget.name;
                      summary.linking.push({ name: dep.name, type: depRefType });
                  } else {
                      const shell = {
                          ...dep,
                          device_uuid: realTargetScopeUuid,
                          scope: targetScopeName
                      };
                      delete shell.id;
                      delete shell.uuid;
                      
                      let shellMembersList: string[] = [];
                      if (shell.member_list) shellMembersList = shell.member_list.split(',');
                      if (shellMembersList.length > 0) {
                          shell.members = shellMembersList.map((m: string) => idRemap[m] || m);
                      }
                      
                      if (existingInTarget && resolution === 'replace') {
                          shell.id = existingInTarget.id;
                          ops.push({ type: 'update', refType: depRefType, data: shell });
                          summary.updating.push({ name: dep.name, type: depRefType });
                      } else {
                          if (existingInTarget && resolution === 'copy') {
                              shell.name = `${shell.name}_copy`;
                          }
                          ops.push({ type: 'create', refType: depRefType, data: shell });
                          summary.creating.push({ name: shell.name, type: depRefType });
                          idRemap[dep.name] = shell.name;
                      }
                  }
              }
          }

          for (const item of items) {
              if (actionType === 'move' && item.device_uuid === realTargetScopeUuid) continue;

              const updates = { ...item, device_uuid: realTargetScopeUuid, scope: targetScopeName };
              if (updates.tags) updates.tags = updates.tags.map((t: string) => idRemap[t] || t);
              
              let membersList: string[] = [];
              if (updates.member_list) membersList = updates.member_list.split(',');
              if (membersList.length > 0) {
                  updates.members = membersList.map((m: string) => idRemap[m] || m);
              }
              
              if (actionType === 'move') {
                  ops.push({ type: 'update', refType: type, data: updates });
                  summary.moving.push({ name: item.name, type });
              } else {
                  delete updates.id;
                  delete updates.uuid;
                  
                  const table = type === 'address' ? dataSources.addresses : 
                                type === 'addressGroup' ? dataSources.addressGroups :
                                type === 'service' ? dataSources.services :
                                type === 'serviceGroup' ? dataSources.serviceGroups :
                                type === 'application' ? dataSources.applications :
                                type === 'applicationGroup' ? dataSources.applicationGroups : [];
                                
                  const isDuplicate = table.some((t: any) => t.name === item.name && t.device_uuid === realTargetScopeUuid);
                  if (isDuplicate) {
                      updates.name = `${item.name}_copy`;
                  }
                  ops.push({ type: 'create', refType: type, data: updates });
                  summary.creating.push({ name: updates.name, type });
              }
          }

          // Apply remaps to created/updated dependencies (nested)
          for (const op of ops) {
              if (op.data.tags) {
                  op.data.tags = op.data.tags.map((t: string) => idRemap[t] || t);
              }
              if (op.data.members) {
                  op.data.members = op.data.members.map((m: string) => idRemap[m] || m);
              }
          }

          return { ops, summary };
      };

      const executePlan = async (ops: any[]) => {
          setIsProcessing(true);
          try {
              if (addToast) addToast(`Executing ${actionType} plan...`, 'info');
              for (const op of ops) {
                  console.log("Executing Move/Clone op:", op.type, op.refType, op.data.name, JSON.stringify(op.data));
                  if (op.type === 'create') {
                      try {
                          if (op.refType === 'address') await apiClient.createAddressObject(op.data);
                          else if (op.refType === 'addressGroup') await apiClient.createAddressGroup(op.data);
                          else if (op.refType === 'service') await apiClient.createServiceObject(op.data);
                          else if (op.refType === 'serviceGroup') await apiClient.createServiceGroup(op.data);
                          else if (op.refType === 'application') await apiClient.createApplicationObject(op.data);
                          else if (op.refType === 'applicationGroup') await apiClient.createApplicationGroup(op.data);
                          else if (op.refType === 'tag') await apiClient.createTag(op.data);
                      } catch (err: any) {
                          throw new Error(`Failed to create ${op.refType} "${op.data.name}": ${err.message || String(err)}`);
                      }
                  } else if (op.type === 'update') {
                      try {
                          if (op.refType === 'address') await apiClient.updateAddressObject(op.data);
                          else if (op.refType === 'addressGroup') await apiClient.updateAddressGroup(op.data);
                          else if (op.refType === 'service') await apiClient.updateServiceObject(op.data);
                          else if (op.refType === 'serviceGroup') await apiClient.updateServiceGroup(op.data);
                          else if (op.refType === 'application') await apiClient.updateApplicationObject(op.data);
                          else if (op.refType === 'applicationGroup') await apiClient.updateApplicationGroup(op.data);
                          else if (op.refType === 'tag') await apiClient.updateTag(op.data);
                      } catch (err: any) {
                          throw new Error(`Failed to update ${op.refType} "${op.data.name}": ${err.message || String(err)}`);
                      }
                  }
              }
              refreshData();
              setMoveConfirmDialog(prev => ({ ...prev, isOpen: false }));
              if (addToast) addToast(`Successfully completed ${actionType}!`, 'success');
          } catch (e: any) {
              console.error("Failed to execute plan", e);
              if (addToast) addToast(`Failed to execute ${actionType}: ${e.message || String(e)}`, 'error');
              alert(`Failed to execute ${actionType}: ${e.message || String(e)}`);
          } finally {
              setIsProcessing(false);
          }
      };

      const showWarnings = (currentResolutions: Record<string | number, string> = initialRes) => {
          setMoveConfirmDialog({
              isOpen: true,
              title: `${actionType === 'move' ? 'Move' : 'Duplicate'} Warnings`,
              initialWidth: 900,
              initialHeight: 600,
              isDestructive: false,
              message: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {incomingDependencies.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <p style={{ fontWeight: 'semibold', color: 'var(--status-warn)', fontSize: '13px', margin: '0 0 2px 0' }}>Incoming Dependencies:</p>
                              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 6px 0' }}>
                                  {actionType === 'move' ? 'Moving' : 'Copying'} these objects might break references from other objects.
                              </p>
                              <ul style={{
                                  listStyleType: 'none',
                                  padding: '8px 12px',
                                  margin: 0,
                                  fontSize: '12px',
                                  color: 'var(--text-muted)',
                                  maxHeight: '160px',
                                  overflowY: 'auto',
                                  backgroundColor: 'rgba(15, 15, 20, 0.5)',
                                  borderRadius: '6px',
                                  border: '1px solid var(--border-main)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '8px'
                              }}>
                                  {incomingDependencies.map((d, i) => (
                                      <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                          <div>
                                              <span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>{d.item.name}</span> used in {d.deps.length} places:
                                          </div>
                                          <ul style={{
                                              listStyleType: 'disc',
                                              paddingLeft: '20px',
                                              margin: 0,
                                              color: 'var(--text-muted)'
                                          }}>
                                              {d.deps.slice(0, 10).map((dep: any, idx: number) => (
                                                  <li key={idx} style={{ marginBottom: '2px' }}>
                                                      {dep.name} <span style={{ color: 'var(--text-sub)' }}>({formatTypeLabelV1(dep.typeLabel || dep.type).toLowerCase()})</span>
                                                  </li>
                                              ))}
                                              {d.deps.length > 10 && <li>...and {d.deps.length - 10} more</li>}
                                          </ul>
                                      </li>
                                  ))}
                              </ul>
                          </div>
                      )}
                      
                      {outgoingDependencies.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <p style={{ fontWeight: 'semibold', color: 'var(--text-main)', fontSize: '13px', margin: '0 0 2px 0' }}>Outgoing Dependencies:</p>
                              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 6px 0' }}>
                                  Objects referenced by the items being {actionType === 'move' ? 'moved' : 'copied'}:
                              </p>
                              <DependencyList 
                                  dependencies={outgoingDependencies} 
                                  resolutions={currentResolutions} 
                                  setResolutions={(res: any) => {
                                      setResolutions(res);
                                      showWarnings(res);
                                  }} 
                                  actionType={actionType}
                              />
                              {dependenciesToFix.length > 0 && (
                                  <p style={{ fontSize: '11px', color: 'var(--accent-blue)', marginTop: '8px', margin: '8px 0 0 0' }}>
                                      Clicking "Preview" will show the resolution plan for {dependenciesToFix.length} dependencies.
                                  </p>
                              )}
                          </div>
                      )}

                      {scanLimitReached && (
                          <div style={{
                              marginTop: '12px',
                              padding: '12px',
                              backgroundColor: 'rgba(249, 226, 175, 0.1)',
                              border: '1px solid var(--status-warn)',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '12px'
                          }}>
                              <AlertTriangle style={{ color: 'var(--status-warn)', flexShrink: 0, marginTop: '2px' }} size={16} />
                              <div style={{ fontSize: '11px', color: 'var(--text-main)' }}>
                                  <p style={{ fontWeight: 'bold', margin: '0 0 4px 0' }}>Scan Depth Limit Reached</p>
                                  <p style={{ margin: 0 }}>The dependency check stopped at {MAX_SCAN_DEPTH} levels deep. Some nested conflicts might not be detected.</p>
                              </div>
                          </div>
                      )}
                  </div>
              ),
              confirmText: "Preview",
              onConfirm: () => {
                  const plan = calculatePlan(currentResolutions);
                  setMoveConfirmDialog({
                      isOpen: true,
                      title: `${actionType === 'move' ? 'Move' : 'Duplicate'} Preview`,
                      message: <MovePreview summary={plan.summary} actionType={actionType} />,
                      confirmText: actionType === 'move' ? 'Confirm Move' : 'Confirm Duplicate',
                      cancelText: "Back",
                      onClose: () => showWarnings(currentResolutions),
                      isDestructive: false,
                      onConfirm: () => executePlan(plan.ops)
                  });
              }
          });
      };

      if (incomingDependencies.length > 0 || outgoingDependencies.length > 0) {
          setIsProcessing(false);
          showWarnings(initialRes);
      } else {
          const plan = calculatePlan(initialRes);
          await executePlan(plan.ops);
      }
    } catch (err) {
      setIsProcessing(false);
      console.error("Crash inside useObjectMove hook:", err);
      alert("Error calculating plan: " + String(err));
    }

  }, [dataSources, apiClient, refreshData, isVisible, getScopeHierarchy, getDependencies, resolutions, firewalls]);

  return { move, moveConfirmDialog, setMoveConfirmDialog, isProcessing };
};
