import React, { useState, useEffect, useRef } from 'react';
import { SearchBar } from '../components/SearchBar';
import { Bell, Moon, Sun, HelpCircle, Lock, AlertTriangle, MessageSquare, PanelLeft, ChevronLeft, ChevronRight, ExternalLink, Activity } from 'lucide-react';
import { Tooltip } from '../components/Tooltip';
import { HelpModal } from '../components/HelpModal';
import { ToastContainer, ToastMessage } from '../components/ToastContainer';
import { NotificationsDrawer } from '../components/NotificationsDrawer';
import { CanopyApiClient } from '../api/client';
import { Dropdown } from '../components/Dropdown';
import { Checkbox } from '../components/Checkbox';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/ConfirmProvider';
import { useIsDirty } from '../components/UnsavedChangesProvider';
import packageJson from '../../package.json';
import ReactMarkdown from 'react-markdown';

interface SearchResult {
  id: string;
  type: string;
  label: string;
  module: string;
  submodule: string;
}

interface AppLayoutProps {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  activeMainTab: string;
  setActiveMainTab: (tab: string) => void;
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
  toasts: ToastMessage[];
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  dismissToast: (id: string) => void;
  notificationsHistory: ToastMessage[];
  clearNotifications: () => void;
  systemError: string | null;
  isPortable?: boolean;
  port?: string | null;
  onLockApp: () => void;
  children: React.ReactNode;
}

// Navigation configurations
const mainTabs = ['Dashboard', 'Device Management', 'Policies', 'Objects', 'Network', 'Monitor', 'XML Import', 'Analytics', 'System'];
const subTabsMap: Record<string, string[]> = {
  'Device Management': ['Inventory', 'Device Groups', 'Templates'],
  'Network': ['Interfaces', 'Zones', 'Virtual Routers', 'Path Resolution'],
  'Monitor': ['Traffic', 'Threat'],
  'XML Import': ['Upload Config'],
  'Analytics': ['Traffic Logs', 'Threat Logs', 'System Logs'],
  'Policies': ['Security Rules', 'NAT Rules'],
  'Objects': ['Address Objects', 'Address Groups', 'Services', 'Service Groups', 'Applications', 'Application Groups', 'Tags', 'Log Forwarding Profiles', 'Security Profiles', 'Security Profile Groups', 'Custom Objects'],
  'System': ['Workspaces', 'Secrets Vault', 'Settings', 'Audit Logs', 'Snapshots', 'Upgrade', 'Support', 'Database Browser', 'Changelog', 'Design System'],
};

