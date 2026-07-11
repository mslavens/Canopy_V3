import React from 'react';
import { HelpModal } from './HelpModal';

interface CommitHistoryHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommitHistoryHelpModal: React.FC<CommitHistoryHelpModalProps> = ({ isOpen, onClose }) => {
  return (
    <HelpModal 
      isOpen={isOpen} 
      onClose={onClose} 
      docId="system-commit-history" 
    />
  );
};
