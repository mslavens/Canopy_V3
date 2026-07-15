import React, { useState, useEffect } from 'react';
import { Calculator, Copy, Check, Info } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Dropdown } from '../../components/Dropdown';

const cidrToMask = (bits: number): string => {
  if (bits < 0 || bits > 32) return '';
  const mask = (bits === 0) ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return [
    (mask >>> 24) & 255,
    (mask >>> 16) & 255,
    (mask >>> 8) & 255,
    mask & 255
  ].join('.');
};

const maskToCidr = (mask: string): number | null => {
  const parts = mask.split('.');
  if (parts.length !== 4) return null;
  if (parts.some(p => isNaN(parseInt(p, 10)) || parseInt(p, 10) < 0 || parseInt(p, 10) > 255)) return null;
  
  const bin = parts.map(p => parseInt(p, 10).toString(2).padStart(8, '0')).join('');
  const indexOfZero = bin.indexOf('0');
  if (indexOfZero === -1) return 32;
  if (bin.slice(indexOfZero).includes('1')) return null;
  return indexOfZero;
};

const CIDR_OPTIONS = Array.from({ length: 33 }, (_, i) => ({
    label: `/${i} (${cidrToMask(i)})`,
    value: i.toString()
}));

const MASK_OPTIONS = Array.from({ length: 33 }, (_, i) => {
    const m = cidrToMask(i);
    return { label: `${m} (/${i})`, value: m };
});

interface SubnetResults {
  networkAddress: string;
  broadcastAddress: string;
  firstHost: string;
  lastHost: string;
  subnetMask: string;
  usableHosts: string;
  totalHosts: string;
  cidr: string;
  wildcardMask: string;
}

