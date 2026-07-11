import React, { useState } from 'react';
import { X, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { DataTable, ColumnDef } from './DataTable';
import { Modal } from './Modal';
import { SearchBar } from './SearchBar';

interface CommitDetailsModalProps {
  onClose: () => void;
  diffData: any; // The JSON response from /api/workspaces/diff
}

export const CommitDetailsModal: React.FC<CommitDetailsModalProps> = ({ onClose, diffData }) => {
  const [searchQuery, setSearchQuery] = useState(''); // force reload

  // Flatten diffData into a list of changes
  const changes: any[] = [];
  
  const getDisplayName = (item: any, tableName?: string) => {
    if (item?.name) {
      if (typeof item.name === 'string') return item.name;
      return item.name.new || item.name.old || 'Unknown Object';
    }
    
    if (tableName === 'address_group_members') return `Group ${item.group_id?.new || item.group_id || '?'} Member`;
    if (tableName === 'service_group_members') return `Service Group ${item.group_id?.new || item.group_id || '?'} Member`;
    if (tableName === 'application_group_members') return `App Group ${item.group_id?.new || item.group_id || '?'} Member`;
    if (tableName === 'entity_tag_mappings') return `Tag ${item.tag_id?.new || item.tag_id || '?'} on Entity ${item.entity_id?.new || item.entity_id || '?'}`;
    
    return 'Unknown Object';
  };

  const processCategory = (categoryName: string, categoryData: any) => {
    if (!categoryData) return;
    
    // Added
    (categoryData.added || []).forEach((item: any, idx: number) => {
      const name = getDisplayName(item, categoryName);
      changes.push({
        id: `add_${categoryName}_${name}_${idx}`,
        type: 'ADD',
        table: categoryName,
        name: name,
        description: `Added ${name} to ${categoryName}`,
        details: item
      });
    });

    // Modified
    (categoryData.modified || []).forEach((item: any, idx: number) => {
      const name = getDisplayName(item, categoryName);
      changes.push({
        id: `mod_${categoryName}_${name}_${idx}`,
        type: 'UPDATE',
        table: categoryName,
        name: name,
        description: `Updated ${name} in ${categoryName}`,
        details: item
      });
    });

    // Deleted
    (categoryData.deleted || []).forEach((item: any, idx: number) => {
      const name = getDisplayName(item, categoryName);
      changes.push({
        id: `del_${categoryName}_${name}_${idx}`,
        type: 'DELETE',
        table: categoryName,
        name: name,
        description: `Deleted ${name} from ${categoryName}`,
        details: item
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
            if (key === 'name') return null; // skip name
            return (
              <div key={key} style={{ fontFamily: 'monospace' }}>
                <div style={{ color: '#ef4444' }}>- {key}: {JSON.stringify(val.old)}</div>
                <div style={{ color: '#10b981' }}>+ {key}: {JSON.stringify(val.new)}</div>
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
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Pending Changes (Candidate Config)</h2>
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
                width: '130px',
                renderCell: (val: any) => renderBadge(val)
              },
              { key: 'table', label: 'Table', width: '150px' },
              { key: 'name', label: 'Name', width: '200px' },
              { key: 'description', label: 'Description', allowOverflow: true }
            ]}
            data={filteredChanges}
            expandableRowRender={renderDiffDetails}
            pagination={true}
          />
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 30px 16px 20px', borderTop: '1px solid var(--border-main)', display: 'flex', justifyContent: 'flex-end', backgroundColor: 'var(--bg-surface)' }}>
          <button 
            onClick={onClose}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--bg-hover)',
              border: '1px solid var(--border-main)',
              borderRadius: '6px',
              color: 'var(--text-main)',
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
