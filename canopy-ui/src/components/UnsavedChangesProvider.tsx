import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';

interface UnsavedChangesContextType {
  isDirty: boolean;
  setDirty: (id: string, dirty: boolean) => void;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextType | undefined>(undefined);

export const UnsavedChangesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [dirtyRegistry, setDirtyRegistry] = useState<Set<string>>(new Set());

  const setDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyRegistry(prev => {
      const next = new Set(prev);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const isDirty = dirtyRegistry.size > 0;

  // Intercept native browser reloads or window closes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = ''; // Required by Chromium to trigger the native warning prompt
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  return <UnsavedChangesContext.Provider value={{ isDirty, setDirty }}>{children}</UnsavedChangesContext.Provider>;
};

export const useUnsavedChanges = (dirty: boolean, id: string = 'default') => {
  const context = useContext(UnsavedChangesContext);
  if (!context) throw new Error('useUnsavedChanges must be used within an UnsavedChangesProvider');
  
  const { setDirty } = context;
  useEffect(() => { setDirty(id, dirty); return () => setDirty(id, false); }, [dirty, id, setDirty]);
};

export const useIsDirty = () => {
  const context = useContext(UnsavedChangesContext);
  if (!context) throw new Error('useIsDirty must be used within an UnsavedChangesProvider');
  return context.isDirty;
};