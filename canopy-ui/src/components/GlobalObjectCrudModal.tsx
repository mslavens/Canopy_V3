import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from './Modal';
import { Dropdown } from './Dropdown';
import { Tag, Globe, Network, ShieldAlert, Layers, Search, Trash2, Plus, X } from 'lucide-react';
import { EmptyState } from './EmptyState';

export interface GlobalObjectCrudModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  mode: 'create' | 'edit';
  objectType: string;
  initialData?: any;
  defaultScopeUuid?: string;
  defaultName?: string;
  defaultValue?: string;
  apiClient: any;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const GlobalObjectCrudModal: React.FC<GlobalObjectCrudModalProps> = ({
  isOpen, onClose, onSuccess, mode, objectType, initialData, defaultScopeUuid, defaultName, defaultValue,
  apiClient, addToast
}) => {
  const [formScopeUuid, setFormScopeUuid] = useState(defaultScopeUuid || 'paloalto-panorama-global');
  const [formName, setFormName] = useState(defaultName || '');
  const [formDescription, setFormDescription] = useState('');
  const [formType, setFormType] = useState('ip-netmask');
  const [formValue, setFormValue] = useState(defaultValue || '');
  const [formTags, setFormTags] = useState<string[]>([]);
  
  // Minimal reference data needed for quick add of address objects
  const [deviceGroups, setDeviceGroups] = useState<any[]>([]);
  const [scopeNameMap, setScopeNameMap] = useState<Record<string, string>>({});
  
  // We fetch reference data on mount if needed
  useEffect(() => {
    if (isOpen) {
      const fetchRef = async () => {
        try {
          const dgResp = await apiClient.request('/api/device_groups');
          const dgs = dgResp.device_groups || [];
          setDeviceGroups(dgs);
          
          const map: Record<string, string> = { 'paloalto-panorama-global': 'Shared' };
          dgs.forEach((g: any) => {
            map[g.uuid] = g.name;
          });
          setScopeNameMap(map);
        } catch(e) {
          console.error("Failed to load device groups", e);
        }
      };
      fetchRef();
    }
  }, [isOpen, apiClient]);

  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && initialData) {
        setFormScopeUuid(initialData.device_uuid || 'paloalto-panorama-global');
        setFormName(initialData.name || '');
        setFormDescription(initialData.description || '');
        setFormType(initialData.type || 'ip-netmask');
        setFormValue(initialData.value || '');
      } else {
        setFormScopeUuid(defaultScopeUuid || 'paloalto-panorama-global');
        setFormName(defaultName || '');
        setFormDescription('');
        setFormType('ip-netmask');
        setFormValue(defaultValue || '');
        setFormTags([]);
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
      description: formDescription.trim()
    };

    if (mode === 'edit' && initialData) {
      payload.id = initialData.id;
    }

    try {
      if (objectType === 'Address Objects') {
        payload.type = formType;
        payload.value = formValue.trim();
        payload.tags = formTags;
        if (mode === 'create') await apiClient.createAddressObject(payload);
        else await apiClient.updateAddressObject(payload);
      } else {
        addToast(`Creating ${objectType} is not fully implemented in Quick Add yet.`, 'error');
        return;
      }

      addToast(`${objectType.slice(0, -1)} ${mode === 'create' ? 'created' : 'updated'} successfully.`, 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      addToast(`Error saving object: ${err.message}`, 'error');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'create' ? `Create New ${objectType.slice(0, -1)}` : `Modify ${objectType.slice(0, -1)}`}
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" form="crud-object-form" className="btn-primary btn-sm">Save Changes</button>
        </>
      }
    >
      <form id="crud-object-form" onSubmit={handleSaveObject} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Scope Location</label>
          <Dropdown
            width="100%"
            value={formScopeUuid}
            onChange={setFormScopeUuid}
            options={deviceGroups.length > 0 ? Array.from(new Set(deviceGroups.map(dg => dg.uuid))) : [formScopeUuid]}
            renderOption={(opt) => scopeNameMap[opt] || opt}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Object Name</label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              className="input-text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. host_10.0.0.1"
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
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            Only letters, numbers, underscores, hyphens, and dots allowed. No spaces.
          </span>
        </div>

        {objectType === 'Address Objects' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Address Type</label>
              <Dropdown width="100%" value={formType} onChange={setFormType} options={['ip-netmask', 'ip-range', 'fqdn']} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Value</label>
              <input type="text" className="input-text" value={formValue} onChange={(e) => setFormValue(e.target.value)} required />
            </div>
          </>
        )}
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
           <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Description (Optional)</label>
           <input type="text" className="input-text" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="e.g. Created via Optimization Sandbox" />
        </div>
      </form>
    </Modal>
  );
};
