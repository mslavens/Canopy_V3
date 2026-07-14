import React from 'react';

interface HighlightedTextProps {
  text: string;
  highlight: string;
}

export const HighlightedText: React.FC<HighlightedTextProps> = ({ text, highlight }) => {
  if (!highlight.trim()) {
    return <span>{text}</span>;
  }

  // Safely escape regex characters from user input to prevent ReDoS or app crashes
  const cleanHighlight = highlight.trim();
  const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapeRegExp(cleanHighlight)})`, 'gi');
  const parts = text.split(regex);
  const lowerHighlight = cleanHighlight.toLowerCase();

  return (
    <span>
      {parts.map((part, index) =>
        part.toLowerCase() === lowerHighlight ? (
          <mark key={index} style={{ backgroundColor: 'var(--accent-purple)', color: 'var(--bg-app)', borderRadius: '2px', padding: '0 2px' }}>
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </span>
  );
};