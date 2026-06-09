import React, { useState, useEffect, useMemo } from 'react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { SearchBar } from '../components/SearchBar';
import { Tooltip } from '../components/Tooltip';
import { Server, LayoutGrid, Layers, FileText, ChevronRight, ChevronDown, Loader2, Network } from 'lucide-react';

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
}

interface DeviceGroupNode {
  uuid: string;
  name: string;
  parent_uuid: string | null;
}

interface BaseTemplateNode {
  uuid: string;
  name: string;
}

interface TemplateStack {
  id: number;
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
}

const GroupTreeItem: React.FC<GroupTreeItemProps> = ({
  group,
  allGroups,
  selectedGroupId,
  onSelect,
  deviceCounts,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const children = allGroups.filter(g => g.parent_uuid === group.uuid);
  const isSelected = group.uuid === selectedGroupId;
  const hasChildren = children.length > 0;
  const count = deviceCounts[group.uuid] || 0;

  return (
    <div style={{ marginLeft: '12px' }}>
      <div
        onClick={() => onSelect(group.uuid)}
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
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSelected ? 600 : 400 }}>
          {cleanGroupName(group.name)}
        </span>
        {count > 0 && (
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '10px', marginLeft: '6px', border: '1px solid var(--border-main)', fontWeight: 600 }}>
            {count}
          </span>
        )}
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
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Loaded DB data
  const [inventory, setInventory] = useState<ManagedDevice[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<DeviceGroupNode[]>([]);
  const [baseTemplates, setBaseTemplates] = useState<BaseTemplateNode[]>([]);
  const [templateStacks, setTemplateStacks] = useState<TemplateStack[]>([]);
  const [stackMembers, setStackMembers] = useState<TemplateStackMember[]>([]);

  // Selection states
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);

  const apiClient = useMemo(() => (auth ? new CanopyApiClient(auth) : null), [auth]);

  const fetchData = async () => {
    if (!apiClient) return;
    setLoading(true);
    try {
      const [invRes, dgRes, tmplRes, stackRes, membersRes] = await Promise.all([
        apiClient.queryDb('SELECT id, serial, name, ip_address, device_group, template_stack FROM managed_devices ORDER BY name ASC;'),
        apiClient.queryDb("SELECT uuid, name, parent_uuid FROM devices WHERE uuid LIKE 'paloalto-dg-%' ORDER BY name ASC;"),
        apiClient.queryDb("SELECT uuid, name FROM devices WHERE uuid LIKE 'panorama-tmpl-%' ORDER BY name ASC;"),
        apiClient.queryDb('SELECT id, name, device_uuid FROM template_stacks ORDER BY name ASC;'),
        apiClient.queryDb('SELECT stack_id, template_name, sequence FROM template_stack_members ORDER BY stack_id, sequence ASC;'),
      ]);

      setInventory(invRes.rows || []);
      setDeviceGroups(dgRes.rows || []);
      setBaseTemplates(tmplRes.rows || []);
      setTemplateStacks(stackRes.rows || []);
      setStackMembers(membersRes.rows || []);
    } catch (err) {
      console.error('Failed to load Device Management data:', err);
      addToast(err instanceof Error ? err.message : 'Failed to query database.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [apiClient]);

  // Reset selections when sub-tab changes
  useEffect(() => {
    setSelectedGroupId(null);
    setSelectedTemplateId(null);
    setSelectedTemplateName(null);
    setSearchQuery('');
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
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      devs = devs.filter(d => d.name.toLowerCase().includes(q) || d.serial.toLowerCase().includes(q) || (d.ip_address || '').toLowerCase().includes(q));
    }
    return devs;
  }, [selectedGroupDetails, inventory, searchQuery]);

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

  // Device groups tree components helper
  const rootGroups = useMemo(() => {
    return deviceGroups.filter(g => !g.parent_uuid || !deviceGroups.some(p => p.uuid === g.parent_uuid));
  }, [deviceGroups]);

  // Columns definition for full Inventory table
  const inventoryColumns: ColumnDef[] = useMemo(() => [
    { key: 'name', label: 'Device Name' },
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
    }
  ], []);

  const handleSelectTemplate = (id: string, name: string) => {
    setSelectedTemplateId(id);
    setSelectedTemplateName(name);
  };

  if (loading) {
    return (
      <div className="fade-in-delayed" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px', color: 'var(--text-muted)', fontSize: '13px', gap: '15px' }}>
        <Loader2 size={28} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />
        Querying appliance catalog...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      <PageHeader
        title={`Device ${activeSubTab}`}
        description={`Display and audit client ${activeSubTab.toLowerCase()} contexts extracted from the ingested configuration.`}
        actions={
          activeSubTab === 'Inventory' ? (
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search inventory..." variant="local" />
          ) : undefined
        }
      />

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
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <DataTable
                columns={inventoryColumns}
                data={inventory}
                searchQuery={searchQuery}
                exportFilename={`canopy_inventory_${new Date().toISOString().slice(0, 10)}.csv`}
              />
            </div>
          )}

          {/* 2. Device Groups Tree Explorer */}
          {activeSubTab === 'Device Groups' && (
            <div style={{ flex: 1, display: 'flex', gap: '20px', minHeight: 0 }}>
              
              {/* Left Tree Pane */}
              <div style={{
                width: '320px',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-main)',
                borderRadius: '8px',
                padding: '15px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>
                  Hierarchy Tree
                </h3>
                {rootGroups.length === 0 ? (
                  <div style={{ color: 'var(--text-sub)', fontSize: '12px', padding: '10px', textAlign: 'center' }}>No device groups found.</div>
                ) : (
                  rootGroups.map(group => (
                    <GroupTreeItem
                      key={group.uuid}
                      group={group}
                      allGroups={deviceGroups}
                      selectedGroupId={selectedGroupId}
                      onSelect={setSelectedGroupId}
                      deviceCounts={deviceCounts}
                    />
                  ))
                )}
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
                    <div style={{ padding: '20px', borderBottom: '1px solid var(--border-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
                      <div>
                        <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: 'var(--text-main)' }}>
                          {cleanGroupName(selectedGroupDetails.name)}
                        </h4>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Scope: <code>paloalto-dg</code> &bull; Context: <code>{selectedGroupDetails.uuid}</code>
                        </span>
                      </div>
                      <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search members..." variant="local" />
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
                      {devicesInSelectedGroup.length === 0 ? (
                        <div style={{ color: 'var(--text-sub)', fontSize: '13px', padding: '30px', textAlign: 'center', fontStyle: 'italic' }}>
                          No devices assigned directly to this group {searchQuery ? 'matching the filter' : ''}.
                        </div>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid var(--border-main)' }}>
                              <th style={{ padding: '10px', fontSize: '11px', color: 'var(--text-sub)', textTransform: 'uppercase' }}>Device Name</th>
                              <th style={{ padding: '10px', fontSize: '11px', color: 'var(--text-sub)', textTransform: 'uppercase' }}>Serial Number</th>
                              <th style={{ padding: '10px', fontSize: '11px', color: 'var(--text-sub)', textTransform: 'uppercase' }}>Management IP</th>
                              <th style={{ padding: '10px', fontSize: '11px', color: 'var(--text-sub)', textTransform: 'uppercase' }}>Template Stack</th>
                            </tr>
                          </thead>
                          <tbody>
                            {devicesInSelectedGroup.map(dev => (
                              <tr key={dev.id} style={{ borderBottom: '1px solid var(--border-main)' }} className="table-row">
                                <td style={{ padding: '12px 10px', fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>{dev.name}</td>
                                <td style={{ padding: '12px 10px', fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{dev.serial}</td>
                                <td style={{ padding: '12px 10px', fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{dev.ip_address || '-'}</td>
                                <td style={{ padding: '12px 10px', fontSize: '13px', color: 'var(--text-main)' }}>{dev.template_stack ? cleanTemplateName(dev.template_stack) : '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
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
            <div style={{ flex: 1, display: 'flex', gap: '20px', minHeight: 0 }}>
              
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
                  <h3 style={{ margin: '0 0 10px 0', fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>
                    Template Stacks
                  </h3>
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
                  <h3 style={{ margin: '0 0 10px 0', fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>
                    Base Templates
                  </h3>
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
                      <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search members..." variant="local" />
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
  );
};
