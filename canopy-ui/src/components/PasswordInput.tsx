import React, { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface PasswordInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  showIcon?: boolean;
  autoFocus?: boolean;
}

export const PasswordInput: React.FC<PasswordInputProps> = ({ value, onChange, placeholder, showIcon = false, autoFocus = false }) => {
  const [showPassword, setShowPassword] = useState(false);

  const commonInputStyle: React.CSSProperties = {
    width: '100%',
    paddingRight: '35px',
    letterSpacing: showPassword || !value ? 'normal' : '2px',
  };

  const unlockPageStyle: React.CSSProperties = showIcon ? { paddingLeft: '40px', fontSize: '14px' } : {};

  return (
    <div style={{ position: 'relative' }}>
      {showIcon && <Lock style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />}
      <input type={showPassword ? "text" : "password"} placeholder={placeholder} value={value} onChange={onChange} className="input-text" style={{ ...commonInputStyle, ...unlockPageStyle }} autoFocus={autoFocus} />
      <div style={{ position: 'absolute', right: '10px', top: 0, bottom: 0, display: 'flex', alignItems: 'center', zIndex: 10 }}>
        <Tooltip content={showPassword ? "Hide" : "Show"} align="right" position="top">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setShowPassword(!showPassword)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, display: 'flex' }} tabIndex={-1}>
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </Tooltip>
      </div>
    </div>
  );
};