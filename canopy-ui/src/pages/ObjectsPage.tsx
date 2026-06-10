import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Globe,
  Layers,
  Search,
  Plus,
  Trash2,
  Code,
  Download,
  Eye,
  Edit2,
  ArrowRight,
  RefreshCw,
  FileUp,
  Loader2,
  X,
  Tag,
  ShieldAlert,
  Server,
  Database,
  List,
  ChevronDown,
  Network
} from 'lucide-react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/ConfirmProvider';
import { SearchBar } from '../components/SearchBar';
import { HighlightedText } from '../components/HighlightedText';
import { Dropdown } from '../components/Dropdown';
import { Tooltip } from '../components/Tooltip';

interface SearchableScopeDropdownProps {
  value: string;
  options: { label: string; value: string; depth: number; type: 'global' | 'shared' | 'device-group' | 'firewall' }[];
  onChange: (value: string) => void;
  scopeNameMap: Record<string, string>;
}

const SearchableScopeDropdown: React.FC<SearchableScopeDropdownProps> = ({ value, options, onChange, scopeNameMap }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 280 });

  const updateCoords = () => {
    if (dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width
      });
    }
  };

  useEffect(() => {
    if (isOpen) {
      updateCoords();
      window.addEventListener('resize', updateCoords);
      window.addEventListener('scroll', updateCoords, true);
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
    if (!searchQuery.trim()) return options;
    const q = searchQuery.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, searchQuery]);

  const dropdownMenu = isOpen ? (
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
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100005
      }}
    >
      {/* Search Input Box */}
      <div style={{ padding: '8px', borderBottom: '1px solid var(--border-main)', position: 'sticky', top: 0, backgroundColor: 'var(--bg-surface)', zIndex: 10 }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={12} style={{ position: 'absolute', left: '8px', color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search device groups/firewalls..."
            style={{
              width: '100%',
              padding: '6px 8px 6px 26px',
              fontSize: '12px',
              backgroundColor: 'var(--bg-app)',
              border: '1px solid var(--border-main)',
              borderRadius: '4px',
              color: 'var(--text-main)',
              outline: 'none'
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      {/* Options list */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
        {filteredOptions.length === 0 ? (
          <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>
            No scopes match search
          </div>
        ) : (
          filteredOptions.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                style={{
                  padding: '8px 12px',
                  paddingLeft: `${opt.depth * 16 + 12}px`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  color: isSelected ? 'var(--text-main)' : 'var(--text-muted)',
                  backgroundColor: isSelected ? 'var(--bg-element)' : 'transparent',
                  transition: 'background-color 0.15s ease',
                  fontWeight: isSelected ? 600 : 400
                }}
                className="dropdown-option-row"
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {opt.type === 'global' && <Database size={12} className="text-accent" />}
                {opt.type === 'shared' && <Globe size={12} style={{ color: 'var(--accent-blue)' }} />}
                {opt.type === 'device-group' && <Layers size={12} />}
                {opt.type === 'firewall' && <Server size={12} style={{ color: 'var(--text-muted)' }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {opt.label}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  ) : null;

  return (
    <div ref={dropdownRef} style={{ position: 'relative', width: '280px', zIndex: 900 }}>
      {/* Selected Box */}
      <div
        onClick={() => { setIsOpen(!isOpen); setSearchQuery(''); }}
        style={{
          height: '34px',
          padding: '0 12px',
          backgroundColor: 'var(--bg-app)',
          border: `1px solid ${isOpen ? 'var(--accent-blue)' : 'var(--border-main)'}`,
          borderRadius: '4px',
          color: 'var(--text-main)',
          fontSize: '13px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
          transition: 'border-color 0.2s ease',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedOption?.type === 'global' && <Database size={13} className="text-accent" />}
          {selectedOption?.type === 'shared' && <Globe size={13} style={{ color: 'var(--accent-blue)' }} />}
          {selectedOption?.type === 'device-group' && <Layers size={13} />}
          {selectedOption?.type === 'firewall' && <Server size={13} style={{ color: 'var(--text-muted)' }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
            {selectedOption ? selectedOption.label : 'Select scope...'}
          </span>
        </div>
        <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
      </div>

      {isOpen && dropdownMenu && createPortal(dropdownMenu, document.body)}
    </div>
  );
};

interface ObjectsPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  activeSubTab: string;
}

export const ObjectsPage: React.FC<ObjectsPageProps> = ({ auth, addToast, activeSubTab }) => {
  const apiClient = useMemo(() => auth ? new CanopyApiClient(auth) : null, [auth]);
  const confirm = useConfirm();

  // Scopes states
  const [deviceGroups, setDeviceGroups] = useState<any[]>([]);
  const [firewalls, setFirewalls] = useState<any[]>([]);
  const [currentScope, setCurrentScope] = useState<string>('show-all');

  // Data Loading States
  const [tableData, setTableData] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSelectorModalOpen, setIsSelectorModalOpen] = useState<boolean>(false);
  const [selectorSearchQuery, setSelectorSearchQuery] = useState<string>('');
  const [selectorCheckedNames, setSelectorCheckedNames] = useState<string[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState<string>('');
  const [memberCheckedNames, setMemberCheckedNames] = useState<string[]>([]);

  // Dropdown options lists for relationships
  const [allAddresses, setAllAddresses] = useState<any[]>([]);
  const [allAddressGroups, setAllAddressGroups] = useState<any[]>([]);
  const [allServices, setAllServices] = useState<any[]>([]);
  const [allServiceGroups, setAllServiceGroups] = useState<any[]>([]);
  const [allApplications, setAllApplications] = useState<any[]>([]);
  const [allApplicationGroups, setAllApplicationGroups] = useState<any[]>([]);

  // Selection state (from table)
  const [selectedRows, setSelectedRows] = useState<any[]>([]);

  // Modal / Slide-over states
  const [isCrudModalOpen, setIsCrudModalOpen] = useState<boolean>(false);
  const [crudMode, setCrudMode] = useState<'create' | 'edit'>('create');
  const [selectedObject, setSelectedObject] = useState<any | null>(null);

  // Group Members detail slide-over
  const [isSlideOverOpen, setIsSlideOverOpen] = useState<boolean>(false);
  const [selectedGroupDetails, setSelectedGroupDetails] = useState<any | null>(null);
  const [resolvedMembers, setResolvedMembers] = useState<any[]>([]);
  const [slideOverLoading, setSlideOverLoading] = useState<boolean>(false);
  const [inspectorSearch, setInspectorSearch] = useState<string>('');

  // CLI Command generation modal
  const [isCliModalOpen, setIsCliModalOpen] = useState<boolean>(false);
  const [generatedCommands, setGeneratedCommands] = useState<string>('');

  // CRUD Form states
  const [formName, setFormName] = useState('');
  const [formScopeUuid, setFormScopeUuid] = useState('paloalto-panorama-global');
  const [formType, setFormType] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formFilter, setFormFilter] = useState('');
  const [formProtocol, setFormProtocol] = useState('tcp');
  const [formSourcePort, setFormSourcePort] = useState('');
  const [formDestPort, setFormDestPort] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formSubcategory, setFormSubcategory] = useState('');
  const [formTechnology, setFormTechnology] = useState('');
  const [formRisk, setFormRisk] = useState(1);
  const [formPorts, setFormPorts] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formMembers, setFormMembers] = useState<string[]>([]);

  // Drag and drop drop-zone applications CSV file state
  const [dragActive, setDragActive] = useState(false);
  const [csvUploading, setCsvUploading] = useState(false);

  // Form scope hierarchy (self -> parents -> global)
  const formVisibleScopes = useMemo(() => {
    if (formScopeUuid === 'paloalto-panorama-global') {
      return ['paloalto-panorama-global'];
    }
    const scopes = [formScopeUuid];
    let curr = deviceGroups.find(dg => dg.uuid === formScopeUuid);
    while (curr && curr.parent_id) {
      const parent = deviceGroups.find(dg => dg.id === curr.parent_id);
      if (parent) {
        scopes.push(parent.uuid);
        curr = parent;
      } else {
        break;
      }
    }
    if (!scopes.includes('paloalto-panorama-global')) {
      scopes.push('paloalto-panorama-global');
    }
    return scopes;
  }, [formScopeUuid, deviceGroups]);

  // Dual List available items for group CRUD editors
  const addressGroupAvailableItems = useMemo(() => {
    const items: { name: string; type: string; value: string; icon: React.ReactNode }[] = [];
    allAddresses
      .filter(a => formVisibleScopes.includes(a.device_uuid))
      .forEach(a => {
        items.push({
          name: a.name,
          type: 'address',
          value: `${a.type}: ${a.value}`,
          icon: <Globe size={12} style={{ color: 'var(--accent-blue)' }} />
        });
      });
    allAddressGroups
      .filter(g => g.id !== selectedObject?.id && formVisibleScopes.includes(g.device_uuid))
      .forEach(g => {
        items.push({
          name: g.name,
          type: 'group',
          value: g.type === 'dynamic' ? `Filter: ${g.filter}` : 'Static Group',
          icon: <Layers size={12} style={{ color: '#a855f7' }} />
        });
      });
    return items;
  }, [allAddresses, allAddressGroups, formVisibleScopes, selectedObject]);

  const serviceGroupAvailableItems = useMemo(() => {
    const items: { name: string; type: string; value: string; icon: React.ReactNode }[] = [];
    allServices
      .filter(s => formVisibleScopes.includes(s.device_uuid))
      .forEach(s => {
        items.push({
          name: s.name,
          type: 'service',
          value: `${String(s.protocol).toUpperCase()}: ${s.destination_port}`,
          icon: <Network size={12} style={{ color: '#10b981' }} />
        });
      });
    allServiceGroups
      .filter(g => g.id !== selectedObject?.id && formVisibleScopes.includes(g.device_uuid))
      .forEach(g => {
        items.push({
          name: g.name,
          type: 'group',
          value: 'Service Group',
          icon: <Layers size={12} style={{ color: '#a855f7' }} />
        });
      });
    return items;
  }, [allServices, allServiceGroups, formVisibleScopes, selectedObject]);

  const applicationGroupAvailableItems = useMemo(() => {
    const items: { name: string; type: string; value: string; icon: React.ReactNode }[] = [];
    allApplications
      .filter(a => formVisibleScopes.includes(a.device_uuid))
      .forEach(a => {
        items.push({
          name: a.name,
          type: 'application',
          value: `${a.category} / Risk: ${a.risk}`,
          icon: <ShieldAlert size={12} style={{ color: '#f59e0b' }} />
        });
      });
    allApplicationGroups
      .filter(g => g.id !== selectedObject?.id && formVisibleScopes.includes(g.device_uuid))
      .forEach(g => {
        items.push({
          name: g.name,
          type: 'group',
          value: 'Application Group',
          icon: <Layers size={12} style={{ color: '#a855f7' }} />
        });
      });
    return items;
  }, [allApplications, allApplicationGroups, formVisibleScopes, selectedObject]);

  const renderGroupMembersSection = (selectedNames: string[], onRemove: (name: string) => void) => {
    // Resolve object values for search and rendering
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
          if (!newChecked.includes(name)) {
            newChecked.push(name);
          }
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
      <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border-main)', borderRadius: '6px', backgroundColor: 'var(--bg-app)', overflow: 'hidden', height: '280px', marginTop: '5px' }}>
        {/* Header with Title and Actions */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '41px', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Selected Members ({selectedNames.length})</span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {memberCheckedNames.length > 0 && (
              <button
                onClick={handleRemoveSelected}
                style={{
                  backgroundColor: 'var(--status-red)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  height: '24px'
                }}
              >
                <Trash2 size={11} />
                Remove ({memberCheckedNames.length})
              </button>
            )}
            <button
              onClick={(e) => {
                e.preventDefault();
                setSelectorCheckedNames([]);
                setSelectorSearchQuery('');
                setIsSelectorModalOpen(true);
              }}
              className="btn-primary"
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                height: '24px'
              }}
            >
              <Plus size={12} />
              Add Members
            </button>
          </div>
        </div>

        {/* Search Input */}
        {selectedNames.length > 0 && (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-main)', display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
              <Search size={12} style={{ position: 'absolute', left: '8px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search group members..."
                value={memberSearchQuery}
                onChange={(e) => setMemberSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '4px 24px 4px 24px',
                  fontSize: '11px',
                  backgroundColor: 'var(--bg-app)',
                  border: '1px solid var(--border-main)',
                  borderRadius: '4px',
                  color: 'var(--text-main)',
                  outline: 'none'
                }}
              />
              {memberSearchQuery && (
                <button
                  onClick={() => setMemberSearchQuery('')}
                  style={{ position: 'absolute', right: '8px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Select All Checkbox */}
        {filteredSelected.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderBottom: '1px solid var(--border-main)', flexShrink: 0 }}>
            <input 
              type="checkbox"
              id="select-all-members"
              checked={isAllChecked}
              onChange={handleSelectAll}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="select-all-members" style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
              {isAllChecked ? 'Deselect All' : 'Select All matching'}
            </label>
          </div>
        )}

        {/* Scrollable Members List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {selectedNames.length === 0 ? (
            <div style={{ padding: '30px 20px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
              <span>No members selected.</span>
              <span style={{ fontSize: '11px' }}>Click "+ Add Members" to select config objects.</span>
            </div>
          ) : filteredSelected.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
              No members match search query
            </div>
          ) : (
            filteredSelected.map(name => {
              const isChecked = memberCheckedNames.includes(name);
              const isAddr = allAddresses.some(a => a.name === name) || allAddressGroups.some(g => g.name === name);
              const isSvc = allServices.some(s => s.name === name) || allServiceGroups.some(g => g.name === name);
              const isApp = allApplications.some(a => a.name === name) || allApplicationGroups.some(g => g.name === name);
              
              let icon = <Tag size={12} />;
              if (isAddr) {
                const isGroup = allAddressGroups.some(g => g.name === name);
                icon = isGroup ? <Layers size={12} style={{ color: '#a855f7' }} /> : <Globe size={12} style={{ color: 'var(--accent-blue)' }} />;
              } else if (isSvc) {
                const isGroup = allServiceGroups.some(g => g.name === name);
                icon = isGroup ? <Layers size={12} style={{ color: '#a855f7' }} /> : <Network size={12} style={{ color: '#10b981' }} />;
              } else if (isApp) {
                const isGroup = allApplicationGroups.some(g => g.name === name);
                icon = isGroup ? <Layers size={12} style={{ color: '#a855f7' }} /> : <ShieldAlert size={12} style={{ color: '#f59e0b' }} />;
              }

              const objVal = getObjDetails(name);

              return (
                <div
                  key={name}
                  onClick={() => handleToggleCheck(name)}
                  style={{
                    padding: '6px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.02)',
                    backgroundColor: isChecked ? 'var(--bg-element)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease'
                  }}
                  className="dropdown-option-row"
                  onMouseEnter={(e) => { if (!isChecked) e.currentTarget.style.backgroundColor = 'var(--bg-surface)'; }}
                  onMouseLeave={(e) => { if (!isChecked) e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                    <input 
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      style={{ cursor: 'pointer', flexShrink: 0 }}
                    />
                    {icon}
                    <div style={{ display: 'flex', alignItems: 'baseline', minWidth: 0, flex: 1, overflow: 'hidden' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, color: 'var(--text-main)' }}>{name}</span>
                      {objVal && (
                        <Tooltip content={objVal} position="top">
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            ({objVal})
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); onRemove(name); }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '4px',
                      borderRadius: '4px',
                      transition: 'all 0.15s ease',
                      flexShrink: 0
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--status-red)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const renderSelectorModal = (availableItems: { name: string; type: string; value: string; icon: React.ReactNode }[]) => {
    const filteredAvailable = availableItems.filter(item => !formMembers.includes(item.name));
    const searchFiltered = filteredAvailable.filter(item => 
      item.name.toLowerCase().includes(selectorSearchQuery.toLowerCase()) ||
      (item.value || '').toLowerCase().includes(selectorSearchQuery.toLowerCase())
    );

    const handleToggleCheck = (name: string) => {
      if (selectorCheckedNames.includes(name)) {
        setSelectorCheckedNames(selectorCheckedNames.filter(n => n !== name));
      } else {
        setSelectorCheckedNames([...selectorCheckedNames, name]);
      }
    };

    const handleSelectAll = () => {
      const allNamesOnScreen = searchFiltered.map(item => item.name);
      const allCheckedOnScreen = allNamesOnScreen.every(name => selectorCheckedNames.includes(name));
      
      if (allCheckedOnScreen) {
        setSelectorCheckedNames(selectorCheckedNames.filter(name => !allNamesOnScreen.includes(name)));
      } else {
        const newChecked = [...selectorCheckedNames];
        allNamesOnScreen.forEach(name => {
          if (!newChecked.includes(name)) {
            newChecked.push(name);
          }
        });
        setSelectorCheckedNames(newChecked);
      }
    };

    const handleAddSelected = () => {
      setFormMembers([...formMembers, ...selectorCheckedNames]);
      setIsSelectorModalOpen(false);
      setSelectorCheckedNames([]);
      setSelectorSearchQuery('');
    };

    const isAllChecked = searchFiltered.length > 0 && searchFiltered.every(item => selectorCheckedNames.includes(item.name));

    return (
      <Modal
        isOpen={isSelectorModalOpen}
        onClose={() => setIsSelectorModalOpen(false)}
        title={`Select Objects to Add`}
        size="md"
        footer={
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn-secondary btn-md" onClick={() => setIsSelectorModalOpen(false)}>Cancel</button>
            <button 
              className="btn-primary btn-md" 
              onClick={handleAddSelected}
              disabled={selectorCheckedNames.length === 0}
            >
              Add Selected ({selectorCheckedNames.length})
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search available objects by name or value..."
              value={selectorSearchQuery}
              onChange={(e) => setSelectorSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 30px 8px 30px',
                fontSize: '13px',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-main)',
                borderRadius: '6px',
                color: 'var(--text-main)',
                outline: 'none'
              }}
            />
            {selectorSearchQuery && (
              <button
                onClick={() => setSelectorSearchQuery('')}
                style={{ position: 'absolute', right: '10px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderBottom: '1px solid var(--border-main)', paddingBottom: '8px' }}>
            <input 
              type="checkbox"
              id="select-all-objects"
              checked={isAllChecked}
              onChange={handleSelectAll}
              disabled={searchFiltered.length === 0}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="select-all-objects" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
              {isAllChecked ? 'Deselect All' : 'Select All matching'}
            </label>
          </div>

          <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-main)', borderRadius: '6px', backgroundColor: 'var(--bg-app)' }}>
            {searchFiltered.length === 0 ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                {filteredAvailable.length === 0 ? 'No new objects available to add.' : 'No objects match your search.'}
              </div>
            ) : (
              searchFiltered.map(item => {
                const checked = selectorCheckedNames.includes(item.name);
                return (
                  <div
                    key={item.name}
                    onClick={() => handleToggleCheck(item.name)}
                    style={{
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.02)',
                      backgroundColor: checked ? 'var(--bg-element)' : 'transparent',
                      transition: 'background-color 0.15s ease'
                    }}
                    onMouseEnter={(e) => { if (!checked) e.currentTarget.style.backgroundColor = 'var(--bg-surface)'; }}
                    onMouseLeave={(e) => { if (!checked) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <input 
                      type="checkbox"
                      checked={checked}
                      onChange={() => {}}
                      style={{ cursor: 'pointer', flexShrink: 0 }}
                    />
                    {item.icon}
                    <div style={{ display: 'flex', alignItems: 'baseline', minWidth: 0, flex: 1, overflow: 'hidden' }}>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>{item.name}</span>
                      {item.value && (
                        <Tooltip content={item.value} position="top">
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            ({item.value})
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Modal>
    );
  };



  // Load basic configurations on mount
  useEffect(() => {
    const loadScopes = async () => {
      if (!apiClient) return;
      try {
        const [dgRes, fwRes] = await Promise.all([
          apiClient.queryDb("SELECT id, uuid, name, parent_id FROM device_groups ORDER BY name ASC;"),
          apiClient.queryDb("SELECT id, serial, name, device_group_id FROM managed_devices_raw ORDER BY name ASC;")
        ]);
        setDeviceGroups(dgRes.rows || []);
        setFirewalls(fwRes.rows || []);
      } catch (err) {
        console.error('Failed to load device groups or firewalls:', err);
      }
    };
    loadScopes();
  }, [apiClient]);

  // Scope Name Map to map UUIDs/Serials to human-readable names
  const scopeNameMap = useMemo(() => {
    const map: Record<string, string> = {
      'show-all': 'Show all',
      'paloalto-panorama-global': 'Shared'
    };
    deviceGroups.forEach(dg => {
      map[dg.uuid] = dg.name;
    });
    firewalls.forEach(fw => {
      map[`fw-${fw.serial}`] = fw.name;
    });
    return map;
  }, [deviceGroups, firewalls]);

  // Hierarchical scope selector option definitions
  const hierarchyOptions = useMemo(() => {
    const opts: { label: string; value: string; depth: number; type: 'global' | 'shared' | 'device-group' | 'firewall' }[] = [
      { label: 'Show all', value: 'show-all', depth: 0, type: 'global' },
      { label: 'Shared', value: 'paloalto-panorama-global', depth: 0, type: 'shared' }
    ];

    const buildNode = (parentId: number | null, depth: number) => {
      const levelGroups = deviceGroups.filter(g => g.parent_id === parentId);
      levelGroups.forEach(dg => {
        opts.push({
          label: dg.name,
          value: dg.uuid,
          depth: depth,
          type: 'device-group'
        });

        // Find firewalls for this group
        const groupFirewalls = firewalls.filter(fw => fw.device_group_id === dg.id);
        groupFirewalls.forEach(fw => {
          opts.push({
            label: fw.name,
            value: `fw-${fw.serial}`,
            depth: depth + 1,
            type: 'firewall'
          });
        });

        // Recursively build children
        buildNode(dg.id, depth + 1);
      });
    };

    buildNode(null, 1);
    return opts;
  }, [deviceGroups, firewalls]);

  const handleScopeChange = (val: string) => {
    setCurrentScope(val);
  };

  // Helper to get device group scope hierarchy (self -> parents -> global)
  const getScopeHierarchy = (scopeUuid: string): string[] => {
    if (!scopeUuid || scopeUuid === 'paloalto-panorama-global' || scopeUuid === 'show-all') {
      return ['paloalto-panorama-global'];
    }
    let activeScope = scopeUuid;
    if (scopeUuid.startsWith('fw-')) {
      const serial = scopeUuid.replace('fw-', '');
      const fw = firewalls.find(f => f.serial === serial);
      if (fw && fw.device_group_id) {
        const dg = deviceGroups.find(g => g.id === fw.device_group_id);
        if (dg) activeScope = dg.uuid;
      }
    }
    const scopes = [activeScope];
    let curr = deviceGroups.find(dg => dg.uuid === activeScope);
    while (curr && curr.parent_id) {
      const parent = deviceGroups.find(dg => dg.id === curr.parent_id);
      if (parent) {
        scopes.push(parent.uuid);
        curr = parent;
      } else {
        break;
      }
    }
    if (!scopes.includes('paloalto-panorama-global')) {
      scopes.push('paloalto-panorama-global');
    }
    return scopes;
  };

  // Recursive Address Group Resolver for total flattened view
  const resolveAddressGroupMembers = (groupName: string, scopeUuid: string, currentPath: string[] = [], visited = new Set<string>()): any[] => {
    if (visited.has(groupName)) return [];
    const newVisited = new Set(visited);
    newVisited.add(groupName);

    const allowedScopes = getScopeHierarchy(scopeUuid);
    
    // Find closest group in scope hierarchy
    let group = null;
    for (const sc of allowedScopes) {
      const g = allAddressGroups.find(item => item.name === groupName && item.device_uuid === sc);
      if (g) {
        group = g;
        break;
      }
    }

    if (!group) {
      // Find closest leaf address in scope hierarchy
      let leaf = null;
      for (const sc of allowedScopes) {
        const l = allAddresses.find(item => item.name === groupName && item.device_uuid === sc);
        if (l) {
          leaf = l;
          break;
        }
      }
      
      if (leaf) {
        return [{
          name: leaf.name,
          type: 'Address Object',
          details: `${leaf.type}: ${leaf.value}`,
          path: [...currentPath, groupName]
        }];
      }
      return [{
        name: groupName,
        type: 'External/Tag',
        details: 'Dynamic tag or unresolved member',
        path: [...currentPath, groupName]
      }];
    }

    if (group.type === 'dynamic') {
      return [{
        name: `Filter: ${group.filter}`,
        type: 'Dynamic Filter',
        details: 'Matches objects matching this filter tag',
        path: [...currentPath, groupName]
      }];
    }

    const members = group.member_list ? group.member_list.split(',') : [];
    let resolved: any[] = [];
    members.forEach((m: string) => {
      const mName = m.trim();
      if (!mName) return;
      resolved = resolved.concat(resolveAddressGroupMembers(mName, group.device_uuid, [...currentPath, groupName], newVisited));
    });
    return resolved;
  };

  // Recursive Service Group Resolver for total flattened view
  const resolveServiceGroupMembers = (groupName: string, scopeUuid: string, currentPath: string[] = [], visited = new Set<string>()): any[] => {
    if (visited.has(groupName)) return [];
    const newVisited = new Set(visited);
    newVisited.add(groupName);

    const allowedScopes = getScopeHierarchy(scopeUuid);
    
    let group = null;
    for (const sc of allowedScopes) {
      const g = allServiceGroups.find(item => item.name === groupName && item.device_uuid === sc);
      if (g) {
        group = g;
        break;
      }
    }

    if (!group) {
      let leaf = null;
      for (const sc of allowedScopes) {
        const l = allServices.find(item => item.name === groupName && item.device_uuid === sc);
        if (l) {
          leaf = l;
          break;
        }
      }
      if (leaf) {
        return [{
          name: leaf.name,
          type: 'Port Service',
          details: `${String(leaf.protocol).toUpperCase()}: ${leaf.destination_port}`,
          path: [...currentPath, groupName]
        }];
      }
      return [{
        name: groupName,
        type: 'Unresolved',
        details: 'External or unresolved service',
        path: [...currentPath, groupName]
      }];
    }

    const members = group.member_list ? group.member_list.split(',') : [];
    let resolved: any[] = [];
    members.forEach((m: string) => {
      const mName = m.trim();
      if (!mName) return;
      resolved = resolved.concat(resolveServiceGroupMembers(mName, group.device_uuid, [...currentPath, groupName], newVisited));
    });
    return resolved;
  };

  // Recursive Application Group Resolver for total flattened view
  const resolveApplicationGroupMembers = (groupName: string, scopeUuid: string, currentPath: string[] = [], visited = new Set<string>()): any[] => {
    if (visited.has(groupName)) return [];
    const newVisited = new Set(visited);
    newVisited.add(groupName);

    const allowedScopes = getScopeHierarchy(scopeUuid);
    
    let group = null;
    for (const sc of allowedScopes) {
      const g = allApplicationGroups.find(item => item.name === groupName && item.device_uuid === sc);
      if (g) {
        group = g;
        break;
      }
    }

    if (!group) {
      let leaf = null;
      for (const sc of allowedScopes) {
        const l = allApplications.find(item => item.name === groupName && item.device_uuid === sc);
        if (l) {
          leaf = l;
          break;
        }
      }
      if (leaf) {
        return [{
          name: leaf.name,
          type: 'Application Signature',
          details: `${leaf.category} / Risk: ${leaf.risk}`,
          path: [...currentPath, groupName]
        }];
      }
      return [{
        name: groupName,
        type: 'Unresolved',
        details: 'Custom application signature',
        path: [...currentPath, groupName]
      }];
    }

    const members = group.member_list ? group.member_list.split(',') : [];
    let resolved: any[] = [];
    members.forEach((m: string) => {
      const mName = m.trim();
      if (!mName) return;
      resolved = resolved.concat(resolveApplicationGroupMembers(mName, group.device_uuid, [...currentPath, groupName], newVisited));
    });
    return resolved;
  };

  // Recursive ancestors search
  const visibleScopes = useMemo(() => {
    if (currentScope === 'show-all') {
      return [];
    }
    let activeScope = currentScope;
    if (currentScope.startsWith('fw-')) {
      const serial = currentScope.replace('fw-', '');
      const fw = firewalls.find(f => f.serial === serial);
      if (fw && fw.device_group_id) {
        const dg = deviceGroups.find(g => g.id === fw.device_group_id);
        if (dg) {
          activeScope = dg.uuid;
        } else {
          activeScope = 'paloalto-panorama-global';
        }
      } else {
        activeScope = 'paloalto-panorama-global';
      }
    }

    if (activeScope === 'paloalto-panorama-global') {
      return ['paloalto-panorama-global'];
    }
    const scopes = [activeScope];
    let curr = deviceGroups.find(dg => dg.uuid === activeScope);
    while (curr && curr.parent_id) {
      const parent = deviceGroups.find(dg => dg.id === curr.parent_id);
      if (parent) {
        scopes.push(parent.uuid);
        curr = parent;
      } else {
        break;
      }
    }
    scopes.push('paloalto-panorama-global');
    return scopes;
  }, [currentScope, deviceGroups, firewalls]);

  // Fetch active tab records
  const fetchRecords = async () => {
    if (!apiClient) return;
    setLoading(true);
    try {
      const isShowAll = currentScope === 'show-all';
      const scopeFilter = isShowAll ? '' : visibleScopes.map(s => `'${s}'`).join(',');
      let query = '';

      switch (activeSubTab) {
        case 'Address Objects':
          query = isShowAll
            ? `SELECT * FROM address_objects ORDER BY name ASC;`
            : `SELECT * FROM address_objects WHERE device_uuid IN (${scopeFilter}) ORDER BY name ASC;`;
          break;
        case 'Address Groups':
          query = isShowAll
            ? `
              SELECT g.*, CAST(GROUP_CONCAT(COALESCE(ao.name, nested.name, agm.member_name)) AS TEXT) AS member_list
              FROM address_groups g
              LEFT JOIN address_group_members agm ON g.id = agm.group_id
              LEFT JOIN address_objects ao ON agm.member_address_id = ao.id
              LEFT JOIN address_groups nested ON agm.member_group_id = nested.id
              GROUP BY g.id
              ORDER BY g.name ASC;
            `
            : `
              SELECT g.*, CAST(GROUP_CONCAT(COALESCE(ao.name, nested.name, agm.member_name)) AS TEXT) AS member_list
              FROM address_groups g
              LEFT JOIN address_group_members agm ON g.id = agm.group_id
              LEFT JOIN address_objects ao ON agm.member_address_id = ao.id
              LEFT JOIN address_groups nested ON agm.member_group_id = nested.id
              WHERE g.device_uuid IN (${scopeFilter})
              GROUP BY g.id
              ORDER BY g.name ASC;
            `;
          break;
        case 'Services':
          query = isShowAll
            ? `SELECT * FROM service_objects ORDER BY name ASC;`
            : `SELECT * FROM service_objects WHERE device_uuid IN (${scopeFilter}) ORDER BY name ASC;`;
          break;
        case 'Service Groups':
          query = isShowAll
            ? `
              SELECT g.*, CAST(GROUP_CONCAT(COALESCE(so.name, nested.name, sgm.member_name)) AS TEXT) AS member_list
              FROM service_groups g
              LEFT JOIN service_group_members sgm ON g.id = sgm.group_id
              LEFT JOIN service_objects so ON sgm.member_service_id = so.id
              LEFT JOIN service_groups nested ON sgm.member_group_id = nested.id
              GROUP BY g.id
              ORDER BY g.name ASC;
            `
            : `
              SELECT g.*, CAST(GROUP_CONCAT(COALESCE(so.name, nested.name, sgm.member_name)) AS TEXT) AS member_list
              FROM service_groups g
              LEFT JOIN service_group_members sgm ON g.id = sgm.group_id
              LEFT JOIN service_objects so ON sgm.member_service_id = so.id
              LEFT JOIN service_groups nested ON sgm.member_group_id = nested.id
              WHERE g.device_uuid IN (${scopeFilter})
              GROUP BY g.id
              ORDER BY g.name ASC;
            `;
          break;
        case 'Applications':
          query = isShowAll
            ? `SELECT * FROM application_objects ORDER BY name ASC;`
            : `SELECT * FROM application_objects WHERE device_uuid IN (${scopeFilter}) ORDER BY name ASC;`;
          break;
        case 'Application Groups':
          query = isShowAll
            ? `
              SELECT g.*, CAST(GROUP_CONCAT(COALESCE(app.name, nested.name, appgm.member_name)) AS TEXT) AS member_list
              FROM application_groups g
              LEFT JOIN application_group_members appgm ON g.id = appgm.group_id
              LEFT JOIN application_objects app ON appgm.member_application_id = app.id
              LEFT JOIN application_groups nested ON appgm.member_group_id = nested.id
              GROUP BY g.id
              ORDER BY g.name ASC;
            `
            : `
              SELECT g.*, CAST(GROUP_CONCAT(COALESCE(app.name, nested.name, appgm.member_name)) AS TEXT) AS member_list
              FROM application_groups g
              LEFT JOIN application_group_members appgm ON g.id = appgm.group_id
              LEFT JOIN application_objects app ON appgm.member_application_id = app.id
              LEFT JOIN application_groups nested ON appgm.member_group_id = nested.id
              WHERE g.device_uuid IN (${scopeFilter})
              GROUP BY g.id
              ORDER BY g.name ASC;
            `;
          break;
      }

      if (query) {
        const res = await apiClient.queryDb(query);
        setTableData(res.rows || []);
      }
    } catch (err) {
      console.error('Failed to load table data:', err);
      addToast('Failed to load objects from the database.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Load reference entities for modals
  const loadReferenceData = async () => {
    if (!apiClient) return;
    try {
      const [addRes, addGrpRes, svcRes, svcGrpRes, appRes, appGrpRes] = await Promise.all([
        apiClient.queryDb("SELECT id, name, device_uuid, type, value FROM address_objects;"),
        apiClient.queryDb(`
          SELECT g.id, g.name, g.device_uuid, g.type, g.filter, CAST(GROUP_CONCAT(COALESCE(ao.name, nested.name, agm.member_name)) AS TEXT) AS member_list
          FROM address_groups g
          LEFT JOIN address_group_members agm ON g.id = agm.group_id
          LEFT JOIN address_objects ao ON agm.member_address_id = ao.id
          LEFT JOIN address_groups nested ON agm.member_group_id = nested.id
          GROUP BY g.id;
        `),
        apiClient.queryDb("SELECT id, name, device_uuid, protocol, destination_port FROM service_objects;"),
        apiClient.queryDb(`
          SELECT g.id, g.name, g.device_uuid, CAST(GROUP_CONCAT(COALESCE(so.name, nested.name, sgm.member_name)) AS TEXT) AS member_list
          FROM service_groups g
          LEFT JOIN service_group_members sgm ON g.id = sgm.group_id
          LEFT JOIN service_objects so ON sgm.member_service_id = so.id
          LEFT JOIN service_groups nested ON sgm.member_group_id = nested.id
          GROUP BY g.id;
        `),
        apiClient.queryDb("SELECT id, name, device_uuid, category, risk FROM application_objects;"),
        apiClient.queryDb(`
          SELECT g.id, g.name, g.device_uuid, CAST(GROUP_CONCAT(COALESCE(app.name, nested.name, appgm.member_name)) AS TEXT) AS member_list
          FROM application_groups g
          LEFT JOIN application_group_members appgm ON g.id = appgm.group_id
          LEFT JOIN application_objects app ON appgm.member_application_id = app.id
          LEFT JOIN application_groups nested ON appgm.member_group_id = nested.id
          GROUP BY g.id;
        `),
      ]);

      setAllAddresses(addRes.rows || []);
      setAllAddressGroups(addGrpRes.rows || []);
      setAllServices(svcRes.rows || []);
      setAllServiceGroups(svcGrpRes.rows || []);
      setAllApplications(appRes.rows || []);
      setAllApplicationGroups(appGrpRes.rows || []);
    } catch (e) {
      console.error('Failed to load validation reference lists', e);
    }
  };

  useEffect(() => {
    fetchRecords();
    setSelectedRows([]);
  }, [activeSubTab, currentScope, deviceGroups, firewalls]);

  // Group members slide-over panel
  const flattenedMembers = useMemo(() => {
    if (!selectedGroupDetails) return [];
    let rawList: any[] = [];
    if (activeSubTab === 'Address Groups') {
      rawList = resolveAddressGroupMembers(selectedGroupDetails.name, selectedGroupDetails.device_uuid);
    } else if (activeSubTab === 'Service Groups') {
      rawList = resolveServiceGroupMembers(selectedGroupDetails.name, selectedGroupDetails.device_uuid);
    } else if (activeSubTab === 'Application Groups') {
      rawList = resolveApplicationGroupMembers(selectedGroupDetails.name, selectedGroupDetails.device_uuid);
    }

    // Deduplicate and aggregate paths
    const aggregated: { [key: string]: any } = {};
    rawList.forEach(item => {
      const existing = aggregated[item.name];
      if (existing) {
        if (item.path && item.path.length > 1) {
          const displayPath = item.path.slice(1).join(' > ');
          if (displayPath && !existing.paths.includes(displayPath)) {
            existing.paths.push(displayPath);
          }
        }
      } else {
        const displayPaths = item.path && item.path.length > 1 
          ? [item.path.slice(1).join(' > ')] 
          : [];
        aggregated[item.name] = {
          name: item.name,
          type: item.type,
          details: item.details,
          paths: displayPaths
        };
      }
    });

    return Object.values(aggregated);
  }, [selectedGroupDetails, activeSubTab, allAddresses, allAddressGroups, allServices, allServiceGroups, allApplications, allApplicationGroups]);

  // Inspector Search Filters
  const filteredResolvedMembers = useMemo(() => {
    if (!inspectorSearch.trim()) return resolvedMembers;
    const q = inspectorSearch.toLowerCase();
    return resolvedMembers.filter(m => {
      const title = (m.member_name || m.address_name || m.service_name || m.app_name || m.nested_group_name || '').toLowerCase();
      const details = `${m.address_value || ''} ${m.service_port || ''} ${m.app_category || ''} ${m.address_type || ''} ${m.service_protocol || ''}`.toLowerCase();
      return title.includes(q) || details.includes(q);
    });
  }, [resolvedMembers, inspectorSearch]);

  const filteredFlattenedMembers = useMemo(() => {
    if (!inspectorSearch.trim()) return flattenedMembers;
    const q = inspectorSearch.toLowerCase();
    return flattenedMembers.filter(m => {
      return (m.name || '').toLowerCase().includes(q) || (m.details || '').toLowerCase().includes(q);
    });
  }, [flattenedMembers, inspectorSearch]);

  const handleOpenSlideOver = async (groupRow: any) => {
    setSelectedGroupDetails(groupRow);
    setIsSlideOverOpen(true);
    setSlideOverLoading(true);
    setResolvedMembers([]);
    setInspectorSearch('');

    if (!apiClient) return;

    // Load reference data to ensure we have all addresses, groups, etc. in memory for recursive flattening
    await loadReferenceData();

    let memberQuery = '';
    switch (activeSubTab) {
      case 'Address Groups':
        memberQuery = `
          SELECT agm.member_name, ao.name AS address_name, ao.type AS address_type, ao.value AS address_value, nested.name AS nested_group_name
          FROM address_group_members agm
          LEFT JOIN address_objects ao ON agm.member_address_id = ao.id
          LEFT JOIN address_groups nested ON agm.member_group_id = nested.id
          WHERE agm.group_id = ?;
        `;
        break;
      case 'Service Groups':
        memberQuery = `
          SELECT sgm.member_name, so.name AS service_name, so.protocol AS service_protocol, so.destination_port AS service_port, nested.name AS nested_group_name
          FROM service_group_members sgm
          LEFT JOIN service_objects so ON sgm.member_service_id = so.id
          LEFT JOIN service_groups nested ON sgm.member_group_id = nested.id
          WHERE sgm.group_id = ?;
        `;
        break;
      case 'Application Groups':
        memberQuery = `
          SELECT appgm.member_name, appo.name AS app_name, appo.category AS app_category, nested.name AS nested_group_name
          FROM application_group_members appgm
          LEFT JOIN application_objects appo ON appgm.member_application_id = appo.id
          LEFT JOIN application_groups nested ON appgm.member_group_id = nested.id
          WHERE appgm.group_id = ?;
        `;
        break;
    }

    try {
      const res = await apiClient.queryDb(memberQuery.replace('?', String(groupRow.id)));
      setResolvedMembers(res.rows || []);
    } catch (e) {
      console.error('Failed to resolve group members details', e);
      addToast('Failed to fetch group member details.', 'error');
    } finally {
      setSlideOverLoading(false);
    }
  };

  // CRUD Forms handlers
  const openCreateModal = () => {
    loadReferenceData();
    setSelectorSearchQuery('');
    setSelectorCheckedNames([]);
    setIsSelectorModalOpen(false);
    setMemberSearchQuery('');
    setMemberCheckedNames([]);
    setCrudMode('create');
    setSelectedObject(null);
    setFormName('');
    setFormScopeUuid(currentScope);
    setFormDescription('');
    setFormMembers([]);

    // Set subtab specific defaults
    if (activeSubTab === 'Address Objects') {
      setFormType('ip-netmask');
      setFormValue('');
    } else if (activeSubTab === 'Address Groups') {
      setFormType('static');
      setFormFilter('');
    } else if (activeSubTab === 'Services') {
      setFormProtocol('tcp');
      setFormSourcePort('');
      setFormDestPort('');
    } else if (activeSubTab === 'Applications') {
      setFormCategory('general-internet');
      setFormSubcategory('internet-utility');
      setFormTechnology('browser-based');
      setFormRisk(1);
      setFormPorts('');
    }

    setIsCrudModalOpen(true);
  };

  const openEditModal = (obj: any) => {
    loadReferenceData();
    setSelectorSearchQuery('');
    setSelectorCheckedNames([]);
    setIsSelectorModalOpen(false);
    setMemberSearchQuery('');
    setMemberCheckedNames([]);
    setCrudMode('edit');
    setSelectedObject(obj);
    setFormName(obj.name);
    setFormScopeUuid(obj.device_uuid);
    setFormDescription(obj.description || '');

    // Set fields
    if (activeSubTab === 'Address Objects') {
      setFormType(obj.type);
      setFormValue(obj.value);
    } else if (activeSubTab === 'Address Groups') {
      setFormType(obj.type || 'static');
      setFormFilter(obj.filter || '');
      setFormMembers(obj.member_list ? obj.member_list.split(',') : []);
    } else if (activeSubTab === 'Services') {
      setFormProtocol(obj.protocol);
      setFormSourcePort(obj.source_port || '');
      setFormDestPort(obj.destination_port);
    } else if (activeSubTab === 'Service Groups') {
      setFormMembers(obj.member_list ? obj.member_list.split(',') : []);
    } else if (activeSubTab === 'Applications') {
      setFormCategory(obj.category);
      setFormSubcategory(obj.subcategory || obj.subcategory);
      setFormTechnology(obj.technology);
      setFormRisk(obj.risk || 1);
      setFormPorts(obj.ports || '');
    } else if (activeSubTab === 'Application Groups') {
      setFormMembers(obj.member_list ? obj.member_list.split(',') : []);
    }

    setIsCrudModalOpen(true);
  };

  const handleSaveObject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiClient) return;

    // Client-side validations
    if (!formName.trim()) {
      addToast('Name is required.', 'error');
      return;
    }
    const nameRegex = /^[a-zA-Z0-9_\-\.]+$/;
    if (!nameRegex.test(formName)) {
      addToast('Name contains illegal characters. Only alphanumeric, underscores, hyphens, and dots allowed.', 'error');
      return;
    }

    // Prepare data
    const activeScopeName = scopeNameMap[formScopeUuid] || 'Shared';
    const payload: Record<string, any> = {
      device_uuid: formScopeUuid,
      scope: activeScopeName,
      name: formName.trim(),
      description: formDescription.trim()
    };

    if (crudMode === 'edit') {
      payload.id = selectedObject.id;
    }

    try {
      let result: any;
      if (activeSubTab === 'Address Objects') {
        payload.type = formType;
        payload.value = formValue.trim();
        if (crudMode === 'create') result = await apiClient.createAddressObject(payload);
        else result = await apiClient.updateAddressObject(payload);
      } else if (activeSubTab === 'Address Groups') {
        payload.type = formType;
        payload.filter = formType === 'dynamic' ? formFilter.trim() : '';
        payload.members = formType === 'static' ? formMembers : [];
        if (crudMode === 'create') result = await apiClient.createAddressGroup(payload);
        else result = await apiClient.updateAddressGroup(payload);
      } else if (activeSubTab === 'Services') {
        payload.protocol = formProtocol;
        payload.source_port = formSourcePort.trim();
        payload.destination_port = formDestPort.trim();
        if (crudMode === 'create') result = await apiClient.createServiceObject(payload);
        else result = await apiClient.updateServiceObject(payload);
      } else if (activeSubTab === 'Service Groups') {
        payload.members = formMembers;
        if (crudMode === 'create') result = await apiClient.createServiceGroup(payload);
        else result = await apiClient.updateServiceGroup(payload);
      } else if (activeSubTab === 'Applications') {
        payload.category = formCategory.trim();
        payload.subcategory = formSubcategory.trim();
        payload.technology = formTechnology.trim();
        payload.risk = Number(formRisk);
        payload.ports = formPorts.trim();
        if (crudMode === 'create') result = await apiClient.createApplicationObject(payload);
        else result = await apiClient.updateApplicationObject(payload);
      } else if (activeSubTab === 'Application Groups') {
        payload.members = formMembers;
        if (crudMode === 'create') result = await apiClient.createApplicationGroup(payload);
        else result = await apiClient.updateApplicationGroup(payload);
      }

      addToast(
        `Object successfully ${crudMode === 'create' ? 'created' : 'updated'}. Row flagged as edited.`,
        'success'
      );
      setIsCrudModalOpen(false);
      fetchRecords();
    } catch (err: any) {
      console.error('CRUD Save Error:', err);
      addToast(err.message || 'Failed to save configuration object.', 'error');
    }
  };

  const handleDeleteObject = (obj: any) => {
    if (!apiClient) return;
    confirm({
      title: 'Delete Object',
      message: `Are you sure you want to delete "${obj.name}"?`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: async () => {
        try {
          if (activeSubTab === 'Address Objects') await apiClient.deleteAddressObject(obj.id);
          else if (activeSubTab === 'Address Groups') await apiClient.deleteAddressGroup(obj.id);
          else if (activeSubTab === 'Services') await apiClient.deleteServiceObject(obj.id);
          else if (activeSubTab === 'Service Groups') await apiClient.deleteServiceGroup(obj.id);
          else if (activeSubTab === 'Applications') await apiClient.deleteApplicationObject(obj.id);
          else if (activeSubTab === 'Application Groups') await apiClient.deleteApplicationGroup(obj.id);

          addToast(`Deleted object "${obj.name}" successfully.`, 'success');
          fetchRecords();
        } catch (err: any) {
          console.error('CRUD Delete Error:', err);
          addToast(err.message || 'Failed to delete object.', 'error');
        }
      }
    });
  };

  // Bulk Delete
  const handleBulkDelete = () => {
    if (!apiClient || selectedRows.length === 0) return;
    confirm({
      title: 'Bulk Delete Objects',
      message: `Are you sure you want to delete the ${selectedRows.length} selected objects?`,
      confirmText: 'Delete All',
      isDestructive: true,
      onConfirm: async () => {
        setLoading(true);
        let deletedCount = 0;
        try {
          for (const row of selectedRows) {
            if (activeSubTab === 'Address Objects') await apiClient.deleteAddressObject(row.id);
            else if (activeSubTab === 'Address Groups') await apiClient.deleteAddressGroup(row.id);
            else if (activeSubTab === 'Services') await apiClient.deleteServiceObject(row.id);
            else if (activeSubTab === 'Service Groups') await apiClient.deleteServiceGroup(row.id);
            else if (activeSubTab === 'Applications') await apiClient.deleteApplicationObject(row.id);
            else if (activeSubTab === 'Application Groups') await apiClient.deleteApplicationGroup(row.id);
            deletedCount++;
          }
          addToast(`Successfully deleted ${deletedCount} objects.`, 'success');
          fetchRecords();
          setSelectedRows([]);
        } catch (err: any) {
          console.error('Bulk Delete Error:', err);
          addToast(`Deleted ${deletedCount} items. Failed to delete remainder: ` + err.message, 'error');
          fetchRecords();
        } finally {
          setLoading(false);
        }
      }
    });
  };

  // Drag and Drop Application CSV Ingestor
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDropCSV = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await uploadCSV(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await uploadCSV(e.target.files[0]);
    }
  };

  const uploadCSV = async (file: File) => {
    if (!apiClient) return;
    if (!file.name.endsWith('.csv')) {
      addToast('Only standard CSV package spreadsheets can be imported.', 'error');
      return;
    }

    setCsvUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('device_uuid', currentScope);
    formData.append('scope', scopeNameMap[currentScope] || 'Shared');

    try {
      const res = await apiClient.importApplicationCSV(formData);
      addToast(`App-ID Import Success! Ingested ${res.inserted} signatures, updated ${res.updated} signatures.`, 'success');
      fetchRecords();
    } catch (err: any) {
      console.error('CSV Ingest Error:', err);
      addToast(err.message || 'Failed to ingest Application spreadsheet package.', 'error');
    } finally {
      setCsvUploading(false);
    }
  };

  // Generate CLI commands
  const handleGenerateCli = () => {
    const rows = selectedRows.length > 0 ? selectedRows : tableData;
    if (rows.length === 0) {
      addToast('No records available to generate commands.', 'info');
      return;
    }

    let commands: string[] = [];

    rows.forEach(row => {
      const isShared = row.device_uuid === 'paloalto-panorama-global';
      const scopePrefix = isShared
        ? 'set shared'
        : `set device-group ${scopeNameMap[row.device_uuid] || 'DG'}`;

      switch (activeSubTab) {
        case 'Address Objects':
          commands.push(`${scopePrefix} address ${row.name} ${row.type} ${row.value}`);
          if (row.description) {
            commands.push(`${scopePrefix} address ${row.name} description "${row.description}"`);
          }
          break;
        case 'Address Groups':
          if (row.type === 'dynamic') {
            commands.push(`${scopePrefix} address-group ${row.name} dynamic filter "${row.filter}"`);
          } else {
            const members = row.member_list ? row.member_list.split(',') : [];
            members.forEach((m: string) => {
              commands.push(`${scopePrefix} address-group ${row.name} static ${m}`);
            });
          }
          if (row.description) {
            commands.push(`${scopePrefix} address-group ${row.name} description "${row.description}"`);
          }
          break;
        case 'Services':
          commands.push(`${scopePrefix} service ${row.name} protocol ${row.protocol} port ${row.destination_port}`);
          if (row.source_port) {
            commands.push(`${scopePrefix} service ${row.name} protocol ${row.protocol} source-port ${row.source_port}`);
          }
          if (row.description) {
            commands.push(`${scopePrefix} service ${row.name} description "${row.description}"`);
          }
          break;
        case 'Service Groups':
          const svcMembers = row.member_list ? row.member_list.split(',') : [];
          svcMembers.forEach((m: string) => {
            commands.push(`${scopePrefix} service-group ${row.name} members ${m}`);
          });
          if (row.description) {
            commands.push(`${scopePrefix} service-group ${row.name} description "${row.description}"`);
          }
          break;
        case 'Applications':
          commands.push(`${scopePrefix} application ${row.name} category ${row.category} subcategory ${row.subcategory || row.subcategory} technology ${row.technology} risk ${row.risk}`);
          if (row.ports) {
            commands.push(`${scopePrefix} application ${row.name} ports ${row.ports}`);
          }
          if (row.description) {
            commands.push(`${scopePrefix} application ${row.name} description "${row.description}"`);
          }
          break;
        case 'Application Groups':
          const appMembers = row.member_list ? row.member_list.split(',') : [];
          appMembers.forEach((m: string) => {
            commands.push(`${scopePrefix} application-group ${row.name} members ${m}`);
          });
          if (row.description) {
            commands.push(`${scopePrefix} application-group ${row.name} description "${row.description}"`);
          }
          break;
      }
    });

    setGeneratedCommands(commands.join('\n'));
    setIsCliModalOpen(true);
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(generatedCommands);
    addToast('Commands copied to clipboard!', 'success');
  };

  // Define table columns dynamically based on sub-tab
  const columns: ColumnDef[] = useMemo(() => {
    const defaultCols: ColumnDef[] = [
      {
        key: 'name',
        label: 'Name',
        width: '240px',
        renderCell: (val, row, query) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 500 }}><HighlightedText text={val} highlight={query} /></span>
            {row.dirty === 1 && (
              <span style={{
                fontSize: '9px',
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                color: '#f59e0b',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '3px',
                padding: '1px 5px',
                fontWeight: 600,
                letterSpacing: '0.3px',
                boxShadow: '0 0 4px rgba(245, 158, 11, 0.15)'
              }}>
                EDITED
              </span>
            )}
          </div>
        )
      },
      {
        key: 'device_uuid',
        label: 'Scope Context',
        width: '180px',
        renderCell: (val, row, query) => {
          const isShared = val === 'paloalto-panorama-global';
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isShared ? (
                <span className="badge badge-info" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Globe size={11} /> <HighlightedText text="Shared" highlight={query} />
                </span>
              ) : (
                <span className="badge badge-neutral" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Layers size={11} /> <HighlightedText text={scopeNameMap[val] || val} highlight={query} />
                </span>
              )}
            </div>
          );
        }
      }
    ];

    let subtabCols: ColumnDef[] = [];
    switch (activeSubTab) {
      case 'Address Objects':
        subtabCols = [
          { key: 'type', label: 'Type', width: '130px' },
          { key: 'value', label: 'Address / Netmask / Range', width: '220px' },
        ];
        break;
      case 'Address Groups':
        subtabCols = [
          {
            key: 'type',
            label: 'Mode',
            width: '120px',
            renderCell: (val) => (
              <span className={`badge ${val === 'dynamic' ? 'badge-warning' : 'badge-neutral'}`}>
                {val}
              </span>
            )
          },
          {
            key: 'member_list',
            label: 'Members / Dynamic Filter',
            width: '320px',
            renderCell: (val, row, query) => {
              if (row.type === 'dynamic') {
                return <code style={{ color: 'var(--accent-blue)', fontSize: '11px' }}><HighlightedText text={row.filter || 'No Filter'} highlight={query} /></code>;
              }
              const list = val ? val.split(',') : [];
              if (list.length === 0) return <span style={{ color: 'var(--text-muted)' }}>No members</span>;
              return (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '300px', overflow: 'hidden' }}>
                  {list.slice(0, 3).map((m: string) => (
                    <span
                      key={m}
                      title={m}
                      style={{
                        fontSize: '11px',
                        padding: '1px 6px',
                        borderRadius: '3px',
                        backgroundColor: 'var(--bg-app)',
                        border: '1px solid var(--border-main)',
                        color: 'var(--text-main)',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        maxWidth: '90px'
                      }}
                    >
                      <HighlightedText text={m} highlight={query} />
                    </span>
                  ))}
                  {list.length > 3 && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '0 4px' }}>
                      +{list.length - 3} more
                    </span>
                  )}
                </div>
              );
            }
          }
        ];
        break;
      case 'Services':
        subtabCols = [
          {
            key: 'protocol',
            label: 'Protocol',
            width: '110px',
            renderCell: (val, row, query) => (
              <span className="badge badge-info" style={{ fontWeight: 600 }}><HighlightedText text={String(val).toUpperCase()} highlight={query} /></span>
            )
          },
          { key: 'destination_port', label: 'Destination Ports', width: '200px' },
          { key: 'source_port', label: 'Source Ports', width: '130px' },
        ];
        break;
      case 'Service Groups':
        subtabCols = [
          {
            key: 'member_list',
            label: 'Members list',
            width: '320px',
            renderCell: (val, row, query) => {
              const list = val ? val.split(',') : [];
              if (list.length === 0) return <span style={{ color: 'var(--text-muted)' }}>No members</span>;
              return (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '300px' }}>
                  {list.slice(0, 3).map((m: string) => (
                    <span
                      key={m}
                      title={m}
                      style={{
                        fontSize: '11px',
                        padding: '1px 6px',
                        borderRadius: '3px',
                        backgroundColor: 'var(--bg-app)',
                        border: '1px solid var(--border-main)',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        maxWidth: '90px'
                      }}
                    >
                      <HighlightedText text={m} highlight={query} />
                    </span>
                  ))}
                  {list.length > 3 && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                      +{list.length - 3} more
                    </span>
                  )}
                </div>
              );
            }
          }
        ];
        break;
      case 'Applications':
        subtabCols = [
          { key: 'category', label: 'Category', width: '150px' },
          { key: 'subcategory', label: 'Sub-Category', width: '150px' },
          { key: 'technology', label: 'Technology', width: '140px' },
          {
            key: 'risk',
            label: 'Risk Level',
            width: '120px',
            renderCell: (val) => {
              const num = Number(val);
              let color = 'rgba(16, 185, 129, 0.2)'; // green
              let textColor = '#10b981';
              if (num >= 4) {
                color = 'rgba(239, 68, 68, 0.2)'; // red
                textColor = '#ef4444';
              } else if (num >= 3) {
                color = 'rgba(245, 158, 11, 0.2)'; // amber
                textColor = '#f59e0b';
              }
              return (
                <span style={{
                  backgroundColor: color,
                  color: textColor,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  {num} / 5
                </span>
              );
            }
          },
          { key: 'ports', label: 'Ports List', width: '180px' },
        ];
        break;
      case 'Application Groups':
        subtabCols = [
          {
            key: 'member_list',
            label: 'Signature Members',
            width: '320px',
            renderCell: (val, row, query) => {
              const list = val ? val.split(',') : [];
              if (list.length === 0) return <span style={{ color: 'var(--text-muted)' }}>No members</span>;
              return (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '300px' }}>
                  {list.slice(0, 3).map((m: string) => (
                    <span
                      key={m}
                      title={m}
                      style={{
                        fontSize: '11px',
                        padding: '1px 6px',
                        borderRadius: '3px',
                        backgroundColor: 'var(--bg-app)',
                        border: '1px solid var(--border-main)',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        maxWidth: '90px'
                      }}
                    >
                      <HighlightedText text={m} highlight={query} />
                    </span>
                  ))}
                  {list.length > 3 && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                      +{list.length - 3} more
                    </span>
                  )}
                </div>
              );
            }
          }
        ];
        break;
    }

    const actionCols: ColumnDef[] = [
      { key: 'description', label: 'Description', width: '220px' },
      {
        key: 'id',
        label: 'Actions',
        width: '120px',
        renderCell: (val, row) => {
          const isGroup = activeSubTab.endsWith('Groups');
          return (
            <div style={{ display: 'flex', gap: '6px' }}>
              {isGroup && (
                <button
                  className="btn-table-action"
                  onClick={() => handleOpenSlideOver(row)}
                  title="Inspect Members Details"
                >
                  <Eye size={14} />
                </button>
              )}
              <button
                className="btn-table-action"
                onClick={() => openEditModal(row)}
                title="Edit Object"
              >
                <Edit2 size={14} />
              </button>
              <button
                className="btn-table-action-danger"
                onClick={() => handleDeleteObject(row)}
                title="Delete Object"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        }
      }
    ];

    return [...defaultCols, ...subtabCols, ...actionCols];
  }, [activeSubTab, scopeNameMap]);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', margin: '-20px', overflow: 'hidden' }}>
      {/* 2. Main content canvas */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Scope context summary top header */}
        <div style={{ height: '70px', padding: '0 20px', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, overflow: 'visible', position: 'relative', zIndex: 1010 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', height: '100%', overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, width: '300px' }}>
              <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)' }}>
                {activeSubTab}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                Active Scope context: <strong style={{ color: 'var(--accent-blue)' }}>{scopeNameMap[currentScope] || currentScope}</strong>
                {visibleScopes.length > 1 && (
                  <Tooltip content={visibleScopes.slice(1).map(s => scopeNameMap[s] || s).join(' -> ')} position="bottom">
                    <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                      ({visibleScopes.slice(1).map(s => scopeNameMap[s] || s).join(' -> ')})
                    </span>
                  </Tooltip>
                )}
              </span>
            </div>

            {/* Top Panorama-Style Device Group Selection Dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>Device Group:</span>
              <SearchableScopeDropdown
                value={currentScope}
                options={hierarchyOptions}
                onChange={handleScopeChange}
                scopeNameMap={scopeNameMap}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {selectedRows.length > 0 && (
              <button
                onClick={handleBulkDelete}
                className="btn-danger btn-sm"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Trash2 size={13} /> Bulk Delete ({selectedRows.length})
              </button>
            )}
            <button
              onClick={handleGenerateCli}
              className="btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Code size={13} /> {selectedRows.length > 0 ? `Generate CLI (${selectedRows.length})` : 'Generate CLI'}
            </button>
            <button
              onClick={openCreateModal}
              className="btn-primary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={14} /> Add Object
            </button>
          </div>
        </div>

        {/* Ingest Pack drop-zone (Only for Custom Applications list) */}
        {activeSubTab === 'Applications' && (
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDropCSV}
            style={{
              margin: '15px 20px 0 20px',
              padding: '20px',
              border: `2px dashed ${dragActive ? 'var(--accent-blue)' : 'var(--border-main)'}`,
              borderRadius: '6px',
              backgroundColor: dragActive ? 'rgba(59, 130, 246, 0.05)' : 'var(--bg-surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 0.2s ease',
              flexShrink: 0
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-blue)'
              }}>
                {csvUploading ? <Loader2 className="spin-animation" size={20} /> : <FileUp size={20} />}
              </div>
              <div>
                <div style={{ fontWeight: 500, fontSize: '13px', color: 'var(--text-main)' }}>Import Apps Package (CSV)</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Drop a Palo Alto standard App-ID package spreadsheet to bulk-ingest signatures. Duplicates are upserted.
                </div>
              </div>
            </div>
            <div>
              <label
                className={`btn-secondary btn-sm ${csvUploading ? 'disabled' : ''}`}
                style={{ cursor: csvUploading ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  disabled={csvUploading}
                  style={{ display: 'none' }}
                />
                Browse File
              </label>
            </div>
          </div>
        )}

        {/* Global Search Filtering Tool */}
        <div style={{ padding: '10px 20px', backgroundColor: 'var(--bg-app)', display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={`Search ${activeSubTab.toLowerCase()}...`}
            width="100%"
            variant="local"
          />
        </div>

        {/* The data table area - Stretch to edge-to-edge */}
        <div style={{ flex: 1, padding: '0 0 20px 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)', gap: '10px' }}>
              <Loader2 className="spin-animation" size={20} /> Loading database records...
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={tableData}
              searchQuery={searchQuery}
              selectable={true}
              onSelectionChange={setSelectedRows}
              exportFilename={`${activeSubTab.toLowerCase().replace(' ', '_')}_export.csv`}
              highlightRow={(row) => row.dirty === 1}
            />
          )}
        </div>
      </div>

      {/* 3. Group members detailed slide-over panel */}
      {isSlideOverOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: '400px',
            backgroundColor: 'var(--bg-surface)',
            borderLeft: '1px solid var(--border-main)',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.4)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideIn 0.2s ease-out'
          }}
        >
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border-main)', display: 'flex', flexDirection: 'column', gap: '15px', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Group Detail Inspector</div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)', marginTop: '4px' }}>
                  {selectedGroupDetails?.name}
                </div>
              </div>
              <button
                onClick={() => setIsSlideOverOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Search filter in inspector */}
            <SearchBar
              value={inspectorSearch}
              onChange={setInspectorSearch}
              placeholder="Search group members..."
              width="100%"
              variant="local"
            />
          </div>

          <div style={{ flex: 1, padding: '20px 20px 100px 20px', overflowY: 'auto' }}>
            {slideOverLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '150px', color: 'var(--text-muted)', gap: '10px' }}>
                <Loader2 className="spin-animation" size={16} /> Resolving group memberships...
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* 1. Configured Members (Direct) */}
                <div>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>
                    Configured Members ({filteredResolvedMembers.length})
                  </h4>
                  {filteredResolvedMembers.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border-main)', borderRadius: '4px', fontSize: '12px', backgroundColor: 'var(--bg-app)' }}>
                      No static members configured.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {filteredResolvedMembers.map((member, idx) => {
                        let title = member.member_name || '';
                        let subtitle = 'Unresolved/External';

                        let cardIcon = <Tag size={14} className="text-accent" />;
                        let displayType = 'Member';
                        let displayDetails = subtitle;

                        if (member.address_name) {
                          title = member.address_name;
                          cardIcon = <Globe size={14} style={{ color: 'var(--accent-blue)' }} />;
                          displayType = `Address Object (${member.address_type})`;
                          displayDetails = member.address_value;
                        } else if (member.service_name) {
                          title = member.service_name;
                          cardIcon = <Network size={14} style={{ color: '#10b981' }} />;
                          displayType = `Port Service (${String(member.service_protocol).toUpperCase()})`;
                          displayDetails = member.service_port;
                        } else if (member.app_name) {
                          title = member.app_name;
                          cardIcon = <ShieldAlert size={14} style={{ color: '#f59e0b' }} />;
                          displayType = `App-ID`;
                          displayDetails = member.app_category;
                        } else if (member.nested_group_name) {
                          title = member.nested_group_name;
                          cardIcon = <Layers size={14} style={{ color: '#a855f7' }} />;
                          displayType = 'Nested Group';
                          displayDetails = 'Address Group';
                        }

                        return (
                          <div
                            key={idx}
                            style={{
                              padding: '10px 12px',
                              border: '1px solid var(--border-main)',
                              borderRadius: '4px',
                              backgroundColor: 'var(--bg-app)',
                              display: 'flex',
                              gap: '10px',
                              alignItems: 'flex-start',
                              minWidth: 0
                            }}
                          >
                            <div style={{ marginTop: '3px', flexShrink: 0 }}>
                              {cardIcon}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
                              <span style={{ fontWeight: 500, color: 'var(--text-main)', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={title}>
                                <HighlightedText text={title} highlight={inspectorSearch} />
                              </span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${displayType} • ${displayDetails}`}>
                                <HighlightedText text={`${displayType} • ${displayDetails}`} highlight={inspectorSearch} />
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 2. Flattened Total View (Recursive) */}
                <div style={{ borderTop: '1px solid var(--border-main)', paddingTop: '20px' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Globe size={12} style={{ color: 'var(--accent-blue)' }} /> Resolved Members (Flattened Total View) ({filteredFlattenedMembers.length})
                  </h4>
                  {filteredFlattenedMembers.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border-main)', borderRadius: '4px', fontSize: '12px', backgroundColor: 'var(--bg-app)' }}>
                      No resolved elements found.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {filteredFlattenedMembers.map((member, idx) => {
                        let cardIcon = <Tag size={14} className="text-accent" />;
                        if (member.type.includes('Address')) {
                          cardIcon = <Globe size={14} style={{ color: 'var(--accent-blue)' }} />;
                        } else if (member.type.includes('Port') || member.type.includes('Service')) {
                          cardIcon = <Network size={14} style={{ color: '#10b981' }} />;
                        } else if (member.type.includes('Application') || member.type.includes('Signature')) {
                          cardIcon = <ShieldAlert size={14} style={{ color: '#f59e0b' }} />;
                        }

                        return (
                          <div
                            key={idx}
                            style={{
                              padding: '10px 12px',
                              border: '1px solid var(--border-main)',
                              borderRadius: '4px',
                              backgroundColor: 'var(--bg-app)',
                              display: 'flex',
                              gap: '10px',
                              alignItems: 'flex-start',
                              minWidth: 0
                            }}
                          >
                            <div style={{ marginTop: '3px', flexShrink: 0 }}>
                              {cardIcon}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
                              <Tooltip content={member.name} position="top" align="left">
                                <span style={{ fontWeight: 500, color: 'var(--text-main)', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <HighlightedText text={member.name} highlight={inspectorSearch} />
                                </span>
                              </Tooltip>
                              <Tooltip content={`${member.type} • ${member.details}`} position="top" align="left">
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <HighlightedText text={`${member.type} • ${member.details}`} highlight={inspectorSearch} />
                                </span>
                              </Tooltip>
                              {member.paths && member.paths.length > 0 && (
                                <Tooltip content={`via ${member.paths.join(', ')}`} position="top" align="left">
                                  <span style={{ fontSize: '10px', color: 'var(--accent-purple)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    via: <HighlightedText text={member.paths.join(', ')} highlight={inspectorSearch} />
                                  </span>
                                </Tooltip>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. CRUD Modals */}
      <Modal
        isOpen={isCrudModalOpen}
        onClose={() => setIsCrudModalOpen(false)}
        title={crudMode === 'create' ? `Create New ${activeSubTab.slice(0, -1)}` : `Modify ${activeSubTab.slice(0, -1)}`}
        size="md"
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setIsCrudModalOpen(false)}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleSaveObject}>Save Changes</button>
          </>
        }
      >
        <form onSubmit={handleSaveObject} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {/* Scope selection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Scope Location</label>
            {crudMode === 'edit' ? (
              <input
                type="text"
                className="input-text"
                value={formScopeUuid === 'paloalto-panorama-global' ? 'Shared (Global Root)' : (scopeNameMap[formScopeUuid] || formScopeUuid)}
                disabled
                style={{ cursor: 'not-allowed', opacity: 0.6 }}
              />
            ) : (
              <Dropdown
                width="100%"
                value={formScopeUuid}
                onChange={setFormScopeUuid}
                options={['paloalto-panorama-global', ...deviceGroups.map(dg => dg.uuid)]}
                renderOption={(opt) => opt === 'paloalto-panorama-global' ? 'Shared (Global Root)' : (scopeNameMap[opt] || opt)}
              />
            )}
          </div>

          {/* Name */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Object Name</label>
            <input
              type="text"
              className="input-text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. corp-internal-subnet"
              required
            />
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              Only letters, numbers, underscores, hyphens, and dots allowed. No spaces.
            </span>
          </div>

          {/* Subtab specific fields */}
          {activeSubTab === 'Address Objects' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Address Type</label>
                <Dropdown
                  width="100%"
                  value={formType}
                  onChange={setFormType}
                  options={['ip-netmask', 'ip-range', 'fqdn']}
                  renderOption={(opt) => {
                    if (opt === 'ip-netmask') return 'IP Netmask / Subnet CIDR';
                    if (opt === 'ip-range') return 'IP Range';
                    if (opt === 'fqdn') return 'Fully Qualified Domain Name (FQDN)';
                    return opt;
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Value</label>
                <input
                  type="text"
                  className="input-text"
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                  placeholder={
                    formType === 'ip-netmask' ? 'e.g. 192.168.10.0/24 or 10.0.0.1' :
                      formType === 'ip-range' ? 'e.g. 192.168.10.10-192.168.10.50' :
                        'e.g. internal.corp.net'
                  }
                  required
                />
              </div>
            </>
          )}

          {activeSubTab === 'Address Groups' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Group Mode</label>
                <Dropdown
                  width="100%"
                  value={formType}
                  onChange={setFormType}
                  options={['static', 'dynamic']}
                  renderOption={(opt) => {
                    if (opt === 'static') return 'Static (Explicit Members)';
                    if (opt === 'dynamic') return 'Dynamic (Filter Tag Expression)';
                    return opt;
                  }}
                />
              </div>
              {formType === 'dynamic' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Tag Filter Expression</label>
                  <input
                    type="text"
                    className="input-text"
                    value={formFilter}
                    onChange={(e) => setFormFilter(e.target.value)}
                    placeholder="e.g. 'tag-web' and 'tag-internal'"
                    required
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Group Members</label>
                  {renderGroupMembersSection(
                    formMembers,
                    (name) => setFormMembers(formMembers.filter(n => n !== name))
                  )}
                </div>
              )}
            </>
          )}

          {activeSubTab === 'Services' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Protocol</label>
                <Dropdown
                  width="100%"
                  value={formProtocol}
                  onChange={setFormProtocol}
                  options={['tcp', 'udp']}
                  renderOption={(opt) => opt.toUpperCase()}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Destination Ports</label>
                <input
                  type="text"
                  className="input-text"
                  value={formDestPort}
                  onChange={(e) => setFormDestPort(e.target.value)}
                  placeholder="e.g. 80,443,8080-8085"
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

          {activeSubTab === 'Service Groups' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Group Members</label>
              {renderGroupMembersSection(
                formMembers,
                (name) => setFormMembers(formMembers.filter(n => n !== name))
              )}
            </div>
          )}

          {activeSubTab === 'Applications' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Category</label>
                  <input type="text" className="input-text" value={formCategory} onChange={(e) => setFormCategory(e.target.value)} placeholder="e.g. general-internet" required />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Subcategory</label>
                  <input type="text" className="input-text" value={formSubcategory} onChange={(e) => setFormSubcategory(e.target.value)} placeholder="e.g. internet-utility" required />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Technology</label>
                  <input type="text" className="input-text" value={formTechnology} onChange={(e) => setFormTechnology(e.target.value)} placeholder="e.g. browser-based" required />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Risk Level (1-5)</label>
                  <Dropdown
                    width="100%"
                    value={String(formRisk)}
                    onChange={(val) => setFormRisk(Number(val))}
                    options={['1', '2', '3', '4', '5']}
                    renderOption={(opt) => {
                      if (opt === '1') return '1 (Lowest)';
                      if (opt === '5') return '5 (Highest)';
                      return opt;
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Standard Ports (Optional)</label>
                <input type="text" className="input-text" value={formPorts} onChange={(e) => setFormPorts(e.target.value)} placeholder="e.g. tcp/80,443" />
              </div>
            </>
          )}

          {activeSubTab === 'Application Groups' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Application Signature Members</label>
              {renderGroupMembersSection(
                formMembers,
                (name) => setFormMembers(formMembers.filter(n => n !== name))
              )}
            </div>
          )}

          {/* Description */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Description (Optional)</label>
            <textarea
              className="input-text"
              style={{ height: '60px', resize: 'none' }}
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Provide context for this configuration object..."
            />
          </div>
        </form>
      </Modal>

      {/* Secondary Selection Modal for adding group members */}
      {isSelectorModalOpen && renderSelectorModal(
        activeSubTab === 'Address Groups' 
          ? addressGroupAvailableItems 
          : activeSubTab === 'Service Groups' 
            ? serviceGroupAvailableItems 
            : applicationGroupAvailableItems
      )}

      {/* 5. CLI Commands Output Modal */}
      <Modal
        isOpen={isCliModalOpen}
        onClose={() => setIsCliModalOpen(false)}
        title="Generated PAN-OS CLI Set Commands"
        size="lg"
        footer={
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn-secondary btn-md" onClick={() => setIsCliModalOpen(false)}>Close</button>
            <button className="btn-primary btn-md" onClick={handleCopyToClipboard}>Copy to Clipboard</button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Execute the following native PAN-OS CLI commands in your device or Panorama terminal shell:
          </div>
          <pre
            style={{
              backgroundColor: 'var(--bg-app)',
              border: '1px solid var(--border-main)',
              borderRadius: '4px',
              padding: '15px',
              color: '#34d399',
              fontFamily: 'Courier New, monospace',
              fontSize: '12px',
              overflowY: 'auto',
              maxHeight: '350px',
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {generatedCommands}
          </pre>
        </div>
      </Modal>
    </div>
  );
};