export const CIDRCalculator: React.FC = () => {
  const [ip, setIp] = useState('');
  const [cidr, setCidr] = useState('24');
  const [subnetMask, setSubnetMask] = useState('255.255.255.0');
  const [inputMode, setInputMode] = useState<'cidr' | 'mask'>('cidr');
  const [results, setResults] = useState<SubnetResults | null>(null);

  useEffect(() => {
    calculateSubnet();
  }, [ip, cidr]);

  useEffect(() => {
    if (inputMode === 'cidr') {
        const mask = cidrToMask(parseInt(cidr, 10));
        if (mask) setSubnetMask(mask);
    }
  }, [cidr, inputMode]);

  useEffect(() => {
    if (inputMode === 'mask') {
        const c = maskToCidr(subnetMask);
        if (c !== null) {
            setCidr(c.toString());
        } else {
            setCidr('-1');
        }
    }
  }, [subnetMask, inputMode]);

  const parseIpInput = (val: string) => {
    if (val.includes('/')) {
        const parts = val.split('/');
        const newIp = parts[0];
        const parsedCidr = parseInt(parts[1], 10);
        setIp(newIp);
        if (!isNaN(parsedCidr) && parsedCidr >= 0 && parsedCidr <= 32) {
            setInputMode('cidr');
            setCidr(parsedCidr.toString());
        }
    } else {
        setIp(val);
    }
  };

  const calculateSubnet = () => {
    const maskBits = parseInt(cidr, 10);
    if (isNaN(maskBits) || maskBits < 0 || maskBits > 32) {
        setResults(null);
        return;
    }

    const maskNum = (maskBits === 0 ? 0 : (~0 << (32 - maskBits))) >>> 0;
    const totalHosts = Math.pow(2, 32 - maskBits);
    const usableHosts = maskBits < 31 ? totalHosts - 2 : 0;

    const toIp = (num: number) => {
      return [
        (num >>> 24) & 255,
        (num >>> 16) & 255,
        (num >>> 8) & 255,
        num & 255
      ].join('.');
    };

    let networkAddress = 'N/A';
    let broadcastAddress = 'N/A';
    let firstHost = 'N/A';
    let lastHost = 'N/A';

    if (ip) {
        const ipParts = ip.split('.').map(Number);
        if (ipParts.length === 4 && !ipParts.some(p => isNaN(p) || p < 0 || p > 255)) {
            const ipNum = ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0;
            
            const networkNum = (ipNum & maskNum) >>> 0;
            const broadcastNum = (networkNum | (~maskNum)) >>> 0;
            
            const firstHostNum = (networkNum + 1) >>> 0;
            const lastHostNum = (broadcastNum - 1) >>> 0;

            networkAddress = toIp(networkNum);
            broadcastAddress = toIp(broadcastNum);
            firstHost = maskBits < 31 ? toIp(firstHostNum) : 'N/A';
            lastHost = maskBits < 31 ? toIp(lastHostNum) : 'N/A';
        }
    }

    setResults({
      networkAddress,
      broadcastAddress,
      firstHost,
      lastHost,
      subnetMask: toIp(maskNum),
      usableHosts: usableHosts.toLocaleString(),
      totalHosts: totalHosts.toLocaleString(),
      cidr: `/${maskBits}`,
      wildcardMask: toIp(~maskNum >>> 0)
    });
  };

  const handleQuickPreset = (presetCidr: string) => {
    setInputMode('cidr');
    setCidr(presetCidr);
  };

  const CopyButton = ({ text }: { text: string }) => {
      const [copied, setCopied] = useState(false);
      
      const handleCopy = () => {
          if (text === 'N/A') return;
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
      };

      return (
          <button 
            onClick={handleCopy} 
            style={{ 
              background: 'none', 
              border: 'none', 
              padding: '4px',
              cursor: text === 'N/A' ? 'default' : 'pointer',
              color: copied ? 'var(--status-green)' : (text === 'N/A' ? 'var(--border-main)' : 'var(--text-muted)'),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px'
            }}
            title="Copy"
          >
              {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
      );
  };

  const ResultRow = ({ label, value }: { label: string, value: string }) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-main)' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{label}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ color: 'var(--text-main)', fontFamily: 'monospace', fontSize: '13px' }}>{value}</span>
              <CopyButton text={value} />
          </div>
      </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader 
        title="CIDR Subnet Calculator" 
        description="Compute IP network ranges, boundaries, and host counts." 
      />
      
      <div style={{ padding: '25px', overflowY: 'auto' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            <div style={{ 
                backgroundColor: 'rgba(59, 130, 246, 0.1)', 
                border: '1px solid rgba(59, 130, 246, 0.3)', 
                borderRadius: '6px', 
                padding: '12px 16px', 
                display: 'flex', 
                gap: '12px', 
                alignItems: 'flex-start' 
            }}>
                <Info size={16} style={{ color: 'var(--accent-blue)', marginTop: '2px', flexShrink: 0 }} />
                <div style={{ fontSize: '13px', color: 'var(--text-main)', lineHeight: '1.5' }}>
                    <strong>How it works:</strong> Enter a <strong>Subnet Mask</strong> to see host counts and mask details. 
                    Add an <strong>IP Address</strong> (you can also paste an IP with a CIDR, e.g. <code>10.0.0.1/24</code>) to calculate the specific Network Address, Broadcast Address, and usable IP range.
                </div>
            </div>
            
            <section style={{ backgroundColor: 'var(--bg-surface)', padding: '25px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>IP Address</label>
                    <input 
                      type="text" 
                      value={ip}
                      onChange={(e) => parseIpInput(e.target.value)}
                      placeholder="e.g. 192.168.1.1"
                      style={{
                        padding: '10px 12px',
                        backgroundColor: 'var(--bg-app)',
                        border: '1px solid var(--border-main)',
                        borderRadius: '6px',
                        color: 'var(--text-main)',
                        fontSize: '14px',
                        width: '100%',
                        outline: 'none'
                      }}
                      onFocus={(e) => e.target.style.borderColor = 'var(--accent-blue)'}
                      onBlur={(e) => e.target.style.borderColor = 'var(--border-main)'}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>Subnet Mask / Prefix</label>
                      <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                          <input 
                            type="radio" 
                            name="format" 
                            checked={inputMode === 'cidr'} 
                            onChange={() => setInputMode('cidr')}
                            style={{ margin: 0 }}
                          />
                          CIDR
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                          <input 
                            type="radio" 
                            name="format" 
                            checked={inputMode === 'mask'} 
                            onChange={() => setInputMode('mask')}
                            style={{ margin: 0 }}
                          />
                          Mask
                        </label>
                      </div>
                    </div>
                    
                    {inputMode === 'cidr' ? (
                      <Dropdown 
                        value={cidr}
                        onChange={setCidr}
                        options={CIDR_OPTIONS.map(opt => opt.value)}
                        renderOption={(val) => CIDR_OPTIONS.find(opt => opt.value === val)?.label}
                        width="100%"
                      />
                    ) : (
                      <Dropdown 
                        value={subnetMask}
                        onChange={setSubnetMask}
                        options={MASK_OPTIONS.map(opt => opt.value)}
                        renderOption={(val) => MASK_OPTIONS.find(opt => opt.value === val)?.label}
                        width="100%"
                      />
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'right', marginTop: '4px' }}>
                      {inputMode === 'cidr' ? `Mask: ${subnetMask}` : `CIDR: /${cidr}`}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Quick Presets</label>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {[
                        { label: 'Class A', cidr: '8' },
                        { label: 'Class B', cidr: '16' },
                        { label: 'Class C', cidr: '24' },
                        { label: 'P2P', cidr: '30' },
                        { label: 'Host', cidr: '32' }
                      ].map(preset => (
                        <button
                          key={preset.cidr}
                          onClick={() => handleQuickPreset(preset.cidr)}
                          style={{
                            backgroundColor: 'var(--bg-app)',
                            border: `1px solid ${cidr === preset.cidr ? 'var(--accent-blue)' : 'var(--border-main)'}`,
                            color: cidr === preset.cidr ? 'var(--accent-blue)' : 'var(--text-main)',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          {preset.label} <span style={{ color: 'var(--text-muted)' }}>(/{preset.cidr})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ backgroundColor: 'var(--bg-app)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-main)' }}>
                  {results && (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <ResultRow label="Network Address" value={results.networkAddress} />
                      <ResultRow label="Broadcast Address" value={results.broadcastAddress} />
                      <ResultRow label="Subnet Mask" value={results.subnetMask} />
                      <ResultRow label="Wildcard Mask" value={results.wildcardMask} />
                      <ResultRow label="First Usable Host" value={results.firstHost} />
                      <ResultRow label="Last Usable Host" value={results.lastHost} />
                      <ResultRow label="Usable Hosts" value={results.usableHosts} />
                      <ResultRow label="Total Hosts" value={results.totalHosts} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>CIDR Notation</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ color: 'var(--text-main)', fontFamily: 'monospace', fontSize: '13px' }}>{results.cidr}</span>
                              <CopyButton text={results.cidr} />
                          </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
        </div>
      </div>
    </div>
  );
};
