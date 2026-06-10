import React, { useState, useMemo, useEffect } from 'react';
import { SearchBar } from '../components/SearchBar';
import { AlertTriangle, Database, Loader2, ChevronDown, ChevronRight, Server, Shield, Layers, HardDrive } from 'lucide-react';
import { CanopyApiClient } from '../api/client';
import { DataTable, ColumnDef } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

interface DBResponse {
  columns: string[];
  rows: Record<string, any>[];
}

interface DatabaseBrowserPageProps {
  auth: { url: string; token: string } | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

interface TableMetadata {
  tableName: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface TableCategory {
  categoryName: string;
  tables: TableMetadata[];
}

export const DatabaseBrowserPage: React.FC<DatabaseBrowserPageProps> = ({ auth, addToast }) => {
  const [selectedTable, setSelectedTable] = useState<string>('scopes');
  const [query, setQuery] = useState("SELECT * FROM scopes;");
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);
  
  const [data, setData] = useState<DBResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pageSearchQuery, setPageSearchQuery] = useState('');

  const apiClient = useMemo(() => auth ? new CanopyApiClient(auth) : null, [auth]);

  const tableCategories: TableCategory[] = [
    {
      categoryName: "Infrastructure & Topology",
      tables: [
        { tableName: "scopes", label: "Scopes Registry", description: "Unified administrative scope registry (shared, device-group, template, stack, firewall).", icon: <Layers size={14} /> },
        { tableName: "device_groups", label: "Device Groups", description: "Panorama device groups hierarchy and parent relationships.", icon: <Layers size={14} /> },
        { tableName: "templates", label: "Base Templates", description: "Panorama templates catalog.", icon: <Layers size={14} /> },
        { tableName: "template_stacks", label: "Template Stacks", description: "Ledger of Panorama template stacks.", icon: <Layers size={14} /> },
        { tableName: "template_stack_members", label: "Stack Members (View)", description: "Sequential list of member templates inside stacks.", icon: <Layers size={14} /> },
        { tableName: "template_stack_members_raw", label: "Stack Members (Raw)", description: "Underlying raw sequential template stack membership records.", icon: <Layers size={14} /> },
        { tableName: "network_topology", label: "Interface Mappings", description: "Platform-blind physical/logical network interfaces, subnets, and zone mappings.", icon: <Layers size={14} /> },
        { tableName: "static_routes", label: "Static Routing Tables", description: "Virtual Router static route entries including exit interfaces and next-hops.", icon: <Layers size={14} /> },
        { tableName: "managed_devices", label: "Managed Inventory (View)", description: "Complete ledger of managed firewalls and their serials discovered via Panorama.", icon: <Server size={14} /> },
        { tableName: "managed_devices_raw", label: "Managed Inventory (Raw)", description: "Physical ledger of managed appliances (underlying raw normalized storage).", icon: <Server size={14} /> }
      ]
    },
    {
      categoryName: "Security Rules",
      tables: [
        { tableName: "security_rules", label: "Security Policies", description: "Rules governing allowed or denied traffic based on zones, applications, and services.", icon: <Shield size={14} /> },
        { tableName: "nat_rules", label: "NAT Policies", description: "Network Address Translation (NAT) rules and translation details.", icon: <Shield size={14} /> },
        { tableName: "security_profiles", label: "Security Profiles", description: "Applied profiles mapping (Antivirus, URL filtering, Anti-spyware, etc.).", icon: <Shield size={14} /> }
      ]
    },
    {
      categoryName: "Objects",
      tables: [
        { tableName: "address_objects", label: "Address Objects", description: "IP addresses, subnet blocks, FQDN targets, and ranges.", icon: <Database size={14} /> },
        { tableName: "address_groups", label: "Address Groups", description: "Named lists of address objects.", icon: <Database size={14} /> },
        { tableName: "address_group_members", label: "Address Group Members", description: "Mapping table linking address groups to their nested members.", icon: <Database size={14} /> },
        { tableName: "service_objects", label: "Port Services", description: "TCP and UDP destination port definitions.", icon: <Database size={14} /> },
        { tableName: "service_groups", label: "Service Groups", description: "Named collections of port services.", icon: <Database size={14} /> },
        { tableName: "service_group_members", label: "Service Group Members", description: "Mapping table linking service groups to their members.", icon: <Database size={14} /> },
        { tableName: "tags", label: "Administrative Tags", description: "Tags and native color labels applied to objects and rules.", icon: <Database size={14} /> }
      ]
    },
    {
      categoryName: "System State",
      tables: [
        { tableName: "secrets_vault", label: "Secrets Vault", description: "Encrypted API access keys, credentials, and tokens.", icon: <HardDrive size={14} /> },
        { tableName: "license_vault", label: "License Vault", description: "Offline cryptographic licenses and activation ledger keys.", icon: <HardDrive size={14} /> }
      ]
    },
    {
      categoryName: "Schema Directory",
      tables: [
        { tableName: "sqlite_master", label: "Schema Catalog", description: "Master directory of all tables and raw creation schemas in the offline database.", icon: <Database size={14} /> }
      ]
    }
  ];

  const activeTableMeta = useMemo(() => {
    for (const cat of tableCategories) {
      const match = cat.tables.find(t => t.tableName === selectedTable);
      if (match) return match;
    }
    return null;
  }, [selectedTable]);

