import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from './Modal';
import { Dropdown } from './Dropdown';
import { Tag, Globe, Network, ShieldAlert, Layers, Search, Trash2, Plus, X, Package, CheckSquare } from 'lucide-react';
import { createPortal } from 'react-dom';
import { SearchableScopeDropdown } from './SearchableScopeDropdown';

export interface GlobalObjectCrudModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newObjectName?: string) => void;
  mode: 'create' | 'edit';
  objectType: string;
  initialData?: any;
  defaultScopeUuid?: string;
  defaultName?: string;
  defaultValue?: string;
  apiClient: any;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  referenceData?: {
    deviceGroups?: any[];
    scopeNameMap?: Record<string, string>;
    allAddresses?: any[];
    allAddressGroups?: any[];
    allServices?: any[];
    allServiceGroups?: any[];
    allApplications?: any[];
    allApplicationGroups?: any[];
    allTags?: any[];
  };
}

export const GlobalObjectCrudModal: React.FC<GlobalObjectCrudModalProps> = ({
  isOpen, onClose, onSuccess, mode, objectType, initialData, defaultScopeUuid, defaultName, defaultValue,
  apiClient, addToast, referenceData
}) => {
  const [internalObjectType, setInternalObjectType] = useState<'Object' | 'Group'>(
    objectType.includes('Group') ? 'Group' : 'Object'
  );

  const [formScopeUuid, setFormScopeUuid] = useState(defaultScopeUuid || 'paloalto-panorama-global');
  const [formName, setFormName] = useState(defaultName || '');
  const [confirmCancelDialog, setConfirmCancelDialog] = useState(false);
  const [nestedCreateObject, setNestedCreateObject] = useState<{name: string, type: 'Object' | 'Group'} | null>(null);

  const [formDescription, setFormDescription] = useState('');
  const [formType, setFormType] = useState('ip-netmask');
  const [formValue, setFormValue] = useState(defaultValue || '');
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formMembers, setFormMembers] = useState<string[]>([]);

  // Minimal reference data
  const [deviceGroups, setDeviceGroups] = useState<any[]>(referenceData?.deviceGroups || []);
  const [scopeNameMap, setScopeNameMap] = useState<Record<string, string>>(referenceData?.scopeNameMap || {});
  
  // Extended reference data for selectors
  const [allAddresses, setAllAddresses] = useState<any[]>(referenceData?.allAddresses || []);
  const [allAddressGroups, setAllAddressGroups] = useState<any[]>(referenceData?.allAddressGroups || []);
  const [allServices, setAllServices] = useState<any[]>(referenceData?.allServices || []);
  const [allServiceGroups, setAllServiceGroups] = useState<any[]>(referenceData?.allServiceGroups || []);
  const [allApplications, setAllApplications] = useState<any[]>(referenceData?.allApplications || []);
  const [allApplicationGroups, setAllApplicationGroups] = useState<any[]>(referenceData?.allApplicationGroups || []);
  const [allTags, setAllTags] = useState<any[]>(referenceData?.allTags || []);

  // Tag Selector State
  const [isTagSelectorModalOpen, setIsTagSelectorModalOpen] = useState(false);
  const [tagDropdownPos, setTagDropdownPos] = useState<any>({ top: 0, left: 0, bottom: 'auto' });
  const [initialTagSortValues, setInitialTagSortValues] = useState<string[]>([]);

  useEffect(() => {
    if (isTagSelectorModalOpen) {
      setInitialTagSortValues(formTags);
    }
  }, [isTagSelectorModalOpen]);
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [tagCheckedNames, setTagCheckedNames] = useState<string[]>([]);
  
  // Create Tag Modal State
  const [isCreateTagModalOpen, setIsCreateTagModalOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('color1');
  const [newTagDescription, setNewTagDescription] = useState('');

  // Member Selector State
  const [isSelectorModalOpen, setIsSelectorModalOpen] = useState(false);
  const [memberDropdownPos, setMemberDropdownPos] = useState<any>({ top: 0, left: 0, bottom: 'auto' });
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [memberCheckedNames, setMemberCheckedNames] = useState<string[]>([]);
  const [selectorSearchQuery, setSelectorSearchQuery] = useState('');
  const [selectorCheckedNames, setSelectorCheckedNames] = useState<string[]>([]);
  const [initialMemberSnapshot, setInitialMemberSnapshot] = useState<string[]>([]);

  useEffect(() => {
    if (isSelectorModalOpen) {
      setInitialMemberSnapshot(formMembers);
    }
  }, [isSelectorModalOpen]);

  // Fetch reference data on mount if needed
  useEffect(() => {
    if (isOpen) {
      const fetchRef = async () => {
        try {
          if (!referenceData?.deviceGroups) {
            const dgResp = await (apiClient.getDevicesInventory ? apiClient.getDevicesInventory() : apiClient.request('/api/devices/inventory'));
            const dgs = dgResp.device_groups || [];
            setDeviceGroups(dgs);
            const map: Record<string, string> = { 'paloalto-panorama-global': 'Shared' };
            dgs.forEach((g: any) => { map[g.uuid] = g.name; });
            setScopeNameMap(map);
          }

          if (!referenceData?.allAddresses) {
            const refData = await apiClient.getObjectsReference();
            setAllAddresses(refData.addresses || []);
            setAllAddressGroups(refData.address_groups || []);
            setAllServices(refData.services || []);
            setAllServiceGroups(refData.service_groups || []);
            setAllApplications(refData.applications || []);
            setAllApplicationGroups(refData.application_groups || []);
            setAllTags(refData.tags || []);
          }
        } catch(e) {
          console.error("Failed to load reference data", e);
        }
      };
      fetchRef();
    }
  }, [isOpen, apiClient, referenceData]);

  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && initialData) {
        setFormScopeUuid(initialData.device_uuid || 'paloalto-panorama-global');
        setFormName(initialData.name || '');
        setFormDescription(initialData.description || '');
        setFormTags(initialData.tags || []);
        
        if (internalObjectType === 'Group') {
           setFormMembers(initialData.member_list || []);
        } else {
           setFormType(initialData.type || 'ip-netmask');
           setFormValue(initialData.value || '');
        }
      } else {
        setFormScopeUuid(defaultScopeUuid || 'paloalto-panorama-global');
        setFormName(defaultName || '');
        setFormDescription('');
        setFormType('ip-netmask');
        setFormValue(defaultValue || '');
        setFormTags([]);
        setFormMembers([]);
      }
    }
  }, [isOpen, mode, initialData, defaultScopeUuid, defaultName, defaultValue]);

  const handleSaveObject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiClient) return;

    if (!formName.trim()) {
      addToast('Name is required.', 'error');
      return;
    }
    const nameRegex = /^[a-zA-Z0-9_\-\.]+$/;
    if (!nameRegex.test(formName)) {
      addToast('Name contains illegal characters.', 'error');
      return;
    }

    let activeScopeName = scopeNameMap[formScopeUuid] || 'Shared';
    if (formScopeUuid === 'paloalto-panorama-global' || activeScopeName === 'Shared') {
      activeScopeName = 'shared';
    }
    
    const payload: Record<string, any> = {
      device_uuid: formScopeUuid,
      scope: activeScopeName,
      name: formName.trim(),
      description: formDescription.trim(),
      tags: formTags
    };

    if (mode === 'edit' && initialData) {
      payload.id = initialData.id;
    }

    try {
      if (objectType.includes('Address')) {
        if (internalObjectType === 'Object') {
          payload.type = formType;
          payload.value = formValue.trim();
          if (mode === 'create') await apiClient.createAddressObject(payload);
          else await apiClient.updateAddressObject(payload);
        } else {
          payload.member_list = formMembers;
          payload.type = 'static';
          if (mode === 'create') await apiClient.createAddressGroup(payload);
          else await apiClient.updateAddressGroup(payload);
        }
      } else {
        addToast(`Creating ${objectType} is not fully implemented in Quick Add yet.`, 'error');
        return;
      }

      addToast(`${internalObjectType} ${mode === 'create' ? 'created' : 'updated'} successfully.`, 'success');
      onSuccess(payload.name);
      onClose();
    } catch (err: any) {
      addToast(`Error saving object: ${err.message}`, 'error');
    }
  };

  const getObjDetails = (name: string): string => {
    const addrObj = allAddresses.find(a => a.name === name);
    const addrGrpObj = allAddressGroups.find(g => g.name === name);
    const svcObj = allServices.find(s => s.name === name);
    const svcGrpObj = allServiceGroups.find(g => g.name === name);
    const appObj = allApplications.find(a => a.name === name);
    const appGrpObj = allApplicationGroups.find(g => g.name === name);

    if (addrObj) return `${addrObj.type}: ${addrObj.value}`;
    if (addrGrpObj) return addrGrpObj.type === 'dynamic' ? `Filter: ${addrGrpObj.filter}` : 'Static Group';
    if (svcObj) return `${String(svcObj.protocol).toUpperCase()}: ${svcObj.destination_port}`;
    if (svcGrpObj) return 'Service Group';
    if (appObj) return `${appObj.category} / Risk: ${appObj.risk}`;
    if (appGrpObj) return 'Application Group';
    return '';
  };

  const handleTagModalMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const startPosX = parseFloat(tagDropdownPos.left);
    const startPosY = parseFloat(tagDropdownPos.top);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setTagDropdownPos((prev: any) => ({
        ...prev,
        left: startPosX + dx,
        top: startPosY + dy
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMemberModalMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const startPosX = parseFloat(memberDropdownPos.left);
    const startPosY = parseFloat(memberDropdownPos.top);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setMemberDropdownPos((prev: any) => ({
        ...prev,
        left: startPosX + dx,
        top: startPosY + dy
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const renderTagsSection = (selectedTags: string[]) => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Tags</label>
          <button 
            type="button" 
            onClick={(e) => { 
              e.preventDefault(); 
              const modalEl = e.currentTarget.closest('[tabindex="-1"]');
              const rect = modalEl ? modalEl.getBoundingClientRect() : e.currentTarget.getBoundingClientRect();
              
              let left = rect.right + 16;
              // The tag selector modal is 600px wide. If it goes off the right edge:
              if (left + 600 > window.innerWidth) {
                // Check if it fits on the left
                if (rect.left > 600 + 16) {
                  left = rect.left - 600 - 16; // Pop out to the left side
                } else {
                  // If it doesn't fit on either side, center it over the modal
                  left = rect.left + (rect.width / 2) - 300;
                }
              }
              
              setTagDropdownPos({ top: rect.top, left, bottom: 'auto' });
              setIsTagSelectorModalOpen(true); 
            }} 
            style={{ padding: '2px 8px', background: 'transparent', border: '1px dashed var(--border-main)', color: 'var(--text-muted)', fontSize: '11px', borderRadius: '4px', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-muted)'; e.currentTarget.style.color = 'var(--text-main)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-main)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            + Add Tag
          </button>
        </div>
        <div 
          className="custom-scrollbar"
          style={{ 
            display: 'flex', 
            flexWrap: 'wrap', 
            gap: '6px', 
            height: '64px',
            backgroundColor: 'var(--bg-main)',
            border: '1px solid var(--border-main)',
            padding: '8px',
            borderRadius: '4px',
            overflowY: 'auto',
            alignContent: 'flex-start'
          }}
        >
          {selectedTags.length === 0 && (
            <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic', alignSelf: 'center' }}>No tags selected...</span>
          )}
          {selectedTags.map(tag => (
            <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: 'var(--bg-main)', border: '1px solid var(--border-main)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', color: 'var(--text-main)' }}>
              <Tag size={10} style={{ color: 'var(--accent-blue)' }} />
              <span>{tag}</span>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); setFormTags(formTags.filter(t => t !== tag)); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--accent-red)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderGroupMembersSection = (selectedNames: string[], onRemove: (name: string) => void) => {
    const filteredSelected = selectedNames.filter(name => {
      const objVal = getObjDetails(name);
      const q = memberSearchQuery.toLowerCase();
      return name.toLowerCase().includes(q) || objVal.toLowerCase().includes(q);
    });

    const handleToggleCheck = (name: string) => {
      if (memberCheckedNames.includes(name)) {
        setMemberCheckedNames(memberCheckedNames.filter(n => n !== name));
      } else {
        setMemberCheckedNames([...memberCheckedNames, name]);
      }
    };

    const handleSelectAll = () => {
      const allCheckedOnScreen = filteredSelected.every(name => memberCheckedNames.includes(name));
      if (allCheckedOnScreen) {
        setMemberCheckedNames(memberCheckedNames.filter(name => !filteredSelected.includes(name)));
      } else {
        const newChecked = [...memberCheckedNames];
        filteredSelected.forEach(name => {
          if (!newChecked.includes(name)) newChecked.push(name);
        });
        setMemberCheckedNames(newChecked);
      }
    };

    const handleRemoveSelected = (e: React.MouseEvent) => {
      e.preventDefault();
      const newMembers = selectedNames.filter(name => !memberCheckedNames.includes(name));
      setFormMembers(newMembers);
      setMemberCheckedNames([]);
    };

    const isAllChecked = filteredSelected.length > 0 && filteredSelected.every(name => memberCheckedNames.includes(name));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Group Members ({selectedNames.length})</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {memberCheckedNames.length > 0 && (
              <button 
                type="button" 
                onClick={handleRemoveSelected}
                style={{ padding: '4px 8px', backgroundColor: 'var(--accent-red)', color: 'white', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Trash2 size={12} /> Remove ({memberCheckedNames.length})
              </button>
            )}
            <button 
              type="button" 
              onClick={(e) => { 
                e.preventDefault(); 
                const modalEl = e.currentTarget.closest('[tabindex="-1"]');
                const rect = modalEl ? modalEl.getBoundingClientRect() : e.currentTarget.getBoundingClientRect();
                
                let left = rect.right + 16;
                // The member selector modal is 600px wide. If it goes off the right edge:
                if (left + 600 > window.innerWidth) {
                  // Check if it fits on the left
                  if (rect.left > 600 + 16) {
                    left = rect.left - 600 - 16; // Pop out to the left side
                  } else {
                    // If it doesn't fit on either side, center it over the modal
                    left = rect.left + (rect.width / 2) - 300;
                  }
                }
                
                setMemberDropdownPos({ top: rect.top, left, bottom: 'auto' });
                setIsSelectorModalOpen(true); 
              }} 
              style={{ padding: '4px 8px', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)', border: '1px solid var(--border-main)', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Plus size={12} /> Add Members
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              className="input-text" 
              placeholder="Filter members..." 
              value={memberSearchQuery} 
              onChange={e => setMemberSearchQuery(e.target.value)}
              style={{ width: '100%', paddingLeft: '28px', paddingRight: '28px' }}
            />
            {memberSearchQuery && (
              <button 
                type="button"
                onClick={() => setMemberSearchQuery('')}
                style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="table-container" style={{ flex: 1, minHeight: '150px' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '32px' }}>
                  <input type="checkbox" checked={isAllChecked} onChange={handleSelectAll} disabled={filteredSelected.length === 0} />
                </th>
                <th>Name</th>
                <th>Value</th>
                <th style={{ width: '40px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredSelected.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    {selectedNames.length === 0 ? "No members added yet." : "No members match your search."}
                  </td>
                </tr>
              ) : (
                filteredSelected.map(name => {
                  const isChecked = memberCheckedNames.includes(name);
                  const isGroup = name.includes('Group') || allAddressGroups.some(g => g.name === name);
                  const objVal = getObjDetails(name);
                  
                  return (
                    <tr key={name} className={isChecked ? 'selected-row' : ''} onClick={() => handleToggleCheck(name)} style={{ cursor: 'pointer' }}>
                      <td>
                        <input type="checkbox" checked={isChecked} onChange={() => handleToggleCheck(name)} onClick={e => e.stopPropagation()} />
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {isGroup ? <Layers size={14} style={{ color: '#60a5fa' }} /> : <Package size={14} style={{ color: '#10b981' }} />}
                          <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>{name}</span>
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '11px' }}>
                        {objVal || '--'}
                      </td>
                      <td>
                        <button 
                          type="button" 
                          onClick={(e) => { e.stopPropagation(); onRemove(name); }}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                          title="Remove from group"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const activeTitle = mode === 'create' ? `Create New ${internalObjectType}` : `Modify ${internalObjectType}`;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={activeTitle}
        size={internalObjectType === 'Group' ? 'lg' : 'md'}
        footer={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" form="crud-object-form" className="btn-primary btn-sm">Save Changes</button>
          </>
        }
      >
        <form id="crud-object-form" onSubmit={handleSaveObject} style={{ display: 'flex', flexDirection: 'column', gap: '15px', height: internalObjectType === 'Group' ? '500px' : 'auto' }}>
          
          {/* Object / Group Segmented Control */}
          <div style={{ display: 'flex', backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '6px', padding: '4px', width: 'fit-content' }}>
            <button
              type="button"
              onClick={() => {
                setInternalObjectType('Object');
                if (formName.startsWith('group_')) setFormName('host_' + formName.slice(6));
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 16px',
                fontSize: '12px',
                fontWeight: 700,
                backgroundColor: internalObjectType === 'Object' ? 'rgba(0, 0, 0, 0.5)' : 'transparent',
                color: internalObjectType === 'Object' ? 'white' : 'var(--text-muted)',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: internalObjectType === 'Object' ? '0 1px 3px rgba(0,0,0,0.5)' : 'none'
              }}
            >
              <Package size={14} />
              OBJECT
            </button>
            <button
              type="button"
              onClick={() => {
                setInternalObjectType('Group');
                if (formName.startsWith('host_')) setFormName('group_' + formName.slice(5));
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 16px',
                fontSize: '12px',
                fontWeight: 700,
                backgroundColor: internalObjectType === 'Group' ? 'rgba(0, 0, 0, 0.5)' : 'transparent',
                color: internalObjectType === 'Group' ? 'white' : 'var(--text-muted)',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: internalObjectType === 'Group' ? '0 1px 3px rgba(0,0,0,0.5)' : 'none'
              }}
            >
              <Layers size={14} />
              GROUP
            </button>
          </div>

          <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px', overflowY: 'auto', paddingRight: '8px' }} className="custom-scrollbar">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Scope Location</label>
                <SearchableScopeDropdown
                  width="100%"
                  value={formScopeUuid}
                  onChange={setFormScopeUuid}
                  scopeNameMap={scopeNameMap}
                  options={deviceGroups.length > 0 ? [
                    { value: 'paloalto-panorama-global', label: 'Shared', type: 'global' as const, depth: 0 },
                    ...deviceGroups.map(dg => ({ value: dg.uuid, label: dg.name, type: 'device-group' as const, depth: 0 }))
                  ] : [{ value: formScopeUuid, label: scopeNameMap[formScopeUuid] || formScopeUuid, type: 'global' as const, depth: 0 }]}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Name</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="input-text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder={internalObjectType === 'Group' ? "e.g. Group_Servers" : "e.g. host_10.0.0.1"}
                    style={{ width: '100%', paddingRight: '30px' }}
                    required
                  />
                  {formName && (
                    <button
                      type="button"
                      onClick={() => setFormName('')}
                      style={{ position: 'absolute', right: '8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {internalObjectType === 'Object' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Address Type</label>
                    <Dropdown width="100%" value={formType} onChange={setFormType} options={['ip-netmask', 'ip-range', 'fqdn']} searchable={false} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Value</label>
                    <input 
                      type="text" 
                      className="input-text" 
                      value={formValue} 
                      onChange={(e) => setFormValue(e.target.value)} 
                      placeholder={formType === 'ip-netmask' ? 'e.g. 10.0.0.1 or 10.0.0.0/24' : (formType === 'ip-range' ? 'e.g. 10.0.0.1-10.0.0.50' : 'e.g. www.google.com')}
                      required 
                    />
                  </div>
                </>
              )}
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Description (Optional)</label>
                <input type="text" className="input-text" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="e.g. Created via Optimization Sandbox" />
              </div>

              {renderTagsSection(formTags)}
            </div>

            {internalObjectType === 'Group' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {renderGroupMembersSection(formMembers, (name) => {
                  setFormMembers(prev => prev.filter(n => n !== name));
                })}
              </div>
            )}
          </div>
        </form>
      </Modal>

      {/* Member Selector Modal */}
      {isSelectorModalOpen && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'transparent', zIndex: 10050 }} onMouseDown={() => setIsSelectorModalOpen(false)}>
          <div 
            style={{ 
              position: 'absolute',
              top: memberDropdownPos.top,
              left: memberDropdownPos.left,
              backgroundColor: 'var(--bg-surface)', 
              border: '1px solid var(--border-main)', 
              borderRadius: '8px', 
              width: '600px', 
              height: '400px',
              display: 'flex', 
              flexDirection: 'column', 
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
              overflow: 'hidden'
            }} 
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <div 
              onMouseDown={handleMemberModalMouseDown}
              style={{ padding: '12px 12px 12px 12px', borderBottom: '1px solid var(--border-main)', backgroundColor: 'var(--bg-app)', cursor: 'move' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', userSelect: 'none' }}>Select Object</span>
                <button 
                  onClick={() => setIsSelectorModalOpen(false)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                >
                  <X size={16} />
                </button>
              </div>

              <div 
                onMouseDown={e => e.stopPropagation()} // Prevent dragging when clicking search bar
                style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--accent-blue)', borderRadius: '4px', padding: '6px 8px', backgroundColor: 'var(--bg-surface)', cursor: 'text' }}
              >
                <Search size={14} style={{ color: 'var(--text-muted)' }} />
                <input
                  autoFocus
                  value={selectorSearchQuery}
                  onChange={(e) => setSelectorSearchQuery(e.target.value)}
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: '12px', color: 'var(--text-main)', padding: 0 }}
                  placeholder="Search objects..."
                />
                {selectorSearchQuery && (
                  <button 
                    onClick={() => setSelectorSearchQuery('')}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div style={{ padding: '8px 0 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    style={{ cursor: 'pointer' }}
                    checked={(() => {
                      const q = selectorSearchQuery.toLowerCase();
                      const allAvailable = [...allAddresses, ...allAddressGroups];
                      const filtered = allAvailable.filter(o => {
                        const val = o.value || o.filter || '';
                        const matchesQuery = o.name.toLowerCase().includes(q) || val.toLowerCase().includes(q);
                        const matchesScope = o.device_uuid === formScopeUuid || o.device_uuid === 'paloalto-panorama-global';
                        return matchesQuery && matchesScope;
                      }).slice(0, 100);
                      return filtered.length > 0 && filtered.every(o => formMembers.includes(o.name));
                    })()}
                    onChange={(e) => {
                      const isChecked = e.target.checked;
                      const q = selectorSearchQuery.toLowerCase();
                      const allAvailable = [...allAddresses, ...allAddressGroups];
                      const filtered = allAvailable.filter(o => {
                        const val = o.value || o.filter || '';
                        const matchesQuery = o.name.toLowerCase().includes(q) || val.toLowerCase().includes(q);
                        const matchesScope = o.device_uuid === formScopeUuid || o.device_uuid === 'paloalto-panorama-global';
                        return matchesQuery && matchesScope;
                      }).slice(0, 100);
                      
                      if (isChecked) {
                        const toAdd = filtered.map(o => o.name).filter(n => !formMembers.includes(n));
                        if (toAdd.length > 0) {
                          setFormMembers(prev => [...prev, ...toAdd]);
                        }
                      } else {
                        const toRemove = filtered.map(o => o.name);
                        setFormMembers(prev => prev.filter(n => !toRemove.includes(n)));
                      }
                    }}
                  />
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Select All Filtered</span>
                </div>
                {(() => {
                  const q = selectorSearchQuery.toLowerCase();
                  const allAvailable = [...allAddresses, ...allAddressGroups];
                  const filteredCount = allAvailable.filter(o => {
                    const val = o.value || o.filter || '';
                    const matchesQuery = o.name.toLowerCase().includes(q) || val.toLowerCase().includes(q);
                    const matchesScope = o.device_uuid === formScopeUuid || o.device_uuid === 'paloalto-panorama-global';
                    return matchesQuery && matchesScope;
                  }).length;
                  const visibleCount = Math.min(filteredCount, 100);
                  return (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {visibleCount} visible ({formMembers.length} selected)
                    </span>
                  );
                })()}
              </div>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }} className="custom-scrollbar">
              {(() => {
                const q = selectorSearchQuery.toLowerCase();
                const allAvailable = [...allAddresses, ...allAddressGroups];
                const filtered = allAvailable.filter(o => {
                  const val = o.value || o.filter || '';
                  const matchesQuery = o.name.toLowerCase().includes(q) || val.toLowerCase().includes(q);
                  const matchesScope = o.device_uuid === formScopeUuid || o.device_uuid === 'paloalto-panorama-global';
                  return matchesQuery && matchesScope;
                }).slice(0, 100);
                
                if (filtered.length === 0) {
                  return (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                      No objects found matching "{selectorSearchQuery}"
                    </div>
                  );
                }
                
                return filtered.map(opt => {
                  const isGroup = opt.member_list !== undefined;
                  let iconColor = '#10b981'; // Green
                  if (isGroup) iconColor = '#60a5fa'; // Blue
                  
                  const scopeName = scopeNameMap[opt.device_uuid] || 'Shared';
                  const isShared = scopeName.toLowerCase().includes('shared');
                  const isAlreadyAdded = formMembers.includes(opt.name);

                  return (
                    <div 
                      key={opt.id}
                      onClick={() => {
                        if (!isAlreadyAdded) {
                          setFormMembers(prev => [...prev, opt.name]);
                        } else {
                          setFormMembers(prev => prev.filter(n => n !== opt.name));
                        }
                      }}
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        padding: '10px 12px', 
                        borderBottom: '1px solid rgba(255,255,255,0.02)',
                        cursor: 'pointer',
                        opacity: isAlreadyAdded ? 0.4 : 1,
                        transition: 'background-color 0.1s'
                      }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'; }}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
                        <input type="checkbox" checked={isAlreadyAdded} onChange={() => {}} style={{ cursor: 'pointer', pointerEvents: 'none' }} onClick={e => e.stopPropagation()} />
                        {isGroup ? <Layers size={14} color={iconColor} /> : <Package size={14} color={iconColor} />}
                        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.name}</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.value || opt.filter || '--'}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <div style={{ fontSize: '11px', color: isShared ? '#f97316' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 6px', borderRadius: '4px', border: `1px solid ${isShared ? 'rgba(249, 115, 22, 0.3)' : 'var(--border-main)'}`, backgroundColor: isShared ? 'rgba(249, 115, 22, 0.1)' : 'transparent', fontWeight: 500 }}>
                          {isShared && <Globe size={10} />}
                          {scopeName}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <div style={{ padding: '12px', borderTop: '1px solid var(--border-main)', backgroundColor: 'var(--bg-app)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  setNestedCreateObject({ name: selectorSearchQuery.trim(), type: 'Object' });
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', backgroundColor: 'transparent', color: 'var(--text-main)', border: '1px dashed var(--border-main)', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: 1 }}
                title="Create a new object to add as a member"
              >
                <Plus size={14} /> Quick Add Object
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setFormMembers(initialMemberSnapshot);
                    setIsSelectorModalOpen(false);
                  }}
                  style={{ padding: '8px 16px', backgroundColor: 'transparent', border: '1px solid var(--border-main)', color: 'var(--text-muted)', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setIsSelectorModalOpen(false)}
                  style={{ padding: '8px 16px', backgroundColor: 'var(--accent-blue)', border: 'none', color: 'white', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = '#3b82f6'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--accent-blue)'}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Tag Selector Modal */}
      {isTagSelectorModalOpen && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'transparent', zIndex: 10050 }} onMouseDown={() => setIsTagSelectorModalOpen(false)}>
          <div 
            style={{ 
              position: 'absolute',
              top: tagDropdownPos.top,
              left: tagDropdownPos.left,
              backgroundColor: 'var(--bg-surface)', 
              border: '1px solid var(--border-main)', 
              borderRadius: '8px', 
              width: '600px', 
              height: '400px',
              display: 'flex', 
              flexDirection: 'column', 
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
              overflow: 'hidden'
            }} 
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <div 
              onMouseDown={handleTagModalMouseDown}
              style={{ padding: '12px 12px 12px 12px', borderBottom: '1px solid var(--border-main)', backgroundColor: 'var(--bg-app)', cursor: 'move' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', userSelect: 'none' }}>Select Tag</span>
                <button 
                  onClick={() => setIsTagSelectorModalOpen(false)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                >
                  <X size={16} />
                </button>
              </div>

              <div 
                onMouseDown={e => e.stopPropagation()} // Prevent dragging when clicking the search bar
                style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--accent-blue)', borderRadius: '4px', padding: '6px 8px', backgroundColor: 'var(--bg-surface)', cursor: 'text' }}
              >
                <Search size={14} style={{ color: 'var(--text-muted)' }} />
                <input
                  autoFocus
                  value={tagSearchQuery}
                  onChange={(e) => setTagSearchQuery(e.target.value)}
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: '12px', color: 'var(--text-main)', padding: 0 }}
                  placeholder="Search tags..."
                />
                {tagSearchQuery && (
                  <button 
                    onClick={() => setTagSearchQuery('')}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div style={{ padding: '8px 0 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    style={{ cursor: 'pointer' }}
                    checked={(() => {
                      const q = tagSearchQuery.toLowerCase();
                      const filtered = allTags.filter(t => 
                        (t.device_uuid === formScopeUuid || t.device_uuid === 'paloalto-panorama-global') &&
                        t.name.toLowerCase().includes(q)
                      ).slice(0, 100);
                      return filtered.length > 0 && filtered.every(t => formTags.includes(t.name));
                    })()}
                    onChange={(e) => {
                      const isChecked = e.target.checked;
                      const q = tagSearchQuery.toLowerCase();
                      const filtered = allTags.filter(t => 
                        (t.device_uuid === formScopeUuid || t.device_uuid === 'paloalto-panorama-global') &&
                        t.name.toLowerCase().includes(q)
                      ).slice(0, 100);
                      
                      if (isChecked) {
                        const toAdd = filtered.map(t => t.name).filter(n => !formTags.includes(n));
                        if (toAdd.length > 0) {
                          setFormTags(prev => [...prev, ...toAdd]);
                        }
                      } else {
                        const toRemove = filtered.map(t => t.name);
                        setFormTags(prev => prev.filter(n => !toRemove.includes(n)));
                      }
                    }}
                  />
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Select All Filtered</span>
                </div>
                {(() => {
                  const q = tagSearchQuery.toLowerCase();
                  const filteredCount = allTags.filter(t => 
                    (t.device_uuid === formScopeUuid || t.device_uuid === 'paloalto-panorama-global') &&
                    t.name.toLowerCase().includes(q)
                  ).length;
                  const visibleCount = Math.min(filteredCount, 100);
                  return (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {visibleCount} visible ({formTags.length} selected)
                    </span>
                  );
                })()}
              </div>
            </div>
            
            <div style={{ overflowY: 'auto', flex: 1 }} className="custom-scrollbar">
              {(() => {
                const q = tagSearchQuery.toLowerCase();
                let filtered = allTags.filter(t => 
                  (t.device_uuid === formScopeUuid || t.device_uuid === 'paloalto-panorama-global') &&
                  t.name.toLowerCase().includes(q)
                );
                
                filtered = [...filtered].sort((a, b) => {
                  const aAdded = initialTagSortValues.includes(a.name);
                  const bAdded = initialTagSortValues.includes(b.name);
                  if (aAdded && !bAdded) return 1;
                  if (!aAdded && bAdded) return -1;
                  return 0;
                }).slice(0, 100);
                
                if (filtered.length === 0) {
                  return (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                      No tags found matching "{tagSearchQuery}"
                    </div>
                  );
                }
                
                return filtered.map(tag => {
                  const isAlreadyAdded = formTags.includes(tag.name);
                  const scopeName = scopeNameMap[tag.device_uuid] || 'Shared';
                  const isShared = scopeName.toLowerCase().includes('shared');
                  
                  return (
                    <div 
                      key={tag.id}
                      onClick={() => {
                        if (!isAlreadyAdded) {
                          setFormTags(prev => [...prev, tag.name]);
                        } else {
                          setFormTags(prev => prev.filter(n => n !== tag.name));
                        }
                      }}
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        padding: '10px 12px', 
                        borderBottom: '1px solid rgba(255,255,255,0.02)',
                        cursor: 'pointer',
                        opacity: isAlreadyAdded ? 0.4 : 1,
                        transition: 'background-color 0.1s'
                      }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'; }}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                        <input type="checkbox" checked={isAlreadyAdded} onChange={() => {}} style={{ cursor: 'pointer', pointerEvents: 'none' }} onClick={e => e.stopPropagation()} />
                        <Tag size={14} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tag.name}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <div style={{ fontSize: '11px', color: isShared ? '#f97316' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 6px', borderRadius: '4px', border: `1px solid ${isShared ? 'rgba(249, 115, 22, 0.3)' : 'var(--border-main)'}`, backgroundColor: isShared ? 'rgba(249, 115, 22, 0.1)' : 'transparent', fontWeight: 500 }}>
                          {isShared && <Globe size={10} />}
                          {scopeName}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <div style={{ padding: '12px', borderTop: '1px solid var(--border-main)', backgroundColor: 'var(--bg-app)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px' }}>
              <button
                onClick={() => {
                  setNewTagName(tagSearchQuery.trim());
                  setNewTagColor('color1');
                  setNewTagDescription('');
                  setIsCreateTagModalOpen(true);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', backgroundColor: 'var(--button-primary)', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
              >
                <Plus size={14} /> Quick Add New Tag
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setFormTags(initialTagSortValues);
                    setIsTagSelectorModalOpen(false);
                  }}
                  style={{ padding: '8px 16px', backgroundColor: 'transparent', border: '1px solid var(--border-main)', color: 'var(--text-muted)', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setIsTagSelectorModalOpen(false)}
                  style={{ padding: '8px 16px', backgroundColor: 'var(--accent-blue)', border: 'none', color: 'white', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = '#3b82f6'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--accent-blue)'}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Create New Tag Modal */}
      <Modal
        isOpen={isCreateTagModalOpen}
        onClose={() => setIsCreateTagModalOpen(false)}
        title="Create New Tag"
        size="sm"
        zIndex={10100}
        footer={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setIsCreateTagModalOpen(false)}>Cancel</button>
            <button 
              type="button" 
              className="btn-primary btn-sm"
              onClick={async () => {
                if (!newTagName.trim()) {
                  addToast('Tag name is required', 'error');
                  return;
                }
                try {
                  const tagPayload = {
                    name: newTagName.trim(),
                    color: newTagColor,
                    description: newTagDescription.trim(),
                    device_uuid: formScopeUuid,
                    scope: scopeNameMap[formScopeUuid] || 'Shared'
                  };
                  await apiClient.createTag(tagPayload);
                  // Add it locally so it works immediately
                  setAllTags(prev => [...prev, { name: tagPayload.name, color: tagPayload.color }]);
                  setFormTags(prev => [...new Set([...prev, tagPayload.name])]);
                  addToast(`Tag "${tagPayload.name}" created successfully.`, 'success');
                  setIsCreateTagModalOpen(false);
                  setIsTagSelectorModalOpen(false); // Optionally close selector too
                } catch(e: any) {
                  addToast(`Failed to create tag: ${e.message}`, 'error');
                }
              }}
            >
              Create Tag
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Tag Name</label>
            <input 
              type="text" 
              className="input-text" 
              value={newTagName} 
              onChange={e => setNewTagName(e.target.value)} 
              placeholder="e.g. Server_Tag" 
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Color</label>
            <Dropdown 
              width="100%" 
              value={newTagColor} 
              onChange={setNewTagColor} 
              options={Array.from({length: 42}, (_, i) => `color${i+1}`)} 
              renderOption={(opt) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: `var(--${opt}, #cbd5e1)` }} />
                  {opt.replace('color', 'Color ')}
                </div>
              )}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Comments (Optional)</label>
            <input 
              type="text" 
              className="input-text" 
              value={newTagDescription} 
              onChange={e => setNewTagDescription(e.target.value)} 
              placeholder="Description for this tag..." 
            />
          </div>
        </div>
      </Modal>

      {/* Nested Object Creator */}
      {nestedCreateObject && (
        <GlobalObjectCrudModal
          isOpen={true}
          onClose={() => setNestedCreateObject(null)}
          mode="create"
          objectType={nestedCreateObject.type === 'Group' ? 'Address Groups' : 'Address Objects'}
          apiClient={apiClient}
          addToast={addToast}
          referenceData={{
            deviceGroups,
            scopeNameMap,
            allAddresses,
            allAddressGroups,
            allServices,
            allServiceGroups,
            allApplications,
            allApplicationGroups,
            allTags
          }}
          defaultName={nestedCreateObject.name}
          defaultValue=""
          onSuccess={(name) => {
            if (name) setFormMembers(prev => [...prev, name]);
            setNestedCreateObject(null);
          }}
        />
      )}
    </>
  );
};
