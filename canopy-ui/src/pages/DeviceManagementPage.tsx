import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { SearchBar } from '../components/SearchBar';
import { Tooltip } from '../components/Tooltip';
import { Modal } from '../components/Modal';
import { Dropdown } from '../components/Dropdown';
import { useConfirm } from '../components/ConfirmProvider';
import { NewWindowPortal } from '../components/NewWindowPortal';
import { Server, LayoutGrid, Layers, FileText, ChevronRight, ChevronDown, ChevronUp, ChevronsUp, ChevronsDown, Loader2, Network, Plus, Edit2, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Copy, MoreHorizontal, ExternalLink, Globe, X } from 'lucide-react';

interface DeviceManagementPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  activeSubTab?: string;
  setActiveSubTab?: (tab: string) => void;
  standaloneAssign?: boolean;
  standaloneGroupId?: string | null;
}

interface ManagedDevice {
  id: number;
  serial: string;
  name: string;
  ip_address: string;
  device_group: string | null;
  template_stack: string | null;
  device_group_id?: number | null;
  template_stack_id?: number | null;
  template_id?: number | null;
}

interface DeviceGroupNode {
  id: number;
  uuid: string;
  name: string;
  parent_uuid: string | null;
  description?: string | null;
}

interface BaseTemplateNode {
  id: number;
  uuid: string;
  name: string;
}

interface TemplateStack {
  id: number;
  uuid: string;
  name: string;
  device_uuid: string;
}

interface TemplateStackMember {
  stack_id: number;
  template_name: string;
  sequence: number;
}

// Helpers to strip Palo Alto suffixes from names
const cleanGroupName = (name: string) => name.replace(/\s*\(Device Group\)$/i, '');
const cleanTemplateName = (name: string) => name.replace(/\s*\(Panorama\)$/i, '').replace(/\s*\(Template Stack\)$/i, '');

// 1. Recursive Tree Node for Device Groups
interface GroupTreeItemProps {
  group: DeviceGroupNode;
  allGroups: DeviceGroupNode[];
  selectedGroupId: string | null;
  onSelect: (uuid: string) => void;
  deviceCounts: Record<string, number>;
  onContextMenu?: (e: React.MouseEvent, group: DeviceGroupNode) => void;
  depth?: number;
  isLastInTree?: boolean;
}

const GroupTreeItem: React.FC<GroupTreeItemProps> = ({
  group,
  allGroups,
  selectedGroupId,
  onSelect,
  deviceCounts,
  onContextMenu,
  depth = 0,
  isLastInTree = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const children = allGroups.filter(g => g.parent_uuid === group.uuid);
  const isSelected = group.uuid === selectedGroupId;
  const hasChildren = children.length > 0;
  const count = deviceCounts[group.uuid] || 0;

  return (
    <div>
      <div
        onClick={() => onSelect(group.uuid)}
        onContextMenu={(e) => {
          if (onContextMenu) {
            e.preventDefault();
            e.stopPropagation();
            onContextMenu(e, group);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '32px',
          padding: '0 10px',
          paddingLeft: `${10 + (depth > 0 ? 12 : 0)}px`,
          boxSizing: 'border-box',
          cursor: 'pointer',
          backgroundColor: isSelected ? 'var(--bg-element)' : 'var(--bg-surface)',
          borderLeft: isSelected ? '3px solid var(--accent-blue)' : '3px solid transparent',
          color: isSelected ? 'var(--text-main)' : 'var(--text-muted)',
          fontSize: '13px',
          transition: 'all 0.15s ease',
          userSelect: 'none',
          position: 'sticky',
          top: `${10 + depth * 32}px`,
          zIndex: 10 - depth,
          boxShadow: `0 1px 0 var(--bg-surface)`
        }}
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          style={{
            marginRight: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            height: '16px',
            color: 'var(--text-sub)',
          }}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <div style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--text-sub)' }} />
          )}
        </span>
        {group.uuid === 'paloalto-dg-shared' ? (
          <Globe size={14} style={{ marginRight: '8px', color: 'var(--accent-blue)', flexShrink: 0 }} />
        ) : (
          <Layers size={14} style={{ marginRight: '8px', color: isSelected ? 'var(--accent-purple)' : 'var(--text-sub)', flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSelected ? 600 : 400 }}>
            {group.uuid === 'paloalto-dg-shared' ? 'Shared' : cleanGroupName(group.name)}
          </span>
          {count !== undefined && count > 0 && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.5px' }}>
              ({count})
            </span>
          )}
        </div>
      </div>
      {isExpanded && hasChildren && (
        <div style={{ position: 'relative', marginLeft: `${19 + (depth > 0 ? 12 : 0)}px` }}>
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: isLastInTree ? 'max(50px, calc(100vh - 400px))' : 0,
            width: '1px',
            backgroundColor: 'var(--border-main)',
            zIndex: 1
          }} />
          {children.map((child, index) => (
            <GroupTreeItem
              key={child.uuid}
              group={child}
              allGroups={allGroups}
              selectedGroupId={selectedGroupId}
              onSelect={onSelect}
              deviceCounts={deviceCounts}
              onContextMenu={onContextMenu}
              depth={depth + 1}
              isLastInTree={isLastInTree && index === children.length - 1}
            />
          ))}
        </div>
      )}
      {isLastInTree && (!isExpanded || !hasChildren) && (
        <div style={{ height: 'max(50px, calc(100vh - 400px))', flexShrink: 0 }} />
      )}
    </div>
  );
};

// 2. Tree Item for Template Stacks
interface TemplateStackItemProps {
  stack: TemplateStack;
  members: TemplateStackMember[];
  selectedTemplateId: string | null;
  onSelect: (id: string, name: string) => void;
  templateCounts: Record<string, number>;
  baseTemplates: BaseTemplateNode[];
  onContextMenu?: (e: React.MouseEvent, type: 'stack' | 'template', data: any) => void;
}

