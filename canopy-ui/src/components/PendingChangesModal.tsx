import React, { useState } from 'react';
import { X, ChevronDown, ChevronRight, Search, Undo2, HelpCircle } from 'lucide-react';
import { DataTable, ColumnDef } from './DataTable';
import { HighlightedText } from './HighlightedText';
import { CommitHelpModal } from './CommitHelpModal';
import { CanopyApiClient } from '../api/client';
import { useConfirm } from './ConfirmProvider';

interface CommitDetailsModalProps {
  onClose: () => void;
  diffData: any; // The JSON response from /api/workspaces/diff
  onRevert?: (category: string, id: string) => Promise<void>;
  onCommit?: () => void;
  globalScopeVendor?: string;
}

export const PendingChangesModal: React.FC<CommitDetailsModalProps> = ({ onClose, diffData, onRevert, onCommit, globalScopeVendor }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<any>>(new Set());
  const confirm = useConfirm();

  // Flatten diffData into a list of changes
  const changes: any[] = React.useMemo(() => {
    const list: any[] = [];
    const getDisplayName = (item: any, tableName?: string) => {
      if (item?.name) {
        if (typeof item.name === 'string') return item.name;
        return item.name.new || item.name.old || 'Unknown Object';
      }
      
      if (tableName === 'address_group_members') return `Group ${item._group_name || item.group_id?.new || item.group_id || '?'} Member`;
      if (tableName === 'service_group_members') return `Service Group ${item._group_name || item.group_id?.new || item.group_id || '?'} Member`;
      if (tableName === 'application_group_members') return `App Group ${item._group_name || item.group_id?.new || item.group_id || '?'} Member`;
      if (tableName === 'entity_tag_mappings') return `Tag ${item._tag_name || item.tag_id?.new || item.tag_id || '?'} on Entity ${item.entity_id?.new || item.entity_id || '?'}`;
      
      return 'Unknown Object';
    };

  const getVendorName = (item: any) => {
    const uuid = item?.device_uuid || item?.deviceUuid || item?.scope;
    let rawVendor = globalScopeVendor || 'Unknown';
    if (uuid && typeof uuid === 'string') {
      if (uuid.includes('paloalto-')) rawVendor = 'paloalto';
      else if (uuid.includes('fortinet-')) rawVendor = 'fortinet';
      else if (uuid.includes('cisco-')) rawVendor = 'cisco';
      else if (uuid.includes('checkpoint-')) rawVendor = 'checkpoint';
      else if (uuid.includes('juniper-')) rawVendor = 'juniper';
    }
    
    const v = rawVendor.toLowerCase();
    if (v === 'paloalto') return 'Palo Alto';
    if (v === 'fortinet') return 'Fortinet';
    if (v === 'cisco') return 'Cisco';
    if (v === 'checkpoint') return 'Check Point';
    if (v === 'juniper') return 'Juniper';
    return rawVendor;
  };

  const processCategory = (categoryName: string, categoryData: any) => {
    if (!categoryData) return;

    if (['address_group_members', 'service_group_members', 'application_group_members'].includes(categoryName)) {
      const grouped = new Map<number, { added: any[], deleted: any[] }>();
      
      const getGroupId = (item: any) => item.group_id?.new || item.group_id;

      (categoryData.added || []).forEach((item: any) => {
        const gid = getGroupId(item);
        if (!grouped.has(gid)) grouped.set(gid, { added: [], deleted: [] });
        grouped.get(gid)!.added.push(item);
      });

      (categoryData.deleted || []).forEach((item: any) => {
        const gid = getGroupId(item);
        if (!grouped.has(gid)) grouped.set(gid, { added: [], deleted: [] });
        grouped.get(gid)!.deleted.push(item);
      });

      Array.from(grouped.entries()).forEach(([gid, data], idx) => {
        const firstItem = data.added[0] || data.deleted[0];
        const groupName = firstItem?._group_name || `Group ${gid}`;
        const scopeUUID = firstItem?.device_uuid || firstItem?.scope || 'global';
        const vendor = getVendorName(firstItem);
        
        list.push({
          id: `mod_group_members_${categoryName}_${gid}_${idx}`,
          type: 'UPDATE',
          table: categoryName,
          vendor: vendor,
          scope: scopeUUID === 'global' ? 'Global' : scopeUUID,
          name: `${groupName} Members`,
          description: `Updated members for ${groupName} (${data.added.length} added, ${data.deleted.length} removed)`,
          details: { _isAggregated: true, ...data },
          dbId: gid
        });
      });
      return;
    }

    // Added
    (categoryData.added || []).forEach((item: any, idx: number) => {
      const dName = getDisplayName(item, categoryName);
      const vendor = getVendorName(item);
      const scopeUUID = item?.device_uuid || item?.deviceUuid || item?.scope || 'global';
      list.push({
        id: `add_${categoryName}_${dName}_${scopeUUID}_${idx}`,
        type: 'ADD',
        table: categoryName,
        vendor: vendor,
        scope: scopeUUID === 'global' ? 'Global' : scopeUUID,
        name: dName,
        description: `Added ${dName} to ${categoryName}`,
        details: item,
        dbId: item.id
      });
    });

    // Modified
    (categoryData.modified || []).forEach((item: any, idx: number) => {
      const dName = getDisplayName(item, categoryName);
      const vendor = getVendorName(item.new || item);
      const scopeUUID = (item.new || item)?.device_uuid || (item.new || item)?.deviceUuid || (item.new || item)?.scope || 'global';
      list.push({
        id: `mod_${categoryName}_${dName}_${scopeUUID}_${idx}`,
        type: 'UPDATE',
        table: categoryName,
        vendor: vendor,
        scope: scopeUUID === 'global' ? 'Global' : scopeUUID,
        name: dName,
        description: `Modified ${dName} in ${categoryName}`,
        details: item,
        dbId: item.id?.new || item.id || item.id?.old
      });
    });

    // Deleted
    (categoryData.deleted || []).forEach((item: any, idx: number) => {
      const dName = getDisplayName(item, categoryName);
      const vendor = getVendorName(item);
      const scopeUUID = item?.device_uuid || item?.deviceUuid || item?.scope || 'global';
      list.push({
        id: `del_${categoryName}_${dName}_${scopeUUID}_${idx}`,
        type: 'DELETE',
        table: categoryName,
        vendor: vendor,
        scope: scopeUUID === 'global' ? 'Global' : scopeUUID,
        name: dName,
        description: `Deleted ${dName} from ${categoryName}`,
        details: item,
        dbId: item.id
      });
    });
  };

  if (diffData.tables) {
    Object.keys(diffData.tables).forEach(tableName => {
      processCategory(tableName, diffData.tables[tableName]);
    });
  } else {
    if (diffData.address_objects) processCategory('addressObjects', diffData.address_objects);
    if (diffData.address_groups) processCategory('addressGroups', diffData.address_groups);
    if (diffData.services) processCategory('services', diffData.services);
    if (diffData.tags) processCategory('tags', diffData.tags);
  }

  return list;
}, [diffData, globalScopeVendor]);

  const handleRevertAll = async () => {
    if (!onRevert) return;
    confirm({
      title: 'Revert All Changes',
      message: 'Are you sure you want to revert all pending changes in the workspace?',
      confirmText: 'Revert All',
      isDestructive: true,
      onConfirm: async () => {
        try {
          for (const change of changes) {
            await onRevert(change.table, String(change.dbId || change.name));
          }
          window.dispatchEvent(new Event('workspace-committed'));
          onClose();
        } catch (e: any) {
          alert(`Failed to revert all: ${e.message}`);
        }
      }
    });
  };

  const handleBulkRevert = async () => {
    if (!onRevert) return;
    confirm({
      title: 'Revert Selected',
      message: `Are you sure you want to revert the ${selectedRows.length} selected changes?`,
      confirmText: 'Revert',
      isDestructive: true,
      onConfirm: async () => {
        try {
          for (const row of selectedRows) {
            await onRevert(row.table, String(row.dbId || row.name));
          }
          setSelectedRows([]);
        } catch (e: any) {
          alert(`Failed during bulk revert: ${e.message}`);
        }
      }
    });
  };

  const lowerQuery = searchQuery.trim().toLowerCase();
  const filteredChanges = changes.filter((c: any) => 
    (c.name || '').toLowerCase().includes(lowerQuery) || 
    (c.table || '').toLowerCase().includes(lowerQuery) ||
    JSON.stringify(c.details || {}).toLowerCase().includes(lowerQuery)
  );

  React.useEffect(() => {
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      const nextExpanded = new Set(expandedRows);
      let changed = false;
      
      filteredChanges.forEach((c: any) => {
        if (JSON.stringify(c.details || {}).toLowerCase().includes(lowerQuery)) {
          if (!nextExpanded.has(c.id)) {
            nextExpanded.add(c.id);
            changed = true;
          }
        }
      });
      if (changed) {
        setExpandedRows(nextExpanded);
      }
    }
  }, [searchQuery, filteredChanges]);



  const renderBadge = (type: string) => {
    let bg = 'rgba(255,255,255,0.1)';
    let color = '#fff';
    if (type === 'ADD') { bg = 'rgba(16, 185, 129, 0.2)'; color = '#10b981'; }
    if (type === 'UPDATE') { bg = 'rgba(59, 130, 246, 0.2)'; color = '#3b82f6'; }
    if (type === 'DELETE') { bg = 'rgba(239, 68, 68, 0.2)'; color = '#ef4444'; }

    return (
      <span style={{
        backgroundColor: bg,
        color: color,
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 'bold'
      }}>
        {type}
      </span>
    );
  };

  const renderDiffValue = (val: any) => {
    if (Array.isArray(val)) {
      return `[${val.map(v => typeof v === 'object' && v !== null && 'name' in v ? v.name : (typeof v === 'string' ? `"${v}"` : JSON.stringify(v))).join(', ')}]`;
    }
    return JSON.stringify(val);
  };

  const formatKey = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  const formatDiffDetailsForCsv = (change: any) => {
    const skipKeys = [
      'id', 'device_uuid', 'scope', 'dirty', 'created_at', 'updated_at',
      'group_id', 'member_address_id', 'member_group_id', 'member_service_id', 'member_application_id', 'tag_id', 'entity_id', 'entity_type',
      '_group_name'
    ];

    if (!change.details) return '';
    const lines: string[] = [];

    if (change.details._isAggregated) {
      (change.details.added || []).forEach((item: any) => {
        lines.push(`+ Added Member: ${item._member_name || item.member_address_id || item.member_group_id || item.member_service_id || item.member_application_id || '?'}`);
      });
      (change.details.deleted || []).forEach((item: any) => {
        lines.push(`- Removed Member: ${item._member_name || item.member_address_id || item.member_group_id || item.member_service_id || item.member_application_id || '?'}`);
      });
      return lines.join('\n');
    }

    if (change.type === 'ADD') {
      Object.entries(change.details).forEach(([key, val]) => {
        if (val === null || val === '' || skipKeys.includes(key)) return;
        lines.push(`+ ${formatKey(key)}: ${renderDiffValue(val)}`);
      });
    } else if (change.type === 'DELETE') {
      Object.entries(change.details).forEach(([key, val]) => {
        if (val === null || val === '' || skipKeys.includes(key)) return;
        lines.push(`- ${formatKey(key)}: ${renderDiffValue(val)}`);
      });
    } else if (change.type === 'UPDATE') {
      Object.entries(change.details).forEach((entry: any) => {
        const [key, val] = entry;
        if (skipKeys.includes(key)) return;
        if (typeof val !== 'object' || val === null || (!('old' in val) && !('new' in val))) return;
        lines.push(`- ${formatKey(key)}: ${renderDiffValue(val.old)}`);
        lines.push(`+ ${formatKey(key)}: ${renderDiffValue(val.new)}`);
      });
    }

    return lines.join('\n');
  };

  const renderDiffDetails = (change: any) => {
    const skipKeys = [
      'id', 'device_uuid', 'scope', 'dirty', 'created_at', 'updated_at',
      'group_id', 'member_address_id', 'member_group_id', 'member_service_id', 'member_application_id', 'tag_id', 'entity_id', 'entity_type',
      '_group_name'
    ];

    if (change.details?._isAggregated) {
      return (
        <div style={{ backgroundColor: 'var(--bg-main)', padding: '10px', fontSize: '13px', overflowX: 'auto', fontFamily: 'monospace' }}>
          {change.details.added.map((item: any, i: number) => (
             <div key={`add-${i}`} style={{ color: '#10b981' }}>+ Added Member: <HighlightedText text={item._member_name || item.member_address_id || item.member_group_id || item.member_service_id || item.member_application_id || '?'} highlight={searchQuery} /></div>
          ))}
          {change.details.deleted.map((item: any, i: number) => (
             <div key={`del-${i}`} style={{ color: '#ef4444' }}>- Removed Member: <HighlightedText text={item._member_name || item.member_address_id || item.member_group_id || item.member_service_id || item.member_application_id || '?'} highlight={searchQuery} /></div>
          ))}
        </div>
      );
    }

    if (change.type === 'ADD') {
      return (
        <div style={{ backgroundColor: 'var(--bg-main)', padding: '10px', fontSize: '13px', overflowX: 'auto', color: '#10b981', fontFamily: 'monospace' }}>
          {Object.entries(change.details).map(([key, val]) => {
            if (val === null || val === '' || skipKeys.includes(key)) return null;
            return <div key={key}>+ {formatKey(key)}: <HighlightedText text={renderDiffValue(val)} highlight={searchQuery} /></div>;
          })}
        </div>
      );
    }
    if (change.type === 'DELETE') {
      return (
        <div style={{ backgroundColor: 'var(--bg-main)', padding: '10px', fontSize: '13px', overflowX: 'auto', color: '#ef4444', fontFamily: 'monospace' }}>
          {Object.entries(change.details).map(([key, val]) => {
            if (val === null || val === '' || skipKeys.includes(key)) return null;
            return <div key={key}>- {formatKey(key)}: <HighlightedText text={renderDiffValue(val)} highlight={searchQuery} /></div>;
          })}
        </div>
      );
    }
    if (change.type === 'UPDATE') {
      return (
        <div style={{ backgroundColor: 'var(--bg-main)', padding: '10px', fontSize: '13px', overflowX: 'auto' }}>
          {Object.entries(change.details).map((entry: any) => {
            const [key, val] = entry;
            if (skipKeys.includes(key)) return null;
            if (typeof val !== 'object' || val === null || (!('old' in val) && !('new' in val))) return null;
            return (
              <div key={key} style={{ fontFamily: 'monospace', marginBottom: '4px' }}>
                <div style={{ color: '#ef4444' }}>- {formatKey(key)}: <HighlightedText text={renderDiffValue(val.old)} highlight={searchQuery} /></div>
                <div style={{ color: '#10b981' }}>+ {formatKey(key)}: <HighlightedText text={renderDiffValue(val.new)} highlight={searchQuery} /></div>
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.6)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '1200px',
        height: '90vh',
        backgroundColor: 'var(--bg-surface)',
        borderRadius: '8px',
        border: '1px solid var(--border-main)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        resize: 'both',
        minWidth: '600px',
        minHeight: '400px'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-main)', backgroundColor: 'var(--bg-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-main)' }}>
              Pending Changes <span style={{ fontWeight: 600 }}>({changes.length})</span>
            </h3>
            <button 
              onClick={() => setIsHelpOpen(true)}
              title="How does Candidate Config work?"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
            >
              <HelpCircle size={16} />
            </button>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>
        <CommitHelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

        {/* Search */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-main)' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Filter by name, description, or table..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 36px 8px 36px',
                backgroundColor: 'var(--bg-main)',
                border: '1px solid var(--border-main)',
                borderRadius: '6px',
                color: 'var(--text-main)',
                outline: 'none'
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ position: 'absolute', right: '12px', top: '10px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 0 }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Table Body */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <DataTable
            columns={[
              {
                key: 'type',
                label: 'Type',
                width: '110px',
                renderCell: (val: any) => renderBadge(val)
              },
              { key: 'vendor', label: 'Vendor', width: '130px' },
              { key: 'table', label: 'Table', width: '150px' },
              { key: 'scope', label: 'Scope', width: '150px' },
              { key: 'name', label: 'Name', width: '200px' },
              { key: 'description', label: 'Description', allowOverflow: true }
            ]}
            data={filteredChanges}
            searchQuery={searchQuery}
            disableInternalSearch={true}
            expandedRows={expandedRows}
            onExpandedRowsChange={setExpandedRows}
            expandableRowRender={renderDiffDetails}
            pagination={true}
            selectable={true}
            onSelectionChange={setSelectedRows}
            exportFilename="pending_changes.csv"
            additionalExportColumns={[{ header: 'Details', getValue: (row: any) => formatDiffDetailsForCsv(row) }]}
            bulkActions={
              selectedRows.length > 0 && onRevert ? (
                <button 
                  onClick={handleBulkRevert}
                  className="btn-danger btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Undo2 size={14} /> Revert Selected
                </button>
              ) : undefined
            }
            exportActions={
              onRevert ? (
                <>
                  <button
                    onClick={handleRevertAll}
                    className="btn-danger btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', justifyContent: 'flex-start' }}
                    title="Revert all uncommitted changes in the workspace"
                  >
                    <Undo2 size={13} /> Revert All
                  </button>
                  <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '4px 0' }} />
                </>
              ) : undefined
            }
            topRightActions={
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-main)' }} />
                <button
                  className="btn-primary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  onClick={() => alert("Export Package feature coming soon")}
                >
                  Export Package
                </button>
              </div>
            }
          />
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 30px 16px 20px', borderTop: '1px solid var(--border-main)', display: 'flex', justifyContent: 'flex-end', gap: '10px', backgroundColor: 'var(--bg-surface)' }}>
          <button 
            onClick={onClose}
            className="btn-secondary"
          >
            Close
          </button>
          {onCommit && changes.length > 0 && (
            <button
              onClick={onCommit}
              className="btn-primary"
            >
              Commit Changes
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
