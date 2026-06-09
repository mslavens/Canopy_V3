import React, { useState } from 'react';
import { Dropdown } from '../components/Dropdown';
import { Checkbox } from '../components/Checkbox';
import { Modal } from '../components/Modal';
import { SearchBar } from '../components/SearchBar';
import { DataTable, ColumnDef } from '../components/DataTable';
import { AlertTriangle, Info, ChevronUp, ChevronDown, FolderOpen } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { Tooltip } from '../components/Tooltip';
import { PageHeader } from '../components/PageHeader';

export const DesignSystemPage: React.FC = () => {
  const [dropdownValue, setDropdownValue] = useState('Option 1');
  const [isChecked, setIsChecked] = useState(true);
  const [stepperValue, setStepperValue] = useState('15');
  const [filterQuery, setFilterQuery] = useState('');
  const [findQuery, setFindQuery] = useState('error');
  const [activeModalSize, setActiveModalSize] = useState<'sm' | 'md' | 'lg' | null>(null);

  const handleIncrement = () => {
    const current = parseInt(stepperValue, 10) || 0;
    setStepperValue((current + 1).toString());
  };

  const handleDecrement = () => {
    const current = parseInt(stepperValue, 10) || 0;
    if (current > 0) {
      setStepperValue((current - 1).toString());
    }
  };

  const dsColumns: ColumnDef[] = [
    { key: 'col1', label: 'Column 1' },
    { key: 'col2', label: 'Column 2' },
    { key: 'col3', label: 'Column 3' },
  ];
  const dsData = [1, 2, 3, 4, 5].map(row => ({
    col1: `Data ${row}.1`, col2: `Data ${row}.2`, col3: `Data ${row}.3`
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', maxWidth: '1200px' }}>
      <PageHeader 
        title="Design System & Components" 
        description="A living reference for Canopy's semantic UI tokens and reusable components." 
      />

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
        <h3 style={{ margin: '0 0 20px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>Tooltips & Micro-Context</h3>
        <p style={{ margin: '0 0 15px 0', fontSize: '13px', color: 'var(--text-muted)' }}>Hover over the elements below to view the standardized <code>&lt;Tooltip /&gt;</code> wrappers.</p>
        <div style={{ display: 'flex', gap: '30px', alignItems: 'center' }}>
          <Tooltip content="Default (Center Bottom)">
            <span style={{ fontSize: '13px', color: 'var(--text-main)', textDecoration: 'underline', cursor: 'help' }}>Hover me</span>
          </Tooltip>
          <Tooltip content="Align Right" align="right">
            <button className="btn-secondary btn-sm">Right Aligned</button>
          </Tooltip>
          <Tooltip content="Top Position" position="top">
            <button className="btn-secondary btn-sm">Top Position</button>
          </Tooltip>
        </div>
      </section>

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
        <h3 style={{ margin: '0 0 20px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>Standard Buttons</h3>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '20px' }}>
          <button className="btn-primary">Primary Button</button>
          <button className="btn-secondary">Secondary Button</button>
          <button className="btn-danger">Danger Button</button>
          <button className="btn-success">Success Button</button>
        </div>
        
        <h3 style={{ margin: '30px 0 15px 0', fontSize: '13px', color: 'var(--text-main)' }}>Disabled States</h3>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '20px' }}>
          <button className="btn-primary" disabled>Primary Disabled</button>
          <button className="btn-danger" disabled>Danger Disabled</button>
        </div>

        <h3 style={{ margin: '30px 0 15px 0', fontSize: '13px', color: 'var(--text-main)' }}>Size Modifiers (.btn-sm)</h3>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <button className="btn-primary btn-sm">Primary Small</button>
          <button className="btn-secondary btn-sm">Secondary Small</button>
        </div>
      </section>

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
        <h3 style={{ margin: '0 0 20px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>Standard Empty States</h3>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-muted)' }}>Use the <code>&lt;EmptyState /&gt;</code> component for empty data grids, lists, or unconfigured settings.</p>
        <div style={{ border: '1px dashed var(--border-main)', borderRadius: '4px', backgroundColor: 'var(--bg-app)' }}>
          <EmptyState 
            icon={<FolderOpen size={32} />}
            title="No projects found"
            description="Get started by creating a new project or importing an existing repository."
            action={<button className="btn-primary btn-sm">Create Project</button>}
          />
        </div>
      </section>

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
        <h3 style={{ margin: '0 0 20px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>Search & Filtering</h3>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-muted)' }}>Canopy uses three distinct search paradigms depending on the context of the data being queried.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
          <div>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--text-main)' }}>1. Global Command Palette</h4>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>Used exclusively in the main header. Triggers a dropdown overlay and navigates the user across the app. Associated with the <code>Cmd/Ctrl+K</code> shortcut.</p>
            <SearchBar value="" onChange={() => {}} placeholder="Search (Cmd+K)" variant="global" />
          </div>
          <div style={{ height: '1px', backgroundColor: 'var(--border-main)' }} />
          <div>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--text-main)' }}>2. List Filter (Data Grids)</h4>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>Used above data tables (Database Browser, Audit Logs) and lists (System Logs). Instantly hides non-matching rows. Does not use arrows or counts because the condensed data is immediately visible.</p>
            <SearchBar value={filterQuery} onChange={setFilterQuery} placeholder="Filter results..." variant="local" />
          </div>
          <div style={{ height: '1px', backgroundColor: 'var(--border-main)' }} />
          <div>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--text-main)' }}>3. Document Find</h4>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>Used for large static documents (Help Handbook, Changelog). Preserves surrounding text context and allows jumping between matches using Enter/Arrows. Associated with the <code>Cmd/Ctrl+F</code> shortcut.</p>
            <SearchBar value={findQuery} onChange={setFindQuery} placeholder="Find in document..." variant="local" matchCount={5} currentMatch={1} />
          </div>
        </div>
      </section>

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
        <h3 style={{ margin: '0 0 20px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>Typography</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Heading 1 (20px, Semi-Bold)</h1>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Used for main page titles and primary screen anchors.</div>
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Heading 2 (18px, Semi-Bold)</h2>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Used for major section headers within a page.</div>
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--accent-blue)', fontWeight: 500 }}>Heading 3 (15px, Accent)</h3>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Used for cards, modules, and internal grouping titles.</div>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-main)', lineHeight: 1.5 }}>Body Text (13px, Regular). This is the standard font size for paragraph text, form labels, and data table content across the application. It gracefully falls back to the native OS system font.</p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>Muted Text (12px, Regular). Used for helper text, sub-labels, and secondary information.</p>
          </div>
          <div>
            <code style={{ fontSize: '12px', fontFamily: 'monospace', backgroundColor: 'var(--bg-element)', padding: '2px 6px', borderRadius: '4px' }}>Monospace Code (12px)</code>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '10px' }}>Used for IP addresses, IDs, and raw configurations.</span>
          </div>
        </div>
      </section>

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
        <h3 style={{ margin: '0 0 20px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>Status & Feedback Banners</h3>
        <p style={{ margin: '0 0 15px 0', fontSize: '13px', color: 'var(--text-muted)' }}>Standardized contextual banners for system alerts and inline messaging.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', maxWidth: '600px' }}>
          <div style={{ backgroundColor: 'var(--bg-app)', borderLeft: '4px solid var(--status-red)', padding: '12px 15px', borderRadius: '4px', color: 'var(--status-red)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span><strong>System Fault:</strong> Critical error state or destructive warning.</span>
          </div>
          <div style={{ backgroundColor: 'var(--bg-app)', borderLeft: '4px solid var(--status-warn)', padding: '12px 15px', borderRadius: '4px', color: 'var(--text-main)', fontSize: '13px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, color: 'var(--status-warn)', marginTop: '2px' }} />
            <div>
              <strong style={{ display: 'block', marginBottom: '4px' }}>Action Required:</strong>
              <span style={{ color: 'var(--text-muted)' }}>Non-blocking warning or important prerequisite information.</span>
            </div>
          </div>
          <div style={{ backgroundColor: 'var(--bg-app)', borderLeft: '4px solid var(--accent-blue)', padding: '12px 15px', borderRadius: '4px', color: 'var(--text-main)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Info size={14} style={{ flexShrink: 0, color: 'var(--accent-blue)' }} />
            <span style={{ color: 'var(--text-muted)' }}>Informational context or neutral feedback.</span>
          </div>
        </div>
      </section>

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
        <h3 style={{ margin: '0 0 20px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>Data Tables & Grids</h3>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-muted)' }}>Tables must implement Pagination to prevent DOM bloat. Constrained vertical scrolling wrappers are explicitly prohibited to avoid scrollbar/sticky-header rendering collisions.</p>
        <div style={{ borderRadius: '4px', border: '1px solid var(--border-main)', height: '400px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <DataTable columns={dsColumns} data={dsData} selectable={true} />
          </div>
      </section>

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
        <h3 style={{ margin: '0 0 20px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>Semantic Colors</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
          {[
            { name: '--bg-app', label: 'App Background' },
            { name: '--bg-surface', label: 'Surface Background' },
            { name: '--bg-element', label: 'Element Background' },
            { name: '--text-main', label: 'Main Text' },
            { name: '--text-muted', label: 'Muted Text' },
            { name: '--accent-blue', label: 'Accent Blue' },
          ].map(color => (
            <div key={color.name} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-main)', borderRadius: '6px' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '4px', backgroundColor: `var(${color.name})`, border: '1px solid var(--border-main)' }} />
              <div style={{ fontSize: '12px', color: 'var(--text-main)', fontFamily: 'monospace' }}>{color.name}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
        <h3 style={{ margin: '0 0 20px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>Form Elements</h3>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="text" className="input-text" placeholder="Standard Text Input" />
          <input type="text" className="input-text" defaultValue="Active Value" />
          <Dropdown 
            options={['Option 1', 'Option 2', 'Option 3']} 
            value={dropdownValue} 
            onChange={setDropdownValue} 
          />
          <Checkbox 
            checked={isChecked} 
            onChange={setIsChecked} 
            label="Checkbox element" 
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input 
              type="number" min="0" className="input-text no-spinners" 
              style={{ width: '60px', textAlign: 'center' }} 
              value={stepperValue} onChange={(e) => setStepperValue(e.target.value)} 
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <button className="stepper-btn" onClick={handleIncrement} style={{ background: 'var(--bg-element)', border: '1px solid var(--border-main)', borderRadius: '4px', color: 'var(--text-main)', cursor: 'pointer', padding: '1px 4px', display: 'flex', alignItems: 'center' }}>
                <ChevronUp size={12} />
              </button>
              <button className="stepper-btn" onClick={handleDecrement} style={{ background: 'var(--bg-element)', border: '1px solid var(--border-main)', borderRadius: '4px', color: 'var(--text-main)', cursor: 'pointer', padding: '1px 4px', display: 'flex', alignItems: 'center' }}>
                <ChevronDown size={12} />
              </button>
            </div>
          </div>
        </div>
      </section>

      <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
        <h3 style={{ margin: '0 0 20px 0', fontSize: '15px', color: 'var(--accent-blue)' }}>Overlays & Modals</h3>
        <p style={{ margin: '0 0 15px 0', fontSize: '13px', color: 'var(--text-muted)' }}>Standardized dialog windows. Sizes include <code>sm</code> (400px), <code>md</code> (600px), and <code>lg</code> (800px).</p>
        <div style={{ display: 'flex', gap: '15px' }}>
          <button className="btn-secondary" onClick={() => setActiveModalSize('sm')}>Open Small (sm)</button>
          <button className="btn-secondary" onClick={() => setActiveModalSize('md')}>Open Medium (md)</button>
          <button className="btn-secondary" onClick={() => setActiveModalSize('lg')}>Open Large (lg)</button>
        </div>
        
        <Modal 
          isOpen={activeModalSize !== null} 
          onClose={() => setActiveModalSize(null)} 
          title={`Example Modal (${activeModalSize})`} 
          size={activeModalSize || 'md'}
          footer={<><button className="btn-secondary btn-sm" onClick={() => setActiveModalSize(null)}>Cancel</button><button className="btn-primary btn-sm" onClick={() => setActiveModalSize(null)}>Confirm Action</button></>}
        >
          <p style={{ margin: 0 }}>This is a standardized modal component rendering at the <code>{activeModalSize}</code> size. It handles the backdrop blur, standard padding, semantic background colors, and a fixed header/footer.</p>
        </Modal>
      </section>
    </div>
  );
};