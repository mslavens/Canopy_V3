import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface NewWindowPortalProps {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
  width?: number;
  height?: number;
  externalWindow?: Window | null;
}

export const NewWindowPortal: React.FC<NewWindowPortalProps> = ({ children, title, onClose, width = 800, height = 600, externalWindow }) => {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const newWindow = useRef<Window | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    // Open a new browser window if not provided
    newWindow.current = externalWindow || window.open(
      '',
      '',
      `width=${width},height=${height},left=200,top=200`
    );

    if (!newWindow.current) {
      console.error("Failed to open new window. It might have been blocked by a popup blocker.");
      if (onCloseRef.current) onCloseRef.current();
      return;
    }

    newWindow.current.document.title = title;

    // Copy styles from main window to new window asynchronously to prevent freezing main thread
    setTimeout(() => {
      if (!newWindow.current || newWindow.current.closed) return;
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach(style => {
        newWindow.current!.document.head.appendChild(style.cloneNode(true));
      });
    }, 0);

    let div = newWindow.current.document.getElementById('portal-root') as HTMLDivElement;
    if (!div) {
      div = newWindow.current.document.createElement('div');
      newWindow.current.document.body.style.margin = '0';
      newWindow.current.document.body.style.padding = '0';
      newWindow.current.document.body.style.backgroundColor = 'var(--bg-app)';
      newWindow.current.document.body.style.color = 'var(--text-main)';
      newWindow.current.document.body.appendChild(div);
      
      if (document.documentElement.classList.contains('dark')) {
        newWindow.current.document.documentElement.classList.add('dark');
      }
    }

    setContainer(div);

    const timer = setInterval(() => {
      if (newWindow.current?.closed) {
        clearInterval(timer);
        if (onCloseRef.current) {
          onCloseRef.current();
        }
      }
    }, 200);

    return () => {
      clearInterval(timer);
      // Only close the window if we created it internally.
      // If it's an externalWindow, the parent component is responsible for its lifecycle.
      if (!externalWindow) {
        newWindow.current?.close();
      }
    };
  }, [title, width, height, externalWindow]); // Removed onClose from dependencies

  return container ? createPortal(children, container) : null;
};
