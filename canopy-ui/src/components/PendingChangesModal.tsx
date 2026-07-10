import React, { useState } from 'react';
import { X, ChevronDown, ChevronRight, Search, Undo2 } from 'lucide-react';
import { DataTable, ColumnDef } from './DataTable';


interface CommitDetailsModalProps {
  onClose: () => void;
  diffData: any; // The JSON response from /api/workspaces/diff
  onRevert?: (category: string, id: string) => Promise<void>;
  onCommit?: () => void;
  globalScopeVendor?: string;
}

export const PendingChangesModal: React.FC<CommitDetailsModalProps> = ({ onClose, diffData, onRevert, onCommit, globalScopeVendor }) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Flatten diffData into a list of changes
  const changes: any[] = [];
  const getDisplayName = (item: any) => {
    if (!item || !item.name) return 'Unknown Object';
    if (typeof item.name === 'string') return item.name;
    return item.name.new || item.name.old || 'Unknown Object';
  };

  const getVendorName = (item: any) => {
    const uuid = item?.device_uuid || item?.deviceUuid || item?.scope;
    let vendor = globalScopeVendor || 'Unknown';
    if (uuid) {
      if (uuid.includes('paloalto-')) vendor = 'Palo Alto';
      else if (uuid.includes('fortinet-')) vendor = 'Fortinet';
      else if (uuid.includes('cisco-')) vendor = 'Cisco';
      else if (uuid.includes('checkpoint-')) vendor = 'Check Point';
      else if (uuid.includes('juniper-')) vendor = 'Juniper';
    }
    return vendor;
  };

  const processCategory = (categoryName: string, categoryData: any) => {
    if (!categoryData) return;
    
    // Added
    (categoryData.added || []).forEach((item: any) => {
      const dName = getDisplayName(item);
      const vendor = getVendorName(item);
      const scopeUUID = item?.device_uuid || item?.deviceUuid || item?.scope || 'global';
      changes.push({
        id: `add_${categoryName}_${dName}_${scopeUUID}`,
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
    (categoryData.modified || []).forEach((item: any) => {
      const dName = getDisplayName(item);
      const vendor = getVendorName(item.new || item);
      const scopeUUID = (item.new || item)?.device_uuid || (item.new || item)?.deviceUuid || (item.new || item)?.scope || 'global';
      changes.push({
        id: `mod_${categoryName}_${dName}_${scopeUUID}`,
        type: 'UPDATE',
        table: categoryName,
        vendor: vendor,
        scope: scopeUUID === 'global' ? 'Global' : scopeUUID,
        name: dName,
        description: `Updated ${dName} in ${categoryName}`,
        details: item,
        dbId: item.id
      });
    });

    // Deleted
    (categoryData.deleted || []).forEach((item: any) => {
      const dName = getDisplayName(item);
      const vendor = getVendorName(item);
      const scopeUUID = item?.device_uuid || item?.deviceUuid || item?.scope || 'global';
      changes.push({
        id: `del_${categoryName}_${dName}_${scopeUUID}`,
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

  const filteredChanges = changes.filter(c => 
    (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
    (c.table || '').toLowerCase().includes(searchQuery.toLowerCase())
  );



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

  const renderDiffDetails = (change: any) => {
    if (change.type === 'ADD') {
      return (
        <pre style={{ margin: 0, padding: '10px', backgroundColor: 'var(--bg-main)', color: '#10b981', fontSize: '13px', overflowX: 'auto' }}>
          {JSON.stringify(change.details, null, 2).split('\n').map(line => `+ ${line}`).join('\n')}
        </pre>
      );
    }
    if (change.type === 'DELETE') {
      return (
        <pre style={{ margin: 0, padding: '10px', backgroundColor: 'var(--bg-main)', color: '#ef4444', fontSize: '13px', overflowX: 'auto' }}>
          {JSON.stringify(change.details, null, 2).split('\n').map(line => `- ${line}`).join('\n')}
        </pre>
      );
    }
    if (change.type === 'UPDATE') {
      return (
        <div style={{ backgroundColor: 'var(--bg-main)', padding: '10px', fontSize: '13px', overflowX: 'auto' }}>
          {Object.entries(change.details).map(([key, val]: any) => {
            if (key === 'id') return null; // skip internal id
            if (typeof val !== 'object' || val === null || (!('old' in val) && !('new' in val))) return null;
            return (
              <div key={key} style={{ fontFamily: 'monospace' }}>
                <div style={{ color: '#ef4444' }}>- {key}: {renderDiffValue(val.old)}</div>
                <div style={{ color: '#10b981' }}>+ {key}: {renderDiffValue(val.new)}</div>
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
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-main)' }}>
            Pending Changes <span style={{ fontWeight: 600 }}>({changes.length})</span>
          </h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

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
                padding: '8px 12px 8px 36px',
                backgroundColor: 'var(--bg-main)',
                border: '1px solid var(--border-main)',
                borderRadius: '6px',
                color: 'var(--text-main)',
                outline: 'none'
              }}
            />
          </div>
        </div>

        {/* Table Body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <DataTable
            columns={[
              {
                key: 'type',
                label: 'Type',
                width: '100px',
                renderCell: (val: any) => renderBadge(val)
              },
              { key: 'vendor', label: 'Vendor', width: '100px' },
              { key: 'table', label: 'Table', width: '150px' },
              { key: 'scope', label: 'Scope', width: '150px' },
              { key: 'name', label: 'Name', width: '200px' },
              { key: 'description', label: 'Description', allowOverflow: true },
              {
                key: 'actions',
                label: '',
                width: '40px',
                renderCell: (_: any, row: any) => {
                  if (!row.dbId) return null;
                  return (
                    <button 
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (onRevert) {
                          await onRevert(row.table, String(row.dbId));
                        }
                      }}
                      title="Undo this change"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '4px',
                        borderRadius: '4px'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                        e.currentTarget.style.color = 'var(--text-main)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--text-muted)';
                      }}
                    >
                      <Undo2 size={16} />
                    </button>
                  );
                }
              }
            ]}
            data={filteredChanges}
            expandableRowRender={renderDiffDetails}
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
