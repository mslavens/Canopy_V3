import React, { useState, useEffect, useMemo } from 'react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { SearchBar } from '../components/SearchBar';
import { SearchableScopeDropdown } from '../components/SearchableScopeDropdown';
import { Dropdown } from '../components/Dropdown';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/ConfirmProvider';
import { useTemplateHierarchy } from '../hooks/useTemplateHierarchy';
import { useNetworkTabCounts } from '../hooks/useNetworkTabCounts';
import { Network, Loader2, Plus, Edit2, Trash2, Code } from 'lucide-react';

interface ZonesPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  sharedScopeUuid: string;
  setSharedScopeUuid: (val: string) => void;
}

export const ZonesPage: React.FC<ZonesPageProps> = ({ auth, addToast, sharedScopeUuid, setSharedScopeUuid }) => {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [zones, setZones] = useState<any[]>([]);

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
  const [editingZone, setEditingZone] = useState<any>(null);

  // CLI Generation states
  const [isCliModalOpen, setIsCliModalOpen] = useState(false);
  const [generatedCliCommands, setGeneratedCliCommands] = useState('');

  // Form states
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('layer3');
  const [formDescription, setFormDescription] = useState('');

  const apiClient = useMemo(() => (auth ? new CanopyApiClient(auth) : null), [auth]);

  useEffect(() => {
    let isMounted = true;
    const loadScopes = async () => {
      if (!apiClient) return;
      try {
        const data = await apiClient.getHierarchyContext('zones');
        
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

  const fetchZones = async () => {
    if (!apiClient) return;
    try {
      setLoading(true);
      const uuidToQuery = selectedScopeUuid === 'show-all' ? undefined : selectedScopeUuid;
      const res = await apiClient.getNetworksZones(uuidToQuery);
      setZones(res || []);
    } catch (err) {
      console.error('Failed to load zones:', err);
      addToast(err instanceof Error ? err.message : 'Failed to query network zones.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchZones();
    setSelectedRows([]);
  }, [apiClient, selectedScopeUuid]);

  const handleOpenAddZoneModal = () => {
    setEditingZone(null);
    setFormName('');
    setFormType('layer3');
    setFormDescription('');
    setIsModalOpen(true);
  };

  const handleOpenEditZoneModal = (zone: any) => {
    setEditingZone(zone);
    setFormName(zone.name);
    setFormType(zone.type || 'layer3');
    setFormDescription(zone.description || '');
    setIsModalOpen(true);
  };

  const handleSaveZone = async () => {
    if (!formName.trim()) {
      addToast('Zone name is required', 'error');
      return;
    }
    if (!apiClient) return;
    try {
      const scopeVal = selectedScopeUuid === 'show-all' ? 'paloalto-panorama-global' : selectedScopeUuid;
      const scopeName = scopeNameMap[scopeVal] || scopeVal;
      await apiClient.saveNetworksZone({
        id: editingZone ? editingZone.id : 0,
        device_uuid: scopeVal,
        scope: scopeName,
        name: formName,
        type: formType,
        description: formDescription
      });
      addToast(`Zone ${editingZone ? 'updated' : 'created'} successfully`, 'success');
      setIsModalOpen(false);
      fetchZones();
    } catch (err: any) {
      addToast(err.message || 'Failed to save zone', 'error');
    }
  };

  const handleDeleteZone = (zone: any) => {
    confirm({
      title: 'Delete Security Zone',
      message: `Are you sure you want to delete security zone "${zone.name}"?`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: async () => {
        if (!apiClient) return;
        try {
          await apiClient.deleteNetworksZonesBatch([zone.id]);
          addToast('Zone deleted successfully', 'success');
          fetchZones();
        } catch (err: any) {
          addToast(err.message || 'Failed to delete zone', 'error');
        }
      }
    });
  };

  const handleBulkDeleteZones = () => {
    if (selectedRows.length === 0) return;
    confirm({
      title: 'Bulk Delete Security Zones',
      message: `Are you sure you want to delete ${selectedRows.length} selected security zones?`,
      confirmText: 'Delete All',
      isDestructive: true,
      onConfirm: async () => {
        if (!apiClient) return;
        try {
          const ids = selectedRows.map(r => r.id);
          await apiClient.deleteNetworksZonesBatch(ids);
          addToast('Selected zones deleted successfully', 'success');
          setSelectedRows([]);
          fetchZones();
        } catch (err: any) {
          addToast(err.message || 'Failed to delete zones', 'error');
        }
      }
    });
  };

  const handleGenerateCli = async (overrideRows?: any[]) => {
    const rows = overrideRows || (selectedRows.length > 0 ? selectedRows : zones);
    if (rows.length === 0) {
      addToast('No records available to generate commands.', 'info');
      return;
    }
    setIsCliModalOpen(true);
    setGeneratedCliCommands('Generating...');
    if (!apiClient) return;
    try {
      const response = await apiClient.generateCliCommands({
        entityType: 'Zones',
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
      { key: 'name', label: 'Zone Name', width: '250px', renderCell: (val: any, row: any) => <span style={{ fontWeight: 500 }}>{row.name}</span> },
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
      { key: 'type', label: 'Type', width: '150px' },
      { key: 'description', label: 'Description', width: '250px' },
      { key: 'interfaces', label: 'Interfaces', width: '400px', renderCell: (val: any) => val ? val.join(', ') : '' },
    ],
    [scopeNameMap, getVisibleScopes]
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
                  placeholder="Search zones..."
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
              <span style={{ marginLeft: '12px' }}>Loading security zones...</span>
            </div>
          ) : zones.length > 0 ? (
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <DataTable
                key={selectedScopeUuid}
                toolbarTitle={
                  <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-main)' }}>
                    Security Zones ({zones.length})
                  </h2>
                }
                topRightActions={
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => handleGenerateCli()}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      title="Generate CLI commands for zones"
                    >
                      <Code size={14} /> Generate CLI
                    </button>
                    <button
                      onClick={handleOpenAddZoneModal}
                      className="btn-primary btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      disabled={selectedScopeUuid === 'show-all'}
                      title={selectedScopeUuid === 'show-all' ? "Select a specific Template context to add zones" : "Add Zone"}
                    >
                      <Plus size={14} /> Add Zone
                    </button>
                  </div>
                }
                bulkActions={
                  selectedRows.length > 0 ? (
                    <button className="btn-danger btn-sm" onClick={handleBulkDeleteZones} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Trash2 size={14} /> Delete Selected ({selectedRows.length})
                    </button>
                  ) : null
                }
                columns={columns}
                data={zones}
                searchQuery={searchQuery}
                exportFilename={`canopy_zones_${selectedScopeUuid}.csv`}
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
                        onClick={() => {
                          closeMenu();
                          handleGenerateCli([row]);
                        }}
                      >
                        <Code size={13} /> Generate CLI
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start' }}
                        disabled={isInherited}
                        onClick={() => {
                          closeMenu();
                          handleOpenEditZoneModal(row);
                        }}
                      >
                        <Edit2 size={13} /> Edit
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start', color: 'var(--red-500)' }}
                        disabled={isInherited}
                        onClick={() => {
                          closeMenu();
                          handleDeleteZone(row);
                        }}
                      >
                        <Trash2 size={13} style={{ color: 'var(--red-500)' }} /> Delete
                      </button>
                    </>
                  );
                }}
              />
            </div>
          ) : (
            <EmptyState
              icon={<Network size={32} />}
              title="No Zones Found"
              description="No zones found for the selected scope context."
              minHeight="100%"
            />
          )}
        </div>
      </div>

      {/* Save Zone Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingZone ? 'Edit Security Zone' : 'Add Security Zone'}
        size="md"
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setIsModalOpen(false)}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleSaveZone}>Save Zone</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Zone Name</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. untrust"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>Type</label>
            <Dropdown
              value={formType}
              options={['layer3', 'layer2', 'vwire', 'tap', 'tunnel', 'external']}
              onChange={setFormType}
              width="100%"
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
    </div>
  );
};