export const AppLayout: React.FC<AppLayoutProps> = ({
  theme,
  toggleTheme,
  activeMainTab,
  setActiveMainTab,
  activeSubTab,
  setActiveSubTab,
  toasts,
  addToast,
  dismissToast,
  notificationsHistory,
  clearNotifications,
  systemError,
  isPortable,
  port,
  onLockApp,
  children
}) => {
  const [globalSearchQuery, setGlobalSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  
  // Tab bar horizontal scroll navigation hooks & states
  const navScrollRef = useRef<HTMLDivElement>(null);
  const [showLeftChevron, setShowLeftChevron] = useState(false);
  const [showRightChevron, setShowRightChevron] = useState(false);

  const checkOverflow = () => {
    const el = navScrollRef.current;
    if (!el) return;
    setShowLeftChevron(el.scrollLeft > 2);
    setShowRightChevron(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
  };

  const scrollNav = (direction: 'left' | 'right') => {
    const el = navScrollRef.current;
    if (!el) return;
    const amount = direction === 'left' ? -150 : 150;
    el.scrollBy({ left: amount, behavior: 'smooth' });
  };
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [isNotificationsDrawerOpen, setIsNotificationsDrawerOpen] = useState<boolean>(false);
  const [helpInitialQuery, setHelpInitialQuery] = useState<string>('');
  
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string>(() => localStorage.getItem('canopy-active-workspace') || 'Default Workspace');
  const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] = useState<boolean>(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState<string>('');
  const [newWorkspaceColor, setNewWorkspaceColor] = useState<string>('');
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState<boolean>(false);
  const [showMessageCenter, setShowMessageCenter] = useState<boolean>(false);
  const [activeMessageTab, setActiveMessageTab] = useState<'whats-new' | 'alerts'>('whats-new');
  const [latestReleaseNotes, setLatestReleaseNotes] = useState<string>('');
  const [dontShowAgain, setDontShowAgain] = useState<boolean>(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const savedWidth = localStorage.getItem('canopy-sidebar-width');
    return savedWidth ? parseInt(savedWidth, 10) : 240;
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => localStorage.getItem('canopy-sidebar-open') !== 'false');

  useEffect(() => {
    localStorage.setItem('canopy-sidebar-open', isSidebarOpen.toString());
  }, [isSidebarOpen]);

  // Tab bar horizontal scroll navigation wheel and resize integration
  useEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('scroll', checkOverflow);
    window.addEventListener('resize', checkOverflow);
    
    // Initial run
    const timer = setTimeout(checkOverflow, 100);

    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('scroll', checkOverflow);
      window.removeEventListener('resize', checkOverflow);
      clearTimeout(timer);
    };
  }, [mainTabs]);

  useEffect(() => {
    checkOverflow();
  }, [activeMainTab]);

  const confirm = useConfirm();
  const isDirty = useIsDirty();

  const handleNavigation = (action: () => void) => {
    if (isDirty) {
      confirm({
        title: 'Unsaved Changes',
        message: 'You have unsaved changes on this page. Are you sure you want to leave? Your changes will be lost.',
        confirmText: 'Discard Changes',
        isDestructive: true,
        onConfirm: action
      });
    } else {
      action();
    }
  };

  // Listen for native OS Help Menu clicks (e.g., from macOS toolbar)
  useEffect(() => {
    if (window.electron && window.electron.onTriggerHelp) {
      window.electron.onTriggerHelp(() => {
        setIsHelpOpen(true);
      });
    }
  }, []);

  // Close dropdown when clicking outside of the search bar boundary
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Global shortcut to focus search (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsHelpOpen(false);
        setIsNotificationsDrawerOpen(false);
        const searchInput = searchRef.current?.querySelector('input');
        if (searchInput) searchInput.focus();
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Debounced Global Search execution
  useEffect(() => {
    // Safely extract string if SearchBar accidentally passes a React SyntheticEvent
    const queryStr = typeof globalSearchQuery === 'string' ? globalSearchQuery : (globalSearchQuery as any)?.target?.value || '';

    if (!queryStr.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      setSelectedIndex(-1);
      return;
    }

    setShowDropdown(true);
    setIsSearching(true);

    const timer = setTimeout(async () => {
      try {
        const creds = await window.electron.getBackendAuth();
        // Use native fetch to bypass CanopyApiClient in case it hides raw methods
        const response = await fetch(`${creds.url}/api/search?q=${encodeURIComponent(queryStr)}`, {
            headers: { 'Authorization': `Bearer ${creds.token}` }
        });
        // Safely handle both raw fetch Responses and pre-parsed JSON arrays
        const data = typeof response.json === 'function' ? await response.json() : response;
        setSearchResults(data || []);
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setIsSearching(false);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [globalSearchQuery]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [searchResults, showDropdown]);

  const executeSearchSelection = (res: SearchResult) => {
    setActiveMainTab(res.module);
    setActiveSubTab(res.submodule);
    if (res.type === 'documentation') {
      setHelpInitialQuery(typeof globalSearchQuery === 'string' ? globalSearchQuery : '');
      setIsHelpOpen(true);
    }
    setGlobalSearchQuery('');
    setShowDropdown(false);
    handleNavigation(() => {
      setActiveMainTab(res.module);
      setActiveSubTab(res.submodule);
      if (res.type === 'documentation') {
        setHelpInitialQuery(typeof globalSearchQuery === 'string' ? globalSearchQuery : '');
        setIsHelpOpen(true);
      }
      setGlobalSearchQuery('');
      setShowDropdown(false);
    });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || searchResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < searchResults.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      executeSearchSelection(searchResults[selectedIndex]);
    }
  };

  // Persist sidebar width
  useEffect(() => {
    localStorage.setItem('canopy-sidebar-width', sidebarWidth.toString());
  }, [sidebarWidth]);

  // Check for Version Updates to show the Message Center
  useEffect(() => {
    const fetchChangelog = async () => {
      try {
        const res = await fetch('./docs/changelog.md');
        if (res.ok) {
          const text = await res.text();
          const blocks = text.split(/(?=^## )/gm);
          if (blocks.length > 1) {
            // Strip the "## v0.x.x - Title" and "**Date:**" lines to cleanly extract just the feature bullets
            const notes = blocks[1].replace(/^##.*?\n/m, '').replace(/^\*\*Date:\*\*.*?\n/m, '').trim();
            setLatestReleaseNotes(notes);
          }
        }
      } catch (err) {
        console.error("Failed to load release notes:", err);
      }
    };
    fetchChangelog();

    const hideWelcome = localStorage.getItem('canopy-hide-welcome-screen') === 'true';
    const lastSeenVersion = localStorage.getItem('canopy-last-seen-version');
    if (!hideWelcome && lastSeenVersion !== packageJson.version) {
      // Add a tiny delay so it pops up smoothly after the app layout renders
      setTimeout(() => setShowMessageCenter(true), 500);
    }
  }, []);

  // Fetch Workspaces on Mount
  useEffect(() => {
    let isMounted = true;
    let isInitialFetch = true;
    const fetchWorkspaces = async () => {
      try {
        const creds = await window.electron.getBackendAuth();
        const response = await fetch(`${creds.url}/api/workspaces`, {
          headers: { 'Authorization': `Bearer ${creds.token}` }
        });
        if (response.ok && isMounted) {
          const data = await response.json();
          setWorkspaces(data || []);
          if (data && data.length > 0) {
            const savedWorkspace = localStorage.getItem('canopy-active-workspace');
            let target = data.find((w: any) => w.name === savedWorkspace);
            if (!target) {
              target = data.reduce((prev: any, curr: any) => prev.id < curr.id ? prev : curr);
            }
            setActiveWorkspaceName(target.name);
            localStorage.setItem('canopy-active-workspace', target.name);
            localStorage.setItem('canopy-active-workspace-color', target.color || 'var(--accent-blue)');
            
            if (isInitialFetch) {
              isInitialFetch = false;
              // Ensure backend is strictly synced with the loaded UI state on mount
              fetch(`${creds.url}/api/workspaces/switch`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: target.id })
              }).catch(console.error);
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch workspaces:", err);
      }
    };
    fetchWorkspaces();
    
    const handleWorkspacesUpdated = () => {
      if (isMounted) fetchWorkspaces();
    };
    window.addEventListener('workspaces-updated', handleWorkspacesUpdated);
    
    return () => { 
      isMounted = false; 
      window.removeEventListener('workspaces-updated', handleWorkspacesUpdated);
    };
  }, []);

  const handleWorkspaceSwitch = async (name: string) => {
    if (name === '+ Create New Workspace') {
      setIsCreateWorkspaceOpen(true);
      return;
    }
    const target = workspaces.find(w => w.name === name);
    if (!target) return;

    handleNavigation(async () => {
      try {
        const creds = await window.electron.getBackendAuth();
        const response = await fetch(`${creds.url}/api/workspaces/switch`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: target.id })
        });
        if (response.ok) {
          localStorage.setItem('canopy-active-workspace', target.name);
          localStorage.setItem('canopy-active-workspace-color', target.color || 'var(--accent-blue)');
          sessionStorage.setItem('canopy-is-switching', 'true');
          window.location.reload(); // Flush React memory state and remount everything to the new DB
        }
      } catch (err) {
        console.error("Failed to switch workspace:", err);
      }
    });
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    setIsCreatingWorkspace(true);
    try {
      const creds = await window.electron.getBackendAuth();
      const res = await fetch(`${creds.url}/api/workspaces/create`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newWorkspaceName, color: newWorkspaceColor })
      });
      if (res.ok) {
        addToast('Workspace created successfully', 'success');
        window.dispatchEvent(new Event('workspaces-updated'));
        setIsCreateWorkspaceOpen(false);
        setNewWorkspaceName('');
        setNewWorkspaceColor('');
      } else {
        const err = await res.json();
        addToast(err.error || 'Failed to create workspace.', 'error');
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Create failed', 'error');
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const handleCloseMessageCenter = () => {
    localStorage.setItem('canopy-last-seen-version', packageJson.version);
    if (dontShowAgain) {
      localStorage.setItem('canopy-hide-welcome-screen', 'true');
    } else {
      localStorage.removeItem('canopy-hide-welcome-screen');
    }
    setShowMessageCenter(false);
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const startX = e.pageX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = startWidth + (moveEvent.pageX - startX);
      if (newWidth >= 200 && newWidth <= 500) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Configuration resolution

  const currentSubTabs = subTabsMap[activeMainTab] || ['Overview'];

  const visibleSubTabs = currentSubTabs.filter(tab => !(isPortable && tab === 'Upgrade'));

  // Dynamically generate the documentation filename based on the active state (e.g., "network-path-resolution")
  const activeDocId = `${activeMainTab.toLowerCase().replace(/\s+/g, '-')}-${activeSubTab.toLowerCase().replace(/\s+/g, '-')}`;

  const activeWorkspace = workspaces.find(w => w.name === activeWorkspaceName);
  const activeWorkspaceColor = (activeWorkspace?.color && activeWorkspace.color.trim() !== '') ? activeWorkspace.color : 'var(--accent-blue)';

  return (
    <div style={{ 
      color: 'var(--text-main)', 
      backgroundColor: 'var(--bg-app)', 
      width: '100vw',
      height: '100vh',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* --- TOP NAVIGATION BAR --- */}
      <header style={{ position: 'relative', zIndex: 2000, display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '50px', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-main)', padding: '0 20px', gap: '20px' }}>
        
        {/* Decouple the logo from the sidebar width for a perfectly rigid top header */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Tooltip content={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"} position="bottom" align="left">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}>
              <PanelLeft size={18} />
            </button>
          </Tooltip>
          <h1 style={{ color: activeWorkspaceColor, margin: 0, fontSize: '18px', fontWeight: 600, whiteSpace: 'nowrap' }}>Canopy <span style={{color: 'var(--text-muted)', fontSize: '14px', fontWeight: 'normal'}}>by Layered Blue</span></h1>
        </div>

        {/* Hide scrollbar for a cleaner look while allowing horizontal scrolling on narrow screens */}
        <style>{`.nav-scroll::-webkit-scrollbar { display: none; }`}</style>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, position: 'relative', height: '100%', overflow: 'hidden' }}>
          {showLeftChevron && (
            <button 
              onClick={() => scrollNav('left')}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '32px',
                background: 'linear-gradient(to right, var(--bg-surface) 60%, transparent)',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                paddingLeft: '4px'
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-main)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <ChevronLeft size={16} />
            </button>
          )}

          <nav ref={navScrollRef} className="nav-scroll" style={{ display: 'flex', height: '100%', flex: 1, overflowX: 'auto', msOverflowStyle: 'none', scrollbarWidth: 'none', padding: '0 20px' }}>
              {mainTabs.map(tab => (
                <button 
                  key={tab}
                  className="nav-tab"
                  onClick={() => { setActiveMainTab(tab); setActiveSubTab(subTabsMap[tab]?.[0] || 'Overview'); }}
                  style={{ 
                    background: 'none', border: 'none', borderBottom: activeMainTab === tab ? `3px solid ${activeWorkspaceColor}` : '3px solid transparent',
                    color: activeMainTab === tab ? 'var(--text-main)' : 'var(--text-muted)', cursor: 'pointer', padding: '0 15px', fontWeight: activeMainTab === tab ? 600 : 400, fontSize: '14px', height: '100%',
                    flexShrink: 0 // Prevent text from squishing
                  }}
                >
                  {tab}
                </button>
              ))}
          </nav>

          {showRightChevron && (
            <button 
              onClick={() => scrollNav('right')}
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: '32px',
                background: 'linear-gradient(to left, var(--bg-surface) 60%, transparent)',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingRight: '4px'
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-main)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <ChevronRight size={16} />
            </button>
          )}
        </div>

        {/* Prevent the right-hand controls from shrinking so they never get cut off */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexShrink: 0 }}>
          <div ref={searchRef} style={{ position: 'relative' }} onKeyDown={handleSearchKeyDown}>
            <SearchBar value={typeof globalSearchQuery === 'string' ? globalSearchQuery : ''} onChange={(val: any) => setGlobalSearchQuery(val?.target?.value !== undefined ? val.target.value : val)} placeholder="Search (Cmd+K)" variant="global" />
            
            {/* Floating Categorized Omnibox */}
            {showDropdown && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: '8px', width: '350px',
                backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)',
                borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 1000,
                maxHeight: '400px', overflowY: 'auto'
              }}>
                {isSearching ? (
                  <div style={{ padding: '15px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>Searching...</div>
                ) : searchResults.length === 0 ? (
                  <div style={{ padding: '15px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>No results found.</div>
                ) : (
                  <div style={{ padding: '8px 0' }}>
                    {searchResults.map((res, idx) => (
                      <div
                        key={res.id}
                        onClick={() => executeSearchSelection(res)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        style={{ 
                          padding: '10px 15px', cursor: 'pointer', borderBottom: '1px solid var(--border-main)',
                          backgroundColor: selectedIndex === idx ? 'var(--bg-element)' : 'transparent'
                        }}
                      >
                        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>{res.label}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{res.module} &rarr; {res.submodule}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          
          <Tooltip content="Message Center" align="right">
            <button onClick={() => setShowMessageCenter(true)} style={{ backgroundColor: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <MessageSquare size={18} />
            </button>
          </Tooltip>

          <Tooltip content="Documentation & Help" align="right">
            <button onClick={() => setIsHelpOpen(true)} style={{ backgroundColor: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <HelpCircle size={18} />
            </button>
          </Tooltip>

          <Tooltip content="Open in New Window" align="right">
            <button 
              onClick={() => {
                if (window.electron && window.electron.spawnWindow) {
                  window.electron.spawnWindow(`mainTab=${encodeURIComponent(activeMainTab)}&subTab=${encodeURIComponent(activeSubTab)}`);
                }
              }} 
              style={{ backgroundColor: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <ExternalLink size={18} />
            </button>
          </Tooltip>

          <Tooltip content="Lock Workspace" align="right">
            <button onClick={onLockApp} style={{ backgroundColor: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <Lock size={18} />
            </button>
          </Tooltip>

          <Tooltip content="Toggle Theme" align="right">
            <button onClick={toggleTheme} style={{ backgroundColor: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </Tooltip>
        </div>
      </header>

      {/* --- MAIN WORKSPACE --- */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {isSidebarOpen && (
          <>
            <aside style={{ width: sidebarWidth, backgroundColor: 'var(--bg-surface)', padding: '15px 10px', display: 'flex', flexDirection: 'column', gap: '5px', overflowY: 'auto', flexShrink: 0 }}>
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, paddingLeft: '10px', marginBottom: '8px' }}>
                  Active Workspace
                </div>
                <Dropdown 
                  options={[...workspaces.map(w => w.name), '+ Create New Workspace']}
                  value={activeWorkspaceName}
                  onChange={handleWorkspaceSwitch}
                  width="100%"
                  renderOption={(opt) => {
                    if (opt === '+ Create New Workspace') return <span style={{ color: 'var(--accent-blue)', fontWeight: 500 }}>{opt}</span>;
                    const ws = workspaces.find(w => w.name === opt);
                    const color = (ws?.color && ws.color.trim() !== '') ? ws.color : 'var(--accent-blue)';
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
                      </div>
                    );
                  }}
                />
              </div>
              <div style={{ height: '1px', backgroundColor: 'var(--border-main)', margin: '5px 10px 15px 10px', flexShrink: 0 }} />
              <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, paddingLeft: '10px', marginBottom: '8px' }}>{activeMainTab} Elements</div>
              {visibleSubTabs.map(subTab => (
                <button key={subTab} onClick={() => handleNavigation(() => setActiveSubTab(subTab))} style={{ textAlign: 'left', background: activeSubTab === subTab ? 'var(--bg-element)' : 'transparent', border: 'none', borderLeft: activeSubTab === subTab ? `3px solid ${activeWorkspaceColor}` : '3px solid transparent', padding: '8px 10px', borderRadius: '4px', color: activeSubTab === subTab ? 'var(--text-main)' : 'var(--text-muted)', fontWeight: activeSubTab === subTab ? 500 : 400, cursor: 'pointer', fontSize: '13px' }}>{subTab}</button>
              ))}
            </aside>
            <div 
              onMouseDown={handleResizeMouseDown}
              title="Drag to resize sidebar"
              style={{ 
                width: '4px', cursor: 'col-resize', flexShrink: 0,
                backgroundColor: 'var(--border-main)',
                transition: 'background-color 0.2s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--accent-blue)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--border-main)'}
            />
          </>
        )}
        <main style={{ flex: 1, padding: '30px', overflowY: 'scroll', backgroundColor: 'var(--bg-app)' }}>
          {systemError && (
            <div style={{ backgroundColor: 'var(--bg-surface)', borderLeft: '4px solid var(--status-red)', padding: '12px 15px', borderRadius: '4px', color: 'var(--status-red)', marginBottom: '20px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              <span><strong>System Fault:</strong> {systemError}</span>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* --- FOOTER / NOTIFICATION AREA --- */}
      <footer style={{ position: 'relative', zIndex: 10002, display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '35px', backgroundColor: 'var(--bg-surface)', borderTop: '1px solid var(--border-main)', padding: '0 20px', fontSize: '11px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <Tooltip content="View System Changelog" align="left" position="top">
            <button onClick={() => handleNavigation(() => { setActiveMainTab('System'); setActiveSubTab('Changelog'); })} style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text-muted)', fontWeight: 600, cursor: 'pointer', fontSize: '11px', fontFamily: 'inherit', letterSpacing: '0.5px' }}>
              v{packageJson.version}
            </button>
          </Tooltip>
          <span style={{ color: 'var(--border-main)' }}>|</span>
          <span style={{ color: 'var(--text-muted)' }}>Engine Status: <strong style={{color: systemError ? 'var(--status-red)' : 'var(--status-green)'}}>{systemError ? 'Degraded' : 'Operational'}</strong></span>
          {port && (
            <>
              <span style={{ color: 'var(--border-main)' }}>|</span>
              <span style={{ color: 'var(--text-muted)' }}>Port: <strong style={{ color: 'var(--text-main)' }}>{port}</strong></span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button onClick={() => setIsNotificationsDrawerOpen(!isNotificationsDrawerOpen)} style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 500, fontFamily: 'inherit' }}>
            <Bell size={12} /> Notifications ({notificationsHistory.length})
          </button>
        </div>
      </footer>

      {/* --- TOAST NOTIFICATION POPUPS --- */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* --- CONTEXTUAL HELP OVERLAY --- */}
      <HelpModal isOpen={isHelpOpen} docId={activeDocId} onClose={() => { setIsHelpOpen(false); setHelpInitialQuery(''); }} initialQuery={helpInitialQuery} />

      {/* --- NOTIFICATIONS HISTORY DRAWER --- */}
      <div {...(!isNotificationsDrawerOpen ? { inert: 'true' } : {})}>
        <NotificationsDrawer isOpen={isNotificationsDrawerOpen} onClose={() => setIsNotificationsDrawerOpen(false)} history={notificationsHistory} onClearAll={clearNotifications} />
      </div>

      {/* --- CREATE WORKSPACE MODAL --- */}
      <Modal
        isOpen={isCreateWorkspaceOpen}
        onClose={() => { setIsCreateWorkspaceOpen(false); setNewWorkspaceName(''); setNewWorkspaceColor(''); }}
        title="Create New Workspace"
        size="sm"
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => { setIsCreateWorkspaceOpen(false); setNewWorkspaceName(''); setNewWorkspaceColor(''); }}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleCreateWorkspace} disabled={!newWorkspaceName.trim() || isCreatingWorkspace}>
              {isCreatingWorkspace ? 'Creating...' : 'Create Workspace'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.5 }}>Provision a new, fully isolated SQLite database matrix for a client or project.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Workspace Name</label>
            <input 
              type="text" 
              className="input-text" 
              placeholder="e.g., Acme Corp" 
              value={newWorkspaceName} 
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateWorkspace()}
              disabled={isCreatingWorkspace}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>Accent Color (Optional)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Tooltip content="Select Color" position="top" align="left">
                <input type="color" value={newWorkspaceColor || '#89b4fa'} onChange={(e) => setNewWorkspaceColor(e.target.value)} style={{ width: '36px', height: '36px', padding: 0, border: '1px solid var(--border-main)', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'transparent' }} disabled={isCreatingWorkspace} />
              </Tooltip>
              <input type="text" className="input-text" value={newWorkspaceColor} onChange={(e) => setNewWorkspaceColor(e.target.value)} style={{ flex: 1, fontFamily: 'monospace' }} placeholder="#RRGGBB" disabled={isCreatingWorkspace} />
            </div>
          </div>
        </div>
      </Modal>

      {/* --- MESSAGE CENTER & RELEASE NOTES MODAL --- */}
      <Modal
        isOpen={showMessageCenter}
        onClose={handleCloseMessageCenter}
        title="Message Center"
        size="md"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <Checkbox checked={dontShowAgain} onChange={setDontShowAgain} label="Do not show automatically on startup" />
            <button className="btn-primary btn-sm" onClick={handleCloseMessageCenter}>
              Continue to Workspace
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-main)', gap: '20px' }}>
            <button 
              onClick={() => setActiveMessageTab('whats-new')}
              style={{ background: 'none', border: 'none', borderBottom: activeMessageTab === 'whats-new' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: activeMessageTab === 'whats-new' ? 'var(--text-main)' : 'var(--text-muted)', padding: '0 0 10px 0', cursor: 'pointer', fontSize: '13px', fontWeight: activeMessageTab === 'whats-new' ? 600 : 400 }}
            >
              What's New
            </button>
            <button 
              onClick={() => setActiveMessageTab('alerts')}
              style={{ background: 'none', border: 'none', borderBottom: activeMessageTab === 'alerts' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: activeMessageTab === 'alerts' ? 'var(--text-main)' : 'var(--text-muted)', padding: '0 0 10px 0', cursor: 'pointer', fontSize: '13px', fontWeight: activeMessageTab === 'alerts' ? 600 : 400 }}
            >
              System Alerts
            </button>
          </div>

          <div style={{ height: '260px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            {activeMessageTab === 'whats-new' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', paddingTop: '10px' }}>
                <p style={{ margin: 0, color: 'var(--text-main)', fontSize: '14px', lineHeight: 1.5 }}>
                  The Canopy Framework has been successfully updated to <strong>v{packageJson.version}</strong>! Here are a few highlights from this release:
                </p>
                <div className="markdown-content" style={{ margin: 0, marginTop: '5px', color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.6 }}>
                  {latestReleaseNotes ? <ReactMarkdown>{latestReleaseNotes}</ReactMarkdown> : 'Loading latest features...'}
                </div>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px', marginTop: '10px' }}>
                  You can review the full details anytime in the <strong>System &gt; Changelog</strong> tab.
                </p>
              </div>
            ) : (
              <div style={{ padding: '20px 0', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <EmptyState icon={<AlertTriangle size={32} />} title="No Active Alerts" description="Your workspace is currently operating normally without any critical notifications or warnings." minHeight="150px" />
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
};