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
      if (response.status === 401 || response.status === 423) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('vault-locked'));
        }
      }
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
      if (options.method && ['POST', 'PUT', 'DELETE'].includes(options.method.toUpperCase())) {
        if (!endpoint.includes('/api/db/query') && !endpoint.includes('/api/vault') && !endpoint.includes('/api/system')) {
          if (window.electron && window.electron.broadcastMutation) {
            window.electron.broadcastMutation();
          }
        }
      }
      return null as T;
    }

    const data = await response.json();

    // Broadcast mutation after successfully parsing the JSON response
    if (options.method && ['POST', 'PUT', 'DELETE'].includes(options.method.toUpperCase())) {
      if (!endpoint.includes('/api/db/query') && !endpoint.includes('/api/vault') && !endpoint.includes('/api/system')) {
        if (window.electron && window.electron.broadcastMutation) {
          window.electron.broadcastMutation();
        }
      }
    }

    return data;
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
  public importDeviceXml = (formData: FormData, preview: boolean = false) => this.request<any>(`/api/devices/import?preview=${preview}`, { method: 'POST', body: formData });

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

  // Device Groups CRUD
  public createDeviceGroup = (name: string, parentId: number | null) => this.request<any>('/api/device-groups/create', { method: 'POST', body: JSON.stringify({ name, parent_id: parentId }) });
  public updateDeviceGroup = (id: number, name: string, parentId: number | null) => this.request<any>('/api/device-groups/update', { method: 'POST', body: JSON.stringify({ id, name, parent_id: parentId }) });
  public deleteDeviceGroup = (id: number) => this.request<any>('/api/device-groups/delete', { method: 'POST', body: JSON.stringify({ id }) });

  // Templates CRUD
  public createTemplate = (name: string) => this.request<any>('/api/templates/create', { method: 'POST', body: JSON.stringify({ name }) });
  public updateTemplate = (id: number, name: string) => this.request<any>('/api/templates/update', { method: 'POST', body: JSON.stringify({ id, name }) });
  public deleteTemplate = (id: number) => this.request<any>('/api/templates/delete', { method: 'POST', body: JSON.stringify({ id }) });

  // Template Stacks CRUD
  public createTemplateStack = (name: string, templateIds: number[]) => this.request<any>('/api/template-stacks/create', { method: 'POST', body: JSON.stringify({ name, template_ids: templateIds }) });
  public updateTemplateStack = (id: number, name: string, templateIds: number[]) => this.request<any>('/api/template-stacks/update', { method: 'POST', body: JSON.stringify({ id, name, template_ids: templateIds }) });
  public deleteTemplateStack = (id: number) => this.request<any>('/api/template-stacks/delete', { method: 'POST', body: JSON.stringify({ id }) });

  // Devices CRUD
  public createDevice = (name: string, serial: string, ipAddress: string, deviceGroupId: number | null, templateStackId: number | null, templateId: number | null) => this.request<any>('/api/devices/create', { method: 'POST', body: JSON.stringify({ name, serial, ip_address: ipAddress, device_group_id: deviceGroupId, template_stack_id: templateStackId, template_id: templateId }) });
  public updateDevice = (id: number, name: string, serial: string, ipAddress: string, deviceGroupId: number | null, templateStackId: number | null, templateId: number | null) => this.request<any>('/api/devices/update', { method: 'POST', body: JSON.stringify({ id, name, serial, ip_address: ipAddress, device_group_id: deviceGroupId, template_stack_id: templateStackId, template_id: templateId }) });
  public deleteDevice = (id: number) => this.request<any>('/api/devices/delete', { method: 'POST', body: JSON.stringify({ id }) });

  // Objects CRUD
  public createAddressObject = (data: any) => this.request<any>('/api/objects/address/create', { method: 'POST', body: JSON.stringify(data) });
  public updateAddressObject = (data: any) => this.request<any>('/api/objects/address/update', { method: 'POST', body: JSON.stringify(data) });
  public deleteAddressObject = (id: number) => this.request<any>('/api/objects/address/delete', { method: 'POST', body: JSON.stringify({ id }) });

  public createAddressGroup = (data: any) => this.request<any>('/api/objects/address-group/create', { method: 'POST', body: JSON.stringify(data) });
  public updateAddressGroup = (data: any) => this.request<any>('/api/objects/address-group/update', { method: 'POST', body: JSON.stringify(data) });
  public deleteAddressGroup = (id: number) => this.request<any>('/api/objects/address-group/delete', { method: 'POST', body: JSON.stringify({ id }) });

  public createServiceObject = (data: any) => this.request<any>('/api/objects/service/create', { method: 'POST', body: JSON.stringify(data) });
  public updateServiceObject = (data: any) => this.request<any>('/api/objects/service/update', { method: 'POST', body: JSON.stringify(data) });
  public deleteServiceObject = (id: number) => this.request<any>('/api/objects/service/delete', { method: 'POST', body: JSON.stringify({ id }) });

  public createServiceGroup = (data: any) => this.request<any>('/api/objects/service-group/create', { method: 'POST', body: JSON.stringify(data) });
  public updateServiceGroup = (data: any) => this.request<any>('/api/objects/service-group/update', { method: 'POST', body: JSON.stringify(data) });
  public deleteServiceGroup = (id: number) => this.request<any>('/api/objects/service-group/delete', { method: 'POST', body: JSON.stringify({ id }) });

  public createApplicationObject = (data: any) => this.request<any>('/api/objects/application/create', { method: 'POST', body: JSON.stringify(data) });
  public updateApplicationObject = (data: any) => this.request<any>('/api/objects/application/update', { method: 'POST', body: JSON.stringify(data) });
  public deleteApplicationObject = (id: number) => this.request<any>('/api/objects/application/delete', { method: 'POST', body: JSON.stringify({ id }) });

  public createApplicationGroup = (data: any) => this.request<any>('/api/objects/application-group/create', { method: 'POST', body: JSON.stringify(data) });
  public updateApplicationGroup = (data: any) => this.request<any>('/api/objects/application-group/update', { method: 'POST', body: JSON.stringify(data) });
  public deleteApplicationGroup = (id: number) => this.request<any>('/api/objects/application-group/delete', { method: 'POST', body: JSON.stringify({ id }) });

  public importApplicationCSV = (formData: FormData) => this.request<any>('/api/objects/application/import-csv', { method: 'POST', body: formData });

  // Tags CRUD
  public createTag = (data: any) => this.request<any>('/api/objects/tag/create', { method: 'POST', body: JSON.stringify(data) });
  public updateTag = (data: any) => this.request<any>('/api/objects/tag/update', { method: 'POST', body: JSON.stringify(data) });
  public deleteTag = (id: number) => this.request<any>('/api/objects/tag/delete', { method: 'POST', body: JSON.stringify({ id }) });

  // Log Forwarding Profiles CRUD
  public createLogForwardingProfile = (data: any) => this.request<any>('/api/objects/log-forwarding-profile/create', { method: 'POST', body: JSON.stringify(data) });
  public updateLogForwardingProfile = (data: any) => this.request<any>('/api/objects/log-forwarding-profile/update', { method: 'POST', body: JSON.stringify(data) });
  public deleteLogForwardingProfile = (id: number) => this.request<any>('/api/objects/log-forwarding-profile/delete', { method: 'POST', body: JSON.stringify({ id }) });

  // Security Profiles CRUD
  public createSecurityProfile = (data: any) => this.request<any>('/api/objects/security-profile/create', { method: 'POST', body: JSON.stringify(data) });
  public updateSecurityProfile = (data: any) => this.request<any>('/api/objects/security-profile/update', { method: 'POST', body: JSON.stringify(data) });
  public deleteSecurityProfile = (id: number) => this.request<any>('/api/objects/security-profile/delete', { method: 'POST', body: JSON.stringify({ id }) });

  // Security Profile Groups CRUD
  public createSecurityProfileGroup = (data: any) => this.request<any>('/api/objects/security-profile-group/create', { method: 'POST', body: JSON.stringify(data) });
  public updateSecurityProfileGroup = (data: any) => this.request<any>('/api/objects/security-profile-group/update', { method: 'POST', body: JSON.stringify(data) });
  public deleteSecurityProfileGroup = (id: number) => this.request<any>('/api/objects/security-profile-group/delete', { method: 'POST', body: JSON.stringify({ id }) });

  // Custom URL Categories CRUD
  public createCustomURLCategory = (data: any) => this.request<any>('/api/objects/custom-url-category/create', { method: 'POST', body: JSON.stringify(data) });
  public updateCustomURLCategory = (data: any) => this.request<any>('/api/objects/custom-url-category/update', { method: 'POST', body: JSON.stringify(data) });
  public deleteCustomURLCategory = (id: number) => this.request<any>('/api/objects/custom-url-category/delete', { method: 'POST', body: JSON.stringify({ id }) });

  // EDLs CRUD
  public createExternalDynamicList = (data: any) => this.request<any>('/api/objects/external-dynamic-list/create', { method: 'POST', body: JSON.stringify(data) });
  public updateExternalDynamicList = (data: any) => this.request<any>('/api/objects/external-dynamic-list/update', { method: 'POST', body: JSON.stringify(data) });
  public deleteExternalDynamicList = (id: number) => this.request<any>('/api/objects/external-dynamic-list/delete', { method: 'POST', body: JSON.stringify({ id }) });
}