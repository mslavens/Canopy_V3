import React, { useState } from 'react';
import { X, ChevronDown, ChevronRight, Search } from 'lucide-react';

interface CommitDetailsModalProps {
  onClose: () => void;
  diffData: any; // The JSON response from /api/workspaces/diff
}

export const PendingChangesModal: React.FC<CommitDetailsModalProps> = ({ onClose, diffData }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Flatten diffData into a list of changes
  const changes: any[] = [];
  const getDisplayName = (item: any) => {
    if (!item || !item.name) return 'Unknown Object';
    if (typeof item.name === 'string') return item.name;
    return item.name.new || item.name.old || 'Unknown Object';
  };

  const processCategory = (categoryName: string, categoryData: any) => {
    if (!categoryData) return;
    
    // Added
    (categoryData.added || []).forEach((item: any) => {
      const dName = getDisplayName(item);
      changes.push({
        id: `add_${categoryName}_${dName}`,
        type: 'ADD',
        table: categoryName,
        name: dName,
        description: `Added ${dName} to ${categoryName}`,
        details: item
      });
    });

    // Modified
    (categoryData.modified || []).forEach((item: any) => {
      const dName = getDisplayName(item);
      changes.push({
        id: `mod_${categoryName}_${dName}`,
        type: 'UPDATE',
        table: categoryName,
        name: dName,
        description: `Updated ${dName} in ${categoryName}`,
        details: item
      });
    });

    // Deleted
    (categoryData.deleted || []).forEach((item: any) => {
      const dName = getDisplayName(item);
      changes.push({
        id: `del_${categoryName}_${dName}`,
        type: 'DELETE',
        table: categoryName,
        name: dName,
        description: `Deleted ${dName} from ${categoryName}`,
        details: item
      });
    });
  };

  processCategory('addressObjects', diffData.address_objects);
  processCategory('addressGroups', diffData.address_groups);
  processCategory('services', diffData.services);
  processCategory('tags', diffData.tags);

  const filteredChanges = changes.filter(c => 
    (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
    (c.table || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) newExpanded.delete(id);
    else newExpanded.add(id);
    setExpandedRows(newExpanded);
  };

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
            if (key === 'id') return null; // skip internal id
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
        overflow: 'hidden'
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

        {/* Table Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '40px 100px 150px 1fr 1fr', padding: '12px 20px', borderBottom: '1px solid var(--border-main)', fontWeight: 600, color: 'var(--text-muted)', fontSize: '13px' }}>
          <div></div>
          <div>Type</div>
          <div>Table</div>
          <div>Name</div>
          <div>Description</div>
        </div>

        {/* Table Body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredChanges.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
              No pending changes found.
            </div>
          ) : (
            filteredChanges.map(change => (
              <React.Fragment key={change.id}>
                <div 
                  onClick={() => toggleRow(change.id)}
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '40px 100px 150px 1fr 1fr', 
                    padding: '12px 20px', 
                    borderBottom: '1px solid var(--border-main)',
                    alignItems: 'center',
                    cursor: 'pointer',
                    backgroundColor: expandedRows.has(change.id) ? 'rgba(255,255,255,0.02)' : 'transparent',
                    fontSize: '14px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = expandedRows.has(change.id) ? 'rgba(255,255,255,0.02)' : 'transparent'}
                >
                  <div style={{ color: 'var(--text-muted)' }}>
                    {expandedRows.has(change.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                  <div>{renderBadge(change.type)}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{change.table}</div>
                  <div style={{ fontWeight: 500 }}>{change.name}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{change.description}</div>
                </div>
                {expandedRows.has(change.id) && (
                  <div style={{ borderBottom: '1px solid var(--border-main)' }}>
                    {renderDiffDetails(change)}
                  </div>
                )}
              </React.Fragment>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-main)', display: 'flex', justifyContent: 'flex-end' }}>
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
