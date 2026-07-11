import React from 'react';
import { HelpModal } from './HelpModal';

interface CommitHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommitHelpModal: React.FC<CommitHelpModalProps> = ({ isOpen, onClose }) => {
  return (
    <HelpModal 
      isOpen={isOpen} 
      onClose={onClose} 
      docId="workspace-commits" 
    />
  );
};
