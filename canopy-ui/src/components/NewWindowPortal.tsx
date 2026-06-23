import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface NewWindowPortalProps {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
  width?: number;
  height?: number;
}

export const NewWindowPortal: React.FC<NewWindowPortalProps> = ({ children, title, onClose, width = 800, height = 600 }) => {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const newWindow = useRef<Window | null>(null);

  useEffect(() => {
    // Open a new browser window
    newWindow.current = window.open(
      '',
      '',
      `width=${width},height=${height},left=200,top=200`
    );

    if (!newWindow.current) {
      console.error("Failed to open new window. It might have been blocked by a popup blocker.");
      onClose();
      return;
    }

    newWindow.current.document.title = title;

    // Copy styles from main window to new window
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach(style => {
      newWindow.current!.document.head.appendChild(style.cloneNode(true));
    });

    const div = newWindow.current.document.createElement('div');
    // Basic reset for the new body
    newWindow.current.document.body.style.margin = '0';
    newWindow.current.document.body.style.padding = '0';
    newWindow.current.document.body.style.backgroundColor = 'var(--bg-app)';
    newWindow.current.document.body.style.color = 'var(--text-main)';
    newWindow.current.document.body.appendChild(div);
    
    // Add canopy theme class if on html tag
    if (document.documentElement.classList.contains('dark')) {
      newWindow.current.document.documentElement.classList.add('dark');
    }

    setContainer(div);

    newWindow.current.addEventListener('beforeunload', () => {
      onClose();
    });

    return () => {
      newWindow.current?.close();
    };
  }, [title, onClose, width, height]);

  return container ? createPortal(children, container) : null;
};
