import React from 'react';
import { Check } from 'lucide-react';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({ checked, onChange, label }) => {
  return (
    <label 
      style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onChange(!checked)}
    >
      <div style={{
        width: '16px', height: '16px', borderRadius: '4px',
        border: `1px solid ${checked ? 'var(--accent-blue)' : 'var(--border-main)'}`,
        backgroundColor: checked ? 'var(--accent-blue)' : 'var(--bg-app)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.1s ease'
      }}>
        {checked && <Check size={12} color="var(--bg-app)" strokeWidth={3} />}
      </div>
      <span style={{ color: 'var(--text-main)' }}>{label}</span>
    </label>
  );
};