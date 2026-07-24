import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from './Modal';
import { Dropdown } from './Dropdown';
import { Tag, Globe, Network, ShieldAlert, Layers, Search, Trash2, Plus, X, Package, CheckSquare, Square } from 'lucide-react';
import { createPortal } from 'react-dom';
import { SearchableScopeDropdown } from './SearchableScopeDropdown';
import { useScopeHierarchy } from '../hooks/useScopeHierarchy';

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
    devices?: any[];
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
  const [formProtocol, setFormProtocol] = useState('tcp');
  const [formSourcePort, setFormSourcePort] = useState('');
  const [formDestPort, setFormDestPort] = useState('');
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formMembers, setFormMembers] = useState<string[]>([]);

  // Minimal reference data
  const [deviceGroups, setDeviceGroups] = useState<any[]>(referenceData?.deviceGroups || []);
  const [devices, setDevices] = useState<any[]>(referenceData?.devices || []);
  
  const { hierarchyOptions, scopeNameMap } = useScopeHierarchy(deviceGroups, devices, { includeShowAll: false, firewallValueKey: 'uuid' });
  
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
  const [tagDropdownPos, setTagDropdownPos] = useState<{ top: number, left: number }>({ top: 0, left: 0 });
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [tagCheckedNames, setTagCheckedNames] = useState<string[]>([]);
  const [tagSelectorTab, setTagSelectorTab] = useState<'all' | 'selected'>('all');
  const [initialTagSortValues, setInitialTagSortValues] = useState<string[]>([]);

  useEffect(() => {
    if (isTagSelectorModalOpen) {
      setInitialTagSortValues(formTags);
    }
  }, [isTagSelectorModalOpen]);
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
  const [memberSelectorTab, setMemberSelectorTab] = useState<'all' | 'objects' | 'groups' | 'selected'>('all');

  const allAvailableForType = useMemo(() => {
    if (objectType.includes('Service')) return [...allServices, ...allServiceGroups];
    if (objectType.includes('Application')) return [...allApplications, ...allApplicationGroups];
    return [...allAddresses, ...allAddressGroups];
  }, [objectType, allAddresses, allAddressGroups, allServices, allServiceGroups, allApplications, allApplicationGroups]);

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
          if (!referenceData?.deviceGroups || !referenceData?.devices) {
            const dgResp = await (apiClient.getPoliciesContext ? apiClient.getPoliciesContext('security_rules', 'device') : apiClient.request('/api/system/policies-context?count_table=security_rules&rulebase=device'));
            const dgs = dgResp.device_groups || [];
            const devs = dgResp.devices || [];
            setDeviceGroups(dgs);
            setDevices(devs);
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
           setFormProtocol(initialData.protocol || 'tcp');
           setFormSourcePort(initialData.source_port || '');
           setFormDestPort(initialData.destination_port || '');
        }
      } else {
        setFormScopeUuid(defaultScopeUuid || 'paloalto-panorama-global');
        setFormName(defaultName || '');
        setFormDescription('');
        setFormType('ip-netmask');
        setFormValue(defaultValue || '');
        setFormProtocol('tcp');
        setFormSourcePort('');
        
        let initPort = defaultValue || '';
        if (initPort.includes('/')) {
          initPort = initPort.split('/').pop() || '';
        }
        setFormDestPort(objectType.includes('Service') ? initPort : '');
        setFormTags([]);
        setFormMembers([]);
      }
    }
  }, [isOpen, mode, initialData, defaultScopeUuid, defaultName, defaultValue, objectType]);

  // Auto-generate Service name if not in edit mode
  useEffect(() => {
    if (isOpen && mode === 'create' && objectType.includes('Service') && internalObjectType === 'Object') {
      const prefix = formProtocol.toUpperCase();
      const portVal = formDestPort ? `_${formDestPort.replace(/[^0-9-]/g, '')}` : '';
      setFormName(`${prefix}${portVal}`);
    }
  }, [formProtocol, formDestPort, isOpen, mode, objectType, internalObjectType]);

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
      } else if (objectType.includes('Service') && internalObjectType === 'Group') {
        payload.members = formMembers;
        if (mode === 'create') await apiClient.createServiceGroup(payload);
        else await apiClient.updateServiceGroup(payload);
      } else if (objectType.includes('Service') && internalObjectType === 'Object') {
        payload.protocol = formProtocol;
        payload.source_port = formSourcePort.trim();
        payload.destination_port = formDestPort.trim();
        if (mode === 'create') await apiClient.createServiceObject(payload);
        else await apiClient.updateServiceObject(payload);
      } else if (objectType.includes('Application') && internalObjectType === 'Group') {
        payload.members = formMembers;
        if (mode === 'create') await apiClient.createApplicationGroup(payload);
        else await apiClient.updateApplicationGroup(payload);
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
    const startPosX = tagDropdownPos.left;
    const startPosY = tagDropdownPos.top;

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
              
              setTagDropdownPos({ top: rect.top, left });
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
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', border: '1px solid var(--border-main)', borderRadius: '6px', backgroundColor: 'var(--bg-app)', overflow: 'hidden', flex: 1, marginTop: '5px' }}>
        
        {/* TOOLBAR */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 12px 8px 12px', borderBottom: '1px solid var(--border-main)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Selected Members ({selectedNames.length})</span>
            <button 
              type="button" 
              onClick={(e) => { 
                e.preventDefault(); 
                const modalEl = e.currentTarget.closest('[tabindex="-1"]');
                const rect = modalEl ? modalEl.getBoundingClientRect() : e.currentTarget.getBoundingClientRect();
                
                let left = rect.right + 16;
                if (left + 600 > window.innerWidth) {
                  if (rect.left > 600 + 16) {
                    left = rect.left - 600 - 16;
                  } else {
                    left = rect.left + (rect.width / 2) - 300;
                  }
                }
                
                setMemberDropdownPos({ top: rect.top, left, bottom: 'auto' });
                setIsSelectorModalOpen(true); 
              }} 
              style={{ padding: '3px 8px', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)', border: '1px solid var(--border-main)', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', height: '24px' }}
            >
              <Plus size={12} /> Add Members
            </button>
          </div>

          <div style={{ height: '32px', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--accent-blue)', borderRadius: '4px', padding: '0 8px', backgroundColor: 'var(--bg-surface)', cursor: 'text' }}>
            <Search size={14} style={{ color: 'var(--text-muted)' }} />
            <input
              value={memberSearchQuery}
              onChange={(e) => setMemberSearchQuery(e.target.value)}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: '12px', color: 'var(--text-main)', padding: 0 }}
              placeholder="Filter members..."
              spellCheck={false}
            />
            {memberSearchQuery && (
              <button 
                type="button"
                onClick={() => setMemberSearchQuery('')}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0 0 0', minHeight: '28px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button 
                type="button"
                onClick={handleSelectAll} 
                style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                {isAllChecked ? <CheckSquare size={16} style={{ color: 'var(--accent-blue)' }} /> : <Square size={16} />}
              </button>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Select All Filtered</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {memberCheckedNames.length > 0 ? (
                <button 
                  type="button"
                  onClick={handleRemoveSelected} 
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', color: 'var(--status-red)', cursor: 'pointer', fontSize: '12px', padding: '4px 8px', borderRadius: '4px' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <Trash2 size={14} /> Remove ({memberCheckedNames.length})
                </button>
              ) : (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {filteredSelected.length} items
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable Members List */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }} className="custom-scrollbar">
          {selectedNames.length === 0 ? (
            <div style={{ padding: '30px 20px', display: 'flex', justifyContent: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
                <Layers size={24} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)' }}>No members selected</span>
                  <span style={{ fontSize: '12px' }}>Click '+ Add Members' to select config objects.</span>
                </div>
              </div>
            </div>
          ) : filteredSelected.length === 0 ? (
            <div style={{ padding: '20px', display: 'flex', justifyContent: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
                <Search size={24} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)' }}>No members match search query</span>
                  <span style={{ fontSize: '12px' }}>Try a different term.</span>
                </div>
              </div>
            </div>
          ) : (
            filteredSelected.map(name => {
              const isChecked = memberCheckedNames.includes(name);
              const isGroup = name.includes('Group') || (referenceData?.allAddressGroups || []).some(g => g.name === name);
              const objVal = getObjDetails(name);

              return (
                <div
                  key={name}
                  onClick={() => handleToggleCheck(name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px 12px',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    cursor: 'pointer',
                    backgroundColor: isChecked ? 'rgba(56, 189, 248, 0.05)' : 'transparent',
                    position: 'relative'
                  }}
                  onMouseEnter={(e) => { if (!isChecked) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)' }}
                  onMouseLeave={(e) => { if (!isChecked) e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  <button 
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleCheck(name);
                    }}
                    style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  >
                    {isChecked ? <CheckSquare size={16} style={{ color: 'var(--accent-blue)' }} /> : <Square size={16} />}
                  </button>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, overflow: 'hidden' }}>
                    <span style={{ color: isGroup ? '#60a5fa' : '#10b981', display: 'flex', alignItems: 'center' }}>
                      {isGroup ? <Layers size={14} /> : <Package size={14} />}
                    </span>
                    
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {name}
                      </span>
                      {objVal && (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {objVal}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemove(name); }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '4px'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    title="Remove from group"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const getDomainPrefix = () => {
    const t = objectType.toLowerCase();
    if (t.includes('address')) return 'Address ';
    if (t.includes('service')) return 'Service ';
    if (t.includes('application') || t.includes('app')) return 'Application ';
    return '';
  };

  const activeTitle = mode === 'create' ? `Create New ${getDomainPrefix()}${internalObjectType}` : `Modify ${getDomainPrefix()}${internalObjectType}`;

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
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px', overflowY: 'auto', paddingRight: '8px', minWidth: 0 }} className="custom-scrollbar">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Scope Location</label>
                <SearchableScopeDropdown
                  width="100%"
                  value={formScopeUuid}
                  onChange={setFormScopeUuid}
                  scopeNameMap={scopeNameMap}
                  options={hierarchyOptions}
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

              {internalObjectType === 'Object' && objectType.includes('Address') && (
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
              {internalObjectType === 'Object' && objectType.includes('Service') && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Protocol</label>
                    <Dropdown width="100%" value={formProtocol} onChange={setFormProtocol} options={['tcp', 'udp']} searchable={false} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Destination Port</label>
                    <input 
                      type="text" 
                      className="input-text" 
                      value={formDestPort} 
                      onChange={(e) => setFormDestPort(e.target.value)} 
                      placeholder="e.g. 443, 80-8080"
                      required 
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Source Ports (Optional)</label>
                    <input 
                      type="text" 
                      className="input-text" 
                      value={formSourcePort} 
                      onChange={(e) => setFormSourcePort(e.target.value)} 
                      placeholder="e.g. 1024-65535"
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
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
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
              <div style={{ display: 'flex', gap: '16px', padding: '8px 0 0 0', borderBottom: '1px solid var(--border-main)' }}>
                <button 
                  onClick={() => setMemberSelectorTab('all')} 
                  style={{ background: 'none', border: 'none', borderBottom: memberSelectorTab === 'all' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: memberSelectorTab === 'all' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, padding: '4px 0', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseEnter={e => { if (memberSelectorTab !== 'all') e.currentTarget.style.color = 'var(--text-main)'; }}
                  onMouseLeave={e => { if (memberSelectorTab !== 'all') e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  All
                </button>
                <button 
                  onClick={() => setMemberSelectorTab('objects')} 
                  style={{ background: 'none', border: 'none', borderBottom: memberSelectorTab === 'objects' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: memberSelectorTab === 'objects' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, padding: '4px 0', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseEnter={e => { if (memberSelectorTab !== 'objects') e.currentTarget.style.color = 'var(--text-main)'; }}
                  onMouseLeave={e => { if (memberSelectorTab !== 'objects') e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  Objects
                </button>
                <button 
                  onClick={() => setMemberSelectorTab('groups')} 
                  style={{ background: 'none', border: 'none', borderBottom: memberSelectorTab === 'groups' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: memberSelectorTab === 'groups' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, padding: '4px 0', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseEnter={e => { if (memberSelectorTab !== 'groups') e.currentTarget.style.color = 'var(--text-main)'; }}
                  onMouseLeave={e => { if (memberSelectorTab !== 'groups') e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  Groups
                </button>
                <button 
                  onClick={() => setMemberSelectorTab('selected')} 
                  style={{ background: 'none', border: 'none', borderBottom: memberSelectorTab === 'selected' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: memberSelectorTab === 'selected' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, padding: '4px 0', cursor: 'pointer', transition: 'all 0.2s ease', marginLeft: 'auto' }}
                  onMouseEnter={e => { if (memberSelectorTab !== 'selected') e.currentTarget.style.color = 'var(--text-main)'; }}
                  onMouseLeave={e => { if (memberSelectorTab !== 'selected') e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  Selected ({formMembers.length})
                </button>
              </div>

              <div style={{ padding: '8px 0 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    style={{ cursor: 'pointer' }}
                    checked={(() => {
                      const q = selectorSearchQuery.toLowerCase();
                      const allAvailable = allAvailableForType;
                      const filtered = allAvailable.filter(o => {
                        if (memberSelectorTab === 'objects' && o.member_list !== undefined) return false;
                        if (memberSelectorTab === 'groups' && o.member_list === undefined) return false;
                        if (memberSelectorTab === 'selected' && !formMembers.includes(o.name)) return false;
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
                      const allAvailable = allAvailableForType;
                      const filtered = allAvailable.filter(o => {
                        if (memberSelectorTab === 'objects' && o.member_list !== undefined) return false;
                        if (memberSelectorTab === 'groups' && o.member_list === undefined) return false;
                        if (memberSelectorTab === 'selected' && !formMembers.includes(o.name)) return false;
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
                  const allAvailable = allAvailableForType;
                  const filteredCount = allAvailable.filter(o => {
                    if (memberSelectorTab === 'objects' && o.member_list !== undefined) return false;
                    if (memberSelectorTab === 'groups' && o.member_list === undefined) return false;
                    if (memberSelectorTab === 'selected' && !formMembers.includes(o.name)) return false;
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
                const allAvailable = allAvailableForType;
                const filtered = allAvailable.filter(o => {
                  if (memberSelectorTab === 'objects' && o.member_list !== undefined) return false;
                  if (memberSelectorTab === 'groups' && o.member_list === undefined) return false;
                  if (memberSelectorTab === 'selected' && !formMembers.includes(o.name)) return false;
                  const val = o.value || o.filter || '';
                  const matchesQuery = o.name.toLowerCase().includes(q) || val.toLowerCase().includes(q);
                  const matchesScope = o.device_uuid === formScopeUuid || o.device_uuid === 'paloalto-panorama-global';
                  return matchesQuery && matchesScope;
                }).slice(0, 100);
                
                if (filtered.length === 0) {
                  return (
                    <div key="empty-state" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
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
                      key={opt.name}
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
              <div style={{ display: 'flex', gap: '16px', padding: '8px 0 0 0', borderBottom: '1px solid var(--border-main)' }}>
                <button 
                  onClick={() => setTagSelectorTab('all')} 
                  style={{ background: 'none', border: 'none', borderBottom: tagSelectorTab === 'all' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: tagSelectorTab === 'all' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, padding: '4px 0', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseEnter={e => { if (tagSelectorTab !== 'all') e.currentTarget.style.color = 'var(--text-main)'; }}
                  onMouseLeave={e => { if (tagSelectorTab !== 'all') e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  All
                </button>
                <button 
                  onClick={() => setTagSelectorTab('selected')} 
                  style={{ background: 'none', border: 'none', borderBottom: tagSelectorTab === 'selected' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: tagSelectorTab === 'selected' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 600, padding: '4px 0', cursor: 'pointer', transition: 'all 0.2s ease', marginLeft: 'auto' }}
                  onMouseEnter={e => { if (tagSelectorTab !== 'selected') e.currentTarget.style.color = 'var(--text-main)'; }}
                  onMouseLeave={e => { if (tagSelectorTab !== 'selected') e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  Selected ({formTags.length})
                </button>
              </div>
              <div style={{ padding: '8px 0 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    style={{ cursor: 'pointer' }}
                    checked={(() => {
                      const q = tagSearchQuery.toLowerCase();
                      const filtered = allTags.filter(t => {
                        if (tagSelectorTab === 'selected' && !formTags.includes(t.name)) return false;
                        return (t.device_uuid === formScopeUuid || t.device_uuid === 'paloalto-panorama-global') &&
                               t.name.toLowerCase().includes(q);
                      }).slice(0, 100);
                      return filtered.length > 0 && filtered.every(t => formTags.includes(t.name));
                    })()}
                    onChange={(e) => {
                      const isChecked = e.target.checked;
                      const q = tagSearchQuery.toLowerCase();
                      const filtered = allTags.filter(t => {
                        if (tagSelectorTab === 'selected' && !formTags.includes(t.name)) return false;
                        return (t.device_uuid === formScopeUuid || t.device_uuid === 'paloalto-panorama-global') &&
                               t.name.toLowerCase().includes(q);
                      }).slice(0, 100);
                      
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
                  const filteredCount = allTags.filter(t => {
                    if (tagSelectorTab === 'selected' && !formTags.includes(t.name)) return false;
                    return (t.device_uuid === formScopeUuid || t.device_uuid === 'paloalto-panorama-global') &&
                           t.name.toLowerCase().includes(q);
                  }).length;
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
                let filtered = allTags.filter(t => {
                  if (tagSelectorTab === 'selected' && !formTags.includes(t.name)) return false;
                  return (t.device_uuid === formScopeUuid || t.device_uuid === 'paloalto-panorama-global') &&
                         t.name.toLowerCase().includes(q);
                });
                
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
