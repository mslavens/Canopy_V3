import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  Network,
  Copy,
  Lock
} from 'lucide-react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/ConfirmProvider';
import { SearchBar } from '../components/SearchBar';
import { HighlightedText } from '../components/HighlightedText';
import { Dropdown } from '../components/Dropdown';
import { Tooltip } from '../components/Tooltip';
import { EmptyState } from '../components/EmptyState';
import { DataImportWizard } from '../components/DataImportWizard';
import { useObjectMove } from '../hooks/useObjectMove';
import { ObjectDataSources } from '../hooks/useObjectDependencies';

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
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 280, ready: false });

  const updateCoords = () => {
    if (dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
        ready: true
      });
    }
  };

  useEffect(() => {
    if (isOpen) {
      updateCoords();
      window.addEventListener('resize', updateCoords);
      window.addEventListener('scroll', updateCoords, true);
    } else {
      setCoords(prev => ({ ...prev, ready: false }));
    }
    return () => {
      window.removeEventListener('resize', updateCoords);
      window.removeEventListener('scroll', updateCoords, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && coords.ready) {
      setTimeout(() => {
        const menu = document.querySelector('.portal-scope-dropdown-menu');
        const activeOption = menu?.querySelector('.dropdown-option-row.active') as HTMLElement;
        if (activeOption) {
          activeOption.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
      }, 50);
    }
  }, [isOpen, coords.ready]);

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

  const dropdownMenu = (isOpen && coords.ready) ? (
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


      {/* Options list */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
        {filteredOptions.length === 0 ? (
          <div style={{ padding: '12px' }}>
            <EmptyState icon={<Search size={24} />} title="No scopes match search" description="Try adjusting your query." minHeight="100px" />
          </div>
        ) : (
          filteredOptions.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                tabIndex={-1}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onChange(opt.value);
                    setIsOpen(false);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = e.currentTarget.nextElementSibling as HTMLElement;
                    if (next) next.focus();
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = e.currentTarget.previousElementSibling as HTMLElement;
                    if (prev) prev.focus();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsOpen(false);
                  }
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
                  fontWeight: isSelected ? 600 : 400,
                  outline: 'none'
                }}
                className={`dropdown-option-row ${isSelected ? 'active' : ''}`}
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
      <div
        onClick={() => {
          if (!isOpen) {
            setIsOpen(true);
            setSearchQuery('');
          }
        }}
        style={{
          height: '34px',
          padding: '0 12px',
          backgroundColor: 'var(--bg-app)',
          border: `1px solid ${isOpen ? 'var(--accent-blue)' : 'var(--border-main)'}`,
          borderRadius: '4px',
          color: 'var(--text-main)',
          fontSize: '13px',
          cursor: isOpen ? 'text' : 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
          transition: 'border-color 0.2s ease',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {isOpen ? (
            <>
              <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={selectedOption ? selectedOption.label : 'Search scope...'}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsOpen(false);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setTimeout(() => {
                      const menu = document.querySelector('.portal-scope-dropdown-menu');
                      const firstOption = menu?.querySelector('.dropdown-option-row') as HTMLElement;
                      if (firstOption) firstOption.focus();
                    }, 50);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (filteredOptions.length > 0) {
                      onChange(filteredOptions[0].value);
                      setIsOpen(false);
                    }
                  }
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-main)',
                  fontSize: '13px',
                  fontWeight: 500,
                  outline: 'none',
                  padding: 0,
                  margin: 0,
                  width: '100%'
                }}
              />
            </>
          ) : (
            <>
              {selectedOption?.type === 'global' && <Database size={13} className="text-accent" />}
              {selectedOption?.type === 'shared' && <Globe size={13} style={{ color: 'var(--accent-blue)' }} />}
              {selectedOption?.type === 'device-group' && <Layers size={13} />}
              {selectedOption?.type === 'firewall' && <Server size={13} style={{ color: 'var(--text-muted)' }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                {selectedOption ? selectedOption.label : 'Select scope...'}
              </span>
            </>
          )}
        </div>
        <ChevronDown 
          size={14} 
          style={{ color: 'var(--text-muted)', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease', cursor: 'pointer' }}
          onClick={(e) => {
            if (isOpen) {
              e.stopPropagation();
              setIsOpen(false);
            }
          }}
        />
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
  const [activeProfileTab, setActiveProfileTab] = useState<'all' | 'antivirus' | 'spyware' | 'vulnerability' | 'url-filtering' | 'file-blocking' | 'wildfire'>('all');

  const displayedTableData = useMemo(() => {
    if (activeSubTab === 'Security Profiles' && activeProfileTab !== 'all') {
      return tableData.filter(row => row.type === activeProfileTab);
    }
    return tableData;
  }, [tableData, activeSubTab, activeProfileTab]);

  useEffect(() => {
    setActiveProfileTab('all');
  }, [activeSubTab]);

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
  const [allSecurityProfiles, setAllSecurityProfiles] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [allTagMappings, setAllTagMappings] = useState<any[]>([]);

  const [importWizardOpen, setImportWizardOpen] = useState(false);

  // Inspector State
  const [flattenedMembers, setFlattenedMembers] = useState<any[]>([]);

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
  const [formValue, setFormValue] = useState('');
  const [formScopeUuid, setFormScopeUuid] = useState('paloalto-panorama-global');
  const [formType, setFormType] = useState('');
  const [formFilter, setFormFilter] = useState('');
  const [filterLogic, setFilterLogic] = useState('and');
  const [showFilterTagSelector, setShowFilterTagSelector] = useState(false);
  const [filterTagSearch, setFilterTagSearch] = useState('');
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
  const [formTags, setFormTags] = useState<string[]>([]);

  // Form states for Palo Alto specific objects
  const [activeCustomObjectTab, setActiveCustomObjectTab] = useState<'categories' | 'edls'>('categories');
  const [formColor, setFormColor] = useState('color1');
  const [formProfileType, setFormProfileType] = useState('antivirus');
  const [formGroupAntivirus, setFormGroupAntivirus] = useState('');
  const [formGroupSpyware, setFormGroupSpyware] = useState('');
  const [formGroupVulnerability, setFormGroupVulnerability] = useState('');
  const [formGroupURLFiltering, setFormGroupURLFiltering] = useState('');
  const [formGroupFileBlocking, setFormGroupFileBlocking] = useState('');
  const [formGroupWildfireAnalysis, setFormGroupWildfireAnalysis] = useState('');
  const [formGroupDNSSecurity, setFormGroupDNSSecurity] = useState('');
  
  const [showActionsMenu, setShowActionsMenu] = useState<boolean>(false);
  const [formURLList, setFormURLList] = useState('');
  const [formListType, setFormListType] = useState('ip');
  const [formSourceURL, setFormSourceURL] = useState('');
  const [formRecurring, setFormRecurring] = useState('five-minute');

  // Drag and drop drop-zone applications CSV file state
  const [dragActive, setDragActive] = useState(false);
  const [csvUploading, setCsvUploading] = useState(false);

  // Helper to get device group scope hierarchy (self -> parents -> global)
  const getScopeHierarchy = useCallback((scopeUuid: string): string[] => {
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
    return scopes.filter(uuid => uuid !== 'paloalto-dg-shared');
  }, [deviceGroups, firewalls]);

  // Form scope hierarchy (self -> parents -> global)
  const formVisibleScopes = useMemo(() => {
    return getScopeHierarchy(formScopeUuid);
  }, [formScopeUuid, getScopeHierarchy]);

  // Helper to deduplicate items by name, keeping the one closest to the active scope (shadowing)
  const getShadowedItems = useCallback(<T extends { name: string; device_uuid: string }>(rawItems: T[], visibleScopes: string[]): T[] => {
    const map: Record<string, T> = {};
    rawItems.forEach(item => {
      const existing = map[item.name];
      if (!existing) {
        map[item.name] = item;
      } else {
        const newIdx = visibleScopes.indexOf(item.device_uuid);
        const oldIdx = visibleScopes.indexOf(existing.device_uuid);
        if (newIdx !== -1 && (oldIdx === -1 || newIdx < oldIdx)) {
          map[item.name] = item;
        }
      }
    });
    return Object.values(map);
  }, []);

  // Dual List available items for group CRUD editors
  const addressGroupAvailableItems = useMemo(() => {
    const items: { name: string; type: string; value: string; icon: React.ReactNode }[] = [];
    
    const shadowedAddresses = getShadowedItems(allAddresses, formVisibleScopes);
    const shadowedAddressGroups = getShadowedItems(allAddressGroups, formVisibleScopes);

    shadowedAddresses.forEach(a => {
      items.push({
        name: a.name,
        type: 'address',
        value: `${a.type}: ${a.value}`,
        icon: <Globe size={12} style={{ color: 'var(--accent-blue)' }} />
      });
    });

    shadowedAddressGroups
      .filter(g => g.id !== selectedObject?.id)
      .forEach(g => {
        items.push({
          name: g.name,
          type: 'group',
          value: g.type === 'dynamic' ? `Filter: ${g.filter}` : 'Static Group',
          icon: <Layers size={12} style={{ color: '#a855f7' }} />
        });
      });

    return items;
  }, [allAddresses, allAddressGroups, formVisibleScopes, selectedObject, getShadowedItems]);

  const serviceGroupAvailableItems = useMemo(() => {
    const items: { name: string; type: string; value: string; icon: React.ReactNode }[] = [];
    
    const shadowedServices = getShadowedItems(allServices, formVisibleScopes);
    const shadowedServiceGroups = getShadowedItems(allServiceGroups, formVisibleScopes);

    shadowedServices.forEach(s => {
      items.push({
        name: s.name,
        type: 'service',
        value: `${String(s.protocol).toUpperCase()}: ${s.destination_port}`,
        icon: <Network size={12} style={{ color: '#10b981' }} />
      });
    });

    shadowedServiceGroups
      .filter(g => g.id !== selectedObject?.id)
      .forEach(g => {
        items.push({
          name: g.name,
          type: 'group',
          value: 'Service Group',
          icon: <Layers size={12} style={{ color: '#a855f7' }} />
        });
      });

    return items;
  }, [allServices, allServiceGroups, formVisibleScopes, selectedObject, getShadowedItems]);

  const applicationGroupAvailableItems = useMemo(() => {
    const items: { name: string; type: string; value: string; icon: React.ReactNode }[] = [];
    
    const shadowedApplications = getShadowedItems(allApplications, formVisibleScopes);
    const shadowedApplicationGroups = getShadowedItems(allApplicationGroups, formVisibleScopes);

    shadowedApplications.forEach(a => {
      items.push({
        name: a.name,
        type: 'application',
        value: `${a.category} / Risk: ${a.risk}`,
        icon: <ShieldAlert size={12} style={{ color: '#f59e0b' }} />
      });
    });

    shadowedApplicationGroups
      .filter(g => g.id !== selectedObject?.id)
      .forEach(g => {
        items.push({
          name: g.name,
          type: 'group',
          value: 'Application Group',
          icon: <Layers size={12} style={{ color: '#a855f7' }} />
        });
      });

    return items;
  }, [allApplications, allApplicationGroups, formVisibleScopes, selectedObject, getShadowedItems]);

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
            <div style={{ padding: '30px 20px' }}>
              <EmptyState icon={<Layers size={24} />} title="No members selected" description="Click '+ Add Members' to select config objects." minHeight="150px" />
            </div>
          ) : filteredSelected.length === 0 ? (
            <div style={{ padding: '20px' }}>
              <EmptyState icon={<Search size={24} />} title="No members match search query" description="Try a different term." minHeight="100px" />
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
    const searchFiltered = availableItems.filter(item => 
      item.name.toLowerCase().includes(selectorSearchQuery.toLowerCase()) ||
      (item.value || '').toLowerCase().includes(selectorSearchQuery.toLowerCase())
    );

    // Render limit (pagination / virtualization slice) to prevent React DOM rendering lag on 20K items
    const displayedItems = searchFiltered.slice(0, 200);

    const handleToggleCheck = (name: string) => {
      if (selectorCheckedNames.includes(name)) {
        setSelectorCheckedNames(selectorCheckedNames.filter(n => n !== name));
      } else {
        setSelectorCheckedNames([...selectorCheckedNames, name]);
      }
    };

    const selectableSearchFilteredTotal = searchFiltered.filter(item => !formMembers.includes(item.name));

    const handleSelectAll = () => {
      const allSelectableNames = selectableSearchFilteredTotal.map(item => item.name);
      const allChecked = allSelectableNames.every(name => selectorCheckedNames.includes(name));
      
      if (allChecked) {
        setSelectorCheckedNames(selectorCheckedNames.filter(name => !allSelectableNames.includes(name)));
      } else {
        const newChecked = [...selectorCheckedNames];
        allSelectableNames.forEach(name => {
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

    const isAllChecked = selectableSearchFilteredTotal.length > 0 && selectableSearchFilteredTotal.every(item => selectorCheckedNames.includes(item.name));

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

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px 12px', borderBottom: '1px solid var(--border-main)', paddingBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input 
                type="checkbox"
                id="select-all-objects"
                checked={isAllChecked}
                onChange={handleSelectAll}
                disabled={selectableSearchFilteredTotal.length === 0}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="select-all-objects" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                {isAllChecked ? 'Deselect All matching' : `Select All matching (${selectableSearchFilteredTotal.length})`}
              </label>
            </div>
            {searchFiltered.length > 200 && (
              <span style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 500 }}>
                Showing 200 of {searchFiltered.length} matches
              </span>
            )}
          </div>

          <div style={{ height: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-main)', borderRadius: '6px', backgroundColor: 'var(--bg-app)' }}>
            {displayedItems.length === 0 ? (
              <div style={{ padding: '40px 20px' }}>
                <EmptyState icon={<Search size={32} />} title="No results found" description="No objects match your search." minHeight="200px" />
              </div>
            ) : (
              displayedItems.map(item => {
                const isAlreadyMember = formMembers.includes(item.name);
                const checked = isAlreadyMember || selectorCheckedNames.includes(item.name);
                return (
                  <div
                    key={`${item.type}-${item.name}`}
                    onClick={() => { if (!isAlreadyMember) handleToggleCheck(item.name); }}
                    style={{
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: isAlreadyMember ? 'default' : 'pointer',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.02)',
                      backgroundColor: checked ? 'var(--bg-element)' : 'transparent',
                      transition: 'background-color 0.15s ease',
                      opacity: isAlreadyMember ? 0.7 : 1
                    }}
                    onMouseEnter={(e) => { if (!checked && !isAlreadyMember) e.currentTarget.style.backgroundColor = 'var(--bg-surface)'; }}
                    onMouseLeave={(e) => { if (!checked && !isAlreadyMember) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <input 
                      type="checkbox"
                      checked={checked}
                      disabled={isAlreadyMember}
                      onChange={() => {}}
                      style={{ cursor: isAlreadyMember ? 'default' : 'pointer', flexShrink: 0 }}
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
                      {isAlreadyMember && (
                        <span style={{
                          fontSize: '9px',
                          backgroundColor: 'rgba(255, 255, 255, 0.08)',
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border-main)',
                          borderRadius: '3px',
                          padding: '0 4px',
                          marginLeft: '8px',
                          fontWeight: 600,
                          flexShrink: 0
                        }}>
                          MEMBER
                        </span>
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
        if (dg.uuid === 'paloalto-dg-shared') {
          buildNode(dg.id, depth);
          return;
        }
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

  // Legacy JS recursive group resolvers removed in favor of SQLite Recursive CTEs!

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
    return scopes.filter(uuid => uuid !== 'paloalto-dg-shared');
  }, [currentScope, deviceGroups, firewalls]);

  // Fetch active tab records
  const fetchRecords = async () => {
    if (!apiClient) return;
    const isInitialLoad = tableData.length === 0;
    if (isInitialLoad) {
      setLoading(true);
    }
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
        case 'Tags':
          query = isShowAll
            ? `SELECT * FROM tags ORDER BY name ASC;`
            : `SELECT * FROM tags WHERE device_uuid IN (${scopeFilter}) ORDER BY name ASC;`;
          break;
        case 'Log Forwarding Profiles':
          query = isShowAll
            ? `SELECT * FROM log_forwarding_profiles ORDER BY name ASC;`
            : `SELECT * FROM log_forwarding_profiles WHERE device_uuid IN (${scopeFilter}) ORDER BY name ASC;`;
          break;
        case 'Security Profiles':
          query = isShowAll
            ? `SELECT * FROM security_profiles ORDER BY name ASC;`
            : `SELECT * FROM security_profiles WHERE device_uuid IN (${scopeFilter}) ORDER BY name ASC;`;
          break;
        case 'Security Profile Groups':
          query = isShowAll
            ? `SELECT * FROM security_profile_groups ORDER BY name ASC;`
            : `SELECT * FROM security_profile_groups WHERE device_uuid IN (${scopeFilter}) ORDER BY name ASC;`;
          break;
        case 'Custom Objects':
          if (activeCustomObjectTab === 'categories') {
            query = isShowAll
              ? `SELECT * FROM custom_url_categories ORDER BY name ASC;`
              : `SELECT * FROM custom_url_categories WHERE device_uuid IN (${scopeFilter}) ORDER BY name ASC;`;
          } else {
            query = isShowAll
              ? `SELECT * FROM external_dynamic_lists ORDER BY name ASC;`
              : `SELECT * FROM external_dynamic_lists WHERE device_uuid IN (${scopeFilter}) ORDER BY name ASC;`;
          }
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
      const [addRes, addGrpRes, svcRes, svcGrpRes, appRes, appGrpRes, secProfRes, tagsRes, mappingsRes] = await Promise.all([
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
        apiClient.queryDb("SELECT id, name, device_uuid, type FROM security_profiles;"),
        apiClient.queryDb("SELECT id, name, device_uuid, color FROM tags;"),
        apiClient.queryDb("SELECT entity_type, entity_id, tag_id FROM entity_tag_mappings;"),
      ]);

      setAllAddresses(addRes.rows || []);
      setAllAddressGroups(addGrpRes.rows || []);
      setAllServices(svcRes.rows || []);
      setAllServiceGroups(svcGrpRes.rows || []);
      setAllApplications(appRes.rows || []);
      setAllApplicationGroups(appGrpRes.rows || []);
      setAllSecurityProfiles(secProfRes.rows || []);
      setAllTags(tagsRes.rows || []);
      setAllTagMappings(mappingsRes.rows || []);
    } catch (e) {
      console.error('Failed to load validation reference lists', e);
    }
  };

  useEffect(() => {
    setTableData([]); // clear table data to force loading spinner on tab/scope transitions
    fetchRecords();
    loadReferenceData();
    setSelectedRows([]);
  }, [activeSubTab, currentScope, deviceGroups, firewalls, activeCustomObjectTab]);

  // Group members slide-over panel flattened members state handled asynchronously in handleOpenSlideOver

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
    let recursiveQuery = '';
    
    switch (activeSubTab) {
      case 'Address Groups':
        memberQuery = `
          SELECT agm.member_name, ao.name AS address_name, ao.type AS address_type, ao.value AS address_value, nested.name AS nested_group_name
          FROM address_group_members agm
          LEFT JOIN address_objects ao ON agm.member_address_id = ao.id
          LEFT JOIN address_groups nested ON agm.member_group_id = nested.id
          WHERE agm.group_id = ?;
        `;
        recursiveQuery = `
          WITH RECURSIVE group_tree(member_address_id, member_group_id, path, is_cycle) AS (
              SELECT member_address_id, member_group_id, CAST(group_id AS TEXT) || ' > ' || COALESCE(member_group_id, member_address_id), 0
              FROM address_group_members
              WHERE group_id = ?
            UNION ALL
              SELECT agm.member_address_id, agm.member_group_id, gt.path || ' > ' || COALESCE(agm.member_group_id, agm.member_address_id),
                     INSTR(gt.path, CAST(agm.group_id AS TEXT)) > 0
              FROM address_group_members agm
              JOIN group_tree gt ON agm.group_id = gt.member_group_id
              WHERE gt.is_cycle = 0
          )
          SELECT gt.path, ao.name, ao.type, ao.value AS details, 'Address Object' AS obj_type
          FROM group_tree gt
          JOIN address_objects ao ON gt.member_address_id = ao.id
          WHERE gt.member_address_id IS NOT NULL;
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
        recursiveQuery = `
          WITH RECURSIVE group_tree(member_service_id, member_group_id, path, is_cycle) AS (
              SELECT member_service_id, member_group_id, CAST(group_id AS TEXT) || ' > ' || COALESCE(member_group_id, member_service_id), 0
              FROM service_group_members
              WHERE group_id = ?
            UNION ALL
              SELECT sgm.member_service_id, sgm.member_group_id, gt.path || ' > ' || COALESCE(sgm.member_group_id, sgm.member_service_id),
                     INSTR(gt.path, CAST(sgm.group_id AS TEXT)) > 0
              FROM service_group_members sgm
              JOIN group_tree gt ON sgm.group_id = gt.member_group_id
              WHERE gt.is_cycle = 0
          )
          SELECT gt.path, so.name, 'Service Object' AS type, so.protocol || ':' || so.destination_port AS details, 'Service Object' AS obj_type
          FROM group_tree gt
          JOIN service_objects so ON gt.member_service_id = so.id
          WHERE gt.member_service_id IS NOT NULL;
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
        recursiveQuery = `
          WITH RECURSIVE group_tree(member_application_id, member_group_id, path, is_cycle) AS (
              SELECT member_application_id, member_group_id, CAST(group_id AS TEXT) || ' > ' || COALESCE(member_group_id, member_application_id), 0
              FROM application_group_members
              WHERE group_id = ?
            UNION ALL
              SELECT agm.member_application_id, agm.member_group_id, gt.path || ' > ' || COALESCE(agm.member_group_id, agm.member_application_id),
                     INSTR(gt.path, CAST(agm.group_id AS TEXT)) > 0
              FROM application_group_members agm
              JOIN group_tree gt ON agm.group_id = gt.member_group_id
              WHERE gt.is_cycle = 0
          )
          SELECT gt.path, ao.name, 'Application Object' AS type, ao.category || ' / ' || ao.subcategory AS details, 'Application Object' AS obj_type
          FROM group_tree gt
          JOIN application_objects ao ON gt.member_application_id = ao.id
          WHERE gt.member_application_id IS NOT NULL;
        `;
        break;
    }

    try {
      const res = await apiClient.queryDb(memberQuery.replace('?', String(groupRow.id)));
      setResolvedMembers(res.rows || []);
      
      if (recursiveQuery) {
        const flatRes = await apiClient.queryDb(recursiveQuery.replace('?', String(groupRow.id)));
        
        // Aggregate paths for flattened members
        const aggregated: Record<string, any> = {};
        (flatRes.rows || []).forEach((item: any) => {
          if (!aggregated[item.name]) {
            aggregated[item.name] = {
              name: item.name,
              type: item.type || item.obj_type,
              details: item.details,
              paths: []
            };
          }
          if (item.path) {
            aggregated[item.name].paths.push(item.path);
          }
        });
        setFlattenedMembers(Object.values(aggregated));
      } else {
        setFlattenedMembers([]);
      }
      
    } catch (e) {
      console.error('Failed to resolve group members details', e);
      addToast('Failed to fetch group member details.', 'error');
    } finally {
      setSlideOverLoading(false);
    }
  };

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
    setFormTags([]);

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
    } else if (activeSubTab === 'Tags') {
      setFormColor('color1');
    } else if (activeSubTab === 'Security Profiles') {
      setFormProfileType('antivirus');
    } else if (activeSubTab === 'Security Profile Groups') {
      setFormGroupAntivirus('');
      setFormGroupSpyware('');
      setFormGroupVulnerability('');
      setFormGroupURLFiltering('');
      setFormGroupFileBlocking('');
      setFormGroupWildfireAnalysis('');
      setFormGroupDNSSecurity('');
    } else if (activeSubTab === 'Custom Objects') {
      if (activeCustomObjectTab === 'categories') {
        setFormURLList('');
      } else {
        setFormListType('ip');
        setFormSourceURL('');
        setFormRecurring('five-minute');
      }
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

    // Resolve active tag mappings
    const tags: string[] = [];
    const mappings = allTagMappings.filter(m => 
      m.entity_id === obj.id && 
      m.entity_type === (activeSubTab === 'Address Objects' ? 'address_object' : 'address_group')
    );
    mappings.forEach(m => {
      const tagObj = allTags.find(t => t.id === m.tag_id);
      if (tagObj) tags.push(tagObj.name);
    });
    setFormTags(tags);

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
    } else if (activeSubTab === 'Tags') {
      setFormColor(obj.color || 'color1');
    } else if (activeSubTab === 'Security Profiles') {
      setFormProfileType(obj.type || 'antivirus');
    } else if (activeSubTab === 'Security Profile Groups') {
      setFormGroupAntivirus(obj.antivirus || '');
      setFormGroupSpyware(obj.spyware || '');
      setFormGroupVulnerability(obj.vulnerability || '');
      setFormGroupURLFiltering(obj.url_filtering || '');
      setFormGroupFileBlocking(obj.file_blocking || '');
      setFormGroupWildfireAnalysis(obj.wildfire_analysis || '');
      setFormGroupDNSSecurity(obj.dns_security || '');
    } else if (activeSubTab === 'Custom Objects') {
      if (activeCustomObjectTab === 'categories') {
        setFormURLList(obj.url_list || '');
      } else {
        setFormListType(obj.list_type || 'ip');
        setFormSourceURL(obj.source_url || '');
        setFormRecurring(obj.recurring || 'five-minute');
      }
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
        payload.tags = formTags;
        if (crudMode === 'create') result = await apiClient.createAddressObject(payload);
        else result = await apiClient.updateAddressObject(payload);
      } else if (activeSubTab === 'Address Groups') {
        payload.type = formType;
        payload.filter = formType === 'dynamic' ? formFilter.trim() : '';
        payload.members = formType === 'static' ? formMembers : [];
        payload.tags = formTags;
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
      } else if (activeSubTab === 'Tags') {
        payload.color = formColor;
        if (crudMode === 'create') result = await apiClient.createTag(payload);
        else result = await apiClient.updateTag(payload);
      } else if (activeSubTab === 'Log Forwarding Profiles') {
        if (crudMode === 'create') result = await apiClient.createLogForwardingProfile(payload);
        else result = await apiClient.updateLogForwardingProfile(payload);
      } else if (activeSubTab === 'Security Profiles') {
        payload.type = formProfileType;
        if (crudMode === 'create') result = await apiClient.createSecurityProfile(payload);
        else result = await apiClient.updateSecurityProfile(payload);
      } else if (activeSubTab === 'Security Profile Groups') {
        payload.antivirus = formGroupAntivirus || null;
        payload.spyware = formGroupSpyware || null;
        payload.vulnerability = formGroupVulnerability || null;
        payload.url_filtering = formGroupURLFiltering || null;
        payload.file_blocking = formGroupFileBlocking || null;
        payload.wildfire_analysis = formGroupWildfireAnalysis || null;
        payload.dns_security = formGroupDNSSecurity || null;
        if (crudMode === 'create') result = await apiClient.createSecurityProfileGroup(payload);
        else result = await apiClient.updateSecurityProfileGroup(payload);
      } else if (activeSubTab === 'Custom Objects') {
        if (activeCustomObjectTab === 'categories') {
          payload.url_list = formURLList.trim();
          if (crudMode === 'create') result = await apiClient.createCustomURLCategory(payload);
          else result = await apiClient.updateCustomURLCategory(payload);
        } else {
          payload.list_type = formListType;
          payload.source_url = formSourceURL.trim();
          payload.recurring = formRecurring;
          if (crudMode === 'create') result = await apiClient.createExternalDynamicList(payload);
          else result = await apiClient.updateExternalDynamicList(payload);
        }
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
          else if (activeSubTab === 'Tags') await apiClient.deleteTag(obj.id);
          else if (activeSubTab === 'Log Forwarding Profiles') await apiClient.deleteLogForwardingProfile(obj.id);
          else if (activeSubTab === 'Security Profiles') await apiClient.deleteSecurityProfile(obj.id);
          else if (activeSubTab === 'Security Profile Groups') await apiClient.deleteSecurityProfileGroup(obj.id);
          else if (activeSubTab === 'Custom Objects') {
            if (activeCustomObjectTab === 'categories') await apiClient.deleteCustomURLCategory(obj.id);
            else await apiClient.deleteExternalDynamicList(obj.id);
          }

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
            else if (activeSubTab === 'Tags') await apiClient.deleteTag(row.id);
            else if (activeSubTab === 'Log Forwarding Profiles') await apiClient.deleteLogForwardingProfile(row.id);
            else if (activeSubTab === 'Security Profiles') await apiClient.deleteSecurityProfile(row.id);
            else if (activeSubTab === 'Security Profile Groups') await apiClient.deleteSecurityProfileGroup(row.id);
            else if (activeSubTab === 'Custom Objects') {
              if (activeCustomObjectTab === 'categories') await apiClient.deleteCustomURLCategory(row.id);
              else await apiClient.deleteExternalDynamicList(row.id);
            }
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

  // --- CLONING AND MOVING OPERATIONS WITH DEPENDENCY RESOLUTION ---
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);
  const [targetActionType, setTargetActionType] = useState<'clone' | 'move'>('clone');
  const [targetScopeUuid, setTargetScopeUuid] = useState('paloalto-panorama-global');

  const dataSources = useMemo<ObjectDataSources>(() => ({
    addresses: allAddresses,
    addressGroups: allAddressGroups,
    services: allServices,
    serviceGroups: allServiceGroups,
    applications: allApplications,
    applicationGroups: allApplicationGroups,
    tags: []
  }), [allAddresses, allAddressGroups, allServices, allServiceGroups, allApplications, allApplicationGroups]);

  const { move, moveConfirmDialog, setMoveConfirmDialog, isProcessing } = useObjectMove(
    dataSources,
    apiClient,
    fetchRecords,
    getScopeHierarchy,
    scopeNameMap,
    addToast,
    firewalls
  );

  const getActiveObjectType = () => {
    switch (activeSubTab) {
      case 'Address Objects': return 'address';
      case 'Address Groups': return 'addressGroup';
      case 'Services': return 'service';
      case 'Service Groups': return 'serviceGroup';
      case 'Applications': return 'application';
      case 'Application Groups': return 'applicationGroup';
      case 'Tags': return 'tag';
      default: return 'genericObject';
    }
  };

  const handleCloneToGroup = () => {
    setTargetActionType('clone');
    setTargetScopeUuid('paloalto-panorama-global');
    setIsTargetModalOpen(true);
  };

  const handleMoveToGroup = () => {
    setTargetActionType('move');
    setTargetScopeUuid('paloalto-panorama-global');
    setIsTargetModalOpen(true);
  };

  const handleConfirmTargetScope = () => {
    setIsTargetModalOpen(false);
    move(selectedRows, getActiveObjectType(), targetScopeUuid, targetActionType);
  };

  const handleClone = () => {
    if (selectedRows.length === 0) return;
    
    // For local clone, we keep the original device_uuid for each item.
    // Since we support multiple selection, we group them by device_uuid,
    // but the move function already handles an array of items.
    // However, the targetScopeUuid in move() is singular.
    // So we invoke it per item, or group by device_uuid.
    const byScope = selectedRows.reduce((acc, row) => {
      if (!acc[row.device_uuid]) acc[row.device_uuid] = [];
      acc[row.device_uuid].push(row);
      return acc;
    }, {} as Record<string, any[]>);

    Object.keys(byScope).forEach(scopeUuid => {
      move(byScope[scopeUuid], getActiveObjectType(), scopeUuid, 'clone');
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

  // Generate CLI commands for a single row
  const generateCliCommandsForRow = (row: any): string[] => {
    let commands: string[] = [];
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
        case 'Tags':
          commands.push(`${scopePrefix} tag ${row.name} color ${row.color || 'color1'}`);
          if (row.description) {
            commands.push(`${scopePrefix} tag ${row.name} comments "${row.description}"`);
          }
          break;
        case 'Log Forwarding Profiles':
          commands.push(`${scopePrefix} log-settings profiles ${row.name}`);
          break;
        case 'Security Profiles': {
          const typeMapping: Record<string, string> = {
            'url-filtering': 'url-filtering',
            'antivirus': 'virus',
            'vulnerability': 'vulnerability',
            'spyware': 'spyware',
            'wildfire': 'wildfire-analysis',
            'file-blocking': 'file-blocking',
          };
          const resolvedType = typeMapping[row.type] || 'virus';
          commands.push(`${scopePrefix} profiles ${resolvedType} ${row.name}`);
          break;
        }
        case 'Security Profile Groups':
          commands.push(`${scopePrefix} profiles profile-group ${row.name}`);
          if (row.antivirus) commands.push(`${scopePrefix} profiles profile-group ${row.name} virus ${row.antivirus}`);
          if (row.spyware) commands.push(`${scopePrefix} profiles profile-group ${row.name} spyware ${row.spyware}`);
          if (row.vulnerability) commands.push(`${scopePrefix} profiles profile-group ${row.name} vulnerability ${row.vulnerability}`);
          if (row.url_filtering) commands.push(`${scopePrefix} profiles profile-group ${row.name} url-filtering ${row.url_filtering}`);
          if (row.file_blocking) commands.push(`${scopePrefix} profiles profile-group ${row.name} file-blocking ${row.file_blocking}`);
          if (row.wildfire_analysis) commands.push(`${scopePrefix} profiles profile-group ${row.name} wildfire-analysis ${row.wildfire_analysis}`);
          break;
        case 'Custom Objects':
          if (activeCustomObjectTab === 'categories') {
            commands.push(`${scopePrefix} profiles custom-url-category ${row.name} list [ ${row.url_list || ''} ]`);
          } else {
            commands.push(`${scopePrefix} external-list ${row.name} type ${row.list_type} source "${row.source_url || ''}"`);
          }
          break;
      }
      return commands;
    };

  // Generate CLI commands for the modal
  const handleGenerateCli = () => {
    const rows = selectedRows.length > 0 ? selectedRows : displayedTableData;
    if (rows.length === 0) {
      addToast('No records available to generate commands.', 'info');
      return;
    }

    let allCommands: string[] = [];
    rows.forEach(row => {
      allCommands.push(...generateCliCommandsForRow(row));
    });

    setGeneratedCommands(allCommands.join('\n'));
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
        renderCell: (val, row, query) => {
          const isShowAll = currentScope === 'show-all';
          const isInherited = !isShowAll && row.device_uuid !== currentScope;
          const inheritedScopeName = isInherited ? (scopeNameMap[row.device_uuid] || row.device_uuid) : '';
          const isEditable = !isInherited && !isShowAll;
          
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {isInherited && (
                <Tooltip content={`Inherited from ${inheritedScopeName}`} position="top">
                  <Lock size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                </Tooltip>
              )}
              <span 
                onClick={() => {
                  if (isEditable) openEditModal(row);
                }}
                onMouseEnter={(e) => {
                  if (isEditable) {
                    e.currentTarget.style.color = 'var(--accent-blue)';
                    e.currentTarget.style.textDecoration = 'underline';
                  }
                }}
                onMouseLeave={(e) => {
                  if (isEditable) {
                    e.currentTarget.style.color = 'inherit';
                    e.currentTarget.style.textDecoration = 'none';
                  }
                }}
                style={{ 
                  fontWeight: 500,
                  cursor: isEditable ? 'pointer' : 'default',
                  transition: 'color 0.15s ease'
                }}
              >
                <HighlightedText text={val} highlight={query || ''} />
              </span>
            </div>
          );
        }
      },
      {
        key: 'device_uuid',
        label: 'Scope Context',
        width: '240px',
        renderCell: (val, row, query) => {
          const hierarchy = [...getScopeHierarchy(val)].reverse();
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontFamily: 'var(--font-mono, monospace)', fontSize: '11px', lineHeight: '1.2' }}>
              {hierarchy.map((scopeId, idx) => {
                const isLast = idx === hierarchy.length - 1;
                const isShared = scopeId === 'paloalto-panorama-global';
                const displayName = isShared ? 'Shared' : (scopeNameMap[scopeId] || scopeId);
                const indent = idx * 12; // 12px indent per level
                
                return (
                  <div key={scopeId} style={{ display: 'flex', alignItems: 'center', paddingLeft: `${indent}px`, gap: '4px' }}>
                    {idx > 0 && <span style={{ color: 'var(--text-muted)', marginRight: '2px' }}>└─</span>}
                    <span 
                      onClick={() => handleScopeChange(scopeId)}
                      style={{ 
                        cursor: 'pointer',
                        transition: 'opacity 0.15s ease'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.opacity = '0.8'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; e.currentTarget.style.opacity = '1'; }}
                      title={`Switch active scope to ${displayName}`}
                    >
                      {isLast ? (
                        <span className="badge badge-info" style={{ fontWeight: 600, padding: '2px 6px', fontSize: '10px', display: 'inline-block' }}>
                          <HighlightedText text={displayName} highlight={query || ''} />
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>
                          <HighlightedText text={displayName} highlight={query || ''} />
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
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
          {
            key: 'tags',
            label: 'Tags',
            width: '180px',
            renderCell: (val, row, query) => {
              const mappings = allTagMappings.filter(m => m.entity_id === row.id && m.entity_type === 'address_object');
              if (mappings.length === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
              const colorMap: Record<string, string> = {
                color1: '#ef4444',
                color2: '#3b82f6',
                color3: '#10b981',
                color4: '#f59e0b',
                color5: '#ec4899',
                color6: '#8b5cf6',
                color7: '#06b6d4',
                color8: '#14b8a6',
                color9: '#f97316',
                color10: '#64748b',
                color11: '#22c55e',
                color12: '#a855f7',
                color13: '#e11d48',
                color14: '#d97706',
                color15: '#2563eb',
                color16: '#059669',
              };
              return (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {mappings.map(m => {
                    const tagObj = allTags.find(t => t.id === m.tag_id);
                    if (!tagObj) return null;
                    const hex = colorMap[tagObj.color] || 'var(--text-muted)';
                    return (
                      <span
                        key={tagObj.id}
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: `${hex}22`,
                          color: hex,
                          border: `1px solid ${hex}44`,
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: hex }} />
                        <HighlightedText text={tagObj.name} highlight={query || ''} />
                      </span>
                    );
                  })}
                </div>
              );
            }
          }
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
                return <code style={{ color: 'var(--accent-blue)', fontSize: '11px' }}><HighlightedText text={row.filter || 'No Filter'} highlight={query || ''} /></code>;
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
                      <HighlightedText text={m} highlight={query || ''} />
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
          },
          {
            key: 'tags',
            label: 'Tags',
            width: '180px',
            renderCell: (val, row, query) => {
              const mappings = allTagMappings.filter(m => m.entity_id === row.id && m.entity_type === 'address_group');
              if (mappings.length === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
              const colorMap: Record<string, string> = {
                color1: '#ef4444',
                color2: '#3b82f6',
                color3: '#10b981',
                color4: '#f59e0b',
                color5: '#ec4899',
                color6: '#8b5cf6',
                color7: '#06b6d4',
                color8: '#14b8a6',
                color9: '#f97316',
                color10: '#64748b',
                color11: '#22c55e',
                color12: '#a855f7',
                color13: '#e11d48',
                color14: '#d97706',
                color15: '#2563eb',
                color16: '#059669',
              };
              return (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {mappings.map(m => {
                    const tagObj = allTags.find(t => t.id === m.tag_id);
                    if (!tagObj) return null;
                    const hex = colorMap[tagObj.color] || 'var(--text-muted)';
                    return (
                      <span
                        key={tagObj.id}
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: `${hex}22`,
                          color: hex,
                          border: `1px solid ${hex}44`,
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: hex }} />
                        <HighlightedText text={tagObj.name} highlight={query || ''} />
                      </span>
                    );
                  })}
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
              <span className="badge badge-info" style={{ fontWeight: 600 }}><HighlightedText text={String(val).toUpperCase()} highlight={query || ''} /></span>
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
                      <HighlightedText text={m} highlight={query || ''} />
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
                      <HighlightedText text={m} highlight={query || ''} />
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

      case 'Tags':
        subtabCols = [
          {
            key: 'color',
            label: 'Color Tag',
            width: '150px',
            renderCell: (val) => {
              const colorStr = String(val);
              const colorMap: Record<string, string> = {
                color1: '#ef4444',
                color2: '#3b82f6',
                color3: '#10b981',
                color4: '#f59e0b',
                color5: '#ec4899',
                color6: '#8b5cf6',
                color7: '#06b6d4',
                color8: '#14b8a6',
                color9: '#f97316',
                color10: '#64748b',
                color11: '#22c55e',
                color12: '#a855f7',
                color13: '#e11d48',
                color14: '#d97706',
                color15: '#2563eb',
                color16: '#059669',
              };
              const hex = colorMap[colorStr] || 'var(--text-muted)';
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: hex, border: '1px solid var(--border-main)' }} />
                  <span style={{ fontSize: '12px', fontWeight: 500 }}>{colorStr}</span>
                </div>
              );
            }
          }
        ];
        break;

      case 'Log Forwarding Profiles':
        subtabCols = [];
        break;

      case 'Security Profiles':
        subtabCols = [
          {
            key: 'type',
            label: 'Profile Type',
            width: '180px',
            renderCell: (val, row, query) => {
              const displayMap: Record<string, string> = {
                'url-filtering': 'URL Filtering',
                'antivirus': 'Antivirus',
                'vulnerability': 'Vulnerability Protection',
                'spyware': 'Anti-Spyware',
                'wildfire': 'WildFire Analysis',
                'file-blocking': 'File Blocking',
              };
              return (
                <span className="badge badge-info" style={{ fontWeight: 600 }}>
                  <HighlightedText text={displayMap[String(val)] || String(val)} highlight={query || ''} />
                </span>
              );
            }
          }
        ];
        break;

      case 'Security Profile Groups':
        subtabCols = [
          {
            key: 'profiles_summary',
            label: 'Assigned Profiles',
            width: '320px',
            renderCell: (val, row, query) => {
              const parts: string[] = [];
              if (row.antivirus) parts.push(`AV: ${row.antivirus}`);
              if (row.spyware) parts.push(`Spyware: ${row.spyware}`);
              if (row.vulnerability) parts.push(`Vuln: ${row.vulnerability}`);
              if (row.url_filtering) parts.push(`URL: ${row.url_filtering}`);
              if (row.file_blocking) parts.push(`File: ${row.file_blocking}`);
              if (row.wildfire_analysis) parts.push(`Wildfire: ${row.wildfire_analysis}`);
              if (row.dns_security) parts.push(`DNS: ${row.dns_security}`);

              if (parts.length === 0) return <span style={{ color: 'var(--text-muted)' }}>Default (None)</span>;

              return (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '300px' }}>
                  {parts.map(p => (
                    <span key={p} style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                      <HighlightedText text={p} highlight={query || ''} />
                    </span>
                  ))}
                </div>
              );
            }
          }
        ];
        break;

      case 'Custom Objects':
        if (activeCustomObjectTab === 'categories') {
          subtabCols = [
            {
              key: 'url_list',
              label: 'URLs List',
              width: '320px',
              renderCell: (val, row, query) => {
                const list = val ? String(val).split(',') : [];
                if (list.length === 0) return <span style={{ color: 'var(--text-muted)' }}>No URLs</span>;
                return (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '300px' }}>
                    {list.slice(0, 3).map((u: string) => (
                      <span key={u} title={u} style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '3px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '90px' }}>
                        <HighlightedText text={u} highlight={query || ''} />
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
        } else {
          subtabCols = [
            {
              key: 'list_type',
              label: 'List Type',
              width: '120px',
              renderCell: (val, row, query) => (
                <span className="badge badge-info" style={{ fontWeight: 600 }}>
                  <HighlightedText text={String(val).toUpperCase()} highlight={query || ''} />
                </span>
              )
            },
            {
              key: 'source_url',
              label: 'Source URL',
              width: '200px',
              renderCell: (val, row, query) => (
                <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                  <HighlightedText text={String(val)} highlight={query || ''} />
                </span>
              )
            },
            {
              key: 'recurring',
              label: 'Check Rate',
              width: '110px',
              renderCell: (val, row, query) => (
                <span className="badge badge-neutral">
                  <HighlightedText text={String(val)} highlight={query || ''} />
                </span>
              )
            }
          ];
        }
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
          const isShowAll = currentScope === 'show-all';
          const isInherited = !isShowAll && row.device_uuid !== currentScope;
          const inheritedScopeName = isInherited ? (scopeNameMap[row.device_uuid] || row.device_uuid) : '';
          return (
            <div style={{ display: 'flex', gap: '6px' }}>
              {isGroup && (
                <Tooltip content="Inspect Members Details" position="top">
                  <button
                    className="btn-table-action"
                    onClick={() => handleOpenSlideOver(row)}
                  >
                    <Eye size={14} />
                  </button>
                </Tooltip>
              )}
              {isShowAll ? (
                <Tooltip content="Select a specific Device Group or Firewall to edit objects" position="top">
                  <button
                    className="btn-table-action"
                    style={{ opacity: 0.5, cursor: 'not-allowed' }}
                    disabled
                  >
                    <Edit2 size={14} />
                  </button>
                </Tooltip>
              ) : isInherited ? (
                <Tooltip content={`Inherited from ${inheritedScopeName}. Switch to this scope to edit.`} position="top">
                  <button
                    className="btn-table-action"
                    style={{ opacity: 0.5, cursor: 'not-allowed' }}
                    disabled
                  >
                    <Edit2 size={14} />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip content="Edit Object" position="top">
                  <button
                    className="btn-table-action"
                    onClick={() => openEditModal(row)}
                  >
                    <Edit2 size={14} />
                  </button>
                </Tooltip>
              )}
              {isShowAll ? (
                <Tooltip content="Select a specific Device Group or Firewall to delete objects" position="top">
                  <button
                    className="btn-table-action-danger"
                    style={{ opacity: 0.5, cursor: 'not-allowed' }}
                    disabled
                  >
                    <Trash2 size={14} />
                  </button>
                </Tooltip>
              ) : isInherited ? (
                <Tooltip content={`Inherited from ${inheritedScopeName}. Switch to this scope to delete.`} position="top">
                  <button
                    className="btn-table-action-danger"
                    style={{ opacity: 0.5, cursor: 'not-allowed' }}
                    disabled
                  >
                    <Trash2 size={14} />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip content="Delete Object" position="top">
                  <button
                    className="btn-table-action-danger"
                    onClick={() => handleDeleteObject(row)}
                  >
                    <Trash2 size={14} />
                  </button>
                </Tooltip>
              )}
            </div>
          );
        }
      }
    ];

    return [...defaultCols, ...subtabCols, ...actionCols];
  }, [activeSubTab, scopeNameMap, currentScope, activeCustomObjectTab]);

  const isFormDirty = useMemo(() => {
    if (crudMode !== 'edit' || !selectedObject) return true;
    if (formName !== selectedObject.name) return true;
    if (formScopeUuid !== selectedObject.device_uuid) return true;
    if (formDescription !== (selectedObject.description || '')) return true;
    
    if (activeSubTab === 'Address Objects') {
      if (formType !== selectedObject.type) return true;
      if (formValue !== selectedObject.value) return true;
    } else if (activeSubTab === 'Address Groups') {
      if (formType !== (selectedObject.type || 'static')) return true;
      if (formFilter !== (selectedObject.filter || '')) return true;
      if (formMembers.join(',') !== (selectedObject.member_list || '')) return true;
    } else if (activeSubTab === 'Services') {
      if (formProtocol !== selectedObject.protocol) return true;
      if (formSourcePort !== (selectedObject.source_port || '')) return true;
      if (formDestPort !== selectedObject.destination_port) return true;
    } else if (activeSubTab === 'Service Groups') {
      if (formMembers.join(',') !== (selectedObject.member_list || '')) return true;
    } else if (activeSubTab === 'Applications') {
      if (formCategory !== selectedObject.category) return true;
      if (formSubcategory !== selectedObject.subcategory) return true;
      if (formTechnology !== selectedObject.technology) return true;
      if (formRisk !== (selectedObject.risk || 1)) return true;
      if (formPorts !== (selectedObject.ports || '')) return true;
    } else if (activeSubTab === 'Application Groups') {
      if (formMembers.join(',') !== (selectedObject.member_list || '')) return true;
    } else if (activeSubTab === 'Tags') {
      if (formColor !== (selectedObject.color || 'color1')) return true;
    } else if (activeSubTab === 'Security Profiles') {
      if (formProfileType !== (selectedObject.type || 'antivirus')) return true;
    } else if (activeSubTab === 'Security Profile Groups') {
      if (formGroupAntivirus !== (selectedObject.antivirus || '')) return true;
      if (formGroupSpyware !== (selectedObject.spyware || '')) return true;
      if (formGroupVulnerability !== (selectedObject.vulnerability || '')) return true;
      if (formGroupURLFiltering !== (selectedObject.url_filtering || '')) return true;
      if (formGroupFileBlocking !== (selectedObject.file_blocking || '')) return true;
      if (formGroupWildfireAnalysis !== (selectedObject.wildfire_analysis || '')) return true;
      if (formGroupDNSSecurity !== (selectedObject.dns_security || '')) return true;
    } else if (activeSubTab === 'Custom Objects') {
      if (activeCustomObjectTab === 'categories') {
        if (formURLList !== (selectedObject.url_list || '')) return true;
      } else {
        if (formListType !== (selectedObject.type || 'ip')) return true;
        if (formSourceURL !== (selectedObject.source_url || '')) return true;
        if (formRecurring !== (selectedObject.recurring || 'five-minute')) return true;
      }
    }
    // Verify tag mappings
    const originalTags: string[] = [];
    const mappings = allTagMappings.filter(m => 
      m.entity_id === selectedObject.id && 
      m.entity_type === (activeSubTab === 'Address Objects' ? 'address_object' : 'address_group')
    );
    mappings.forEach(m => {
      const tagObj = allTags.find(t => t.id === m.tag_id);
      if (tagObj) originalTags.push(tagObj.name);
    });
    if ([...formTags].sort().join(',') !== [...originalTags].sort().join(',')) return true;
    
    return false;
  }, [
    crudMode, selectedObject, formName, formScopeUuid, formDescription, activeSubTab,
    formType, formValue, formFilter, formMembers, formProtocol, formSourcePort, formDestPort,
    formCategory, formSubcategory, formTechnology, formRisk, formPorts, formColor, formProfileType,
    formGroupAntivirus, formGroupSpyware, formGroupVulnerability, formGroupURLFiltering,
    formGroupFileBlocking, formGroupWildfireAnalysis, formGroupDNSSecurity, activeCustomObjectTab,
    formURLList, formListType, formSourceURL, formRecurring, formTags, allTagMappings, allTags
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      {/* 2. Main content canvas */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {/* Scope context summary top header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
          {/* Row 1: Title */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
              {activeSubTab}
            </h2>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <button
                onClick={openCreateModal}
                className="btn-primary btn-sm"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                disabled={currentScope === 'show-all'}
                title={currentScope === 'show-all' ? "Select a specific Device Group or Firewall to add objects" : "Create new object"}
              >
                <Plus size={14} /> Add Object
              </button>
              <div style={{ width: '300px' }}>
                <SearchBar
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder={`Search ${activeSubTab.toLowerCase()}...`}
                  width="100%"
                  variant="local"
                />
              </div>
            </div>
          </div>

          {/* Row 2: Device Group Dropdown & Lineage */}
          <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', width: '100%', gap: '24px', minHeight: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>Device Group:</span>
              <SearchableScopeDropdown
                value={currentScope}
                options={hierarchyOptions}
                onChange={handleScopeChange}
                scopeNameMap={scopeNameMap}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }}>
              {currentScope !== 'show-all' && currentScope !== 'paloalto-panorama-global' && visibleScopes.length > 1 ? (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'normal', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                  Scope Context: 
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', marginLeft: '4px', flexWrap: 'wrap' }}>
                    {[...visibleScopes.slice(1)].reverse().map((scopeId, idx, arr) => (
                      <React.Fragment key={scopeId}>
                        <span 
                          onClick={() => handleScopeChange(scopeId)}
                          style={{ 
                            color: 'var(--text-muted)', 
                            cursor: 'pointer', 
                            fontWeight: 400,
                            transition: 'color 0.15s ease',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-main)'; e.currentTarget.style.textDecoration = 'underline'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.textDecoration = 'none'; }}
                          title={`Switch active scope to ${scopeNameMap[scopeId] || scopeId}`}
                        >
                          {scopeNameMap[scopeId] || scopeId}
                        </span>
                        {idx < arr.length - 1 && <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>➔</span>}
                      </React.Fragment>
                    ))}
                    <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>➔</span>
                    <span style={{ 
                      backgroundColor: 'rgba(59, 130, 246, 0.15)', 
                      color: 'var(--accent-blue)', 
                      padding: '2px 8px', 
                      borderRadius: '4px', 
                      border: '1px solid rgba(59, 130, 246, 0.25)', 
                      fontWeight: 600, 
                      fontSize: '11px',
                      display: 'inline-flex',
                      alignItems: 'center'
                    }}>
                      {scopeNameMap[currentScope] || currentScope}
                    </span>
                  </span>
                </span>
              ) : (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {currentScope === 'paloalto-panorama-global' ? 'Viewing global configuration objects (Shared).' : 'Viewing combined objects across all configured administrative scopes.'}
                </span>
              )}
            </div>
          </div>
          </div>
        </div>

        {/* Ingest Pack drop-zone (Only for Custom Applications list) */}
        {activeSubTab === 'Applications' && currentScope !== 'show-all' && (
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

        {/* Sub-tabs segment selector row */}
        {(activeSubTab === 'Security Profiles' || activeSubTab === 'Custom Objects') && (
          <div style={{ padding: '10px 20px 0 20px', backgroundColor: 'var(--bg-app)', display: 'flex', flexShrink: 0 }}>
            {activeSubTab === 'Security Profiles' && (
              <div style={{ display: 'flex', border: '1px solid var(--border-main)', borderRadius: '6px', overflow: 'hidden', backgroundColor: 'var(--bg-surface)', flexShrink: 0 }}>
                {([
                  { id: 'all', label: 'All' },
                  { id: 'antivirus', label: 'Antivirus' },
                  { id: 'spyware', label: 'Anti-Spyware' },
                  { id: 'vulnerability', label: 'Vulnerability Protection' },
                  { id: 'url-filtering', label: 'URL Filtering' },
                  { id: 'file-blocking', label: 'File Blocking' },
                  { id: 'wildfire', label: 'WildFire Analysis' }
                ] as const).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className="btn-sm"
                    style={{
                      borderRadius: 0,
                      border: 'none',
                      padding: '6px 12px',
                      backgroundColor: activeProfileTab === tab.id ? 'var(--accent-blue)' : 'transparent',
                      color: activeProfileTab === tab.id ? '#ffffff' : 'var(--text-main)',
                      fontWeight: 500,
                      cursor: 'pointer',
                      borderLeft: tab.id !== 'all' ? '1px solid var(--border-main)' : 'none'
                    }}
                    onClick={() => setActiveProfileTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
            {activeSubTab === 'Custom Objects' && (
              <div style={{ display: 'flex', border: '1px solid var(--border-main)', borderRadius: '6px', overflow: 'hidden', backgroundColor: 'var(--bg-surface)', flexShrink: 0 }}>
                <button
                  type="button"
                  className={`btn-sm`}
                  style={{
                    borderRadius: 0,
                    border: 'none',
                    padding: '6px 12px',
                    backgroundColor: activeCustomObjectTab === 'categories' ? 'var(--accent-blue)' : 'transparent',
                    color: activeCustomObjectTab === 'categories' ? '#ffffff' : 'var(--text-main)',
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                  onClick={() => setActiveCustomObjectTab('categories')}
                >
                  URL Categories
                </button>
                <button
                  type="button"
                  className={`btn-sm`}
                  style={{
                    borderRadius: 0,
                    border: 'none',
                    padding: '6px 12px',
                    backgroundColor: activeCustomObjectTab === 'edls' ? 'var(--accent-blue)' : 'transparent',
                    color: activeCustomObjectTab === 'edls' ? '#ffffff' : 'var(--text-main)',
                    fontWeight: 500,
                    cursor: 'pointer',
                    borderLeft: '1px solid var(--border-main)'
                  }}
                  onClick={() => setActiveCustomObjectTab('edls')}
                >
                  External Dynamic Lists (EDLs)
                </button>
              </div>
            )}
          </div>
        )}

        {/* The data table area - Stretch to edge-to-edge */}
        <div style={{ flex: 1, padding: '0', margin: '0 -30px -30px -30px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {loading ? (
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)', gap: '10px' }}>
              <Loader2 className="spin-animation" size={20} /> Loading database records...
            </div>
          ) : (
            <>
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <DataTable
                  key={activeSubTab}
                  columns={columns}
                  data={displayedTableData}
                  searchQuery={searchQuery}
                  selectable={true}
                  onSelectionChange={setSelectedRows}
                  exportFilename={`${activeSubTab.toLowerCase().replace(' ', '_')}_export.csv`}
                  additionalExportColumns={[{
                    header: 'CLI Output',
                    getValue: (row) => generateCliCommandsForRow(row).join('\n')
                  }]}
                  rowStyle={(row) => {
                    const isShowAll = currentScope === 'show-all';
                    const isInherited = !isShowAll && row.device_uuid !== currentScope;
                    return isInherited ? { opacity: 0.55 } : {};
                  }}
                  bulkActions={
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={() => setShowActionsMenu(!showActionsMenu)}
                          className="btn-secondary btn-sm"
                          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                          Actions <ChevronDown size={14} />
                        </button>
                        {showActionsMenu && (
                          <>
                            {/* Invisible overlay for click-outside */}
                            <div 
                              style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
                              onClick={() => setShowActionsMenu(false)}
                            />
                            <div style={{ 
                              position: 'absolute', 
                              top: '100%', 
                              left: 0, 
                              marginTop: '6px', 
                              backgroundColor: 'var(--bg-surface)', 
                              border: '1px solid var(--border-main)', 
                              borderRadius: '6px', 
                              padding: '6px', 
                              boxShadow: '0 4px 12px rgba(0,0,0,0.2)', 
                              zIndex: 1000, 
                              display: 'flex', 
                              flexDirection: 'column', 
                              gap: '4px',
                              minWidth: '180px'
                            }}>
                              <button
                                onClick={() => { setShowActionsMenu(false); handleClone(); }}
                                className="btn-secondary btn-sm"
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start' }}
                                disabled={selectedRows.length === 0 || selectedRows.length > 50}
                                title={selectedRows.length > 50 ? "Bulk operations limited to 50 items" : "Clone selected objects"}
                              >
                                <Copy size={13} /> Clone
                              </button>
                              
                              <button
                                onClick={() => { setShowActionsMenu(false); handleCloneToGroup(); }}
                                className="btn-secondary btn-sm"
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start' }}
                                disabled={selectedRows.length === 0 || selectedRows.length > 50}
                                title={selectedRows.length > 50 ? "Bulk operations limited to 50 items" : "Clone objects to another group"}
                              >
                                <Copy size={13} /> Clone to Group...
                              </button>

                              <button
                                onClick={() => { setShowActionsMenu(false); handleMoveToGroup(); }}
                                className="btn-secondary btn-sm"
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start' }}
                                disabled={selectedRows.length === 0 || selectedRows.length > 50}
                                title={selectedRows.length > 50 ? "Bulk operations limited to 50 items" : "Move objects to another group"}
                              >
                                <ArrowRight size={13} /> Move to Group...
                              </button>

                              <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />

                              <button
                                onClick={() => { setShowActionsMenu(false); handleBulkDelete(); }}
                                className="btn-danger btn-sm"
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start' }}
                                disabled={selectedRows.length === 0}
                                title="Bulk delete selected objects"
                              >
                                <Trash2 size={13} /> Bulk Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  }
                  exportActions={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        onClick={() => setImportWizardOpen(true)}
                        className="btn-secondary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        title="Import data from CSV or Excel"
                      >
                        <FileUp size={13} /> Import CSV / Excel
                      </button>
                      <button
                        onClick={handleGenerateCli}
                        className="btn-secondary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        disabled={displayedTableData.length === 0}
                        title={selectedRows.length > 0 ? `Generate CLI for ${selectedRows.length} selected objects` : "Generate CLI for all displayed objects"}
                      >
                        <Code size={13} /> Generate CLI
                      </button>
                    </div>
                  }
                />
              </div>

              {/* Centralized Data Import Manager Modal */}
              <DataImportWizard 
                isOpen={importWizardOpen} 
                onClose={() => setImportWizardOpen(false)}
                defaultDataType={
                  activeSubTab === 'Address Objects' ? 'address_objects' :
                  activeSubTab === 'Address Groups' ? 'address_groups' :
                  activeSubTab === 'Service Objects' ? 'service_objects' :
                  'address_objects'
                }
                apiClient={apiClient}
                deviceUuid={currentScope}
                scope={currentScope === 'shared' ? 'shared' : 'local'}
                onSuccess={() => {
                  fetchRecords();
                  loadReferenceData();
                  addToast('Data imported successfully!', 'success');
                }}
              />
            </>
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
                              <Tooltip content={member.name} position="top" align="right">
                                <span style={{ fontWeight: 500, color: 'var(--text-main)', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <HighlightedText text={member.name} highlight={inspectorSearch} />
                                </span>
                              </Tooltip>
                              <Tooltip content={`${member.type} • ${member.details}`} position="top" align="right">
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <HighlightedText text={`${member.type} • ${member.details}`} highlight={inspectorSearch} />
                                </span>
                              </Tooltip>
                              {member.paths && member.paths.length > 0 && (
                                <Tooltip content={`via ${member.paths.join(', ')}`} position="top" align="right">
                                  <span style={{ fontSize: '10px', color: 'var(--accent-purple)', marginTop: '2px', display: 'block' }}>
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
            <button className="btn-primary btn-sm" onClick={handleSaveObject} disabled={!isFormDirty}>Save Changes</button>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Tags (Optional)</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  {formTags.map(tName => {
                    const tagObj = allTags.find(t => t.name === tName);
                    const colorMap: Record<string, string> = {
                      color1: '#ef4444', color2: '#3b82f6', color3: '#10b981', color4: '#f59e0b',
                      color5: '#ec4899', color6: '#8b5cf6', color7: '#06b6d4', color8: '#14b8a6',
                      color9: '#f97316', color10: '#64748b', color11: '#22c55e', color12: '#a855f7',
                      color13: '#e11d48', color14: '#d97706', color15: '#2563eb', color16: '#059669',
                    };
                    const hex = tagObj ? (colorMap[tagObj.color] || 'var(--text-muted)') : 'var(--text-muted)';
                    return (
                      <span
                        key={tName}
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: `${hex}22`,
                          color: hex,
                          border: `1px solid ${hex}44`,
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: hex }} />
                        {tName}
                        <button
                          type="button"
                          onClick={() => setFormTags(formTags.filter(t => t !== tName))}
                          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    );
                  })}
                </div>
                <Dropdown
                  width="100%"
                  value=""
                  onChange={(val) => {
                    if (val && !formTags.includes(val)) {
                      setFormTags([...formTags, val]);
                    }
                  }}
                  options={['', ...allTags.map(t => t.name).filter(name => !formTags.includes(name))]}
                  renderOption={(opt) => opt || 'Select tag...'}
                  searchable={true}
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
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Match Filter</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <textarea 
                      className="input-text"
                      style={{ height: '80px', resize: 'none', fontFamily: 'monospace', fontSize: '12px' }}
                      value={formFilter} 
                      onChange={e => setFormFilter(e.target.value)} 
                      placeholder="e.g. 'tag1' and ('tag2' or 'tag3')" 
                    />
                    
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                      <div style={{ display: 'flex', backgroundColor: 'var(--bg-main)', borderRadius: '4px', border: '1px solid var(--border-main)', padding: '2px' }}>
                        <button
                          type="button"
                          onClick={() => setFilterLogic('and')}
                          style={{
                            padding: '4px 12px',
                            fontSize: '12px',
                            borderRadius: '3px',
                            fontWeight: 500,
                            backgroundColor: filterLogic === 'and' ? 'var(--button-primary)' : 'transparent',
                            color: filterLogic === 'and' ? '#fff' : 'var(--text-muted)',
                            border: 'none',
                            cursor: 'pointer'
                          }}
                        >AND</button>
                        <button
                          type="button"
                          onClick={() => setFilterLogic('or')}
                          style={{
                            padding: '4px 12px',
                            fontSize: '12px',
                            borderRadius: '3px',
                            fontWeight: 500,
                            backgroundColor: filterLogic === 'or' ? 'var(--button-primary)' : 'transparent',
                            color: filterLogic === 'or' ? '#fff' : 'var(--text-muted)',
                            border: 'none',
                            cursor: 'pointer'
                          }}
                        >OR</button>
                      </div>
                      
                      <div style={{ height: '16px', width: '1px', backgroundColor: 'var(--border-main)' }}></div>
                      
                      {['NOT', '(', ')'].map(op => (
                        <button
                          key={op}
                          type="button"
                          onClick={() => {
                            const val = op.toLowerCase();
                            setFormFilter(prev => prev + (prev && !prev.endsWith(' ') && !['(', ')'].includes(op) ? ' ' : '') + val + ' ');
                          }}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: 'var(--bg-card)',
                            border: '1px solid var(--border-main)',
                            borderRadius: '4px',
                            fontSize: '12px',
                            color: 'var(--text-main)',
                            cursor: 'pointer'
                          }}
                        >{op}</button>
                      ))}
                      
                      {!showFilterTagSelector && (
                        <button
                          type="button"
                          onClick={() => setShowFilterTagSelector(true)}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            borderRadius: '4px',
                            fontSize: '12px',
                            color: '#3b82f6',
                            cursor: 'pointer',
                            marginLeft: 'auto',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >Select Tags</button>
                      )}
                    </div>
                    
                    {showFilterTagSelector && (
                      <div style={{ border: '1px solid var(--border-main)', borderRadius: '4px', display: 'flex', flexDirection: 'column', height: '192px', backgroundColor: 'var(--bg-card)' }}>
                        <div style={{ padding: '8px', borderBottom: '1px solid var(--border-main)', display: 'flex', gap: '8px', alignItems: 'center', backgroundColor: 'var(--bg-main)' }}>
                          <div style={{ position: 'relative', flex: 1 }}>
                            <input
                              type="text"
                              placeholder="Search tags..."
                              className="input-text"
                              style={{ paddingLeft: '8px', paddingRight: '24px', width: '100%' }}
                              value={filterTagSearch}
                              onChange={e => setFilterTagSearch(e.target.value)}
                            />
                            {filterTagSearch && (
                              <button
                                type="button"
                                style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                                onClick={() => setFilterTagSearch('')}
                              >×</button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowFilterTagSelector(false)}
                            style={{
                              fontSize: '12px',
                              backgroundColor: 'var(--button-primary)',
                              color: '#fff',
                              padding: '4px 12px',
                              borderRadius: '4px',
                              border: 'none',
                              cursor: 'pointer'
                            }}
                          >Done</button>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
                          {allTags.filter(t => t.name.toLowerCase().includes(filterTagSearch.toLowerCase())).map(tag => (
                            <div
                              key={tag.id}
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', cursor: 'pointer', borderRadius: '4px' }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              onClick={() => {
                                const tagText = `'${tag.name}'`;
                                let newFilter = formFilter.trim();
                                if (newFilter) {
                                  const lower = newFilter.toLowerCase();
                                  const endsWithOp = lower.endsWith('(') || lower.endsWith('not') || lower.endsWith('and') || lower.endsWith('or');
                                  if (!endsWithOp) {
                                    newFilter += ` ${filterLogic} `;
                                  } else {
                                    newFilter += ' ';
                                  }
                                }
                                newFilter += tagText;
                                setFormFilter(newFilter);
                              }}
                            >
                              <span style={{ fontSize: '12px', color: 'var(--text-main)', fontWeight: 500 }}>{tag.name}</span>
                            </div>
                          ))}
                          {allTags.filter(t => t.name.toLowerCase().includes(filterTagSearch.toLowerCase())).length === 0 && (
                            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                              No matching tags found
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Tags (Optional)</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  {formTags.map(tName => {
                    const tagObj = allTags.find(t => t.name === tName);
                    const colorMap: Record<string, string> = {
                      color1: '#ef4444', color2: '#3b82f6', color3: '#10b981', color4: '#f59e0b',
                      color5: '#ec4899', color6: '#8b5cf6', color7: '#06b6d4', color8: '#14b8a6',
                      color9: '#f97316', color10: '#64748b', color11: '#22c55e', color12: '#a855f7',
                      color13: '#e11d48', color14: '#d97706', color15: '#2563eb', color16: '#059669',
                    };
                    const hex = tagObj ? (colorMap[tagObj.color] || 'var(--text-muted)') : 'var(--text-muted)';
                    return (
                      <span
                        key={tName}
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: `${hex}22`,
                          color: hex,
                          border: `1px solid ${hex}44`,
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: hex }} />
                        {tName}
                        <button
                          type="button"
                          onClick={() => setFormTags(formTags.filter(t => t !== tName))}
                          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    );
                  })}
                </div>
                <Dropdown
                  width="100%"
                  value=""
                  onChange={(val) => {
                    if (val && !formTags.includes(val)) {
                      setFormTags([...formTags, val]);
                    }
                  }}
                  options={['', ...allTags.map(t => t.name).filter(name => !formTags.includes(name))]}
                  renderOption={(opt) => opt || 'Select tag...'}
                  searchable={true}
                />
              </div>
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

          {activeSubTab === 'Tags' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Color Tag</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '8px', padding: '5px 0' }}>
                {Array.from({ length: 16 }, (_, i) => `color${i + 1}`).map(colKey => {
                  const colorMap: Record<string, string> = {
                    color1: '#ef4444', color2: '#3b82f6', color3: '#10b981', color4: '#f59e0b',
                    color5: '#ec4899', color6: '#8b5cf6', color7: '#06b6d4', color8: '#14b8a6',
                    color9: '#f97316', color10: '#64748b', color11: '#22c55e', color12: '#a855f7',
                    color13: '#e11d48', color14: '#d97706', color15: '#2563eb', color16: '#059669',
                  };
                  return (
                    <button
                      key={colKey}
                      type="button"
                      onClick={() => setFormColor(colKey)}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: colorMap[colKey],
                        border: formColor === colKey ? '2px solid var(--text-main)' : '1px solid var(--border-main)',
                        cursor: 'pointer',
                        transform: formColor === colKey ? 'scale(1.1)' : 'scale(1)',
                        transition: 'transform 0.1s ease',
                      }}
                      title={colKey}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {activeSubTab === 'Security Profiles' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Profile Type</label>
              <Dropdown
                width="100%"
                value={formProfileType}
                onChange={setFormProfileType}
                options={['antivirus', 'spyware', 'vulnerability', 'url-filtering', 'file-blocking', 'wildfire']}
                renderOption={(opt) => {
                  const displayMap: Record<string, string> = {
                    'url-filtering': 'URL Filtering',
                    'antivirus': 'Antivirus',
                    'vulnerability': 'Vulnerability Protection',
                    'spyware': 'Anti-Spyware',
                    'wildfire': 'WildFire Analysis',
                    'file-blocking': 'File Blocking',
                  };
                  return displayMap[opt] || opt;
                }}
              />
            </div>
          )}

          {activeSubTab === 'Security Profile Groups' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Antivirus Profile</label>
                  <Dropdown
                    width="100%"
                    value={formGroupAntivirus}
                    onChange={setFormGroupAntivirus}
                    options={['', ...allSecurityProfiles.filter(p => p.type === 'antivirus').map(p => p.name)]}
                    renderOption={(opt) => opt || 'None (Default)'}
                    searchable={true}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Anti-Spyware Profile</label>
                  <Dropdown
                    width="100%"
                    value={formGroupSpyware}
                    onChange={setFormGroupSpyware}
                    options={['', ...allSecurityProfiles.filter(p => p.type === 'spyware').map(p => p.name)]}
                    renderOption={(opt) => opt || 'None (Default)'}
                    searchable={true}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Vulnerability Protection</label>
                  <Dropdown
                    width="100%"
                    value={formGroupVulnerability}
                    onChange={setFormGroupVulnerability}
                    options={['', ...allSecurityProfiles.filter(p => p.type === 'vulnerability').map(p => p.name)]}
                    renderOption={(opt) => opt || 'None (Default)'}
                    searchable={true}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>URL Filtering Profile</label>
                  <Dropdown
                    width="100%"
                    value={formGroupURLFiltering}
                    onChange={setFormGroupURLFiltering}
                    options={['', ...allSecurityProfiles.filter(p => p.type === 'url-filtering').map(p => p.name)]}
                    renderOption={(opt) => opt || 'None (Default)'}
                    searchable={true}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>File Blocking Profile</label>
                  <Dropdown
                    width="100%"
                    value={formGroupFileBlocking}
                    onChange={setFormGroupFileBlocking}
                    options={['', ...allSecurityProfiles.filter(p => p.type === 'file-blocking').map(p => p.name)]}
                    renderOption={(opt) => opt || 'None (Default)'}
                    searchable={true}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>WildFire Analysis</label>
                  <Dropdown
                    width="100%"
                    value={formGroupWildfireAnalysis}
                    onChange={setFormGroupWildfireAnalysis}
                    options={['', ...allSecurityProfiles.filter(p => p.type === 'wildfire').map(p => p.name)]}
                    renderOption={(opt) => opt || 'None (Default)'}
                    searchable={true}
                  />
                </div>
              </div>
            </>
          )}

          {activeSubTab === 'Custom Objects' && activeCustomObjectTab === 'categories' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Member URL List (comma-separated)</label>
              <textarea
                className="input-text"
                style={{ height: '80px', resize: 'vertical' }}
                value={formURLList}
                onChange={(e) => setFormURLList(e.target.value)}
                placeholder="e.g. *.google.com, *.youtube.com"
                required
              />
            </div>
          )}

          {activeSubTab === 'Custom Objects' && activeCustomObjectTab === 'edls' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>List Type</label>
                  <Dropdown
                    width="100%"
                    value={formListType}
                    onChange={setFormListType}
                    options={['ip', 'domain', 'url']}
                    renderOption={(opt) => opt.toUpperCase()}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Recurring Check Rate</label>
                  <Dropdown
                    width="100%"
                    value={formRecurring}
                    onChange={setFormRecurring}
                    options={['five-minute', 'hourly', 'daily', 'weekly', 'monthly']}
                    renderOption={(opt) => opt.replace('-', ' ')}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Source URL</label>
                <input
                  type="text"
                  className="input-text"
                  value={formSourceURL}
                  onChange={(e) => setFormSourceURL(e.target.value)}
                  placeholder="e.g. http://feed.threatsource.com/ips.txt"
                  required
                />
              </div>
            </>
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

      {/* 6. Target Scope Selector Modal */}
      <Modal
        isOpen={isTargetModalOpen}
        onClose={() => setIsTargetModalOpen(false)}
        title={targetActionType === 'clone' ? 'Clone Objects to Target Scope' : 'Move Objects to Target Scope'}
        size="sm"
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setIsTargetModalOpen(false)}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleConfirmTargetScope}>Continue</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Specify the destination device group or firewall scope context:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Target Location</label>
            <SearchableScopeDropdown
              value={targetScopeUuid}
              options={hierarchyOptions.filter(o => o.value !== 'show-all')} // Cannot move/clone to "Show all"
              onChange={setTargetScopeUuid}
              scopeNameMap={scopeNameMap}
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={moveConfirmDialog.isOpen}
        onClose={() => setMoveConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        title={moveConfirmDialog.title}
        size={moveConfirmDialog.initialWidth && moveConfirmDialog.initialWidth > 600 ? 'lg' : 'md'}
        footer={
          <>
            <button 
              className="btn-secondary btn-sm" 
              onClick={() => {
                if (moveConfirmDialog.onClose) moveConfirmDialog.onClose();
                else setMoveConfirmDialog(prev => ({ ...prev, isOpen: false }));
              }}
            >
              {moveConfirmDialog.cancelText || 'Cancel'}
            </button>
            <button 
              className={`btn-primary btn-sm ${moveConfirmDialog.isDestructive ? 'bg-red-500 hover:bg-red-600 border-red-600' : ''}`} 
              onClick={() => moveConfirmDialog.onConfirm()}
            >
              {moveConfirmDialog.confirmText}
            </button>
          </>
        }
      >
        <div style={{ padding: '10px 0' }}>
          {moveConfirmDialog.message}
        </div>
      </Modal>

      {isProcessing && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          zIndex: 99999
        }}>
          <Loader2 className="spin-animation" size={36} style={{ color: 'var(--accent-blue)' }} />
          <span style={{ color: 'var(--text-main)', fontSize: '14px', fontWeight: 500 }}>
            Analyzing dependencies and preparing operations plan...
          </span>
        </div>
      )}
    </div>
  );
};
