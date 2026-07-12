import React, { useState, useEffect, useMemo } from 'react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { SearchBar } from '../components/SearchBar';
import { SearchableScopeDropdown } from '../components/SearchableScopeDropdown';
import { Dropdown } from '../components/Dropdown';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/ConfirmProvider';
import { VariableResolver } from '../components/VariableResolver';
import { useTemplateHierarchy } from '../hooks/useTemplateHierarchy';
import { useNetworkTabCounts } from '../hooks/useNetworkTabCounts';
import { DataImportWizard } from '../components/DataImportWizard';
import { AlertTriangle, Code, Download, Edit2, Play, Search, Trash2 } from 'lucide-react';
import { ContextMenuItem, ContextMenuDivider, ContextMenuHeader } from '../components/ContextMenu';
import { Network, Loader2, Plus } from 'lucide-react';

const renderVendorBadge = (val: string) => {
  const v = (val || 'paloalto').toLowerCase();
  let bg = 'var(--bg-sub)';
  let color = 'var(--text-main)';
  let text = 'Palo Alto';
  if (v === 'fortinet') { bg = 'rgba(194, 24, 91, 0.1)'; color = '#c2185b'; text = 'Fortinet'; }
  else if (v === 'cisco') { bg = 'rgba(21, 101, 192, 0.1)'; color = '#1565c0'; text = 'Cisco'; }
  else if (v === 'paloalto') { bg = 'rgba(235, 90, 40, 0.1)'; color = '#eb5a28'; text = 'Palo Alto'; }
  return (
    <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, backgroundColor: bg, color: color, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
};

interface InterfacesPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  globalScopeUuid?: string;
  setGlobalScopeUuid?: (val: string) => void;
  globalScopeVendor?: string;
  setGlobalScopeVendor?: (vendor: string) => void;
}

