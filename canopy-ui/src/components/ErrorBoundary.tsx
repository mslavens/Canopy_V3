import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', padding: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--status-red)', borderRadius: '8px', padding: '30px', maxWidth: '500px', width: '100%', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--status-red)', marginBottom: '15px' }}>
              <AlertTriangle size={24} />
              <h2 style={{ margin: 0, fontSize: '18px' }}>Application Render Fault</h2>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px', lineHeight: 1.5 }}>
              An unexpected UI rendering error occurred. The application state has been preserved, but the view could not be rendered.
            </p>
            <div style={{ backgroundColor: 'var(--bg-element)', padding: '10px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '11px', color: 'var(--status-red)', overflowX: 'auto', marginBottom: '20px', whiteSpace: 'pre-wrap' }}>
              {this.state.error?.message || 'Unknown render error'}
            </div>
            <button onClick={() => window.location.reload()} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'center', backgroundColor: 'var(--bg-element)', color: 'var(--text-main)', border: '1px solid var(--border-main)', padding: '10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>
              <RefreshCw size={14} /> Reload Workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}