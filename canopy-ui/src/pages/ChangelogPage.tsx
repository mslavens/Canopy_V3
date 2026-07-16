import React, { useEffect, useState, useRef, createContext, useContext } from 'react';
import ReactMarkdown from 'react-markdown';
import { SearchBar } from '../components/SearchBar';
import { HighlightedText } from '../components/HighlightedText';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { CanopyApiClient } from '../api/client';

// --- Stable Context-Driven Highlight Components ---
const SearchContext = createContext<string>('');

const HighlightWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const query = useContext(SearchContext);
  const highlightedChildren = React.Children.map(children, child => {
    if (typeof child === 'string') return <HighlightedText text={child} highlight={query} />;
    return child;
  });
  return <>{highlightedChildren}</>;
};

const stableMarkdownComponents = {
  p: ({ node, children, ...props }: any) => <p {...props}><HighlightWrapper>{children}</HighlightWrapper></p>,
  li: ({ node, children, ...props }: any) => <li {...props}><HighlightWrapper>{children}</HighlightWrapper></li>,
  h1: ({ node, children, ...props }: any) => <h1 {...props}><HighlightWrapper>{children}</HighlightWrapper></h1>,
  h2: ({ node, children, ...props }: any) => <h2 {...props}><HighlightWrapper>{children}</HighlightWrapper></h2>,
  h3: ({ node, children, ...props }: any) => <h3 {...props}><HighlightWrapper>{children}</HighlightWrapper></h3>,
  strong: ({ node, children, ...props }: any) => <strong {...props}><HighlightWrapper>{children}</HighlightWrapper></strong>,
  em: ({ node, children, ...props }: any) => <em {...props}><HighlightWrapper>{children}</HighlightWrapper></em>,
};

export const ChangelogPage: React.FC = () => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pageSearchQuery, setPageSearchQuery] = useState<string>('');
  const containerRef = useRef<HTMLElement>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const fetchChangelog = async () => {
      try {
        const apiClient = new CanopyApiClient({ url: '', token: '' });
        const text = await apiClient.getChangelog();

        if (isMounted) {
          setContent(text);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load changelog asset.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchChangelog();

    return () => { isMounted = false; };
  }, []);

  // Filter the markdown content by Release Version headers (## )
  let displayedContent = content;
  if (pageSearchQuery.trim() && content) {
    const query = pageSearchQuery.toLowerCase();
    const sections = content.split(/(?=^## )/gm); // Split into blocks while keeping the '## ' prefix
    
    displayedContent = sections.filter((sec, idx) => {
      if (idx === 0 && !sec.startsWith('## ')) return true; // Always keep the title/intro paragraph
      return sec.toLowerCase().includes(query);
    }).join('');

    // If all versions were filtered out, provide a clean fallback message
    if (!displayedContent.includes('## ')) {
      displayedContent += `\n\n> No changelog entries found matching "**${pageSearchQuery}**".`;
    }
  }

  // Reset match index when query changes
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [pageSearchQuery]);

  // Auto-scroll and tracking for specific matches
  useEffect(() => {
    if (pageSearchQuery.trim() !== '' && containerRef.current) {
      const timeoutId = setTimeout(() => {
        const marks = containerRef.current?.querySelectorAll('mark');
        if (marks) {
          setMatchCount(marks.length);
          if (marks.length > 0) {
            const safeIndex = Math.min(currentMatchIndex, marks.length - 1);
            marks[safeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Visually emphasize the active match
            marks.forEach((m, idx) => {
              if (idx === safeIndex) {
                m.style.boxShadow = '0 0 0 2px var(--accent-blue)';
              } else {
                m.style.boxShadow = 'none';
              }
            });
          }
        }
      }, 50); // Small delay ensures ReactMarkdown has finished DOM painting
      return () => clearTimeout(timeoutId);
    } else {
      setMatchCount(0);
    }
  }, [pageSearchQuery, displayedContent, currentMatchIndex]);

  const handleNext = () => setCurrentMatchIndex(prev => (prev + 1) % matchCount);
  const handlePrev = () => setCurrentMatchIndex(prev => (prev - 1 + matchCount) % matchCount);

  if (loading) return <div className="fade-in-delayed" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px', gap: '15px', height: '400px' }}><Loader2 size={24} className="spin-animation" style={{ color: 'var(--accent-blue)' }} />Loading system changelog...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '1200px' }}>
      <PageHeader 
        title="System Changelog" 
        description="Historical record of updates, bug fixes, and system patches." 
        actions={
          <SearchBar 
            historyKey="changelog-search-history"
            value={pageSearchQuery} 
            onChange={setPageSearchQuery} 
            placeholder="Search changelog..." 
            variant="local" 
            matchCount={matchCount}
            currentMatch={currentMatchIndex}
            onNext={handleNext}
            onPrev={handlePrev}
          />
        }
      />
      
      {error ? (
        <div style={{ backgroundColor: 'var(--bg-surface)', borderLeft: '4px solid var(--status-red)', padding: '15px', borderRadius: '4px', color: 'var(--status-red)', marginTop: '50px' }}>
          <strong>Asset Fault:</strong> {error}
        </div>
      ) : (
        <section ref={containerRef} style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)', color: 'var(--text-main)', lineHeight: 1.6, marginTop: '50px' }}>
          <div className="markdown-content">
            <SearchContext.Provider value={pageSearchQuery}>
              <ReactMarkdown components={stableMarkdownComponents}>{displayedContent}</ReactMarkdown>
            </SearchContext.Provider>
          </div>
        </section>
      )}
    </div>
  );
};