const TemplateStackItem: React.FC<TemplateStackItemProps> = ({
  stack,
  members,
  selectedTemplateId,
  onSelect,
  templateCounts,
  baseTemplates,
  onContextMenu,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const count = templateCounts[stack.name] || 0;
  const isSelected = selectedTemplateId === `stack-${stack.id}`;

  return (
    <div style={{ marginBottom: '4px' }}>
      <div
        onClick={() => onSelect(`stack-${stack.id}`, stack.name)}
        onContextMenu={(e) => {
          if (onContextMenu) {
            e.preventDefault();
            onContextMenu(e, 'stack', stack);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 10px',
          borderRadius: '4px',
          cursor: 'pointer',
          backgroundColor: isSelected ? 'var(--bg-element)' : 'var(--bg-surface)',
          borderLeft: isSelected ? '3px solid var(--accent-purple)' : '3px solid transparent',
          color: isSelected ? 'var(--text-main)' : 'var(--text-muted)',
          fontSize: '13px',
          transition: 'all 0.15s ease',
          userSelect: 'none',
          position: 'sticky',
          top: '42px',
          zIndex: 8,
          boxShadow: '0 1px 0 var(--bg-surface)'
        }}
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          style={{
            marginRight: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            height: '16px',
            color: 'var(--text-sub)',
          }}
        >
          {members.length > 0 ? (
            isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <div style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--text-sub)' }} />
          )}
        </span>
        <Layers size={14} style={{ marginRight: '8px', color: isSelected ? 'var(--accent-purple)' : 'var(--text-sub)' }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSelected ? 600 : 400 }}>
          {stack.name}
        </span>
        {count > 0 && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px', fontWeight: 400 }}>
            ({count})
          </span>
        )}
      </div>

      {isExpanded && members.length > 0 && (
        <div style={{ borderLeft: '1px solid var(--border-main)', marginLeft: '20px', paddingLeft: '4px', marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {members.map((member, idx) => {
            const memberCount = templateCounts[member.template_name] || 0;
            const isMemberSelected = selectedTemplateId === `tmpl-${member.template_name}`;
            return (
              <div
                key={`${stack.id}-${member.template_name}-${idx}`}
                onClick={() => onSelect(`tmpl-${member.template_name}`, member.template_name)}
                onContextMenu={(e) => {
                  if (onContextMenu) {
                    e.preventDefault();
                    e.stopPropagation();
                    const tmplObj = baseTemplates.find(t => t.name === member.template_name);
                    onContextMenu(e, 'template', tmplObj || { name: member.template_name, uuid: member.template_name });
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  backgroundColor: isMemberSelected ? 'var(--bg-element)' : 'transparent',
                  borderLeft: isMemberSelected ? '3px solid var(--accent-blue)' : '3px solid transparent',
                  color: isMemberSelected ? 'var(--text-main)' : 'var(--text-muted)',
                  fontSize: '12px',
                  transition: 'all 0.15s ease',
                  userSelect: 'none',
                }}
              >
                <FileText size={12} style={{ marginRight: '6px', color: 'var(--text-sub)' }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cleanTemplateName(member.template_name)}
                </span>
                {memberCount > 0 && (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px', fontWeight: 400 }}>
                    ({memberCount})
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// 3. Main Page Component
export const DeviceManagementPage: React.FC<DeviceManagementPageProps> = ({ 
  auth, 
  addToast, 
  activeSubTab = 'Hierarchy', 
  setActiveSubTab = () => {},
  standaloneAssign = false,
  standaloneGroupId = null
}) => {
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');

  // Loaded DB data
  const [inventory, setInventory] = useState<ManagedDevice[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<ManagedDevice[]>([]);
  const [selectedMemberTemplates, setSelectedMemberTemplates] = useState<any[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<DeviceGroupNode[]>([]);
  const [baseTemplates, setBaseTemplates] = useState<BaseTemplateNode[]>([]);
  const [templateStacks, setTemplateStacks] = useState<TemplateStack[]>([]);
  const [stackMembers, setStackMembers] = useState<TemplateStackMember[]>([]);

  // Device Group State
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(standaloneGroupId);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);

  // Tree Context Menu & Actions Dropdown
  const [treeContextMenu, setTreeContextMenu] = useState<{ x: number; y: number; group: DeviceGroupNode } | null>(null);
  const [isHierarchyDropdownOpen, setIsHierarchyDropdownOpen] = useState(false);
  const [isAssignFirewallsModalOpen, setIsAssignFirewallsModalOpen] = useState(false);
  const [isAssignModalPoppedOut, setIsAssignModalPoppedOut] = useState(false);
  const [assignModalWindow, setAssignModalWindow] = useState<Window | null>(null);
  const [selectedAssignDevices, setSelectedAssignDevices] = useState<ManagedDevice[]>([]);
  const hierarchyDropdownRef = React.useRef<HTMLDivElement>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(380);
  const isDragging = useRef(false);

  // Templates Panel layout states
  const [leftTemplatesPanelWidth, setLeftTemplatesPanelWidth] = useState(380);
  const [templatesSearchQuery, setTemplatesSearchQuery] = useState('');
  const [templateMemberSearchQuery, setTemplateMemberSearchQuery] = useState('');
  const [stackMemberSearchQuery, setStackMemberSearchQuery] = useState('');
  const [isTemplatesDropdownOpen, setIsTemplatesDropdownOpen] = useState(false);
  const [templateContextMenu, setTemplateContextMenu] = useState<{ x: number; y: number; type: 'stack' | 'template'; data: any } | null>(null);
  const [reorderContextMenu, setReorderContextMenu] = useState<{ x: number; y: number; index: number; templateName: string } | null>(null);
  const [reorderSubMenuType, setReorderSubMenuType] = useState<'before' | 'after' | null>(null);
  const [rightClickSubMenuType, setRightClickSubMenuType] = useState<'before' | 'after' | null>(null);
  const [submenuSearchQuery, setSubmenuSearchQuery] = useState('');
  const templatesDropdownRef = React.useRef<HTMLDivElement>(null);
  const isTemplatesDragging = useRef(false);
  const [templatesRightTab, setTemplatesRightTab] = useState<'firewalls' | 'templates'>('firewalls');
  const [isAddTemplateToStackModalOpen, setIsAddTemplateToStackModalOpen] = useState(false);
  const [selectedAddableTemplates, setSelectedAddableTemplates] = useState<BaseTemplateNode[]>([]);
  const [assignModalSearchQuery, setAssignModalSearchQuery] = useState('');
  const [addTemplateModalSearchQuery, setAddTemplateModalSearchQuery] = useState('');

  useEffect(() => {
    setTemplatesRightTab('firewalls');
    setSelectedMemberTemplates([]);
    setStackMemberSearchQuery('');
  }, [selectedTemplateId]);

  // Local storage cache for template stack descriptions
  const [stackDescriptions, setStackDescriptions] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem('canopy_stack_descriptions');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const closeContextMenus = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('.portal-dropdown-menu') || 
        target.closest('.datatable-context-menu') || 
        target.closest('.reorder-context-menu')
      ) {
        return;
      }

      setTreeContextMenu(null);
      setTemplateContextMenu(null);
      setReorderContextMenu(null);
      setReorderSubMenuType(null);
      setRightClickSubMenuType(null);
      setSubmenuSearchQuery('');
    };
    const handleClickOutsideDropdown = (e: MouseEvent) => {
      if (hierarchyDropdownRef.current && !hierarchyDropdownRef.current.contains(e.target as Node)) {
        setIsHierarchyDropdownOpen(false);
      }
      if (templatesDropdownRef.current && !templatesDropdownRef.current.contains(e.target as Node)) {
        setIsTemplatesDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', closeContextMenus);
    document.addEventListener('mousedown', handleClickOutsideDropdown);
    return () => {
      document.removeEventListener('mousedown', closeContextMenus);
      document.removeEventListener('mousedown', handleClickOutsideDropdown);
    };
  }, []);

  // Modals visibility state
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isStackModalOpen, setIsStackModalOpen] = useState(false);

  // Editing state targets
  const [editingDevice, setEditingDevice] = useState<ManagedDevice | null>(null);
  const [editingGroup, setEditingGroup] = useState<DeviceGroupNode | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<BaseTemplateNode | null>(null);
  const [editingStack, setEditingStack] = useState<TemplateStack | null>(null);

  // Device Form fields
  const [deviceName, setDeviceName] = useState('');
  const [deviceSerial, setDeviceSerial] = useState('');
  const [deviceIp, setDeviceIp] = useState('');
  const [deviceGroupId, setDeviceGroupId] = useState<number | null>(null);
  const [deviceParentConfigVal, setDeviceParentConfigVal] = useState<string>(''); // stack-<id> or tmpl-<id>

  // Group Form fields
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupParentId, setGroupParentId] = useState<number | null>(null);

  // Template Form fields
  const [templateName, setTemplateName] = useState('');

  // Template Stack Form fields
  const [stackName, setStackName] = useState('');
  const [stackDescription, setStackDescription] = useState('');
  const [stackTemplateIds, setStackTemplateIds] = useState<number[]>([]);

  const apiClient = useMemo(() => (auth ? new CanopyApiClient(auth) : null), [auth]);

  const fetchData = async (isInitial = false) => {
    if (!apiClient) return;
    if (isInitial) {
      setInitialLoading(true);
    }
    setLoading(true);
    try {
      const data = await apiClient.getDevicesInventory();

      setInventory(data.inventory || []);
      setDeviceGroups(data.device_groups || []);
      setBaseTemplates(data.templates || []);
      setTemplateStacks(data.template_stacks || []);
      setStackMembers(data.stack_members || []);
    } catch (err) {
      console.error('Failed to load Device Management data:', err);
      addToast(err instanceof Error ? err.message : 'Failed to query database.', 'error');
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  };

  const [syncTrigger, setSyncTrigger] = useState(0);

  // Sync Data Across Windows
  useEffect(() => {
    if (window.electron && window.electron.onMutationDetected) {
      window.electron.onMutationDetected(() => {
        setSyncTrigger(prev => prev + 1);
      });
    }
  }, []);

  useEffect(() => {
    if (syncTrigger > 0) {
      fetchData(false);
    }
  }, [syncTrigger]);

  useEffect(() => {
    fetchData(true);
  }, [apiClient]);

  // Reset selections when sub-tab changes
  useEffect(() => {
    if (!standaloneAssign) {
      setSelectedGroupId(null);
      setSelectedTemplateId(null);
      setSelectedTemplateName(null);
    }
    setSearchQuery('');
    setMemberSearchQuery('');
  }, [activeSubTab, standaloneAssign]);

  // Direct device counts per device group
  const deviceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    deviceGroups.forEach(g => {
      const cleanG = cleanGroupName(g.name).trim().toLowerCase();
      counts[g.uuid] = inventory.filter(dev => (dev.device_group || '').trim().toLowerCase() === cleanG).length;
    });
    return counts;
  }, [deviceGroups, inventory]);

  // Direct device counts per template/stack
  const templateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    inventory.forEach(dev => {
      if (dev.template_stack) {
        counts[dev.template_stack] = (counts[dev.template_stack] || 0) + 1;
      }
    });
    return counts;
  }, [inventory]);

  // Filtered lists for rendering right pane details
  const selectedGroupDetails = useMemo(() => {
    if (!selectedGroupId) return null;
    return deviceGroups.find(g => g.uuid === selectedGroupId) || null;
  }, [selectedGroupId, deviceGroups]);

  const devicesInSelectedGroup = useMemo(() => {
    if (!selectedGroupDetails) return [];
    const cleanG = cleanGroupName(selectedGroupDetails.name).trim().toLowerCase();
    let devs = inventory.filter(dev => (dev.device_group || '').trim().toLowerCase() === cleanG);
    if (memberSearchQuery.trim()) {
      const q = memberSearchQuery.toLowerCase();
      devs = devs.filter(d => (d.name || '').toLowerCase().includes(q) || (d.serial || '').toLowerCase().includes(q) || (d.ip_address || '').toLowerCase().includes(q));
    }
    return devs;
  }, [selectedGroupDetails, inventory, memberSearchQuery]);

  const devicesInSelectedTemplate = useMemo(() => {
    if (!selectedTemplateName) return [];
    const cleanT = cleanTemplateName(selectedTemplateName).trim().toLowerCase();
    let devs = inventory.filter(dev => (dev.template_stack || '').trim().toLowerCase() === cleanT);
    if (templateMemberSearchQuery.trim()) {
      const q = templateMemberSearchQuery.toLowerCase();
      devs = devs.filter(d => d.name.toLowerCase().includes(q) || d.serial.toLowerCase().includes(q) || (d.ip_address || '').toLowerCase().includes(q));
    }
    return devs;
  }, [selectedTemplateName, inventory, templateMemberSearchQuery]);

  const filteredTemplateStacks = useMemo(() => {
    if (templatesSearchQuery.trim() && activeSubTab === 'Templates') {
      const query = templatesSearchQuery.toLowerCase();
      return templateStacks.filter(s => s.name.toLowerCase().includes(query));
    }
    return templateStacks;
  }, [templateStacks, templatesSearchQuery, activeSubTab]);

  const filteredBaseTemplates = useMemo(() => {
    if (templatesSearchQuery.trim() && activeSubTab === 'Templates') {
      const query = templatesSearchQuery.toLowerCase();
      return baseTemplates.filter(t => t.name.toLowerCase().includes(query));
    }
    return baseTemplates;
  }, [baseTemplates, templatesSearchQuery, activeSubTab]);

  const selectedTemplateDescription = useMemo(() => {
    if (!selectedTemplateId) return null;
    if (selectedTemplateId.startsWith('stack-')) {
      const id = parseInt(selectedTemplateId.replace('stack-', ''), 10);
      const stack = templateStacks.find(s => s.id === id);
      return stack ? (stackDescriptions[stack.name] || null) : null;
    }
    return null;
  }, [selectedTemplateId, templateStacks, stackDescriptions]);

  const activeStack = useMemo(() => {
    if (!selectedTemplateId || !selectedTemplateId.startsWith('stack-')) return null;
    const id = parseInt(selectedTemplateId.replace('stack-', ''), 10);
    return templateStacks.find(s => s.id === id) || null;
  }, [selectedTemplateId, templateStacks]);

  const activeStackMembers = useMemo(() => {
    if (!activeStack) return [];
    return stackMembers.filter(m => m.stack_id === activeStack.id);
  }, [activeStack, stackMembers]);

  const availableTemplatesToAdd = useMemo(() => {
    if (!activeStack) return [];
    return baseTemplates.filter(bt => !activeStackMembers.some(m => m.template_name === bt.name));
  }, [activeStack, baseTemplates, activeStackMembers]);

  const assignTargetLabel = useMemo(() => {
    if (activeSubTab === 'Device Groups') {
      return selectedGroupDetails ? cleanGroupName(selectedGroupDetails.name) : '';
    } else if (activeSubTab === 'Templates') {
      return selectedTemplateName ? cleanTemplateName(selectedTemplateName) : '';
    }
    return '';
  }, [activeSubTab, selectedGroupDetails, selectedTemplateName]);

  const assignAvailableDevices = useMemo(() => {
    if (activeSubTab === 'Device Groups') {
      return inventory.filter(d => d.device_group_id !== (selectedGroupDetails?.id || -1));
    } else if (activeSubTab === 'Templates') {
      if (!selectedTemplateId) return [];
      if (selectedTemplateId.startsWith('stack-')) {
        const stackId = parseInt(selectedTemplateId.replace('stack-', ''), 10);
        return inventory.filter(d => d.template_stack_id !== stackId);
      } else if (selectedTemplateId.startsWith('tmpl-')) {
        const tmplName = selectedTemplateId.replace('tmpl-', '');
        const tmpl = baseTemplates.find(t => t.name === tmplName);
        const tmplId = tmpl ? tmpl.id : -1;
        return inventory.filter(d => d.template_id !== tmplId);
      }
    }
    return inventory;
  }, [inventory, activeSubTab, selectedGroupDetails, selectedTemplateId, baseTemplates]);

  const filteredDeviceGroups = useMemo(() => {
    let filtered = deviceGroups;
    if (searchQuery.trim() && activeSubTab === 'Device Groups') {
      const q = searchQuery.toLowerCase();
      const matches = new Set<string>();

      const checkMatch = (group: DeviceGroupNode): boolean => {
        if (matches.has(group.uuid)) return true;
        const selfMatch = group.name.toLowerCase().includes(q) || (group.description || '').toLowerCase().includes(q);

        const children = deviceGroups.filter(g => g.parent_uuid === group.uuid);
        let childMatch = false;
        for (const child of children) {
          if (checkMatch(child)) childMatch = true;
        }

        if (selfMatch || childMatch) {
          matches.add(group.uuid);
          return true;
        }
        return false;
      };

      filtered = deviceGroups.filter(g => checkMatch(g));
    }
    return filtered;
  }, [deviceGroups, searchQuery, activeSubTab]);

  const rootGroups = useMemo(() => {
    return filteredDeviceGroups.filter(g =>
      !g.parent_uuid || !filteredDeviceGroups.some(p => p.uuid === g.parent_uuid)
    );
  }, [filteredDeviceGroups]);

  // Device Form Trigger
  const handleOpenAddDeviceModal = (defaultGroupId?: number | null) => {
    setEditingDevice(null);
    setDeviceName('');
    setDeviceSerial('');
    setDeviceIp('');
    setDeviceGroupId(defaultGroupId || null);
    setDeviceParentConfigVal('');
    setIsDeviceModalOpen(true);
  };

  const handleOpenEditDeviceModal = (dev: ManagedDevice) => {
    setEditingDevice(dev);
    setDeviceName(dev.name);
    setDeviceSerial(dev.serial);
    setDeviceIp(dev.ip_address || '');
    setDeviceGroupId(dev.device_group_id || null);

    let pVal = '';
    if (dev.template_stack_id) {
      pVal = `stack-${dev.template_stack_id}`;
    } else if (dev.template_id) {
      pVal = `tmpl-${dev.template_id}`;
    }
    setDeviceParentConfigVal(pVal);
    setIsDeviceModalOpen(true);
  };

  const handleSaveDevice = async () => {
    if (!deviceName.trim() || !deviceSerial.trim()) {
      addToast('Name and Serial Number are required.', 'error');
      return;
    }
    if (!apiClient) return;

    let stackId: number | null = null;
    let tmplId: number | null = null;
    if (deviceParentConfigVal.startsWith('stack-')) {
      stackId = parseInt(deviceParentConfigVal.slice(6), 10);
    } else if (deviceParentConfigVal.startsWith('tmpl-')) {
      tmplId = parseInt(deviceParentConfigVal.slice(5), 10);
    }

    try {
      if (editingDevice) {
        await apiClient.updateDevice(editingDevice.id, deviceName, deviceSerial, deviceIp, deviceGroupId, stackId, tmplId);
        addToast(`Updated managed device: ${deviceName} (S/N: ${deviceSerial})`, 'success');
      } else {
        await apiClient.createDevice(deviceName, deviceSerial, deviceIp, deviceGroupId, stackId, tmplId);
        addToast(`Registered managed device: ${deviceName} (S/N: ${deviceSerial})`, 'success');
      }
      setIsDeviceModalOpen(false);
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    }
  };

  const handleDeleteDevice = (dev: ManagedDevice) => {
    confirm({
      title: 'Remove Managed Firewall',
      message: `Are you sure you want to permanently delete managed firewall ${dev.name}? This will clear all network interfaces and static route entries defined under its scope.`,
      confirmText: 'Delete Device',
      isDestructive: true,
      onConfirm: async () => {
        if (!apiClient) return;
        try {
          await apiClient.deleteDevice(dev.id);
          addToast(`Removed managed device: ${dev.name}`, 'success');
          fetchData();
        } catch (err) {
          addToast(err instanceof Error ? err.message : 'Deletion failed', 'error');
        }
      }
    });
  };

  const handleBulkDeleteDevices = (devices: ManagedDevice[]) => {
    confirm({
      title: `Remove ${devices.length} Managed Firewalls`,
      message: `Are you sure you want to permanently delete ${devices.length} managed firewalls? This will clear all associated network interfaces and static route entries.`,
      confirmText: 'Delete Devices',
      isDestructive: true,
      onConfirm: async () => {
        if (!apiClient) return;
        try {
          for (const dev of devices) {
            await apiClient.deleteDevice(dev.id);
          }
          addToast(`Successfully removed ${devices.length} managed devices.`, 'success');
          setSelectedDevices([]);
          fetchData();
        } catch (err) {
          addToast(err instanceof Error ? err.message : 'Bulk deletion failed', 'error');
        }
      }
    });
  };

  const handleBulkRemoveFromGroup = (devices: ManagedDevice[]) => {
    confirm({
      title: `Remove ${devices.length} Firewalls from Group`,
      message: `Are you sure you want to unassign ${devices.length} firewalls from this device group? They will remain in your inventory.`,
      confirmText: 'Remove from Group',
      isDestructive: true,
      onConfirm: async () => {
        if (!apiClient) return;
        try {
          for (const dev of devices) {
            await apiClient.updateDevice(dev.id, dev.name, dev.serial, dev.ip_address || '', null, dev.template_stack_id || null, dev.template_id || null);
          }
          addToast(`Successfully removed ${devices.length} firewalls from group.`, 'success');
          setSelectedDevices([]);
          fetchData();
        } catch (err) {
          addToast(err instanceof Error ? err.message : 'Bulk removal failed', 'error');
        }
      }
    });
  };

  const handleBulkRemoveFromTemplateContext = (devices: ManagedDevice[]) => {
    confirm({
      title: `Remove ${devices.length} Firewalls from Template Context`,
      message: `Are you sure you want to unassign ${devices.length} firewalls from this template / stack context? They will remain in your inventory.`,
      confirmText: 'Remove from Context',
      isDestructive: true,
      onConfirm: async () => {
        if (!apiClient) return;
        try {
          for (const dev of devices) {
            await apiClient.updateDevice(dev.id, dev.name, dev.serial, dev.ip_address || '', dev.device_group_id || null, null, null);
          }
          addToast(`Successfully removed ${devices.length} firewalls from template context.`, 'success');
          setSelectedDevices([]);
          fetchData();
        } catch (err) {
          addToast(err instanceof Error ? err.message : 'Bulk removal failed', 'error');
        }
      }
    });
  };

  const handleAddMemberTemplate = async (stack: TemplateStack, templateId: number) => {
    if (!apiClient) return;
    const members = stackMembers.filter(m => m.stack_id === stack.id);
    const currentIds = members.map(m => {
      const bt = baseTemplates.find(t => t.name === m.template_name);
      return bt ? bt.id : null;
    }).filter(id => id !== null) as number[];

    const newIds = [...currentIds, templateId];
    try {
      await apiClient.updateTemplateStack(stack.id, stack.name, newIds);
      addToast(`Added template to stack: ${stack.name}`, 'success');
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to add template to stack', 'error');
    }
  };

  const handleRemoveMemberTemplate = async (stack: TemplateStack, templateName: string) => {
    if (!apiClient) return;
    const members = stackMembers.filter(m => m.stack_id === stack.id);
    const currentIds = members.map(m => {
      const bt = baseTemplates.find(t => t.name === m.template_name);
      return bt ? bt.id : null;
    }).filter(id => id !== null) as number[];

    const targetBt = baseTemplates.find(t => t.name === templateName);
    if (!targetBt) return;

    const newIds = currentIds.filter(id => id !== targetBt.id);
    try {
      await apiClient.updateTemplateStack(stack.id, stack.name, newIds);
      addToast(`Removed template from stack: ${stack.name}`, 'success');
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to remove template from stack', 'error');
    }
  };

  const handleMoveMemberTemplate = async (stack: TemplateStack, index: number, direction: 'up' | 'down') => {
    if (!apiClient) return;
    const members = stackMembers.filter(m => m.stack_id === stack.id);
    const currentIds = members.map(m => {
      const bt = baseTemplates.find(t => t.name === m.template_name);
      return bt ? bt.id : null;
    }).filter(id => id !== null) as number[];

    const newIds = [...currentIds];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newIds.length) return;

    // Swap elements
    const temp = newIds[index];
    newIds[index] = newIds[targetIndex];
    newIds[targetIndex] = temp;

    try {
      await apiClient.updateTemplateStack(stack.id, stack.name, newIds);
      addToast('Reordered stack templates successfully', 'success');
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to reorder stack', 'error');
    }
  };

  const handleMoveMemberTemplateToPosition = async (
    stack: TemplateStack, 
    currentIndex: number, 
    position: 'top' | 'bottom' | 'before' | 'after', 
    targetIndex?: number
  ) => {
    if (!apiClient) return;
    const members = stackMembers.filter(m => m.stack_id === stack.id);
    const currentIds = members.map(m => {
      const bt = baseTemplates.find(t => t.name === m.template_name);
      return bt ? bt.id : null;
    }).filter(id => id !== null) as number[];

    const newIds = [...currentIds];
    const element = newIds[currentIndex];
    
    // Remove element from current position
    newIds.splice(currentIndex, 1);

    if (position === 'top') {
      newIds.unshift(element);
    } else if (position === 'bottom') {
      newIds.push(element);
    } else if (position === 'before' && targetIndex !== undefined) {
      const originalTargetId = currentIds[targetIndex];
      const newTargetIndex = newIds.indexOf(originalTargetId);
      newIds.splice(newTargetIndex, 0, element);
    } else if (position === 'after' && targetIndex !== undefined) {
      const originalTargetId = currentIds[targetIndex];
      const newTargetIndex = newIds.indexOf(originalTargetId);
      newIds.splice(newTargetIndex + 1, 0, element);
    }

    try {
      await apiClient.updateTemplateStack(stack.id, stack.name, newIds);
      addToast('Reordered stack templates successfully', 'success');
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to reorder stack', 'error');
    }
  };

  const handleBulkRemoveMembersFromStack = async () => {
    if (!activeStack || !apiClient || selectedMemberTemplates.length === 0) return;
    const currentMembers = stackMembers.filter(m => m.stack_id === activeStack.id);
    const currentIds = currentMembers.map(m => {
      const bt = baseTemplates.find(t => t.name === m.template_name);
      return bt ? bt.id : null;
    }).filter(id => id !== null) as number[];

    const removeNames = selectedMemberTemplates.map(row => row.template_name);
    const removeBts = baseTemplates.filter(bt => removeNames.includes(bt.name));
    const removeIds = removeBts.map(bt => bt.id);

    const newIds = currentIds.filter(id => !removeIds.includes(id));

    try {
      await apiClient.updateTemplateStack(activeStack.id, activeStack.name, newIds);
      addToast(`Successfully removed ${selectedMemberTemplates.length} templates from stack: ${activeStack.name}`, 'success');
      setSelectedMemberTemplates([]);
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Bulk removal failed', 'error');
    }
  };

  const handleAssignFirewalls = async () => {
    if (!apiClient) return false;
    try {
      if (activeSubTab === 'Device Groups') {
        if (!selectedGroupId) return false;
        const match = deviceGroups.find(g => g.uuid === selectedGroupId);
        if (!match) throw new Error("Group not found");
        for (const dev of selectedAssignDevices) {
          await apiClient.updateDevice(dev.id, dev.name, dev.serial, dev.ip_address || '', match.id, dev.template_stack_id || null, dev.template_id || null);
        }
        addToast(`Successfully assigned ${selectedAssignDevices.length} firewalls to group.`, 'success');
      } else if (activeSubTab === 'Templates') {
        if (!selectedTemplateId) return false;
        if (selectedTemplateId.startsWith('stack-')) {
          const stackId = parseInt(selectedTemplateId.replace('stack-', ''), 10);
          for (const dev of selectedAssignDevices) {
            await apiClient.updateDevice(dev.id, dev.name, dev.serial, dev.ip_address || '', dev.device_group_id || null, stackId, null);
          }
        } else if (selectedTemplateId.startsWith('tmpl-')) {
          const tmplName = selectedTemplateId.replace('tmpl-', '');
          const tmpl = baseTemplates.find(t => t.name === tmplName);
          if (!tmpl) throw new Error("Template not found");
          for (const dev of selectedAssignDevices) {
            await apiClient.updateDevice(dev.id, dev.name, dev.serial, dev.ip_address || '', dev.device_group_id || null, null, tmpl.id);
          }
        }
        addToast(`Successfully assigned ${selectedAssignDevices.length} firewalls to template context.`, 'success');
      }
      setIsAssignFirewallsModalOpen(false);
      setSelectedAssignDevices([]);
      fetchData();
      return true;
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Assignment failed', 'error');
      return false;
    }
  };

  // Group Form Trigger
  const handleOpenAddGroupModal = (defaultParentId?: number | null) => {
    setEditingGroup(null);
    setGroupName('');
    setGroupDescription('');
    setGroupParentId(defaultParentId || null);
    setIsGroupModalOpen(true);
  };

  const handleOpenEditGroupModal = (group: DeviceGroupNode) => {
    setEditingGroup(group);
    setGroupName(cleanGroupName(group.name));
    setGroupDescription(group.description || '');
    const parentGroup = deviceGroups.find(g => g.uuid === group.parent_uuid);
    setGroupParentId(parentGroup ? parentGroup.id : null);
    setIsGroupModalOpen(true);
  };

  const handleSaveGroup = async () => {
    if (!groupName.trim()) {
      addToast('Group name is required.', 'error');
      return;
    }
    if (!apiClient) return;
    try {
      if (editingGroup) {
        await apiClient.updateDeviceGroup(editingGroup.id, groupName, groupParentId, groupDescription);
        addToast(`Renamed or updated device group parent context: ${groupName}`, 'success');
      } else {
        await apiClient.createDeviceGroup(groupName, groupParentId, groupDescription);
        addToast(`Added new device group: ${groupName}`, 'success');
      }
      setIsGroupModalOpen(false);
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    }
  };

  const handleDeleteGroup = (group: DeviceGroupNode) => {
    confirm({
      title: 'Delete Device Group',
      message: `Are you sure you want to permanently delete device group "${cleanGroupName(group.name)}"? All security rules, address/service objects, and other configurations defined under its scope will be deleted.`,
      confirmText: 'Delete Group',
      isDestructive: true,
      onConfirm: async () => {
        if (!apiClient) return;
        try {
          await apiClient.deleteDeviceGroup(group.id);
          addToast(`Removed device group: ${cleanGroupName(group.name)}`, 'success');
          setSelectedGroupId(null);
          fetchData();
        } catch (err) {
          addToast(err instanceof Error ? err.message : 'Deletion failed', 'error');
        }
      }
    });
  };

  // Template Form Trigger
  const handleOpenAddTemplateModal = () => {
    setEditingTemplate(null);
    setTemplateName('');
    setIsTemplateModalOpen(true);
  };

  const handleOpenEditTemplateModal = (tmpl: BaseTemplateNode) => {
    setEditingTemplate(tmpl);
    setTemplateName(cleanTemplateName(tmpl.name));
    setIsTemplateModalOpen(true);
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      addToast('Template name is required.', 'error');
      return;
    }
    if (!apiClient) return;
    try {
      if (editingTemplate) {
        await apiClient.updateTemplate(editingTemplate.id, templateName);
        addToast(`Renamed template: ${templateName}`, 'success');
      } else {
        await apiClient.createTemplate(templateName);
        addToast(`Added base template: ${templateName}`, 'success');
      }
      setIsTemplateModalOpen(false);
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    }
  };

  const handleDeleteTemplate = (tmpl: BaseTemplateNode) => {
    confirm({
      title: 'Delete Template',
      message: `Are you sure you want to delete template "${cleanTemplateName(tmpl.name)}"? This will delete all network interface mappings and zone bindings associated with this template.`,
      confirmText: 'Delete Template',
      isDestructive: true,
      onConfirm: async () => {
        if (!apiClient) return;
        try {
          await apiClient.deleteTemplate(tmpl.id);
          addToast(`Removed template: ${cleanTemplateName(tmpl.name)}`, 'success');
          setSelectedTemplateId(null);
          setSelectedTemplateName(null);
          fetchData();
        } catch (err) {
          addToast(err instanceof Error ? err.message : 'Deletion failed', 'error');
        }
      }
    });
  };

  // Stack Form Trigger
  const handleOpenAddStackModal = () => {
    setEditingStack(null);
    setStackName('');
    setStackDescription('');
    setStackTemplateIds([]);
    setIsStackModalOpen(true);
  };

  const handleOpenEditStackModal = (stack: TemplateStack) => {
    setEditingStack(stack);
    setStackName(stack.name);
    setStackDescription(stackDescriptions[stack.name] || '');
    const members = stackMembers.filter(m => m.stack_id === stack.id);
    const tmplIds = members.map(m => {
      const t = baseTemplates.find(bt => bt.name === m.template_name);
      return t ? t.id : null;
    }).filter(id => id !== null) as number[];
    setStackTemplateIds(tmplIds);
    setIsStackModalOpen(true);
  };

  const handleSaveStack = async () => {
    if (!stackName.trim()) {
      addToast('Stack name is required.', 'error');
      return;
    }
    if (!apiClient) return;
    try {
      if (editingStack) {
        await apiClient.updateTemplateStack(editingStack.id, stackName, stackTemplateIds);
        addToast(`Updated template stack context: ${stackName}`, 'success');
      } else {
        await apiClient.createTemplateStack(stackName, stackTemplateIds);
        addToast(`Created template stack: ${stackName}`, 'success');
      }

      // Persist the description field in local storage
      const updatedDescriptions = { ...stackDescriptions, [stackName]: stackDescription };
      setStackDescriptions(updatedDescriptions);
      localStorage.setItem('canopy_stack_descriptions', JSON.stringify(updatedDescriptions));

      setIsStackModalOpen(false);
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    }
  };

  const handleDeleteStack = (stack: TemplateStack) => {
    confirm({
      title: 'Delete Template Stack',
      message: `Are you sure you want to delete template stack "${stack.name}"? This will dissolve the stack structure but will not delete its template members.`,
      confirmText: 'Delete Stack',
      isDestructive: true,
      onConfirm: async () => {
        if (!apiClient) return;
        try {
          await apiClient.deleteTemplateStack(stack.id);
          addToast(`Removed template stack: ${stack.name}`, 'success');
          setSelectedTemplateId(null);
          setSelectedTemplateName(null);
          fetchData();
        } catch (err) {
          addToast(err instanceof Error ? err.message : 'Deletion failed', 'error');
        }
      }
    });
  };

  // Columns definition for full Inventory table
  const inventoryColumns: ColumnDef[] = useMemo(() => [
    {
      key: 'name',
      label: 'Device Name',
      renderCell: (val, row) => (
        <span
          style={{ color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: 500 }}
          onClick={(e) => { e.stopPropagation(); handleOpenEditDeviceModal(row); }}
          title="Click to edit device"
        >
          {val}
        </span>
      )
    },
    { key: 'serial', label: 'Serial Number' },
    { key: 'ip_address', label: 'Management IP' },
    {
      key: 'device_group',
      label: 'Device Group',
      renderCell: (val) => val ? cleanGroupName(val) : <span style={{ color: 'var(--text-sub)', fontStyle: 'italic' }}>Unassigned</span>
    },
    {
      key: 'template_stack',
      label: 'Template Stack / Template',
      renderCell: (val) => val ? cleanTemplateName(val) : <span style={{ color: 'var(--text-sub)', fontStyle: 'italic' }}>None</span>
    },
    {
      key: 'actions',
      label: 'Actions',
      width: '160px',
      renderCell: (_, row) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className="btn-table-action"
            onClick={(e) => { e.stopPropagation(); handleOpenEditDeviceModal(row); }}
            title="Edit Device"
          >
            <Edit2 size={14} />
          </button>
          <button
            className="btn-table-action-danger"
            onClick={(e) => { e.stopPropagation(); handleDeleteDevice(row); }}
            title="Delete Device"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )
    }
  ], []);

  // Columns definition for Device Group table (right pane)
  const groupMemberColumns: ColumnDef[] = useMemo(() => [
    {
      key: 'name',
      label: 'Device Name',
      renderCell: (val, row) => (
        <span
          style={{ color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: 500 }}
          onClick={(e) => { e.stopPropagation(); handleOpenEditDeviceModal(row); }}
          title="Click to edit device"
        >
          {val}
        </span>
      )
    },
    { key: 'serial', label: 'Serial Number' },
    { key: 'ip_address', label: 'Management IP' },
    {
      key: 'template_stack',
      label: 'Template Stack / Template',
      renderCell: (val) => val ? cleanTemplateName(val) : <span style={{ color: 'var(--text-sub)', fontStyle: 'italic' }}>None</span>
    }
  ], []);

  // Columns definition for Template/Stack table (right pane)
  const templateMemberColumns: ColumnDef[] = useMemo(() => [
    {
      key: 'name',
      label: 'Device Name',
      renderCell: (val, row) => (
        <span
          style={{ color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: 500 }}
          onClick={(e) => { e.stopPropagation(); handleOpenEditDeviceModal(row); }}
          title="Click to edit device"
        >
          {val}
        </span>
      )
    },
    { key: 'serial', label: 'Serial Number' },
    { key: 'ip_address', label: 'Management IP' },
    {
      key: 'device_group',
      label: 'Device Group',
      renderCell: (val) => val ? cleanGroupName(val) : <span style={{ color: 'var(--text-sub)', fontStyle: 'italic' }}>Unassigned</span>
    }
  ], []);

  const stackMemberColumns: ColumnDef[] = useMemo(() => [
    {
      key: 'template_name',
      label: 'Template Name',
      renderCell: (val) => cleanTemplateName(String(val))
    },
    {
      key: 'actions',
      label: 'Actions',
      width: '165px',
      renderCell: (_val, row) => {
        const idx = activeStackMembers.findIndex(m => m.template_name === row.template_name);
        return (
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
            <button
              className="btn-table-action"
              onClick={() => { if (activeStack) handleMoveMemberTemplate(activeStack, idx, 'up'); }}
              disabled={idx === 0}
              style={{
                opacity: idx === 0 ? 0.3 : 1,
                cursor: idx === 0 ? 'not-allowed' : 'pointer'
              }}
              title="Move Up"
            >
              <ArrowUp size={14} />
            </button>
            <button
              className="btn-table-action"
              onClick={() => { if (activeStack) handleMoveMemberTemplate(activeStack, idx, 'down'); }}
              disabled={idx === activeStackMembers.length - 1}
              style={{
                opacity: idx === activeStackMembers.length - 1 ? 0.3 : 1,
                cursor: idx === activeStackMembers.length - 1 ? 'not-allowed' : 'pointer'
              }}
              title="Move Down"
            >
              <ArrowDown size={14} />
            </button>
            <button
              className="btn-table-action"
              onClick={(e) => {
                e.stopPropagation();
                setReorderContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  index: idx,
                  templateName: row.template_name
                });
                setReorderSubMenuType(null);
              }}
              title="Move Template to..."
            >
              <ArrowUpDown size={14} />
            </button>
            <button
              className="btn-table-action-danger"
              onClick={() => { if (activeStack) handleRemoveMemberTemplate(activeStack, row.template_name); }}
              title="Remove Template from Stack"
            >
              <X size={14} />
            </button>
          </div>
        );
      }
    }
  ], [activeStack, activeStackMembers]);

  const addableTemplateColumns: ColumnDef[] = useMemo(() => [
    {
      key: 'name',
      label: 'Template Name',
      renderCell: (val) => cleanTemplateName(String(val))
    }
  ], []);

  const handleSelectTemplate = (id: string, name: string) => {
    setSelectedTemplateId(id);
    setSelectedTemplateName(name);
  };

  // --- Mappings for Dropdown elements ---
  // 1. Device Group Assignment Dropdown
  const groupOptions = ['Unassigned', ...deviceGroups.map(g => cleanGroupName(g.name))];
  const activeGroupLabel = deviceGroupId
    ? cleanGroupName(deviceGroups.find(g => g.id === deviceGroupId)?.name || '')
    : 'Unassigned';

  // 2. Parent Config Assignment Dropdown (Templates & Stacks)
  const parentOptions = [
    'None',
    ...templateStacks.map(s => `Stack: ${s.name}`),
    ...baseTemplates.map(t => `Template: ${cleanTemplateName(t.name)}`)
  ];
  let activeParentLabel = 'None';
  if (deviceParentConfigVal.startsWith('stack-')) {
    const stackId = parseInt(deviceParentConfigVal.replace('stack-', ''), 10);
    const stack = templateStacks.find(s => s.id === stackId);
    if (stack) activeParentLabel = `Stack: ${stack.name}`;
  } else if (deviceParentConfigVal.startsWith('tmpl-')) {
    const tmplId = parseInt(deviceParentConfigVal.replace('tmpl-', ''), 10);
    const tmpl = baseTemplates.find(t => t.id === tmplId);
    if (tmpl) activeParentLabel = `Template: ${cleanTemplateName(tmpl.name)}`;
  }

  // 3. Parent Device Group Dropdown
  const parentGroupList = deviceGroups.filter(g => g.uuid !== 'paloalto-dg-shared' && (!editingGroup || g.id !== editingGroup.id));
  const parentGroupOptions = ['Shared', ...parentGroupList.map(g => cleanGroupName(g.name))];
  const activeParentGroupLabel = groupParentId
    ? cleanGroupName(deviceGroups.find(g => g.id === groupParentId)?.name || '')
    : 'Shared';

  // 4. Member Templates Dropdown for Stack Modal
  const availableTemplates = baseTemplates.filter(t => !stackTemplateIds.includes(t.id));
  const memberOptions = ['-- Select template to append --', ...availableTemplates.map(t => cleanTemplateName(t.name))];

  if (initialLoading) {
    return (
      <div className="fade-in-delayed" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px', color: 'var(--text-muted)', fontSize: '13px', gap: '15px' }}>
        <Loader2 size={28} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />
        Querying appliance catalog...
      </div>
    );
  }

  const renderDeviceModal = () => (
    <Modal
      isOpen={isDeviceModalOpen}
      onClose={() => setIsDeviceModalOpen(false)}
      title={editingDevice ? 'Edit Firewall Configuration' : 'Register Managed Firewall'}
      zIndex={10010}
      footer={
        <>
          <button className="btn-secondary btn-sm" onClick={() => setIsDeviceModalOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={handleSaveDevice}>
            {editingDevice ? 'Save Changes' : 'Register Firewall'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Firewall Name</label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. Corp-FW-01"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              style={{ width: '100%', paddingRight: '30px' }}
            />
            <button
              onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(deviceName); addToast('Copied Device Name'); }}
              style={{ position: 'absolute', right: '8px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex' }}
              title="Copy to clipboard"
            >
              <Copy size={13} />
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Serial Number (Unique)</label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. 0123456789ABC"
              value={deviceSerial}
              onChange={(e) => setDeviceSerial(e.target.value)}
              style={{ width: '100%', paddingRight: '30px' }}
            />
            <button
              onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(deviceSerial); addToast('Copied Serial Number'); }}
              style={{ position: 'absolute', right: '8px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex' }}
              title="Copy to clipboard"
            >
              <Copy size={13} />
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Management IP Address</label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. 192.168.1.1"
              value={deviceIp}
              onChange={(e) => setDeviceIp(e.target.value)}
              style={{ width: '100%', paddingRight: '30px' }}
            />
            <button
              onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(deviceIp); addToast('Copied Management IP'); }}
              style={{ position: 'absolute', right: '8px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex' }}
              title="Copy to clipboard"
            >
              <Copy size={13} />
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Device Group Assignment</label>
            <button
              onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(activeGroupLabel); addToast('Copied Device Group'); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
              title="Copy current group to clipboard"
            >
              <Copy size={11} /> Copy
            </button>
          </div>
          <Dropdown
            value={activeGroupLabel}
            options={groupOptions}
            onChange={(val) => {
              if (val === 'Unassigned') {
                setDeviceGroupId(null);
              } else {
                const match = deviceGroups.find(g => cleanGroupName(g.name) === val);
                if (match) setDeviceGroupId(match.id);
              }
            }}
            width="100%"
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Template / Stack Context</label>
            <button
              onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(activeParentLabel); addToast('Copied Template Context'); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
              title="Copy current template context to clipboard"
            >
              <Copy size={11} /> Copy
            </button>
          </div>
          <Dropdown
            value={activeParentLabel}
            options={parentOptions}
            onChange={(val) => {
              if (val === 'None') {
                setDeviceParentConfigVal('');
              } else if (val.startsWith('Stack: ')) {
                const stackName = val.replace('Stack: ', '');
                const stack = templateStacks.find(s => s.name === stackName);
                if (stack) setDeviceParentConfigVal(`stack-${stack.id}`);
              } else if (val.startsWith('Template: ')) {
                const tmplName = val.replace('Template: ', '');
                const tmpl = baseTemplates.find(t => cleanTemplateName(t.name) === tmplName);
                if (tmpl) setDeviceParentConfigVal(`tmpl-${tmpl.id}`);
              }
            }}
            width="100%"
          />
        </div>
      </div>
    </Modal>
  );

  // If we are in standalone mode, render ONLY the Assign Firewalls modal content natively
  if (standaloneAssign) {
    if (initialLoading) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-app)', color: 'var(--text-muted)', gap: '15px' }}>
          <Loader2 size={32} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />
          <div style={{ fontSize: '14px', fontWeight: 500 }}>Loading inventory...</div>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--bg-app)', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', color: 'var(--text-main)' }}>
            Assign Firewalls to {selectedGroupDetails ? cleanGroupName(selectedGroupDetails.name) : ''}
          </h2>
          <div style={{ width: '220px', marginLeft: '10px' }}>
            <SearchBar value={assignModalSearchQuery} onChange={setAssignModalSearchQuery} placeholder="Search available..." variant="local" width="100%" />
          </div>
        </div>
        <p style={{ margin: '0 0 15px 0', fontSize: '13px', color: 'var(--text-sub)' }}>
          Select firewalls from your inventory to assign to <strong style={{ color: 'var(--text-main)' }}>{selectedGroupDetails ? cleanGroupName(selectedGroupDetails.name) : ''}</strong>.
          Firewalls already assigned to this group are hidden.
        </p>
        <div style={{ flex: 1, border: '1px solid var(--border-main)', borderRadius: '6px', overflow: 'hidden', display: 'flex', flexDirection: 'column', marginBottom: '20px' }}>
          <DataTable
            columns={inventoryColumns}
            data={inventory.filter(d => d.device_group_id !== (selectedGroupDetails?.id || -1))}
            searchQuery={assignModalSearchQuery}
            pagination={true}
            selectable={true}
            onSelectionChange={setSelectedAssignDevices}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button className="btn-secondary btn-sm" onClick={() => window.close()}>Cancel</button>
          <button
            className="btn-primary btn-sm"
            onClick={async () => {
              const success = await handleAssignFirewalls();
              if (success) {
                if (window.electron && window.electron.broadcastMutation) {
                  window.electron.broadcastMutation('device_group');
                }
                setTimeout(() => {
                  window.close();
                }, 100);
              }
            }}
            disabled={selectedAssignDevices.length === 0}
          >
            Assign Selected ({selectedAssignDevices.length})
          </button>
        </div>
        {renderDeviceModal()}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      {/* Main content canvas */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {/* Custom Header Block mimicking Objects/Policies */}
        <div style={{
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', gap: '24px', minHeight: '64px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{activeSubTab === 'Inventory' ? 'Device Inventory' : activeSubTab}</h2>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                  Display and audit client {activeSubTab.toLowerCase()} contexts extracted from the ingested configuration.
                </p>
              </div>

              {/* Search Bar in Top Right Corner */}
              {activeSubTab === 'Inventory' && (
                <div style={{ width: '300px', flexShrink: 0 }}>
                  <SearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search inventory..."
                    width="100%"
                    variant="global"
                  />
                </div>
              )}
            </div>
            <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%' }} />
          </div>
        </div>

        {inventory.length === 0 ? (
          <EmptyState
            icon={<Server size={32} />}
            title="No Devices Registered"
            description="Import a Panorama or firewall configuration XML file from the XML Import tab to populate the appliance catalog."
            minHeight="350px"
          />
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>

            {/* 1. Inventory View */}
            {activeSubTab === 'Inventory' && (
              <div style={{ flex: 1, padding: '0', margin: '0 -30px -30px -30px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  <DataTable
                    columns={inventoryColumns}
                    data={inventory}
                    searchQuery={searchQuery}
                    exportFilename={`canopy_inventory_${new Date().toISOString().slice(0, 10)}.csv`}
                    pagination={true}
                    selectable={true}
                    onSelectionChange={setSelectedDevices}
                    bulkActions={
                      selectedDevices.length > 0 ? (
                        <button
                          className="btn-danger btn-sm"
                          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                          onClick={() => handleBulkDeleteDevices(selectedDevices)}
                        >
                          <Trash2 size={14} /> Delete Selected ({selectedDevices.length})
                        </button>
                      ) : undefined
                    }
                    rowContextMenuActions={(row: ManagedDevice, closeMenu) => (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '160px', padding: '4px' }}>
                        <button
                          className="context-menu-item"
                          onClick={() => { navigator.clipboard.writeText(row.name); closeMenu(); addToast('Copied Device Name'); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <Copy size={13} style={{ color: 'var(--text-muted)' }} /> Copy Device Name
                        </button>
                        <button
                          className="context-menu-item"
                          onClick={() => { navigator.clipboard.writeText(row.serial); closeMenu(); addToast('Copied Serial Number'); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <Copy size={13} style={{ color: 'var(--text-muted)' }} /> Copy Serial Number
                        </button>
                        <button
                          className="context-menu-item"
                          onClick={() => { if (row.ip_address) { navigator.clipboard.writeText(row.ip_address); addToast('Copied Management IP'); } else { addToast('No IP Address to copy', 'error'); } closeMenu(); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <Copy size={13} style={{ color: 'var(--text-muted)' }} /> Copy Management IP
                        </button>
                        <button
                          className="context-menu-item"
                          onClick={() => { if (row.device_group) { navigator.clipboard.writeText(row.device_group); addToast('Copied Device Group'); } else { addToast('No Device Group to copy', 'error'); } closeMenu(); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <Copy size={13} style={{ color: 'var(--text-muted)' }} /> Copy Device Group
                        </button>
                        <button
                          className="context-menu-item"
                          onClick={() => { if (row.template_stack) { navigator.clipboard.writeText(row.template_stack); addToast('Copied Template Stack'); } else { addToast('No Template Stack to copy', 'error'); } closeMenu(); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <Copy size={13} style={{ color: 'var(--text-muted)' }} /> Copy Template Stack
                        </button>
                        <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                        <button
                          className="context-menu-item"
                          onClick={() => { handleOpenEditDeviceModal(row); closeMenu(); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <Edit2 size={13} style={{ color: 'var(--text-muted)' }} /> Edit Device
                        </button>
                        <button
                          className="context-menu-item"
                          onClick={() => { handleDeleteDevice(row); closeMenu(); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--red-500)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--red-500-10)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <Trash2 size={13} style={{ color: 'var(--red-500)' }} /> Delete Device
                        </button>
                      </div>
                    )}
                    toolbarTitle={
                      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                        Inventory ({inventory.length})
                      </h2>
                    }
                    topRightActions={
                      <button
                        className="btn-primary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                        onClick={() => handleOpenAddDeviceModal()}
                      >
                        <Plus size={14} /> Add Firewall
                      </button>
                    }
                  />
                </div>
              </div>
            )}

            {/* 2. Device Groups Tree Explorer */}
            {activeSubTab === 'Device Groups' && (
              <div style={{ flex: 1, display: 'flex', gap: '20px', minHeight: 0, marginTop: '50px' }}>

                {/* Left Panel - Hierarchy Tree */}
                <div style={{
                  width: `${leftPanelWidth}px`,
                  minWidth: '340px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-main)',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  flexShrink: 0
                }}>
                <div style={{ padding: '20px 20px 0 20px', display: 'flex', flexDirection: 'column' }}>
                  {/* Title and Search Row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '64px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                        Hierarchy Tree
                      </h3>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <SearchBar
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder="Filter groups..."
                        width="180px"
                        variant="local"
                      />
                    </div>
                  </div>

                  {/* Internal Divider (Aligned with right panel) */}
                  <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%', marginTop: '12px' }} />

                  {/* Buttons below the divider */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', height: '28px', marginTop: '16px', marginBottom: '4px' }}>
                    <div style={{ position: 'relative', height: '100%' }} ref={hierarchyDropdownRef}>
                      <button
                        className="btn-secondary btn-sm"
                        style={{ padding: '0 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '6px', fontSize: '12px' }}
                        onClick={() => setIsHierarchyDropdownOpen(!isHierarchyDropdownOpen)}
                        title="More Actions"
                      >
                        <MoreHorizontal size={14} /> Actions
                      </button>
                      {isHierarchyDropdownOpen && (
                        <div className="dropdown-menu" style={{
                          position: 'absolute',
                          left: 0,
                          top: '100%',
                          marginTop: '4px',
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-main)',
                          borderRadius: '6px',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                          zIndex: 2000,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                          padding: '4px',
                          minWidth: '180px'
                        }}>
                          {selectedGroupId && selectedGroupDetails ? (
                            <>
                              <div style={{ padding: '4px 10px 8px 10px', fontSize: '11px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-main)', marginBottom: '4px', fontWeight: 600 }}>
                                {cleanGroupName(selectedGroupDetails.name)}
                              </div>
                              <button
                                className="context-menu-item"
                                onClick={() => { handleOpenAddGroupModal(selectedGroupDetails.id); setIsHierarchyDropdownOpen(false); }}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <Plus size={13} style={{ color: 'var(--text-muted)' }} /> Add Child Group
                              </button>
                              <button
                                className="context-menu-item"
                                onClick={() => { setIsAssignFirewallsModalOpen(true); setIsHierarchyDropdownOpen(false); }}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <Server size={13} style={{ color: 'var(--text-muted)' }} /> Assign Firewalls
                              </button>
                              <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                              <button
                                className="context-menu-item"
                                onClick={() => { handleOpenEditGroupModal(selectedGroupDetails); setIsHierarchyDropdownOpen(false); }}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <Edit2 size={13} style={{ color: 'var(--text-muted)' }} /> Edit Group
                              </button>
                              {selectedGroupDetails.uuid !== 'paloalto-dg-shared' && (
                                <button
                                  className="context-menu-item"
                                  onClick={() => { handleDeleteGroup(selectedGroupDetails); setIsHierarchyDropdownOpen(false); }}
                                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--red-500)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--red-500-10)'}
                                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                  <Trash2 size={13} style={{ color: 'var(--red-500)' }} /> Delete Group
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              className="context-menu-item"
                              onClick={() => { handleOpenAddGroupModal(null); setIsHierarchyDropdownOpen(false); }}
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <Plus size={13} style={{ color: 'var(--text-muted)' }} /> Add Root Group
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      className="btn-primary btn-sm"
                      style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                      onClick={() => handleOpenAddGroupModal(selectedGroupId ? (selectedGroupDetails?.id || null) : null)}
                    >
                      <Plus size={14} /> {selectedGroupId ? 'Add Child Group' : 'Add Root Group'}
                    </button>
                  </div>
                  {/* Internal Divider */}
                  <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%', marginTop: '12px' }} />
                </div>
                
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 20px', position: 'relative' }}>
                    <div style={{ position: 'sticky', top: 0, height: '10px', backgroundColor: 'var(--bg-surface)', zIndex: 100, margin: '0 -20px' }} />
                    {rootGroups.length === 0 ? (
                      <div style={{ color: 'var(--text-sub)', fontSize: '12px', padding: '10px', textAlign: 'center' }}>No device groups found.</div>
                    ) : (
                      rootGroups.map((group, index) => (
                        <GroupTreeItem
                          key={group.uuid}
                          group={group}
                          allGroups={filteredDeviceGroups}
                          selectedGroupId={selectedGroupId}
                          onSelect={setSelectedGroupId}
                          deviceCounts={deviceCounts}
                          onContextMenu={(e, g) => setTreeContextMenu({ x: e.pageX, y: e.pageY, group: g })}
                          isLastInTree={index === rootGroups.length - 1}
                        />
                      ))
                    )}
                  </div>
                </div>

                {/* Tree Context Menu Overlay */}
                {treeContextMenu && (
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      top: treeContextMenu.y,
                      left: treeContextMenu.x,
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-main)',
                      borderRadius: '6px',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                      zIndex: 2000,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      padding: '4px',
                      minWidth: '180px'
                    }}>
                    <div style={{ padding: '4px 10px 8px 10px', fontSize: '11px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-main)', marginBottom: '4px', fontWeight: 600 }}>
                      {cleanGroupName(treeContextMenu.group.name)}
                    </div>
                    <button
                      className="context-menu-item"
                      onClick={() => { handleOpenAddGroupModal(treeContextMenu.group.id); setTreeContextMenu(null); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <Plus size={13} style={{ color: 'var(--text-muted)' }} /> Add Child Group
                    </button>
                    <button
                      className="context-menu-item"
                      onClick={() => { setIsAssignFirewallsModalOpen(true); setTreeContextMenu(null); setSelectedGroupId(treeContextMenu.group.uuid); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <Server size={13} style={{ color: 'var(--text-muted)' }} /> Assign Firewalls
                    </button>
                    <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                    <button
                      className="context-menu-item"
                      onClick={() => { navigator.clipboard.writeText(cleanGroupName(treeContextMenu.group.name)); addToast('Copied Group Name'); setTreeContextMenu(null); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <Copy size={13} style={{ color: 'var(--text-muted)' }} /> Copy Group Name
                    </button>
                    <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                    <button
                      className="context-menu-item"
                      onClick={() => { handleOpenEditGroupModal(treeContextMenu.group); setTreeContextMenu(null); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <Edit2 size={13} style={{ color: 'var(--text-muted)' }} /> Edit Group
                    </button>
                    {treeContextMenu.group.uuid !== 'paloalto-dg-shared' && (
                      <button
                        className="context-menu-item"
                        onClick={() => { handleDeleteGroup(treeContextMenu.group); setTreeContextMenu(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--red-500)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--red-500-10)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <Trash2 size={13} style={{ color: 'var(--red-500)' }} /> Delete Group
                      </button>
                    )}
                  </div>
                )}



                {/* Resizer */}
                <div
                  style={{
                    width: '12px',
                    cursor: 'col-resize',
                    backgroundColor: 'transparent',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 10,
                    margin: '0 -2px'
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    isDragging.current = true;
                    const startX = e.pageX;
                    const startWidth = leftPanelWidth;

                    const handleMouseMove = (moveEvent: MouseEvent) => {
                      if (isDragging.current) {
                        const newWidth = Math.max(340, Math.min(800, startWidth + (moveEvent.pageX - startX)));
                        setLeftPanelWidth(newWidth);
                      }
                    };

                    const handleMouseUp = () => {
                      isDragging.current = false;
                      document.removeEventListener('mousemove', handleMouseMove);
                      document.removeEventListener('mouseup', handleMouseUp);
                    };

                    document.addEventListener('mousemove', handleMouseMove);
                    document.addEventListener('mouseup', handleMouseUp);
                  }}
                >
                  <div style={{ width: '4px', height: '24px', backgroundColor: 'var(--border-main)', borderRadius: '2px', transition: 'background-color 0.2s ease' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--text-sub)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--border-main)'} />
                </div>

                {/* Right Content Pane */}
                <div style={{
                  flex: 1,
                  minWidth: '500px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-main)',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  overflow: 'hidden'
                }}>
                  {selectedGroupId && selectedGroupDetails ? (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                      <div style={{ padding: '20px 20px 0 20px', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '64px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <h4 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                                {selectedGroupDetails.uuid === 'paloalto-dg-shared' ? 'Shared' : cleanGroupName(selectedGroupDetails.name)}
                              </h4>
                              {selectedGroupDetails.uuid !== 'paloalto-dg-shared' && (
                                <button
                                  className="btn-secondary btn-sm"
                                  style={{ padding: '2px 8px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', height: '22px' }}
                                  onClick={() => handleOpenEditGroupModal(selectedGroupDetails)}
                                  title="Edit Name and Description"
                                >
                                  <Edit2 size={11} /> Edit Info
                                </button>
                              )}
                            </div>
                            {selectedGroupDetails.description && (
                              <div style={{ fontSize: '13px', color: 'var(--text-sub)' }}>
                                {selectedGroupDetails.description}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <SearchBar value={memberSearchQuery} onChange={setMemberSearchQuery} placeholder="Search members..." variant="local" />
                          </div>
                        </div>
                        <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%', marginTop: '12px' }} />
                      </div>

                      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                        <DataTable
                          toolbarTitle={<span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-main)' }}>Firewalls ({devicesInSelectedGroup.length})</span>}
                          columns={groupMemberColumns}
                          data={devicesInSelectedGroup}
                          searchQuery={memberSearchQuery}
                          pagination={true}
                          selectable={true}
                          onSelectionChange={setSelectedDevices}
                          topRightActions={
                            <button
                              className="btn-primary btn-sm"
                              style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                              onClick={() => setIsAssignFirewallsModalOpen(true)}
                            >
                              <Server size={14} /> Assign Firewalls
                            </button>
                          }
                          bulkActions={
                            selectedDevices.length > 0 ? (
                              <button
                                className="btn-secondary btn-sm"
                                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                onClick={() => handleBulkRemoveFromGroup(selectedDevices)}
                              >
                                <Trash2 size={14} /> Remove Selected ({selectedDevices.length})
                              </button>
                            ) : undefined
                          }
                          rowContextMenuActions={(row: ManagedDevice, closeMenu) => (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '160px', padding: '4px' }}>
                              <button
                                className="context-menu-item"
                                onClick={() => { navigator.clipboard.writeText(row.name); closeMenu(); addToast('Copied Device Name'); }}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <Copy size={13} style={{ color: 'var(--text-muted)' }} /> Copy Device Name
                              </button>
                              <button
                                className="context-menu-item"
                                onClick={() => { navigator.clipboard.writeText(row.serial); closeMenu(); addToast('Copied Serial Number'); }}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <Copy size={13} style={{ color: 'var(--text-muted)' }} /> Copy Serial Number
                              </button>
                              <button
                                className="context-menu-item"
                                onClick={() => { handleOpenEditDeviceModal(row); closeMenu(); }}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <Edit2 size={13} style={{ color: 'var(--text-muted)' }} /> Edit Settings
                              </button>
                              <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                              <button
                                className="context-menu-item"
                                onClick={() => { handleBulkRemoveFromGroup([row]); closeMenu(); }}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--red-500)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--red-500-10)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <Trash2 size={13} style={{ color: 'var(--red-500)' }} /> Remove from Group
                              </button>
                            </div>
                          )}
                        />
                      </div>
                    </div>
                  ) : (
                    <EmptyState
                      icon={<LayoutGrid size={32} />}
                      title="Select a Device Group"
                      description="Choose a device group context from the hierarchy tree on the left to inspect its assigned firewalls."
                      minHeight="100%"
                    />
                  )}
                </div>
              </div>
            )}

            {/* 3. Templates & Stacks explorer */}
            {activeSubTab === 'Templates' && (
              <div style={{ flex: 1, display: 'flex', gap: '20px', minHeight: 0, marginTop: '50px' }}>

                {/* Left Templates Panel */}
                <div style={{
                  width: `${leftTemplatesPanelWidth}px`,
                  minWidth: '340px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-main)',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  flexShrink: 0
                }}>
                  <div style={{ padding: '20px 20px 0 20px', display: 'flex', flexDirection: 'column' }}>
                    {/* Title and Search Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '64px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                          Templates
                        </h3>
                      </div>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <SearchBar
                          value={templatesSearchQuery}
                          onChange={setTemplatesSearchQuery}
                          placeholder="Filter templates..."
                          width="180px"
                          variant="local"
                        />
                      </div>
                    </div>

                    {/* Divider */}
                    <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%', marginTop: '12px' }} />

                    {/* Actions Menu row */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', height: '28px', marginTop: '16px', marginBottom: '4px' }}>
                      <div style={{ position: 'relative', height: '100%' }} ref={templatesDropdownRef}>
                        <button
                          className="btn-secondary btn-sm"
                          style={{ padding: '0 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '6px', fontSize: '12px' }}
                          onClick={() => setIsTemplatesDropdownOpen(!isTemplatesDropdownOpen)}
                          title="More Actions"
                        >
                          <MoreHorizontal size={14} /> Actions
                        </button>
                        {isTemplatesDropdownOpen && (
                          <div className="dropdown-menu" style={{
                            position: 'absolute',
                            left: 0,
                            top: '100%',
                            marginTop: '4px',
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--border-main)',
                            borderRadius: '6px',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                            zIndex: 2000,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                            padding: '4px',
                            minWidth: '180px'
                          }}>
                            <button
                              className="context-menu-item"
                              onClick={() => { handleOpenAddStackModal(); setIsTemplatesDropdownOpen(false); }}
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <Plus size={13} style={{ color: 'var(--text-muted)' }} /> Add Template Stack
                            </button>
                            <button
                              className="context-menu-item"
                              onClick={() => { handleOpenAddTemplateModal(); setIsTemplatesDropdownOpen(false); }}
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <Plus size={13} style={{ color: 'var(--text-muted)' }} /> Add Base Template
                            </button>
                          </div>
                        )}
                      </div>
                      <button
                        className="btn-primary btn-sm"
                        style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                        onClick={handleOpenAddStackModal}
                      >
                        <Plus size={14} /> Add Stack
                      </button>
                    </div>

                    {/* Divider */}
                    <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%', marginTop: '12px' }} />
                  </div>

                  {/* Scrollable list viewport */}
                  <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 20px', position: 'relative' }}>
                    <div style={{ position: 'sticky', top: 0, height: '10px', backgroundColor: 'var(--bg-surface)', zIndex: 100, margin: '0 -20px' }} />

                    {/* Template Stacks Section */}
                    <div style={{ marginBottom: '20px' }}>
                      <div style={{ position: 'sticky', top: '10px', backgroundColor: 'var(--bg-surface)', padding: '10px 0', zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>
                          Template Stacks
                        </h3>
                      </div>
                      {filteredTemplateStacks.length === 0 ? (
                        <div style={{ color: 'var(--text-sub)', fontSize: '12px', padding: '5px' }}>No stacks defined.</div>
                      ) : (
                        filteredTemplateStacks.map(stack => (
                          <TemplateStackItem
                            key={stack.id}
                            stack={stack}
                            members={stackMembers.filter(m => m.stack_id === stack.id)}
                            selectedTemplateId={selectedTemplateId}
                            onSelect={handleSelectTemplate}
                            templateCounts={templateCounts}
                            baseTemplates={baseTemplates}
                            onContextMenu={(e, type, data) => {
                              setTemplateContextMenu({ x: e.pageX, y: e.pageY, type, data });
                            }}
                          />
                        ))
                      )}
                    </div>

                    {/* Divider */}
                    <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '15px 0' }} />

                    {/* Base Templates Section */}
                    <div>
                      <div style={{ position: 'sticky', top: '10px', backgroundColor: 'var(--bg-surface)', padding: '10px 0', zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>
                          Base Templates
                        </h3>
                      </div>
                      {filteredBaseTemplates.length === 0 ? (
                        <div style={{ color: 'var(--text-sub)', fontSize: '12px', padding: '5px' }}>No base templates found.</div>
                      ) : (
                        filteredBaseTemplates.map(tmpl => {
                          const count = templateCounts[tmpl.name] || 0;
                          const isSelected = selectedTemplateId === `tmpl-${tmpl.name}`;
                          return (
                            <div
                              key={tmpl.uuid}
                              onClick={() => handleSelectTemplate(`tmpl-${tmpl.name}`, tmpl.name)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setTemplateContextMenu({ x: e.pageX, y: e.pageY, type: 'template', data: tmpl });
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '6px 10px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                backgroundColor: isSelected ? 'var(--bg-element)' : 'transparent',
                                borderLeft: isSelected ? '3px solid var(--accent-blue)' : '3px solid transparent',
                                color: isSelected ? 'var(--text-main)' : 'var(--text-muted)',
                                fontSize: '13px',
                                marginBottom: '2px',
                                transition: 'all 0.15s ease',
                                userSelect: 'none',
                              }}
                            >
                              <FileText size={14} style={{ marginRight: '8px', color: 'var(--text-sub)' }} />
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSelected ? 600 : 400 }}>
                                {cleanTemplateName(tmpl.name)}
                              </span>
                              {count > 0 && (
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px', fontWeight: 400 }}>
                                  ({count})
                                </span>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* Drag Handle Column */}
                <div
                  style={{
                    width: '12px',
                    cursor: 'col-resize',
                    backgroundColor: 'transparent',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 10,
                    margin: '0 -2px'
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    isTemplatesDragging.current = true;
                    const startX = e.pageX;
                    const startWidth = leftTemplatesPanelWidth;

                    const handleMouseMove = (moveEvent: MouseEvent) => {
                      if (isTemplatesDragging.current) {
                        const newWidth = Math.max(340, Math.min(800, startWidth + (moveEvent.pageX - startX)));
                        setLeftTemplatesPanelWidth(newWidth);
                      }
                    };

                    const handleMouseUp = () => {
                      isTemplatesDragging.current = false;
                      document.removeEventListener('mousemove', handleMouseMove);
                      document.removeEventListener('mouseup', handleMouseUp);
                    };

                    document.addEventListener('mousemove', handleMouseMove);
                    document.addEventListener('mouseup', handleMouseUp);
                  }}
                >
                  <div style={{ width: '4px', height: '24px', backgroundColor: 'var(--border-main)', borderRadius: '2px', transition: 'background-color 0.2s ease' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--text-sub)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--border-main)'} />
                </div>

                {/* Right Content Pane */}
                <div style={{
                  flex: 1,
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-main)',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: '500px',
                  minHeight: 0,
                  overflow: 'hidden'
                }}>
                  {selectedTemplateId && selectedTemplateName ? (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                      
                      <div style={{ padding: '20px 20px 0 20px', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '64px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <h4 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                                {cleanTemplateName(selectedTemplateName)}
                              </h4>
                              <button
                                className="btn-secondary btn-sm"
                                style={{ padding: '2px 8px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', height: '22px' }}
                                onClick={() => {
                                  if (selectedTemplateId.startsWith('stack-')) {
                                    if (activeStack) handleOpenEditStackModal(activeStack);
                                  } else {
                                    const tmpl = baseTemplates.find(t => t.name === selectedTemplateName);
                                    if (tmpl) handleOpenEditTemplateModal(tmpl);
                                  }
                                }}
                                title="Edit Name and Description"
                              >
                                <Edit2 size={11} /> Edit Info
                              </button>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                              <span>Type: <code>{selectedTemplateId.startsWith('stack-') ? 'Template Stack' : 'Base Template'}</code></span>
                            </div>
                            {selectedTemplateDescription && (
                              <div style={{ fontSize: '13px', color: 'var(--text-sub)' }}>
                                {selectedTemplateDescription}
                              </div>
                            )}
                          </div>
                          {templatesRightTab === 'firewalls' && (
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                              <SearchBar value={templateMemberSearchQuery} onChange={setTemplateMemberSearchQuery} placeholder="Search firewalls..." variant="local" />
                            </div>
                          )}
                          {templatesRightTab === 'templates' && (
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                              <SearchBar value={stackMemberSearchQuery} onChange={setStackMemberSearchQuery} placeholder="Search templates..." variant="local" />
                            </div>
                          )}
                        </div>

                        {/* TABS ROW */}
                        {activeStack ? (
                          <div style={{ display: 'flex', gap: '20px', borderBottom: '1px solid var(--border-main)', marginTop: '20px' }}>
                            <button
                              onClick={() => setTemplatesRightTab('firewalls')}
                              style={{
                                padding: '8px 4px',
                                background: 'none',
                                border: 'none',
                                borderBottom: templatesRightTab === 'firewalls' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                                color: templatesRightTab === 'firewalls' ? 'var(--text-main)' : 'var(--text-muted)',
                                fontWeight: templatesRightTab === 'firewalls' ? 600 : 400,
                                cursor: 'pointer',
                                fontSize: '13px',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              Assigned Firewalls
                            </button>
                            <button
                              onClick={() => setTemplatesRightTab('templates')}
                              style={{
                                padding: '8px 4px',
                                background: 'none',
                                border: 'none',
                                borderBottom: templatesRightTab === 'templates' ? '2px solid var(--accent-blue)' : '2px solid transparent',
                                color: templatesRightTab === 'templates' ? 'var(--text-main)' : 'var(--text-muted)',
                                fontWeight: templatesRightTab === 'templates' ? 600 : 400,
                                cursor: 'pointer',
                                fontSize: '13px',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              Member Templates ({activeStackMembers.length})
                            </button>
                          </div>
                        ) : (
                          <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%', marginTop: '12px' }} />
                        )}
                      </div>

                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        {/* Tab 1: Assigned Firewalls */}
                        {templatesRightTab === 'firewalls' && (
                          <DataTable
                            toolbarTitle={<span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-main)' }}>Firewalls ({devicesInSelectedTemplate.length})</span>}
                            columns={templateMemberColumns}
                            data={devicesInSelectedTemplate}
                            searchQuery={templateMemberSearchQuery}
                            pagination={true}
                            selectable={true}
                            onSelectionChange={setSelectedDevices}
                            topRightActions={
                              <button
                                className="btn-primary btn-sm"
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                                onClick={() => setIsAssignFirewallsModalOpen(true)}
                              >
                                <Server size={14} /> Assign Firewalls
                              </button>
                            }
                            bulkActions={
                              selectedDevices.length > 0 ? (
                                <button
                                  className="btn-secondary btn-sm"
                                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                  onClick={() => handleBulkRemoveFromTemplateContext(selectedDevices)}
                                >
                                  <Trash2 size={14} /> Remove Selected ({selectedDevices.length})
                                </button>
                              ) : undefined
                            }
                            rowContextMenuActions={(row: ManagedDevice, closeMenu) => (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '160px', padding: '4px' }}>
                                <button
                                  className="context-menu-item"
                                  onClick={() => { navigator.clipboard.writeText(row.name); closeMenu(); addToast('Copied Device Name'); }}
                                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                  <Copy size={13} style={{ color: 'var(--text-muted)' }} /> Copy Device Name
                                </button>
                                <button
                                  className="context-menu-item"
                                  onClick={() => { navigator.clipboard.writeText(row.serial); closeMenu(); addToast('Copied Serial Number'); }}
                                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                  <Copy size={13} style={{ color: 'var(--text-muted)' }} /> Copy Serial Number
                                </button>
                                <button
                                  className="context-menu-item"
                                  onClick={() => { handleOpenEditDeviceModal(row); closeMenu(); }}
                                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                  <Edit2 size={13} style={{ color: 'var(--text-muted)' }} /> Edit Device
                                </button>
                                <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                                <button
                                  className="context-menu-item"
                                  onClick={() => { handleBulkRemoveFromTemplateContext([row]); closeMenu(); }}
                                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--red-500)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--red-500-10)'}
                                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                  <Trash2 size={13} style={{ color: 'var(--red-500)' }} /> Remove from Template
                                </button>
                              </div>
                            )}
                          />
                        )}

                        {/* Tab 2: Member Templates (Only for Stacks) */}
                        {templatesRightTab === 'templates' && activeStack && (
                          <DataTable
                            toolbarTitle={<span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-main)' }}>Stack Members ({activeStackMembers.length})</span>}
                            columns={stackMemberColumns}
                            data={activeStackMembers}
                            searchQuery={stackMemberSearchQuery}
                            selectable={true}
                            onSelectionChange={setSelectedMemberTemplates}
                            topRightActions={
                              availableTemplatesToAdd.length > 0 ? (
                                <button
                                  className="btn-primary btn-sm"
                                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                  onClick={() => {
                                    setSelectedAddableTemplates([]);
                                    setIsAddTemplateToStackModalOpen(true);
                                  }}
                                >
                                  <Plus size={14} /> Add Template
                                </button>
                              ) : undefined
                            }
                            bulkActions={
                              selectedMemberTemplates.length > 0 ? (
                                <button
                                  className="btn-secondary btn-sm"
                                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                  onClick={handleBulkRemoveMembersFromStack}
                                >
                                  <Trash2 size={14} /> Remove Selected ({selectedMemberTemplates.length})
                                </button>
                              ) : undefined
                            }
                             rowContextMenuActions={(row, closeMenu) => {
                               const idx = activeStackMembers.findIndex(m => m.template_name === row.template_name);
                               return (
                                 <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '240px', padding: '4px', maxHeight: '250px', overflowY: 'auto' }}>
                                   {rightClickSubMenuType === null ? (
                                     <>
                                       <div style={{ padding: '4px 10px 8px 10px', fontSize: '11px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-main)', marginBottom: '4px', fontWeight: 600 }}>
                                         {cleanTemplateName(row.template_name)}
                                       </div>
                                       <button
                                         className="context-menu-item"
                                         onClick={() => {
                                           handleMoveMemberTemplateToPosition(activeStack, idx, 'top');
                                           closeMenu();
                                         }}
                                         style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%' }}
                                         onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                                         onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                       >
                                         <ChevronsUp size={13} style={{ color: 'var(--text-muted)' }} /> Move to Top
                                       </button>
                                       <button
                                         className="context-menu-item"
                                         onClick={() => {
                                           handleMoveMemberTemplateToPosition(activeStack, idx, 'bottom');
                                           closeMenu();
                                         }}
                                         style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%' }}
                                         onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                                         onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                       >
                                         <ChevronsDown size={13} style={{ color: 'var(--text-muted)' }} /> Move to Bottom
                                       </button>
                                       <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                                       <button
                                         className="context-menu-item"
                                         onClick={() => {
                                           handleMoveMemberTemplate(activeStack, idx, 'up');
                                           closeMenu();
                                         }}
                                         disabled={idx === 0}
                                         style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: idx === 0 ? 'var(--text-muted)' : 'var(--text-main)', cursor: idx === 0 ? 'not-allowed' : 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%' }}
                                         onMouseEnter={(e) => { if (idx !== 0) e.currentTarget.style.backgroundColor = 'var(--bg-element)'; }}
                                         onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                       >
                                         <ChevronUp size={13} style={{ color: 'var(--text-muted)' }} /> Move Up
                                       </button>
                                       <button
                                         className="context-menu-item"
                                         onClick={() => {
                                           handleMoveMemberTemplate(activeStack, idx, 'down');
                                           closeMenu();
                                         }}
                                         disabled={idx === activeStackMembers.length - 1}
                                         style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: idx === activeStackMembers.length - 1 ? 'var(--text-muted)' : 'var(--text-main)', cursor: idx === activeStackMembers.length - 1 ? 'not-allowed' : 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%' }}
                                         onMouseEnter={(e) => { if (idx !== activeStackMembers.length - 1) e.currentTarget.style.backgroundColor = 'var(--bg-element)'; }}
                                         onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                       >
                                         <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} /> Move Down
                                       </button>
                                       <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                                       <button
                                         className="context-menu-item"
                                         disabled={activeStackMembers.length <= 1}
                                         onClick={() => { setRightClickSubMenuType('before'); setSubmenuSearchQuery(''); }}
                                         style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'none', border: 'none', color: activeStackMembers.length <= 1 ? 'var(--text-muted)' : 'var(--text-main)', cursor: activeStackMembers.length <= 1 ? 'not-allowed' : 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%' }}
                                         onMouseEnter={(e) => { if (activeStackMembers.length > 1) e.currentTarget.style.backgroundColor = 'var(--bg-element)'; }}
                                         onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                       >
                                         <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                           <ArrowUp size={13} style={{ color: 'var(--text-muted)' }} />
                                           <span>Move Before...</span>
                                         </div>
                                         <span style={{ fontSize: '10px' }}>▶</span>
                                       </button>
                                       <button
                                         className="context-menu-item"
                                         disabled={activeStackMembers.length <= 1}
                                         onClick={() => { setRightClickSubMenuType('after'); setSubmenuSearchQuery(''); }}
                                         style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'none', border: 'none', color: activeStackMembers.length <= 1 ? 'var(--text-muted)' : 'var(--text-main)', cursor: activeStackMembers.length <= 1 ? 'not-allowed' : 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%' }}
                                         onMouseEnter={(e) => { if (activeStackMembers.length > 1) e.currentTarget.style.backgroundColor = 'var(--bg-element)'; }}
                                         onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                       >
                                         <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                           <ArrowDown size={13} style={{ color: 'var(--text-muted)' }} />
                                           <span>Move After...</span>
                                         </div>
                                         <span style={{ fontSize: '10px' }}>▶</span>
                                       </button>
                                       <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                                       <button
                                         className="context-menu-item"
                                         onClick={() => {
                                           handleRemoveMemberTemplate(activeStack, row.template_name);
                                           closeMenu();
                                         }}
                                         style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--red-500)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%' }}
                                         onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--red-500-10)'}
                                         onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                       >
                                         <Trash2 size={13} style={{ color: 'var(--red-500)' }} /> Remove from Stack
                                       </button>
                                     </>
                                   ) : (
                                     <>
                                       <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '240px' }}>
                                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                         <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
                                           Move {rightClickSubMenuType === 'before' ? 'Before' : 'After'}:
                                         </span>
                                         <button
                                           onClick={() => setRightClickSubMenuType(null)}
                                           style={{ background: 'none', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: '11px', padding: 0 }}
                                         >
                                           Cancel
                                         </button>
                                       </div>
                                       <Dropdown
                                         value=""
                                         options={activeStackMembers
                                           .map(m => cleanTemplateName(m.template_name))
                                           .filter(name => name !== cleanTemplateName(row.template_name))
                                         }
                                         onChange={(val) => {
                                           const originalItem = activeStackMembers.find(m => cleanTemplateName(m.template_name) === val);
                                           if (originalItem && activeStack) {
                                             const targetIdx = activeStackMembers.indexOf(originalItem);
                                             handleMoveMemberTemplateToPosition(activeStack, idx, rightClickSubMenuType, targetIdx);
                                           }
                                           setRightClickSubMenuType(null);
                                           closeMenu();
                                         }}
                                         width="100%"
                                         searchable={true}
                                       />
                                     </div>
                                     </>
                                   )}
                                 </div>
                               );
                             }}
                          />
                        )}
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      flex: 1,
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-main)',
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      minHeight: 0,
                      overflow: 'hidden'
                    }}>
                      <EmptyState
                        icon={<Layers size={32} />}
                        title="Select a Template Context"
                        description="Choose a template or template stack from the list on the left to inspect its assigned firewalls."
                        minHeight="100%"
                        action={
                          <div style={{ display: 'flex', gap: '10px', marginTop: '15px', justifyContent: 'center' }}>
                            <button
                              className="btn-primary btn-sm"
                              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                              onClick={handleOpenAddTemplateModal}
                            >
                              <Plus size={14} /> Add Base Template
                            </button>
                            <button
                              className="btn-secondary btn-sm"
                              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                              onClick={handleOpenAddStackModal}
                            >
                              <Plus size={14} /> Add Template Stack
                            </button>
                          </div>
                        }
                      />
                    </div>
                  )}
                {/* Templates Context Menu Overlay */}
                {templateContextMenu && (
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      top: templateContextMenu.y,
                      left: templateContextMenu.x,
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-main)',
                      borderRadius: '6px',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                      zIndex: 2000,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      padding: '4px',
                      minWidth: '180px'
                    }}>
                    <div style={{ padding: '4px 10px 8px 10px', fontSize: '11px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-main)', marginBottom: '4px', fontWeight: 600 }}>
                      {templateContextMenu.type === 'stack' ? templateContextMenu.data.name : cleanTemplateName(templateContextMenu.data.name)}
                    </div>
                    {templateContextMenu.type === 'stack' ? (
                      <>
                        <button
                          className="context-menu-item"
                          onClick={() => { handleOpenEditStackModal(templateContextMenu.data); setTemplateContextMenu(null); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <Edit2 size={13} style={{ color: 'var(--text-muted)' }} /> Edit Stack
                        </button>
                        <button
                          className="context-menu-item"
                          onClick={() => { handleDeleteStack(templateContextMenu.data); setTemplateContextMenu(null); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--red-500)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--red-500-10)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <Trash2 size={13} style={{ color: 'var(--red-500)' }} /> Delete Stack
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="context-menu-item"
                          onClick={() => { handleOpenEditTemplateModal(templateContextMenu.data); setTemplateContextMenu(null); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <Edit2 size={13} style={{ color: 'var(--text-muted)' }} /> Edit Template
                        </button>
                        <button
                          className="context-menu-item"
                          onClick={() => { handleDeleteTemplate(templateContextMenu.data); setTemplateContextMenu(null); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--red-500)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--red-500-10)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <Trash2 size={13} style={{ color: 'var(--red-500)' }} /> Delete Template
                        </button>
                      </>
                    )}
                    <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                    <button
                      className="context-menu-item"
                      onClick={() => { navigator.clipboard.writeText(templateContextMenu.data.name); addToast('Copied context name'); setTemplateContextMenu(null); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <Copy size={13} style={{ color: 'var(--text-muted)' }} /> Copy Context Name
                    </button>
                  </div>
                )}

                {reorderContextMenu && (
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    className="reorder-context-menu"
                    style={{
                      position: 'fixed',
                      top: Math.min(reorderContextMenu.y, window.innerHeight - 340),
                      left: Math.min(reorderContextMenu.x, window.innerWidth - 260),
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-main)',
                      borderRadius: '6px',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                      zIndex: 2000,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      padding: '4px',
                      minWidth: '240px',
                      maxHeight: '300px',
                      overflowY: 'auto'
                    }}
                  >
                    {reorderSubMenuType === null ? (
                      <>
                        <div style={{ padding: '4px 10px 8px 10px', fontSize: '11px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-main)', marginBottom: '4px', fontWeight: 600 }}>
                          {cleanTemplateName(reorderContextMenu.templateName)}
                        </div>
                        <button
                          className="context-menu-item"
                          onClick={() => {
                            if (activeStack) {
                              handleMoveMemberTemplateToPosition(activeStack, reorderContextMenu.index, 'top');
                            }
                            setReorderContextMenu(null);
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <ChevronsUp size={13} style={{ color: 'var(--text-muted)' }} /> Move to Top
                        </button>
                        <button
                          className="context-menu-item"
                          onClick={() => {
                            if (activeStack) {
                              handleMoveMemberTemplateToPosition(activeStack, reorderContextMenu.index, 'bottom');
                            }
                            setReorderContextMenu(null);
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-element)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <ChevronsDown size={13} style={{ color: 'var(--text-muted)' }} /> Move to Bottom
                        </button>
                        <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                        <button
                          className="context-menu-item"
                          onClick={() => {
                            if (activeStack) {
                              handleMoveMemberTemplate(activeStack, reorderContextMenu.index, 'up');
                            }
                            setReorderContextMenu(null);
                          }}
                          disabled={reorderContextMenu.index === 0}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: reorderContextMenu.index === 0 ? 'var(--text-muted)' : 'var(--text-main)', cursor: reorderContextMenu.index === 0 ? 'not-allowed' : 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%' }}
                          onMouseEnter={(e) => { if (reorderContextMenu.index !== 0) e.currentTarget.style.backgroundColor = 'var(--bg-element)'; }}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <ChevronUp size={13} style={{ color: 'var(--text-muted)' }} /> Move Up
                        </button>
                        <button
                          className="context-menu-item"
                          onClick={() => {
                            if (activeStack) {
                              handleMoveMemberTemplate(activeStack, reorderContextMenu.index, 'down');
                            }
                            setReorderContextMenu(null);
                          }}
                          disabled={reorderContextMenu.index === activeStackMembers.length - 1}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', color: reorderContextMenu.index === activeStackMembers.length - 1 ? 'var(--text-muted)' : 'var(--text-main)', cursor: reorderContextMenu.index === activeStackMembers.length - 1 ? 'not-allowed' : 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%' }}
                          onMouseEnter={(e) => { if (reorderContextMenu.index !== activeStackMembers.length - 1) e.currentTarget.style.backgroundColor = 'var(--bg-element)'; }}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} /> Move Down
                        </button>
                        <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                        <button
                          className="context-menu-item"
                          disabled={activeStackMembers.length <= 1}
                          onClick={() => setReorderSubMenuType('before')}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'none', border: 'none', color: activeStackMembers.length <= 1 ? 'var(--text-muted)' : 'var(--text-main)', cursor: activeStackMembers.length <= 1 ? 'not-allowed' : 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%' }}
                          onMouseEnter={(e) => { if (activeStackMembers.length > 1) e.currentTarget.style.backgroundColor = 'var(--bg-element)'; }}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <ArrowUp size={13} style={{ color: 'var(--text-muted)' }} />
                            <span>Move Before...</span>
                          </div>
                          <span style={{ fontSize: '10px' }}>▶</span>
                        </button>
                        <button
                          className="context-menu-item"
                          disabled={activeStackMembers.length <= 1}
                          onClick={() => setReorderSubMenuType('after')}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'none', border: 'none', color: activeStackMembers.length <= 1 ? 'var(--text-muted)' : 'var(--text-main)', cursor: activeStackMembers.length <= 1 ? 'not-allowed' : 'pointer', borderRadius: '4px', textAlign: 'left', fontSize: '12px', width: '100%' }}
                          onMouseEnter={(e) => { if (activeStackMembers.length > 1) e.currentTarget.style.backgroundColor = 'var(--bg-element)'; }}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <ArrowDown size={13} style={{ color: 'var(--text-muted)' }} />
                            <span>Move After...</span>
                          </div>
                          <span style={{ fontSize: '10px' }}>▶</span>
                        </button>
                      </>
                    ) : (
                      <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '240px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
                            Move {reorderSubMenuType === 'before' ? 'Before' : 'After'}:
                          </span>
                          <button
                            onClick={() => setReorderSubMenuType(null)}
                            style={{ background: 'none', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: '11px', padding: 0 }}
                          >
                            Cancel
                          </button>
                        </div>
                        <Dropdown
                          value=""
                          options={activeStackMembers
                            .map(m => cleanTemplateName(m.template_name))
                            .filter(name => name !== cleanTemplateName(reorderContextMenu.templateName))
                          }
                          onChange={(val) => {
                            const originalItem = activeStackMembers.find(m => cleanTemplateName(m.template_name) === val);
                            if (originalItem && activeStack) {
                              const targetIdx = activeStackMembers.indexOf(originalItem);
                              handleMoveMemberTemplateToPosition(activeStack, reorderContextMenu.index, reorderSubMenuType, targetIdx);
                            }
                            setReorderContextMenu(null);
                            setReorderSubMenuType(null);
                          }}
                          width="100%"
                          searchable={true}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          </div>
        )}

      </div>
      {/* --- MODALS --- */}
      <Modal
        isOpen={isAddTemplateToStackModalOpen}
        onClose={() => { setIsAddTemplateToStackModalOpen(false); setSelectedAddableTemplates([]); setAddTemplateModalSearchQuery(''); }}
        title="Add Templates to Stack"
        size="lg"
        footer={
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button className="btn-secondary btn-sm" onClick={() => { setIsAddTemplateToStackModalOpen(false); setSelectedAddableTemplates([]); setAddTemplateModalSearchQuery(''); }}>Cancel</button>
            <button
              className="btn-primary btn-sm"
              disabled={selectedAddableTemplates.length === 0}
              onClick={async () => {
                if (activeStack && apiClient && selectedAddableTemplates.length > 0) {
                  const members = stackMembers.filter(m => m.stack_id === activeStack.id);
                  const currentIds = members.map(m => {
                    const bt = baseTemplates.find(t => t.name === m.template_name);
                    return bt ? bt.id : null;
                  }).filter(id => id !== null) as number[];

                  const selectedIds = selectedAddableTemplates.map(t => t.id);
                  const newIds = [...currentIds, ...selectedIds];
                  try {
                    await apiClient.updateTemplateStack(activeStack.id, activeStack.name, newIds);
                    addToast(`Added ${selectedAddableTemplates.length} templates to stack: ${activeStack.name}`, 'success');
                    fetchData();
                  } catch (err) {
                    addToast(err instanceof Error ? err.message : 'Failed to add templates to stack', 'error');
                  }
                  setIsAddTemplateToStackModalOpen(false);
                  setSelectedAddableTemplates([]);
                  setAddTemplateModalSearchQuery('');
                }
              }}
            >
              Add Selected ({selectedAddableTemplates.length})
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', height: '400px', padding: '0 4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-sub)' }}>
              Select base templates to append to <strong style={{ color: 'var(--text-main)' }}>{activeStack ? cleanTemplateName(activeStack.name) : ''}</strong>:
            </span>
            <div style={{ width: '220px', marginLeft: '10px' }}>
              <SearchBar value={addTemplateModalSearchQuery} onChange={setAddTemplateModalSearchQuery} placeholder="Search templates..." variant="local" width="100%" />
            </div>
          </div>
          
          <div style={{ flex: 1, border: '1px solid var(--border-main)', borderRadius: '6px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <DataTable
              columns={addableTemplateColumns}
              data={availableTemplatesToAdd}
              searchQuery={addTemplateModalSearchQuery}
              selectable={true}
              onSelectionChange={setSelectedAddableTemplates}
            />
          </div>
        </div>
      </Modal>

      {/* 1. Device (Firewall) Modal */}
      {renderDeviceModal()}

      {/* 2. Device Group Modal */}
      <Modal
        isOpen={isGroupModalOpen}
        onClose={() => setIsGroupModalOpen(false)}
        title={editingGroup ? 'Edit Device Group' : 'Add New Device Group'}
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setIsGroupModalOpen(false)}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleSaveGroup}>
              {editingGroup ? 'Save Changes' : 'Create Group'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Group Name</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. Branch-Offices"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Description (Optional)</label>
            <textarea
              className="input-text"
              placeholder="Enter group description"
              value={groupDescription}
              onChange={(e) => setGroupDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Parent Device Group</label>
            <Dropdown
              value={activeParentGroupLabel}
              options={parentGroupOptions}
              onChange={(val) => {
                if (val === 'Shared') {
                  setGroupParentId(null);
                } else {
                  const match = deviceGroups.find(g => cleanGroupName(g.name) === val);
                  if (match) setGroupParentId(match.id);
                }
              }}
              width="100%"
            />
          </div>
        </div>
      </Modal>

      {/* 3. Base Template Modal */}
      <Modal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        title={editingTemplate ? 'Edit Base Template' : 'Add Base Template'}
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setIsTemplateModalOpen(false)}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleSaveTemplate}>
              {editingTemplate ? 'Save Changes' : 'Create Template'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Template Name</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. Global-Config"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* 4. Template Stack Modal */}
      <Modal
        isOpen={isStackModalOpen}
        onClose={() => setIsStackModalOpen(false)}
        title={editingStack ? 'Edit Template Stack' : 'Create Template Stack'}
        size="md"
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setIsStackModalOpen(false)}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleSaveStack}>
              {editingStack ? 'Save Changes' : 'Create Stack'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Stack Name</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. Edge-Router-Stack"
              value={stackName}
              onChange={(e) => setStackName(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Description</label>
            <textarea
              className="input-text"
              placeholder="e.g. Standard template stack for edge routers"
              value={stackDescription}
              onChange={(e) => setStackDescription(e.target.value)}
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Add Member Template</label>
            <Dropdown
              value="-- Select template to append --"
              options={memberOptions}
              onChange={(val) => {
                if (val !== '-- Select template to append --') {
                  const match = baseTemplates.find(t => cleanTemplateName(t.name) === val);
                  if (match) {
                    setStackTemplateIds(prev => [...prev, match.id]);
                  }
                }
              }}
              width="100%"
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Template Priority Hierarchy (Highest First)</label>
            {stackTemplateIds.length === 0 ? (
              <div style={{ color: 'var(--text-sub)', fontSize: '12px', fontStyle: 'italic', padding: '5px' }}>
                No templates added to this stack yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {stackTemplateIds.map((id, index) => {
                  const t = baseTemplates.find(bt => bt.id === id);
                  if (!t) return null;
                  return (
                    <div
                      key={id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-main)',
                        borderRadius: '4px'
                      }}
                    >
                      <span style={{ fontSize: '13px' }}>{cleanTemplateName(t.name)}</span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          style={{ padding: '2px 6px' }}
                          disabled={index === 0}
                          onClick={() => {
                            setStackTemplateIds(prev => {
                              const next = [...prev];
                              const tmp = next[index - 1];
                              next[index - 1] = next[index];
                              next[index] = tmp;
                              return next;
                            });
                          }}
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          style={{ padding: '2px 6px' }}
                          disabled={index === stackTemplateIds.length - 1}
                          onClick={() => {
                            setStackTemplateIds(prev => {
                              const next = [...prev];
                              const tmp = next[index + 1];
                              next[index + 1] = next[index];
                              next[index] = tmp;
                              return next;
                            });
                          }}
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          type="button"
                          className="btn-danger btn-sm"
                          style={{ padding: '2px 6px' }}
                          onClick={() => {
                            setStackTemplateIds(prev => prev.filter(val => val !== id));
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* 5. Assign Firewalls Modal (In-Window) */}
      {!isAssignModalPoppedOut && (
        <Modal
          isOpen={isAssignFirewallsModalOpen}
          onClose={() => { setIsAssignFirewallsModalOpen(false); setSelectedAssignDevices([]); setIsAssignModalPoppedOut(false); }}
          title={`Assign Firewalls to ${activeSubTab === 'Device Groups' ? 'Group' : 'Template Context'}`}
          size="lg"
          headerActions={
            <Tooltip content="Pop Out to New Window" align="center">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  if (window.electron && window.electron.spawnWindow) {
                    const idParam = activeSubTab === 'Device Groups'
                      ? (selectedGroupDetails ? encodeURIComponent(String(selectedGroupDetails.uuid)) : '')
                      : (selectedTemplateId ? encodeURIComponent(selectedTemplateId) : '');
                    window.electron.spawnWindow(`editor=assign-firewalls&groupId=${idParam}`, {
                      width: 800,
                      height: 600,
                      minWidth: 700,
                      minHeight: 500
                    });
                  } else {
                    const newWin = window.open('', '', 'width=800,height=600,left=200,top=200');
                    if (newWin) {
                      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
                      const bgColor = isDark ? '#1e1e2e' : '#f2f3f5';
                      newWin.document.write(`
                        <html>
                          <head>
                            <title>Assign Firewalls</title>
                            <style>body { margin: 0; padding: 0; background-color: ${bgColor}; }</style>
                          </head>
                          <body class="${isDark ? 'dark' : ''}">
                            <div id="portal-root"></div>
                          </body>
                        </html>
                      `);
                      newWin.document.close();

                      setAssignModalWindow(newWin);
                      setIsAssignModalPoppedOut(true);
                    } else {
                      console.error("Popup blocker prevented opening the window.");
                    }
                  }
                  setIsAssignFirewallsModalOpen(false);
                }}
                title="Pop out into separate window"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px', borderRadius: '4px' }}
              >
                <ExternalLink size={14} />
              </button>
            </Tooltip>
          }
          footer={
            <>
              <button className="btn-secondary btn-sm" onClick={() => { setIsAssignFirewallsModalOpen(false); setSelectedAssignDevices([]); setIsAssignModalPoppedOut(false); }}>Cancel</button>
              <button
                className="btn-primary btn-sm"
                onClick={handleAssignFirewalls}
                disabled={selectedAssignDevices.length === 0}
              >
                Assign Selected ({selectedAssignDevices.length})
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', height: '400px', padding: '0 4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-sub)' }}>
                Select firewalls from your inventory to assign to <strong style={{ color: 'var(--text-main)' }}>{assignTargetLabel}</strong>.
                Firewalls already assigned to this context are hidden.
              </p>
              <div style={{ width: '220px', marginLeft: '10px' }}>
                <SearchBar value={assignModalSearchQuery} onChange={setAssignModalSearchQuery} placeholder="Search available..." variant="local" width="100%" />
              </div>
            </div>
            <div style={{ flex: 1, border: '1px solid var(--border-main)', borderRadius: '6px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <DataTable
                columns={inventoryColumns}
                data={assignAvailableDevices}
                searchQuery={assignModalSearchQuery}
                pagination={true}
                selectable={true}
                onSelectionChange={setSelectedAssignDevices}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* 6. Assign Firewalls Modal (Popped Out Window) */}
      {isAssignFirewallsModalOpen && isAssignModalPoppedOut && (
        <NewWindowPortal
          title={`Assign Firewalls - ${assignTargetLabel}`}
          externalWindow={assignModalWindow}
          onClose={() => { 
            assignModalWindow?.close();
            setIsAssignFirewallsModalOpen(false); 
            setSelectedAssignDevices([]); 
            setIsAssignModalPoppedOut(false); 
            setAssignModalWindow(null);
          }}
        >
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '16px' }}>Assign Firewalls to {assignTargetLabel}</h2>
              <div style={{ width: '220px', marginLeft: '10px' }}>
                <SearchBar value={assignModalSearchQuery} onChange={setAssignModalSearchQuery} placeholder="Search available..." variant="local" width="100%" />
              </div>
            </div>
            <p style={{ margin: '0 0 15px 0', fontSize: '13px', color: 'var(--text-sub)' }}>
              Select firewalls from your inventory to assign to this context. Firewalls already assigned to this context are hidden.
            </p>
            <div style={{ flex: 1, border: '1px solid var(--border-main)', borderRadius: '6px', overflow: 'hidden', display: 'flex', flexDirection: 'column', marginBottom: '20px' }}>
              <DataTable
                columns={inventoryColumns}
                data={assignAvailableDevices}
                searchQuery={assignModalSearchQuery}
                pagination={true}
                selectable={true}
                onSelectionChange={setSelectedAssignDevices}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn-secondary btn-sm" onClick={() => { setIsAssignFirewallsModalOpen(false); setSelectedAssignDevices([]); setIsAssignModalPoppedOut(false); }}>Cancel</button>
              <button
                className="btn-primary btn-sm"
                onClick={handleAssignFirewalls}
                disabled={selectedAssignDevices.length === 0}
              >
                Assign Selected ({selectedAssignDevices.length})
              </button>
            </div>
          </div>
        </NewWindowPortal>
      )}

    </div>
  );
};