  const runQuery = async (overrideQuery?: string) => {
    if (!apiClient) return;
    const q = overrideQuery || query;
    if (!q.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const resData = await apiClient.queryDb(q);
      setData(resData);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to query database';
      setError(errMsg);
      addToast(errMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Auto-run query when selected table changes
  useEffect(() => {
    const q = selectedTable === 'sqlite_master'
      ? "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
      : `SELECT * FROM ${selectedTable};`;
    setQuery(q);
    runQuery(q);
  }, [selectedTable]);

  const tableColumns: ColumnDef[] = useMemo(() => {
    return (data?.columns || []).map(col => ({ key: col, label: col }));
  }, [data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '15px' }}>
      <PageHeader 
        title="Data Inspector" 
        description="Explore Panorama configurations and offline database tables without needing SQL experience." 
        isSticky={false}
        actions={
          <SearchBar value={pageSearchQuery} onChange={setPageSearchQuery} placeholder="Search records..." variant="local" />
        }
      />

      <div style={{ display: 'flex', flex: 1, gap: '20px', minHeight: 0 }}>
        {/* Left Sidebar Navigator */}
        <aside style={{ 
          width: '260px', 
          backgroundColor: 'var(--bg-surface)', 
          border: '1px solid var(--border-main)', 
          borderRadius: '8px', 
          display: 'flex', 
          flexDirection: 'column', 
          overflowY: 'auto', 
          padding: '15px', 
          gap: '15px',
          flexShrink: 0
        }}>
          {tableCategories.map(category => (
            <div key={category.categoryName} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <h4 style={{ 
                margin: '5px 0 5px 8px', 
                fontSize: '11px', 
                fontWeight: 600, 
                color: 'var(--text-muted)', 
                textTransform: 'uppercase', 
                letterSpacing: '0.5px' 
              }}>
                {category.categoryName}
              </h4>
              {category.tables.map(table => (
                <button
                  key={table.tableName}
                  onClick={() => setSelectedTable(table.tableName)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: selectedTable === table.tableName ? 'var(--bg-element)' : 'transparent',
                    color: selectedTable === table.tableName ? 'var(--text-main)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: selectedTable === table.tableName ? 500 : 400,
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                    borderLeft: selectedTable === table.tableName ? '3px solid var(--accent-blue)' : '3px solid transparent'
                  }}
                  onMouseEnter={(e) => {
                    if (selectedTable !== table.tableName) {
                      e.currentTarget.style.backgroundColor = 'var(--bg-app)';
                      e.currentTarget.style.color = 'var(--text-main)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedTable !== table.tableName) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }
                  }}
                >
                  {table.icon}
                  <span>{table.label}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* Right Content View */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, gap: '15px', minWidth: 0 }}>
          {/* Card Header showing information about selected table */}
          {activeTableMeta && (
            <div style={{ 
              backgroundColor: 'var(--bg-surface)', 
              border: '1px solid var(--border-main)', 
              borderRadius: '8px', 
              padding: '15px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              flexShrink: 0
            }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-main)' }}>
                {activeTableMeta.label} <code style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'normal', backgroundColor: 'var(--bg-app)', padding: '2px 6px', borderRadius: '4px', marginLeft: '8px' }}>{activeTableMeta.tableName}</code>
              </h3>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {activeTableMeta.description}
              </p>
            </div>
          )}

          {/* Table display */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)', borderRadius: '8px', overflow: 'hidden', minWidth: 0 }}>
            {error && (
              <div style={{ margin: '15px', backgroundColor: 'var(--bg-app)', borderLeft: '4px solid var(--status-red)', padding: '12px 15px', borderRadius: '4px', color: 'var(--status-red)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            {loading && !data ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px', gap: '15px' }}>
                <Loader2 size={24} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />
                Fetching table contents...
              </div>
            ) : data && data.columns.length > 0 ? (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s ease', pointerEvents: loading ? 'none' : 'auto', minWidth: 0 }}>
                 <DataTable columns={tableColumns} data={data.rows} searchQuery={pageSearchQuery} exportFilename={`inspection_${selectedTable}_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`} />
              </div>
            ) : (!error && !loading && <EmptyState icon={<Database size={32} />} title="Empty Table" description="No configuration details found. Ensure you have loaded Palo Alto XML configs in the XML Import tab." minHeight="250px" />)}
          </div>

          {/* Advanced SQL Accordion */}
          <div style={{ 
            backgroundColor: 'var(--bg-surface)', 
            border: '1px solid var(--border-main)', 
            borderRadius: '8px', 
            overflow: 'hidden',
            flexShrink: 0
          }}>
            <button 
              onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 20px',
                border: 'none',
                backgroundColor: 'transparent',
                color: 'var(--text-main)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 600,
                textAlign: 'left'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Database size={14} style={{ color: 'var(--text-muted)' }} />
                <span>Advanced SQL Console</span>
              </div>
              {isAdvancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {isAdvancedOpen && (
              <div style={{ padding: '0 20px 20px 20px', display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--border-main)' }}>
                <p style={{ margin: '10px 0 0 0', color: 'var(--text-muted)', fontSize: '11px', lineHeight: 1.4 }}>
                  Inspect or execute direct raw read-only SQL SELECT queries against the local SQLite decryption vault:
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input 
                    type="text" 
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="SELECT * FROM table..."
                    onKeyDown={(e) => e.key === 'Enter' && runQuery()}
                    style={{ 
                      flex: 1, padding: '10px 12px', borderRadius: '4px', border: '1px solid var(--border-main)', 
                      backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px', outline: 'none',
                      fontFamily: 'monospace'
                    }}
                  />
                  <button className="btn-primary btn-sm" onClick={() => runQuery()} disabled={loading} style={{ height: '36px' }}>
                    Execute Query
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};