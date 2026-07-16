import React, { Component, ReactNode, useEffect, useState, useRef, createContext, useContext, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { X, Book } from 'lucide-react';
import { SearchBar } from './SearchBar';
import { HighlightedText } from './HighlightedText';
import { Tooltip } from './Tooltip';
import { CanopyApiClient } from '../api/client';

// --- Error Boundary ---

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class HelpErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="help-error-fallback">
          <p>Help handbook asset is currently a work in progress.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Help Content Fetcher ---

const ModalNavigationContext = createContext<(docId: string) => void>(() => {});
const ModalLocalSearchContext = createContext<string>('');

const ModalHighlightWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const query = useContext(ModalLocalSearchContext);
  const highlightedChildren = React.Children.map(children, child => {
    if (typeof child === 'string') return <HighlightedText text={child} highlight={query} />;
    return child;
  });
  return <>{highlightedChildren}</>;
};

const stableModalComponents = {
  a: ({ node, children, href, ...props }: any) => {
    const navigate = useContext(ModalNavigationContext);
    const isLocal = href && !href.startsWith('http');
    return (
      <a
        {...props}
        href={href}
        onClick={(e) => {
          if (isLocal) {
            e.preventDefault();
            navigate(href.replace('.md', '').replace('./', '').replace(/^\/+/, ''));
          }
        }}
        style={{ color: 'var(--accent-blue)', textDecoration: 'none', cursor: 'pointer' }}
      >
        <ModalHighlightWrapper>{children}</ModalHighlightWrapper>
      </a>
    );
  },
  p: ({ node, children, ...props }: any) => <p {...props}><ModalHighlightWrapper>{children}</ModalHighlightWrapper></p>,
  li: ({ node, children, ...props }: any) => <li {...props}><ModalHighlightWrapper>{children}</ModalHighlightWrapper></li>,
  h1: ({ node, children, ...props }: any) => <h1 {...props}><ModalHighlightWrapper>{children}</ModalHighlightWrapper></h1>,
  h2: ({ node, children, ...props }: any) => <h2 {...props}><ModalHighlightWrapper>{children}</ModalHighlightWrapper></h2>,
  h3: ({ node, children, ...props }: any) => <h3 {...props}><ModalHighlightWrapper>{children}</ModalHighlightWrapper></h3>,
  strong: ({ node, children, ...props }: any) => <strong {...props}><ModalHighlightWrapper>{children}</ModalHighlightWrapper></strong>,
  em: ({ node, children, ...props }: any) => <em {...props}><ModalHighlightWrapper>{children}</ModalHighlightWrapper></em>,
};

interface HelpContentProps {
  docId: string;
  onNavigate: (id: string) => void;
}

