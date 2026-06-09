export interface Strength {
  score: number;
  label: string;
  color: string;
}

export const calculateStrength = (pass: string): Strength => {
  let score = 0;
  if (!pass) return { score: 0, label: '', color: 'transparent' };
  if (pass.length >= 8) score += 1;
  if (/[A-Z]/.test(pass)) score += 1;
  if (/[a-z]/.test(pass)) score += 1;
  if (/[0-9]/.test(pass)) score += 1;
  if (/[^A-Za-z0-9]/.test(pass)) score += 1;

  if (score <= 2) return { score, label: 'Weak', color: 'var(--status-red)' };
  if (score <= 4) return { score, label: 'Fair', color: 'var(--status-warn)' };
  return { score, label: 'Strong', color: 'var(--status-green)' };
};