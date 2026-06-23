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
import { Server, LayoutGrid, Layers, FileText, ChevronRight, ChevronDown, Loader2, Network, Plus, Edit2, Trash2, ArrowUp, ArrowDown, Copy, MoreHorizontal, ExternalLink } from 'lucide-react';

interface DeviceManagementPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
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
}

const GroupTreeItem: React.FC<GroupTreeItemProps> = ({
  group,
  allGroups,
  selectedGroupId,
  onSelect,
  deviceCounts,
  onContextMenu,
  depth = 0,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const children = allGroups.filter(g => g.parent_uuid === group.uuid);
  const isSelected = group.uuid === selectedGroupId;
  const hasChildren = children.length > 0;
  const count = deviceCounts[group.uuid] || 0;

  return (
    <div style={{ marginLeft: depth > 0 ? '12px' : 0 }}>
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
          padding: '6px 10px',
          borderRadius: '4px',
          cursor: 'pointer',
          backgroundColor: isSelected ? 'var(--bg-element)' : 'var(--bg-surface)',
          borderLeft: isSelected ? '3px solid var(--accent-blue)' : '3px solid transparent',
          color: isSelected ? 'var(--text-main)' : 'var(--text-muted)',
          fontSize: '13px',
          marginBottom: '2px',
          transition: 'all 0.15s ease',
          userSelect: 'none',
          position: 'sticky',
          top: `${depth * 28}px`,
          zIndex: 10 - depth,
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
          {hasChildren ? (
            isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <div style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--text-sub)' }} />
          )}
        </span>
        <Layers size={14} style={{ marginRight: '8px', color: isSelected ? 'var(--accent-purple)' : 'var(--text-sub)', flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSelected ? 600 : 400 }}>
            {cleanGroupName(group.name)}
          </span>
          {count !== undefined && count > 0 && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.5px' }}>
              ({count})
            </span>
          )}
        </div>
      </div>
      {hasChildren && isExpanded && (
        <div style={{ borderLeft: '1px solid var(--border-main)', marginLeft: '7px', paddingLeft: '4px' }}>
          {children.map(child => (
            <GroupTreeItem
              key={child.uuid}
              group={child}
              allGroups={allGroups}
              selectedGroupId={selectedGroupId}
              onSelect={onSelect}
              deviceCounts={deviceCounts}
              onContextMenu={onContextMenu}
              depth={depth + 1}
            />
          ))}
        </div>
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
}

const TemplateStackItem: React.FC<TemplateStackItemProps> = ({
  stack,
  members,
  selectedTemplateId,
  onSelect,
  templateCounts,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const count = templateCounts[stack.name] || 0;
  const isSelected = selectedTemplateId === `stack-${stack.id}`;

  return (
    <div style={{ marginBottom: '4px' }}>
      <div
        onClick={() => onSelect(`stack-${stack.id}`, stack.name)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 10px',
          borderRadius: '4px',
          cursor: 'pointer',
          backgroundColor: isSelected ? 'var(--bg-element)' : 'transparent',
          borderLeft: isSelected ? '3px solid var(--accent-purple)' : '3px solid transparent',
          color: isSelected ? 'var(--text-main)' : 'var(--text-muted)',
          fontSize: '13px',
          transition: 'all 0.15s ease',
          userSelect: 'none',
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
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '10px', marginLeft: '6px', border: '1px solid var(--border-main)', fontWeight: 600 }}>
            {count}
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
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface)', padding: '1px 4px', borderRadius: '8px', marginLeft: '6px' }}>
                    {memberCount}
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
  activeSubTab,
}) => {
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');

  // Loaded DB data
  const [inventory, setInventory] = useState<ManagedDevice[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<ManagedDevice[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<DeviceGroupNode[]>([]);
  const [baseTemplates, setBaseTemplates] = useState<BaseTemplateNode[]>([]);
  const [templateStacks, setTemplateStacks] = useState<TemplateStack[]>([]);
  const [stackMembers, setStackMembers] = useState<TemplateStackMember[]>([]);

  // Selection states
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);

  // Tree Context Menu & Actions Dropdown
  const [treeContextMenu, setTreeContextMenu] = useState<{ x: number; y: number; group: DeviceGroupNode } | null>(null);
  const [isHierarchyDropdownOpen, setIsHierarchyDropdownOpen] = useState(false);
  const [isAssignFirewallsModalOpen, setIsAssignFirewallsModalOpen] = useState(false);
  const [isAssignModalPoppedOut, setIsAssignModalPoppedOut] = useState(false);
  const [selectedAssignDevices, setSelectedAssignDevices] = useState<ManagedDevice[]>([]);
  const hierarchyDropdownRef = React.useRef<HTMLDivElement>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(320);
  const isDragging = useRef(false);

  useEffect(() => {
    const closeTreeMenu = () => setTreeContextMenu(null);
    const handleClickOutsideDropdown = (e: MouseEvent) => {
      if (hierarchyDropdownRef.current && !hierarchyDropdownRef.current.contains(e.target as Node)) {
        setIsHierarchyDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', closeTreeMenu);
    document.addEventListener('mousedown', handleClickOutsideDropdown);
    return () => {
      document.removeEventListener('mousedown', closeTreeMenu);
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

  useEffect(() => {
    fetchData(true);
  }, [apiClient]);

  // Reset selections when sub-tab changes
  useEffect(() => {
    setSelectedGroupId(null);
    setSelectedTemplateId(null);
    setSelectedTemplateName(null);
    setSearchQuery('');
    setMemberSearchQuery('');
  }, [activeSubTab]);

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
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      devs = devs.filter(d => d.name.toLowerCase().includes(q) || d.serial.toLowerCase().includes(q) || (d.ip_address || '').toLowerCase().includes(q));
    }
    return devs;
  }, [selectedTemplateName, inventory, searchQuery]);

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

  const handleAssignFirewalls = async () => {
    if (!apiClient || !selectedGroupId) return;
    try {
      const match = deviceGroups.find(g => g.uuid === selectedGroupId);
      if (!match) throw new Error("Group not found");
      for (const dev of selectedAssignDevices) {
        await apiClient.updateDevice(dev.id, dev.name, dev.serial, dev.ip_address || '', match.id, dev.template_stack_id || null, dev.template_id || null);
      }
      addToast(`Successfully assigned ${selectedAssignDevices.length} firewalls to group.`, 'success');
      setIsAssignFirewallsModalOpen(false);
      setSelectedAssignDevices([]);
      fetchData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Assignment failed', 'error');
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
    setStackTemplateIds([]);
    setIsStackModalOpen(true);
  };

  const handleOpenEditStackModal = (stack: TemplateStack) => {
    setEditingStack(stack);
    setStackName(stack.name);
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
      width: '100px',
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
  const parentGroupList = deviceGroups.filter(g => (!editingGroup || g.id !== editingGroup.id));
  const parentGroupOptions = ['shared (Root)', ...parentGroupList.map(g => cleanGroupName(g.name))];
  const activeParentGroupLabel = groupParentId
    ? cleanGroupName(deviceGroups.find(g => g.id === groupParentId)?.name || '')
    : 'shared (Root)';

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
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-main)',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0
              }}>
                <div style={{ padding: '15px 15px 10px 15px', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ marginBottom: '10px' }}>
                    <h3 style={{ margin: 0, fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>
                      Hierarchy Tree
                    </h3>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', height: '28px' }}>
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
                <div style={{ marginBottom: '0px' }}>
                  <SearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Filter groups..."
                    width="100%"
                    variant="local"
                  />
                </div>
                </div>
                <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%' }} />
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 15px 15px 15px' }}>
                {rootGroups.length === 0 ? (
                  <div style={{ color: 'var(--text-sub)', fontSize: '12px', padding: '10px', textAlign: 'center' }}>No device groups found.</div>
                ) : (
                  rootGroups.map(group => (
                    <GroupTreeItem
                      key={group.uuid}
                      group={group}
                      allGroups={filteredDeviceGroups}
                      selectedGroupId={selectedGroupId}
                      onSelect={setSelectedGroupId}
                      deviceCounts={deviceCounts}
                      onContextMenu={(e, g) => setTreeContextMenu({ x: e.pageX, y: e.pageY, group: g })}
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
                      const newWidth = Math.max(200, Math.min(800, startWidth + (moveEvent.pageX - startX)));
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
                          <h4 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                            {cleanGroupName(selectedGroupDetails.name)}
                          </h4>
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

              {/* Left Tree/Stacks List Pane */}
              <div style={{
                width: '320px',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-main)',
                borderRadius: '8px',
                padding: '15px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '15px'
              }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 10px 0' }}>
                    <h3 style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>
                      Template Stacks
                    </h3>
                    <button
                      className="btn-secondary btn-sm"
                      style={{ padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}
                      onClick={handleOpenAddStackModal}
                    >
                      <Plus size={11} /> Add Stack
                    </button>
                  </div>
                  {templateStacks.length === 0 ? (
                    <div style={{ color: 'var(--text-sub)', fontSize: '12px', padding: '5px' }}>No stacks defined.</div>
                  ) : (
                    templateStacks.map(stack => (
                      <TemplateStackItem
                        key={stack.id}
                        stack={stack}
                        members={stackMembers.filter(m => m.stack_id === stack.id)}
                        selectedTemplateId={selectedTemplateId}
                        onSelect={handleSelectTemplate}
                        templateCounts={templateCounts}
                      />
                    ))
                  )}
                </div>

                <div style={{ borderTop: '1px solid var(--border-main)', paddingTop: '15px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 10px 0' }}>
                    <h3 style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>
                      Base Templates
                    </h3>
                    <button
                      className="btn-secondary btn-sm"
                      style={{ padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}
                      onClick={handleOpenAddTemplateModal}
                    >
                      <Plus size={11} /> Add Template
                    </button>
                  </div>
                  {baseTemplates.length === 0 ? (
                    <div style={{ color: 'var(--text-sub)', fontSize: '12px', padding: '5px' }}>No base templates found.</div>
                  ) : (
                    baseTemplates.map(tmpl => {
                      const count = templateCounts[tmpl.name] || 0;
                      const isSelected = selectedTemplateId === `tmpl-${tmpl.name}`;
                      return (
                        <div
                          key={tmpl.uuid}
                          onClick={() => handleSelectTemplate(`tmpl-${tmpl.name}`, tmpl.name)}
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
                            <span style={{ fontSize: '9px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface)', padding: '2px 5px', borderRadius: '10px', marginLeft: '6px', border: '1px solid var(--border-main)' }}>
                              {count}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Content Pane */}
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
                {selectedTemplateId && selectedTemplateName ? (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                    <div style={{ padding: '20px', borderBottom: '1px solid var(--border-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
                      <div>
                        <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: 'var(--text-main)' }}>
                          {cleanTemplateName(selectedTemplateName)}
                        </h4>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Type: <code>{selectedTemplateId.startsWith('stack-') ? 'Template Stack' : 'Base Template'}</code>
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        {selectedTemplateId.startsWith('stack-') ? (
                          <>
                            <button
                              className="btn-secondary btn-sm"
                              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                              onClick={() => {
                                const stackId = parseInt(selectedTemplateId.slice(6), 10);
                                const stack = templateStacks.find(s => s.id === stackId);
                                if (stack) handleOpenEditStackModal(stack);
                              }}
                            >
                              <Edit2 size={13} /> Edit Stack
                            </button>
                            <button
                              className="btn-danger btn-sm"
                              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                              onClick={() => {
                                const stackId = parseInt(selectedTemplateId.slice(6), 10);
                                const stack = templateStacks.find(s => s.id === stackId);
                                if (stack) handleDeleteStack(stack);
                              }}
                            >
                              <Trash2 size={13} /> Delete Stack
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btn-secondary btn-sm"
                              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                              onClick={() => {
                                const tmpl = baseTemplates.find(t => `tmpl-${t.name}` === selectedTemplateId);
                                if (tmpl) handleOpenEditTemplateModal(tmpl);
                              }}
                            >
                              <Edit2 size={13} /> Edit Template
                            </button>
                            <button
                              className="btn-danger btn-sm"
                              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                              onClick={() => {
                                const tmpl = baseTemplates.find(t => `tmpl-${t.name}` === selectedTemplateId);
                                if (tmpl) handleDeleteTemplate(tmpl);
                              }}
                            >
                              <Trash2 size={13} /> Delete Template
                            </button>
                          </>
                        )}
                        <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search members..." variant="local" />
                      </div>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
                      {devicesInSelectedTemplate.length === 0 ? (
                        <div style={{ color: 'var(--text-sub)', fontSize: '13px', padding: '30px', textAlign: 'center', fontStyle: 'italic' }}>
                          No devices assigned to this template context {searchQuery ? 'matching the filter' : ''}.
                        </div>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid var(--border-main)' }}>
                              <th style={{ padding: '10px', fontSize: '11px', color: 'var(--text-sub)', textTransform: 'uppercase' }}>Device Name</th>
                              <th style={{ padding: '10px', fontSize: '11px', color: 'var(--text-sub)', textTransform: 'uppercase' }}>Serial Number</th>
                              <th style={{ padding: '10px', fontSize: '11px', color: 'var(--text-sub)', textTransform: 'uppercase' }}>Management IP</th>
                              <th style={{ padding: '10px', fontSize: '11px', color: 'var(--text-sub)', textTransform: 'uppercase' }}>Device Group</th>
                            </tr>
                          </thead>
                          <tbody>
                            {devicesInSelectedTemplate.map(dev => (
                              <tr key={dev.id} style={{ borderBottom: '1px solid var(--border-main)' }} className="table-row">
                                <td style={{ padding: '12px 10px', fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>{dev.name}</td>
                                <td style={{ padding: '12px 10px', fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{dev.serial}</td>
                                <td style={{ padding: '12px 10px', fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{dev.ip_address || '-'}</td>
                                <td style={{ padding: '12px 10px', fontSize: '13px', color: 'var(--text-main)' }}>{dev.device_group ? cleanGroupName(dev.device_group) : '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Layers size={32} />}
                    title="Select a Template Context"
                    description="Choose a template or template stack from the list on the left to inspect its assigned firewalls."
                    minHeight="100%"
                  />
                )}
              </div>
            </div>
          )}

        </div>
      )}

      </div>
      {/* --- MODALS --- */}

      {/* 1. Device (Firewall) Modal */}
      <Modal
        isOpen={isDeviceModalOpen}
        onClose={() => setIsDeviceModalOpen(false)}
        title={editingDevice ? 'Edit Firewall Configuration' : 'Register Managed Firewall'}
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
                if (val === 'shared (Root)') {
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
          title="Assign Firewalls to Group"
          size="lg"
          headerActions={
            <Tooltip content="Pop Out to New Window" align="center">
              <button 
                onClick={() => setIsAssignModalPoppedOut(true)} 
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', height: '400px' }}>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-sub)' }}>
              Select firewalls from your inventory to assign to <strong style={{ color: 'var(--text-main)' }}>{selectedGroupDetails ? cleanGroupName(selectedGroupDetails.name) : ''}</strong>. 
              Firewalls already assigned to this group are hidden.
            </p>
            <div style={{ flex: 1, border: '1px solid var(--border-main)', borderRadius: '6px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <DataTable
                columns={inventoryColumns}
                data={inventory.filter(d => d.device_group_id !== (selectedGroupDetails?.id || -1))}
                searchQuery=""
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
          title={`Assign Firewalls - ${selectedGroupDetails ? cleanGroupName(selectedGroupDetails.name) : ''}`} 
          onClose={() => { setIsAssignFirewallsModalOpen(false); setSelectedAssignDevices([]); setIsAssignModalPoppedOut(false); }}
        >
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box' }}>
            <h2 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>Assign Firewalls to {selectedGroupDetails ? cleanGroupName(selectedGroupDetails.name) : ''}</h2>
            <p style={{ margin: '0 0 15px 0', fontSize: '13px', color: 'var(--text-sub)' }}>
              Select firewalls from your inventory to assign to this group. Firewalls already assigned to this group are hidden.
            </p>
            <div style={{ flex: 1, border: '1px solid var(--border-main)', borderRadius: '6px', overflow: 'hidden', display: 'flex', flexDirection: 'column', marginBottom: '20px' }}>
              <DataTable
                columns={inventoryColumns}
                data={inventory.filter(d => d.device_group_id !== (selectedGroupDetails?.id || -1))}
                searchQuery=""
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
