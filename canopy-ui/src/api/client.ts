export class CanopyApiClient {
  private baseUrl: string;
  private token: string;

  constructor(auth: { url: string; token: string }) {
    this.baseUrl = auth.url;
    this.token = auth.token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.token}`);
    if (options.body && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMessage = `Engine fault (${response.status}): ${text}`;
      try {
        const data = JSON.parse(text);
        if (data && data.error) errorMessage = data.error;
      } catch (e) { /* fallback to raw text */ }
      throw new Error(errorMessage);
    }

    // Handle cases with no content
    if (response.status === 204) {
      return null as T;
    }

    return response.json();
  }

  public queryDb = (query: string) => this.request<any>('/api/db/query', { method: 'POST', body: JSON.stringify({ query }) });
  public healthCheck = () => this.request<any>('/api/health');
  public lockVault = () => this.request<any>('/api/vault/lock', { method: 'POST' });
  public wipeVault = () => this.request<any>('/api/vault/wipe', { method: 'POST' });
  public setupVault = (password: string) => this.request<any>('/api/init', { method: 'POST', body: JSON.stringify({ password }) });
  public unlockVault = (password: string) => this.request<any>('/api/vault/unlock', { method: 'POST', body: JSON.stringify({ password }) });
  public rekeyVault = (current_password: string, new_password: string) => this.request<any>('/api/vault/rekey', { method: 'POST', body: JSON.stringify({ current_password, new_password }) });
  public resolvePath = (source_ip: string, destination_ip: string) => this.request<any>('/api/paths/resolve', { method: 'POST', body: JSON.stringify({ source_ip, destination_ip }) });
  public getLogLevel = () => this.request<{level: string}>('/api/system/loglevel');
  public setLogLevel = (level: string) => this.request<{level: string}>('/api/system/loglevel', { method: 'POST', body: JSON.stringify({ level }) });
  public inspectPatch = (formData: FormData) => this.request<any>('/api/system/patch/inspect', { method: 'POST', body: formData });
  public applyPatch = (formData: FormData) => this.request<any>('/api/system/patch', { method: 'POST', body: formData });
  public rollbackSystem = () => this.request<any>('/api/system/rollback', { method: 'POST' });

  // Workspaces
  public getWorkspaces = () => this.request<any[]>('/api/workspaces');
  public createWorkspace = (name: string, color: string) => this.request<any>('/api/workspaces/create', { method: 'POST', body: JSON.stringify({ name, color }) });
  public switchWorkspace = (id: number) => this.request<any>('/api/workspaces/switch', { method: 'POST', body: JSON.stringify({ id }) });
  public updateWorkspace = (id: number, name: string, color: string) => this.request<any>('/api/workspaces/update', { method: 'POST', body: JSON.stringify({ id, name, color }) });
  public deleteWorkspace = (id: number) => this.request<any>('/api/workspaces/delete', { method: 'POST', body: JSON.stringify({ id }) });
  public importWorkspace = (formData: FormData) => this.request<any>('/api/workspaces/import', { method: 'POST', body: formData });

  // Secrets Vault
  public getSecrets = () => this.request<any[]>('/api/secrets');
  public createSecret = (name: string, description: string, secret_value: string) => this.request<any>('/api/secrets/create', { method: 'POST', body: JSON.stringify({ name, description, secret_value }) });
  public updateSecret = (id: number, name: string, description: string, secret_value: string) => this.request<any>('/api/secrets/update', { method: 'POST', body: JSON.stringify({ id, name, description, secret_value }) });
  public deleteSecret = (id: number) => this.request<any>('/api/secrets/delete', { method: 'POST', body: JSON.stringify({ id }) });
  public revealSecret = (id: number) => this.request<{secret_value: string}>('/api/secrets/reveal', { method: 'POST', body: JSON.stringify({ id }) });

  // Snapshots
  public getSnapshots = () => this.request<any[]>('/api/system/snapshots');
  public createSnapshot = (description: string) => this.request<any>('/api/system/snapshots/create', { method: 'POST', body: JSON.stringify({ description }) });
  public updateSnapshot = (id: string, description: string) => this.request<any>('/api/system/snapshots/update', { method: 'POST', body: JSON.stringify({ id, description }) });
  public deleteSnapshot = (id: string) => this.request<any>('/api/system/snapshots/delete', { method: 'POST', body: JSON.stringify({ id }) });
  public revertSnapshot = (id: string) => this.request<any>('/api/system/snapshots/revert', { method: 'POST', body: JSON.stringify({ id }) });
  public importSnapshot = (formData: FormData) => this.request<any>('/api/system/snapshots/import', { method: 'POST', body: formData });

  // Audit Logs
  public getAuditLogs = () => this.request<any[]>('/api/audit/logs');
}