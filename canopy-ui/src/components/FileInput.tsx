import React, { useImperativeHandle, useRef } from 'react';

interface FileInputProps {
  file: File | null;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  accept: string;
  disabled?: boolean;
}

export const FileInput = React.forwardRef<HTMLInputElement, FileInputProps>(({ file, onChange, accept, disabled }, ref) => {
  const internalInputRef = useRef<HTMLInputElement>(null);

  // Expose the internal ref to the parent via the passed ref
  useImperativeHandle(ref, () => internalInputRef.current!, []);

  const handleButtonClick = () => {
    internalInputRef.current?.click();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
      <input type="file" ref={internalInputRef} onChange={onChange} accept={accept} disabled={disabled} style={{ display: 'none' }} />
      <button type="button" className="btn-secondary" onClick={handleButtonClick} disabled={disabled}>
        Choose File...
      </button>
      <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: file ? 'normal' : 'italic', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file ? file.name : 'No file chosen'}
      </span>
    </div>
  );
});