export const InterfacesPage: React.FC<InterfacesPageProps> = ({ auth, addToast, globalScopeUuid, setGlobalScopeUuid, globalScopeVendor, setGlobalScopeVendor }) => {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [interfaces, setInterfaces] = useState<any[]>([]);

  const [templates, setTemplates] = useState<any[]>([]);
  const [templateStacks, setTemplateStacks] = useState<any[]>([]);
  const [templateStackMembers, setTemplateStackMembers] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [firewalls, setFirewalls] = useState<any[]>([]);
  
  const [localScope, setLocalScope] = useState<string>('show-all');
  const sharedScopeUuid = globalScopeUuid || localScope;
  const setSharedScopeUuid = setGlobalScopeUuid || setLocalScope;
  const selectedScopeUuid = sharedScopeUuid;
  const setSelectedScopeUuid = setSharedScopeUuid;
  const [hasValuesMap, setHasValuesMap] = useState<Record<string, boolean>>({});

  // CRUD & selection states
  const confirm = useConfirm();
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInterface, setEditingInterface] = useState<any>(null);

  // CLI Generation states
  const [isCliModalOpen, setIsCliModalOpen] = useState(false);
  const [generatedCliCommands, setGeneratedCliCommands] = useState('');
  const [importWizardOpen, setImportWizardOpen] = useState(false);

  // Form states
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('layer3');
  const [formIP, setFormIP] = useState('');
  const [formZone, setFormZone] = useState('trust');
  const [formVR, setFormVR] = useState('default');
  const [formDescription, setFormDescription] = useState('');

  const apiClient = useMemo(() => (auth ? new CanopyApiClient(auth) : null), [auth]);

  const handleScopeChange = (val: string) => {
    setSharedScopeUuid(val);
    if (setGlobalScopeVendor) {
      if (val === 'show-all') {
        // Default
      } else {
        const fw = firewalls.find(f => f.uuid === val);
        if (fw && fw.vendor) setGlobalScopeVendor(fw.vendor);
        else {
          const t = templates.find(t => t.uuid === val);
          if (t && t.vendor) setGlobalScopeVendor(t.vendor);
          else {
            const ts = templateStacks.find(ts => ts.uuid === val);
            if (ts && ts.vendor) setGlobalScopeVendor(ts.vendor);
          }
        }
      }
    }
  };

  useEffect(() => {
    let isMounted = true;
    const loadScopes = async () => {
      if (!apiClient) return;
      try {
        const data = await apiClient.getHierarchyContext('interfaces');
        
        if (isMounted) {
          setTemplates(data.templates || []);
          setTemplateStacks(data.template_stacks || []);
          setTemplateStackMembers(data.template_stack_members || []);
          setDevices(data.devices || []);
          setHasValuesMap(data.has_values_map || {});
        }
      } catch (err) {
        console.error("Failed to load scopes", err);
      }
    };
    loadScopes();
    return () => { isMounted = false; };
  }, [apiClient]);

  const { hierarchyOptions, scopeNameMap, getVisibleScopes, getScopeLineage, getDevicesForScope, getActiveConfigScope, deviceCounts } = useTemplateHierarchy(templates, templateStacks, devices, templateStackMembers, {
    includeShowAll: true,
    firewallValueKey: 'uuid'
  });

  const lineageScopes = getScopeLineage(selectedScopeUuid);

  useNetworkTabCounts(apiClient, selectedScopeUuid, lineageScopes);

  const fetchInterfaces = async () => {
    if (!apiClient) return;
    try {
      setLoading(true);
      const uuidToQuery = selectedScopeUuid === 'show-all' ? undefined : selectedScopeUuid;
      const res = await apiClient.getNetworksInterfaces(uuidToQuery);
      setInterfaces(res || []);
    } catch (err) {
      console.error('Failed to load interfaces:', err);
      addToast(err instanceof Error ? err.message : 'Failed to query network interfaces.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInterfaces();
    setSelectedRows([]);
  }, [apiClient, selectedScopeUuid]);

  const handleOpenAddInterfaceModal = () => {
    setEditingInterface(null);
    setFormName('');
    setFormType('layer3');
    setFormIP('');
    setFormZone('trust');
    setFormVR('default');
    setFormDescription('');
    setIsModalOpen(true);
  };

  const handleOpenEditInterfaceModal = (iface: any) => {
    setEditingInterface(iface);
    setFormName(iface.name);
    setFormType(iface.type || 'layer3');
    setFormIP(iface.ip_address || '');
    setFormZone(iface.zone || 'trust');
    setFormVR(iface.vr_name || 'default');
    setFormDescription(iface.description || '');
    setIsModalOpen(true);
  };

  const handleSaveInterface = async () => {
    if (!formName.trim()) {
      addToast('Interface name is required', 'error');
      return;
    }
    if (!apiClient) return;
    try {
      const scopeVal = selectedScopeUuid === 'show-all' ? 'paloalto-panorama-global' : selectedScopeUuid;
      const scopeName = scopeNameMap[scopeVal] || scopeVal;
      await apiClient.saveNetworksInterface({
        id: editingInterface ? editingInterface.id : 0,
        device_uuid: scopeVal,
        scope: scopeName,
        name: formName,
        type: formType,
        ip_address: formIP,
        zone: formZone,
        vr_name: formVR,
        description: formDescription
      });
      addToast(`Interface ${editingInterface ? 'updated' : 'created'} successfully`, 'success');
      setIsModalOpen(false);
      fetchInterfaces();
    } catch (err: any) {
      addToast(err.message || 'Failed to save interface', 'error');
    }
  };

  const handleDeleteInterface = (iface: any) => {
    confirm({
      title: 'Delete Network Interface',
      message: `Are you sure you want to delete interface "${iface.name}"?`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: async () => {
        if (!apiClient) return;
        try {
          await apiClient.deleteNetworksInterfacesBatch([iface.id]);
          addToast('Interface deleted successfully', 'success');
          fetchInterfaces();
        } catch (err: any) {
          addToast(err.message || 'Failed to delete interface', 'error');
        }
      }
    });
  };

  const handleBulkDeleteInterfaces = () => {
    if (selectedRows.length === 0) return;
    confirm({
      title: 'Bulk Delete Network Interfaces',
      message: `Are you sure you want to delete ${selectedRows.length} selected network interfaces?`,
      confirmText: 'Delete All',
      isDestructive: true,
      onConfirm: async () => {
        if (!apiClient) return;
        try {
          const ids = selectedRows.map(r => r.id);
          await apiClient.deleteNetworksInterfacesBatch(ids);
          addToast('Selected interfaces deleted successfully', 'success');
          setSelectedRows([]);
          fetchInterfaces();
        } catch (err: any) {
          addToast(err.message || 'Failed to delete interfaces', 'error');
        }
      }
    });
  };

  const handleGenerateCli = async (overrideRows?: any[]) => {
    const rows = overrideRows || (selectedRows.length > 0 ? selectedRows : interfaces);
    if (rows.length === 0) {
      addToast('No records available to generate commands.', 'info');
      return;
    }
    setIsCliModalOpen(true);
    setGeneratedCliCommands('Generating...');
    if (!apiClient) return;
    try {
      const response = await apiClient.generateCliCommands({
        entityType: 'Interfaces',
        entityIds: rows.map(r => r.id),
        scopeUuid: selectedScopeUuid,
        includeNested: false
      });
      setGeneratedCliCommands(response.commands.join('\n') || '# No commands generated.');
    } catch (err: any) {
      addToast(err.message || 'Failed to generate CLI commands', 'error');
      setGeneratedCliCommands('Error generating commands.');
    }
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(generatedCliCommands);
    addToast('Commands copied to clipboard', 'success');
  };

  const columns: ColumnDef[] = useMemo(
    () => [
      { key: 'name', label: 'Interface', width: '200px', renderCell: (val: any, row: any) => <span style={{ fontWeight: 500 }}>{row.name}</span> },
      { key: 'device_uuid', label: 'Context / Scope', width: '250px', renderCell: (val: any) => {
        const hierarchy = getVisibleScopes(val, selectedScopeUuid);
        const activeConfig = getActiveConfigScope(selectedScopeUuid);
        const isDeviceContext = activeConfig !== selectedScopeUuid;
        const isInherited = isDeviceContext && val !== selectedScopeUuid;
        const isOverride = isDeviceContext && val === selectedScopeUuid;
        
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontFamily: 'var(--font-mono, monospace)', fontSize: '11px', lineHeight: '1.2' }}>
            {hierarchy.map((scopeId, idx) => {
              const isLast = idx === hierarchy.length - 1;
              const displayName = scopeNameMap[scopeId] || scopeId;
              const indent = idx * 12;
              return (
                <div key={scopeId} style={{ display: 'flex', alignItems: 'center', paddingLeft: `${indent}px`, gap: '4px' }}>
                  {idx > 0 && <span style={{ color: 'var(--text-muted)', marginRight: '2px' }}>└─</span>}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedScopeUuid(scopeId);
                    }}
                    style={{ cursor: 'pointer', transition: 'opacity 0.15s ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.opacity = '0.8'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; e.currentTarget.style.opacity = '1'; }}
                    title={`Switch active scope to ${displayName}`}
                  >
                    {isLast ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="badge badge-info" style={{ fontWeight: 600, padding: '2px 6px', fontSize: '10px', display: 'inline-block' }}>
                          {displayName}
                        </span>
                        {isInherited && (
                          <span className="badge badge-info" style={{ fontWeight: 600, padding: '2px 6px', fontSize: '10px', display: 'inline-block' }}>Inherited</span>
                        )}
                        {isOverride && (
                          <span className="badge" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-blue)', fontWeight: 600, padding: '2px 6px', fontSize: '10px', display: 'inline-block' }}>Device Override</span>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>{displayName}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        );
      }},
      {
        key: 'vendor',
        label: 'Vendor',
        width: '100px',
        renderCell: (val: any, row: any) => {
          let vendor = 'paloalto';
          const scopeId = row.device_uuid;
          if (scopeId === 'paloalto-panorama-global') {
            vendor = 'paloalto';
          } else if (scopeId && (scopeId.startsWith('fw-') || scopeId.startsWith('paloalto-fw-'))) {
            const serial = scopeId.replace('paloalto-fw-', '').replace('fw-', '');
            const fw = devices.find(f => f.serial === serial || f.uuid === scopeId);
            if (fw && fw.vendor) vendor = fw.vendor;
          } else if (scopeId && scopeId.startsWith('paloalto-stack-')) {
            const st = templateStacks.find(s => s.uuid === scopeId);
            if (st && st.vendor) vendor = st.vendor;
          } else {
            const tmpl = templates.find(t => t.uuid === scopeId);
            if (tmpl && tmpl.vendor) vendor = tmpl.vendor;
          }
          return renderVendorBadge(vendor);
        }
      },
      { key: 'type', label: 'Type', width: '150px' },
      { key: 'ip_address', label: 'IP Address', width: '200px', renderCell: (val: any, row: any) => <VariableResolver raw={row.ip_address} resolved={row.resolved_ip_address} /> },
      { key: 'zone', label: 'Security Zone', width: '150px' },
      { key: 'vr_name', label: 'Virtual Router', width: '150px' },
      { key: 'description', label: 'Description', width: '200px' },
    ],
    [scopeNameMap, getVisibleScopes, templates, templateStacks, devices]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {/* Scope context summary top header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
            {/* Top Row: Dropdown, Lineage, and Search */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', gap: '24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span style={{ width: '95px', display: 'inline-block', fontSize: '12px', fontWeight: 500, color: 'var(--text-main)' }}>Template:</span>
                  <SearchableScopeDropdown
                    value={getActiveConfigScope(selectedScopeUuid)}
                    options={hierarchyOptions}
                    onChange={handleScopeChange}
                    scopeNameMap={scopeNameMap}
                    ruleCounts={deviceCounts}
                    hasValuesMap={hasValuesMap}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, minHeight: '20px' }}>
                    {selectedScopeUuid !== 'show-all' ? (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Scope Context:
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', marginLeft: '4px', whiteSpace: 'nowrap' }}>
                          {(() => {
                            const activeConfig = getActiveConfigScope(selectedScopeUuid);
                            return (
                              <span
                                onClick={() => handleScopeChange(activeConfig)}
                                style={{
                                  color: 'var(--text-muted)',
                                  cursor: 'pointer',
                                  fontWeight: 400,
                                  transition: 'color 0.15s ease',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-main)'; e.currentTarget.style.textDecoration = 'underline'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.textDecoration = 'none'; }}
                                title={`Switch active scope to ${scopeNameMap[activeConfig] || activeConfig}`}
                              >
                                {scopeNameMap[activeConfig] || activeConfig}
                              </span>
                            );
                          })()}
                          {(() => {
                             const activeConfig = getActiveConfigScope(selectedScopeUuid);
                             const availableDevices = getDevicesForScope(activeConfig);
                             if (availableDevices.length > 0) {
                               const isDeviceSelected = selectedScopeUuid !== activeConfig;
                               return (
                                 <React.Fragment>
                                   <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>➔</span>
                                   <Dropdown
                                     value={isDeviceSelected ? selectedScopeUuid : ""}
                                     options={["", ...availableDevices.map(fw => fw.uuid)]}
                                     onChange={(val) => {
                                         if (val) {
                                           setSelectedScopeUuid(val);
                                         } else {
                                           setSelectedScopeUuid(activeConfig);
                                         }
                                     }}
                                     searchable={true}
                                     width="220px"
                                     variant="inline"
                                     renderOption={(opt) => {
                                       if (!opt) return <span style={{ color: 'var(--text-muted)' }}>Device Overrides...</span>;
                                       const fw = availableDevices.find(f => f.uuid === opt);
                                       return (
                                         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                           <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fw ? (fw.name || fw.serial) : opt}</span>
                                           {hasValuesMap[opt] && <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--accent-blue)', flexShrink: 0, marginLeft: '6px' }} title="Has overrides configured" />}
                                         </div>
                                       );
                                     }}
                                   />
                                 </React.Fragment>
                               );
                             }
                             return null;
                          })()}
                        </span>
                      </span>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {selectedScopeUuid === 'show-all' ? 'Viewing combined administrative scopes.' : 'Viewing context: ' + (scopeNameMap[selectedScopeUuid] || selectedScopeUuid)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ width: '300px', flexShrink: 0 }}>
                <SearchBar
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search interfaces..."
                  width="100%"
                  variant="local"
                />
              </div>
            </div>
            <div style={{ height: '1px', backgroundColor: 'var(--border-main)', width: '100%' }} />
          </div>
        </div>

        <div style={{ flex: 1, padding: '0', margin: '0 -30px -30px -30px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)' }}>
              <Loader2 size={24} className="animate-spin" />
              <span style={{ marginLeft: '12px' }}>Loading network interfaces...</span>
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <DataTable
                key={selectedScopeUuid}
                toolbarTitle={
                  <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                    Network Interfaces ({interfaces.length})
                  </h2>
                }
                topRightActions={
                  <button
                    onClick={handleOpenAddInterfaceModal}
                    className="btn-primary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    disabled={selectedScopeUuid === 'show-all'}
                    title={selectedScopeUuid === 'show-all' ? "Select a specific Template context to add interfaces" : "Add Interface"}
                  >
                    <Plus size={14} /> Add Interface
                  </button>
                }
                exportActions={
                  <>
                    <button
                      className="btn-secondary btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start', width: '100%' }}
                      onClick={() => handleGenerateCli()}
                    >
                      <Code size={13} /> Generate CLI
                    </button>
                    <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                    <button
                      className="btn-secondary btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start', width: '100%' }}
                      onClick={() => setImportWizardOpen(true)}
                    >
                      <Download size={13} style={{ color: 'var(--text-muted)' }} /> Import CSV...
                    </button>
                  </>
                }
                bulkActions={
                  selectedRows.length > 0 ? (
                    <button className="btn-danger btn-sm" onClick={handleBulkDeleteInterfaces} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Trash2 size={14} /> Delete Selected ({selectedRows.length})
                    </button>
                  ) : null
                }
                columns={columns}
                data={interfaces}
                searchQuery={searchQuery}
                exportFilename={`canopy_interfaces_${selectedScopeUuid}.csv`}
                pagination={true}
                allowScrollPastEnd={true}
                selectable={true}
                onSelectionChange={setSelectedRows}
                rowContextMenuActions={(row, closeMenu) => {
                  const isInherited = selectedScopeUuid !== 'show-all' && row.device_uuid !== selectedScopeUuid;
                  return (
                    <>
                      <ContextMenuHeader label={row.name} />
                      <ContextMenuItem
                        icon={<Edit2 size={13} />}
                        label="Edit"
                        onClick={() => {
                          closeMenu();
                          handleOpenEditInterfaceModal(row);
                        }}
                        disabled={isInherited}
                      />
                      <ContextMenuDivider />
                      <ContextMenuItem
                        icon={<Code size={13} />}
                        label="Generate CLI"
                        onClick={() => {
                          closeMenu();
                          handleGenerateCli([row]);
                        }}
                      />
                      <ContextMenuDivider />
                      <ContextMenuItem
                        icon={<Trash2 size={13} />}
                        label="Delete"
                        onClick={() => {
                          closeMenu();
                          handleDeleteInterface(row);
                        }}
                        disabled={isInherited}
                        danger
                      />
                    </>
                  );
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Save Interface Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingInterface ? 'Edit Network Interface' : 'Add Network Interface'}
        size="md"
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setIsModalOpen(false)}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleSaveInterface}>Save Interface</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Interface Name</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. ethernet1/1"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Type</label>
            <Dropdown
              value={formType}
              options={['layer3', 'layer2', 'vwire', 'tap', 'tunnel', 'ha']}
              onChange={setFormType}
              width="100%"
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>IP Address</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. 192.168.1.1/24 or $variable_name"
              value={formIP}
              onChange={(e) => setFormIP(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Security Zone</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. trust"
              value={formZone}
              onChange={(e) => setFormZone(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Virtual Router</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. default"
              value={formVR}
              onChange={(e) => setFormVR(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Description</label>
            <textarea
              className="input-text"
              rows={3}
              placeholder="Provide a description..."
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              style={{ resize: 'vertical' }}
            />
          </div>
        </div>
      </Modal>

      {/* Generated CLI Commands Modal */}
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
            {generatedCliCommands}
          </pre>
        </div>
      </Modal>

      <DataImportWizard
        isOpen={importWizardOpen}
        onClose={() => setImportWizardOpen(false)}
        defaultDataType="interfaces"
        apiClient={apiClient}
        deviceUuid={selectedScopeUuid === 'show-all' ? 'paloalto-panorama-global' : selectedScopeUuid}
        scope={selectedScopeUuid === 'show-all' ? 'Shared' : (scopeNameMap[selectedScopeUuid] || selectedScopeUuid)}
        onSuccess={() => {
          addToast('Interfaces imported successfully', 'success');
          fetchInterfaces();
        }}
        availableDataTypes={[{ value: 'interfaces', label: 'Interfaces' }]}
      />
    </div>
  );
};
