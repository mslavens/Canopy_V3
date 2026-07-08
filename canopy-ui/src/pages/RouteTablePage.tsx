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
import { Map, Loader2, Plus, Edit2, Trash2, Code, Download } from 'lucide-react';

const renderVendorBadge = (val: string) => {
  const v = (val || 'paloalto').toLowerCase();
  let bg = 'var(--bg-sub)';
  let color = 'var(--text-main)';
  let text = 'Palo Alto';
  if (v === 'fortinet') { bg = 'rgba(194, 24, 91, 0.1)'; color = '#c2185b'; text = 'Fortinet'; }
  else if (v === 'cisco') { bg = 'rgba(21, 101, 192, 0.1)'; color = '#1565c0'; text = 'Cisco'; }
  else if (v === 'vmware') { bg = 'rgba(46, 125, 50, 0.1)'; color = '#2e7d32'; text = 'VMware'; }
  else if (v === 'paloalto') { bg = 'rgba(235, 90, 40, 0.1)'; color = '#eb5a28'; text = 'Palo Alto'; }
  return (
    <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, backgroundColor: bg, color: color, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
};

interface RouteTablePageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  sharedScopeUuid: string;
  setSharedScopeUuid: (val: string) => void;
}

export const RouteTablePage: React.FC<RouteTablePageProps> = ({ auth, addToast, sharedScopeUuid, setSharedScopeUuid }) => {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [routes, setRoutes] = useState<any[]>([]);

  const [templates, setTemplates] = useState<any[]>([]);
  const [templateStacks, setTemplateStacks] = useState<any[]>([]);
  const [templateStackMembers, setTemplateStackMembers] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const selectedScopeUuid = sharedScopeUuid;
  const setSelectedScopeUuid = setSharedScopeUuid;
  const [hasValuesMap, setHasValuesMap] = useState<Record<string, boolean>>({});

  // CRUD & selection states
  const confirm = useConfirm();
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<any>(null);

  // CLI Generation states
  const [isCliModalOpen, setIsCliModalOpen] = useState(false);
  const [generatedCliCommands, setGeneratedCliCommands] = useState('');
  const [importWizardOpen, setImportWizardOpen] = useState(false);

  // Form states
  const [formRouteName, setFormRouteName] = useState('');
  const [formVRName, setFormVRName] = useState('default');
  const [formDestination, setFormDestination] = useState('');
  const [formNextHop, setFormNextHop] = useState('');
  const [formInterface, setFormInterface] = useState('');
  const [formMetric, setFormMetric] = useState(10);

  const apiClient = useMemo(() => (auth ? new CanopyApiClient(auth) : null), [auth]);

  useEffect(() => {
    let isMounted = true;
    const loadScopes = async () => {
      if (!apiClient) return;
      try {
        const data = await apiClient.getHierarchyContext('static_routes');
        
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

  const fetchRoutes = async () => {
    if (!apiClient) return;
    try {
      setLoading(true);
      const uuidToQuery = selectedScopeUuid === 'show-all' ? undefined : selectedScopeUuid;
      const res = await apiClient.getNetworksRoutes(uuidToQuery);
      setRoutes(res || []);
    } catch (err) {
      console.error('Failed to load routes:', err);
      addToast(err instanceof Error ? err.message : 'Failed to query routing tables.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoutes();
    setSelectedRows([]);
  }, [apiClient, selectedScopeUuid]);

  const handleOpenAddRouteModal = () => {
    setEditingRoute(null);
    setFormRouteName('');
    setFormVRName('default');
    setFormDestination('');
    setFormNextHop('');
    setFormInterface('');
    setFormMetric(10);
    setIsModalOpen(true);
  };

  const handleOpenEditRouteModal = (rt: any) => {
    setEditingRoute(rt);
    setFormRouteName(rt.route_name);
    setFormVRName(rt.vr_name || 'default');
    setFormDestination(rt.destination || '');
    setFormNextHop(rt.nexthop || '');
    setFormInterface(rt.interface || '');
    setFormMetric(rt.metric || 10);
    setIsModalOpen(true);
  };

  const handleSaveRoute = async () => {
    if (!formRouteName.trim()) {
      addToast('Route name is required', 'error');
      return;
    }
    if (!formDestination.trim()) {
      addToast('Destination CIDR is required', 'error');
      return;
    }
    if (!apiClient) return;
    try {
      const scopeVal = selectedScopeUuid === 'show-all' ? 'paloalto-panorama-global' : selectedScopeUuid;
      await apiClient.saveNetworksRoute({
        id: editingRoute ? editingRoute.id : 0,
        device_uuid: scopeVal,
        vr_name: formVRName,
        route_name: formRouteName,
        destination: formDestination,
        nexthop: formNextHop,
        interface: formInterface,
        metric: Number(formMetric) || 10
      });
      addToast(`Static route ${editingRoute ? 'updated' : 'created'} successfully`, 'success');
      setIsModalOpen(false);
      fetchRoutes();
    } catch (err: any) {
      addToast(err.message || 'Failed to save static route', 'error');
    }
  };

  const handleDeleteRoute = (rt: any) => {
    confirm({
      title: 'Delete Static Route',
      message: `Are you sure you want to delete static route "${rt.route_name}"?`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: async () => {
        if (!apiClient) return;
        try {
          await apiClient.deleteNetworksRoutesBatch([rt.id]);
          addToast('Static route deleted successfully', 'success');
          fetchRoutes();
        } catch (err: any) {
          addToast(err.message || 'Failed to delete route', 'error');
        }
      }
    });
  };

  const handleBulkDeleteRoutes = () => {
    if (selectedRows.length === 0) return;
    confirm({
      title: 'Bulk Delete Static Routes',
      message: `Are you sure you want to delete ${selectedRows.length} selected static routes?`,
      confirmText: 'Delete All',
      isDestructive: true,
      onConfirm: async () => {
        if (!apiClient) return;
        try {
          const ids = selectedRows.map(r => r.id);
          await apiClient.deleteNetworksRoutesBatch(ids);
          addToast('Selected static routes deleted successfully', 'success');
          setSelectedRows([]);
          fetchRoutes();
        } catch (err: any) {
          addToast(err.message || 'Failed to delete routes', 'error');
        }
      }
    });
  };

  const handleGenerateCli = async (overrideRows?: any[]) => {
    const rows = overrideRows || (selectedRows.length > 0 ? selectedRows : routes);
    if (rows.length === 0) {
      addToast('No records available to generate commands.', 'info');
      return;
    }
    setIsCliModalOpen(true);
    setGeneratedCliCommands('Generating...');
    if (!apiClient) return;
    try {
      const response = await apiClient.generateCliCommands({
        entityType: 'Route Table',
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
      { key: 'route_name', label: 'Name', width: '200px', renderCell: (val: any, row: any) => <span style={{ fontWeight: 500 }}>{row.route_name}</span> },
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
      { key: 'vr_name', label: 'Virtual Router', width: '150px' },
      { key: 'destination', label: 'Destination', width: '200px', renderCell: (val: any, row: any) => <VariableResolver raw={row.destination} resolved={row.resolved_destination} /> },
      { key: 'nexthop', label: 'Next Hop', width: '180px', renderCell: (val: any, row: any) => <VariableResolver raw={row.nexthop} resolved={row.resolved_nexthop} /> },
      { key: 'interface', label: 'Interface', width: '150px' },
      { key: 'metric', label: 'Metric', width: '100px' },
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
                    onChange={setSelectedScopeUuid}
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
                                onClick={() => setSelectedScopeUuid(activeConfig)}
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
                  placeholder="Search routes..."
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
              <span style={{ marginLeft: '12px' }}>Loading static routes...</span>
            </div>
          ) : routes.length > 0 ? (
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <DataTable
                key={selectedScopeUuid}
                toolbarTitle={
                  <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                    Routing Tables ({routes.length})
                  </h2>
                }
                topRightActions={
                  <button
                    onClick={handleOpenAddRouteModal}
                    className="btn-primary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    disabled={selectedScopeUuid === 'show-all'}
                    title={selectedScopeUuid === 'show-all' ? "Select a specific Template context to add routes" : "Add Route"}
                  >
                    <Plus size={14} /> Add Route
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
                    <button className="btn-danger btn-sm" onClick={handleBulkDeleteRoutes} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Trash2 size={14} /> Delete Selected ({selectedRows.length})
                    </button>
                  ) : null
                }
                columns={columns}
                data={routes}
                searchQuery={searchQuery}
                exportFilename={`canopy_routes_${selectedScopeUuid}.csv`}
                pagination={true}
                allowScrollPastEnd={true}
                selectable={true}
                onSelectionChange={setSelectedRows}
                rowContextMenuActions={(row, closeMenu) => {
                  const isInherited = selectedScopeUuid !== 'show-all' && row.device_uuid !== selectedScopeUuid;
                  return (
                    <>
                      <button
                        className="btn-secondary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start' }}
                        disabled={isInherited}
                        onClick={() => {
                          closeMenu();
                          handleOpenEditRouteModal(row);
                        }}
                      >
                        <Edit2 size={13} /> Edit
                      </button>

                      <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />

                      <button
                        className="btn-secondary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start' }}
                        onClick={() => {
                          closeMenu();
                          handleGenerateCli([row]);
                        }}
                      >
                        <Code size={13} /> Generate CLI
                      </button>

                      <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />

                      <button
                        className="btn-secondary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start', color: 'var(--status-red)' }}
                        disabled={isInherited}
                        onClick={() => {
                          closeMenu();
                          handleDeleteRoute(row);
                        }}
                      >
                        <Trash2 size={13} style={{ color: 'var(--status-red)' }} /> Delete
                      </button>
                    </>
                  );
                }}
              />
            </div>
          ) : (
            <EmptyState
              icon={<Map size={32} />}
              title="No Routes Found"
              description="No static routes found for the selected scope context."
              minHeight="100%"
            />
          )}
        </div>
      </div>

      {/* Save Route Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingRoute ? 'Edit Static Route' : 'Add Static Route'}
        size="md"
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setIsModalOpen(false)}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleSaveRoute}>Save Route</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Route Name</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. default-route"
              value={formRouteName}
              onChange={(e) => setFormRouteName(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Virtual Router</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. default"
              value={formVRName}
              onChange={(e) => setFormVRName(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Destination Network (CIDR)</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. 0.0.0.0/0 or $destination_variable"
              value={formDestination}
              onChange={(e) => setFormDestination(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Next Hop (IP Address)</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. 10.0.0.1 or $nexthop_variable"
              value={formNextHop}
              onChange={(e) => setFormNextHop(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Interface</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. ethernet1/1"
              value={formInterface}
              onChange={(e) => setFormInterface(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Metric</label>
            <input
              type="number"
              className="input-text"
              value={formMetric}
              onChange={(e) => setFormMetric(Number(e.target.value))}
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
        defaultDataType="static_routes"
        apiClient={apiClient}
        deviceUuid={selectedScopeUuid === 'show-all' ? 'paloalto-panorama-global' : selectedScopeUuid}
        scope={selectedScopeUuid === 'show-all' ? 'Shared' : (scopeNameMap[selectedScopeUuid] || selectedScopeUuid)}
        onSuccess={() => {
          addToast('Static routes imported successfully', 'success');
          fetchRoutes();
        }}
        availableDataTypes={[{ value: 'static_routes', label: 'Static Routes' }]}
      />
    </div>
  );
};