const HelpContent: React.FC<HelpContentProps> = ({ docId, onNavigate }) => {
  const [content, setContent] = useState<string>('');
  const [error, setError] = useState<Error | null>(null);
  const [localQuery, setLocalQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [showFindWidget, setShowFindWidget] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setError(null);
    setContent('');
    setLocalQuery('');
    setAppliedQuery('');
    setShowFindWidget(false);
    let isMounted = true;

    const fetchDocument = async () => {
      try {
        const apiClient = new CanopyApiClient({ url: '', token: '' });
        const text = await apiClient.getManualDoc(docId);
        
        if (isMounted) {
          setContent(text);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error('Unknown fetch error'));
        }
      }
    };

    fetchDocument();

    return () => {
      isMounted = false;
    };
  }, [docId]);

  // Debounce local search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedQuery(localQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [localQuery]);

  // Handle local find shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        setShowFindWidget(true);
      }
      if (e.key === 'Escape' && showFindWidget) {
        setShowFindWidget(false);
        setLocalQuery('');
        setAppliedQuery('');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showFindWidget]);

  // Auto-scroll logic for highlights
  useEffect(() => {
    if (appliedQuery.trim() !== '' && containerRef.current) {
      const timeoutId = setTimeout(() => {
        const marks = containerRef.current?.querySelectorAll('mark');
        if (marks) {
          setMatchCount(marks.length);
          if (marks.length > 0) {
            const safeIndex = Math.min(currentMatchIndex, marks.length - 1);
            marks[safeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
            marks.forEach((m, idx) => {
              m.style.boxShadow = idx === safeIndex ? '0 0 0 2px var(--accent-blue)' : 'none';
            });
          }
        }
      }, 50);
      return () => clearTimeout(timeoutId);
    } else {
      setMatchCount(0);
    }
  }, [appliedQuery, content, currentMatchIndex]);

  // Memoize markdown
  const renderedMarkdown = useMemo(() => {
    return (
      <ModalLocalSearchContext.Provider value={appliedQuery}>
        <ReactMarkdown components={stableModalComponents}>{content}</ReactMarkdown>
      </ModalLocalSearchContext.Provider>
    );
  }, [content, appliedQuery]);

  if (error) {
    return (
      <div className="help-error-fallback" style={{ color: 'var(--text-muted)' }}>
        <p>Help handbook asset is currently a work in progress.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', minHeight: '100%' }}>
      {showFindWidget && (
        <div style={{ position: 'sticky', top: '10px', zIndex: 100, display: 'flex', justifyContent: 'flex-end', marginBottom: '-35px', pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto', marginRight: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', borderRadius: '4px' }}>
            <SearchBar 
              historyKey="find-in-page-history"
              value={localQuery} 
              onChange={setLocalQuery} 
              placeholder="Find in page..." 
              variant="local" 
              width="220px"
              matchCount={matchCount}
              currentMatch={currentMatchIndex}
              onNext={() => setCurrentMatchIndex(prev => (prev + 1) % matchCount)}
              onPrev={() => setCurrentMatchIndex(prev => (prev - 1 + matchCount) % matchCount)}
              autoFocus={true}
              onClose={() => { setShowFindWidget(false); setLocalQuery(''); setAppliedQuery(''); }}
            />
          </div>
        </div>
      )}
      <ModalNavigationContext.Provider value={onNavigate}>
        {renderedMarkdown}
      </ModalNavigationContext.Provider>
    </div>
  );
};

// --- Main Modal Component ---

interface HelpModalProps {
  docId: string;
  isOpen: boolean;
  onClose?: () => void;
  initialQuery?: string;
}

export const HelpModal: React.FC<HelpModalProps> = ({ docId, isOpen, onClose, initialQuery }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [internalDocId, setInternalDocId] = useState(docId);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery(initialQuery || '');
      setInternalDocId(docId);
    }
  }, [isOpen, docId, initialQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
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
        const apiClient = new CanopyApiClient(creds);
        const data = await apiClient.search(searchQuery);
        const docResults = (data || []).filter((r: any) => r.type === 'documentation');
        setSearchResults(docResults);
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setSelectedIndex(-1);
  }, [searchResults, showDropdown]);

  const executeSearchSelection = (res: any) => {
    const targetDocId = res.id.replace('doc|', '');
    setInternalDocId(targetDocId);
    setSearchQuery('');
    setShowDropdown(false);
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

  // Focus trap
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    const initialFocusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (initialFocusable.length > 0 && !modalRef.current.contains(document.activeElement)) {
      initialFocusable[0].focus();
    }

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return;
      const elements = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (elements.length === 0) return;

      const firstElement = elements[0];
      const lastElement = elements[elements.length - 1];

      if (e.shiftKey && (document.activeElement === firstElement || document.activeElement === modalRef.current)) {
        lastElement.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        firstElement.focus();
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleTabKey);
    return () => document.removeEventListener('keydown', handleTabKey);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div 
      className="help-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div ref={modalRef} tabIndex={-1} className="help-modal-container" style={{ outline: 'none' }}>
        <div className="help-modal-header">
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-main)' }}>Help & Documentation</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div ref={searchRef} style={{ position: 'relative' }} onKeyDown={handleSearchKeyDown}>
              <SearchBar 
                historyKey="global-search-history"
                value={searchQuery} 
                onChange={setSearchQuery} 
                placeholder="Search guides..." 
                variant="global" 
              />
              {showDropdown && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '8px', width: '300px',
                  backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-main)',
                  borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 1000,
                  maxHeight: '300px', overflowY: 'auto'
                }}>
                  {isSearching ? (
                    <div style={{ padding: '15px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>Searching...</div>
                  ) : searchResults.length === 0 ? (
                    <div style={{ padding: '15px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>No guides found.</div>
                  ) : (
                    <div style={{ padding: '8px 0' }}>
                      {searchResults.map((res, idx) => (
                        <div
                          key={res.id}
                          onClick={() => executeSearchSelection(res)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          style={{ 
                            padding: '10px 15px', cursor: 'pointer', borderBottom: '1px solid var(--border-main)',
                            backgroundColor: selectedIndex === idx ? 'var(--bg-element)' : 'transparent',
                            textAlign: 'left'
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
            <Tooltip content="Table of Contents" position="bottom" align="right">
              <button className="help-modal-close-btn" onClick={() => setInternalDocId('index')} aria-label="Table of Contents">
                <Book size={18} />
              </button>
            </Tooltip>
            {onClose && (
              <Tooltip content="Close Help" position="bottom" align="right">
                <button className="help-modal-close-btn" onClick={onClose} aria-label="Close Help">
                  <X size={18} />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="help-modal-body markdown-content">
          <HelpErrorBoundary>
            <HelpContent docId={internalDocId} onNavigate={setInternalDocId} />
          </HelpErrorBoundary>
        </div>
      </div>
    </div>
  );
};