import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { Modal } from './Modal';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => void;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

export const useConfirm = () => {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used within a ConfirmProvider');
  return context.confirm;
};

export const ConfirmProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
  }, []);

  const handleClose = useCallback(() => setOptions(null), []);
  const handleConfirm = useCallback(() => {
    if (options) {
      options.onConfirm();
      setOptions(null);
    }
  }, [options]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Modal isOpen={options !== null} onClose={handleClose} title={options?.title || ''} size="sm" footer={
        <>
          <button className="btn-secondary btn-sm" onClick={handleClose}>Cancel</button>
          <button className={options?.isDestructive ? "btn-danger btn-sm" : "btn-primary btn-sm"} onClick={handleConfirm}>{options?.confirmText || 'Confirm'}</button>
        </>
      }><p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-muted)' }}>{options?.message}</p></Modal>
    </ConfirmContext.Provider>
  );
};