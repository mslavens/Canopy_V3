export class CanopyApiClient {
  public auth: { url: string; token: string };
  private baseUrl: string;
  private token: string;

  constructor(auth: { url: string; token: string }) {
    this.auth = auth;
    this.baseUrl = auth.url;
    this.token = auth.token;
  }

  public async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.token}`);
    
    // Robust check for FormData to prevent boundary corruption
    const isFormData = options.body && (
      options.body instanceof FormData || 
      (typeof (options.body as any).append === 'function' && Object.prototype.toString.call(options.body) === '[object FormData]')
    );

    if (options.body && !isFormData) {
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

  public async downloadBlob(endpoint: string, options?: RequestInit): Promise<Blob> {
    const headers = new Headers(options?.headers || {});
    headers.set('Authorization', `Bearer ${this.token}`);

    if (options?.body && typeof options.body === 'string') {
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

    return response.blob();
  }

  public async streamRequest(endpoint: string, options?: RequestInit): Promise<Response> {
    const headers = new Headers(options?.headers || {});
    headers.set('Authorization', `Bearer ${this.token}`);

    if (options?.body && typeof options.body === 'string') {
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

    return response;
  }

  // System Inspector Only
  public inspectDb = (query: string) => this.request<any>('/api/system/db-inspector', { method: 'POST', body: JSON.stringify({ query }) });
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
  public getAdapters = () => this.request<string[]>('/api/system/adapters');
  public rollbackSystem = () => this.request<any>('/api/system/rollback', { method: 'POST' });
  public importDeviceXml = (formData: FormData, preview: boolean = false) => this.streamRequest(`/api/devices/import?preview=${preview}`, { method: 'POST', body: formData });

  // Workspaces
  public getWorkspaces = () => this.request<any[]>('/api/workspaces');
  public createWorkspace = (name: string, color: string) => this.request<any>('/api/workspaces/create', { method: 'POST', body: JSON.stringify({ name, color }) });
  public switchWorkspace = (id: number) => this.request<any>('/api/workspaces/switch', { method: 'POST', body: JSON.stringify({ id }) });
  public updateWorkspace = (id: number, name: string, color: string) => this.request<any>('/api/workspaces/update', { method: 'POST', body: JSON.stringify({ id, name, color }) });
  public deleteWorkspace = (id: number) => this.request<any>('/api/workspaces/delete', { method: 'POST', body: JSON.stringify({ id }) });
  public importWorkspace = (formData: FormData) => this.request<any>('/api/workspaces/import', { method: 'POST', body: formData });
  public healWorkspace = () => this.request<any>('/api/workspaces/heal', { method: 'POST' });
  public downloadWorkspace = (id: number, archive_password: string) => this.streamRequest('/api/workspaces/export', { method: 'POST', body: JSON.stringify({ id, archive_password }) });
  
  public search = (query: string) => this.request<any[]>(`/api/search?q=${encodeURIComponent(query)}`);

  // Networks & Variables
  public getNetworksZones = (deviceUuid?: string) => this.request<any[]>(`/api/networks/zones${deviceUuid ? `?device_uuid=${deviceUuid}` : ''}`);
  public saveNetworksZone = (payload: any) => this.request<any>('/api/networks/zones/save', { method: 'POST', body: JSON.stringify(payload) });
  public deleteNetworksZonesBatch = (ids: number[]) => this.request<any>('/api/networks/zones/delete-batch', { method: 'POST', body: JSON.stringify({ ids }) });

  public getNetworksInterfaces = (deviceUuid?: string) => this.request<any[]>(`/api/networks/interfaces${deviceUuid ? `?device_uuid=${deviceUuid}` : ''}`);
  public saveNetworksInterface = (payload: any) => this.request<any>('/api/networks/interfaces/save', { method: 'POST', body: JSON.stringify(payload) });
  public deleteNetworksInterfacesBatch = (ids: number[]) => this.request<any>('/api/networks/interfaces/delete-batch', { method: 'POST', body: JSON.stringify({ ids }) });

  public getNetworksRoutes = (deviceUuid?: string) => this.request<any[]>(`/api/networks/routes${deviceUuid ? `?device_uuid=${deviceUuid}` : ''}`);
  public saveNetworksRoute = (payload: any) => this.request<any>('/api/networks/routes/save', { method: 'POST', body: JSON.stringify(payload) });
  public deleteNetworksRoutesBatch = (ids: number[]) => this.request<any>('/api/networks/routes/delete-batch', { method: 'POST', body: JSON.stringify({ ids }) });

  public getNetworkCounts = (scopesStr: string) => this.request<any>(`/api/networks/counts?scopes=${encodeURIComponent(scopesStr)}`);
  
  public getVariables = (deviceUuid?: string) => {
    let url = '/api/variables';
    if (deviceUuid && deviceUuid !== 'show-all') {
      url += `?device_uuid=${encodeURIComponent(deviceUuid)}`;
    }
    return this.request<any[]>(url);
  };
  public saveVariable = (payload: any) => this.request<any>('/api/variables/save', { method: 'POST', body: JSON.stringify(payload) });
  public deleteVariablesBatch = (ids: number[]) => this.request<any>('/api/variables/delete-batch', { method: 'POST', body: JSON.stringify({ ids }) });

  // System & Context
  public getHierarchyContext = (countTable: string) => this.request<any>(`/api/system/hierarchy-context?count_table=${encodeURIComponent(countTable)}`);
  public getPoliciesContext = (countTable?: string, rulebase?: string) => {
    let url = '/api/system/policies-context';
    const params = new URLSearchParams();
    if (countTable) params.append('count_table', countTable);
    if (rulebase) params.append('rulebase', rulebase);
    if (params.toString()) url += `?${params.toString()}`;
    return this.request<any>(url);
  };
  public getObjectsReference = () => this.request<any>('/api/system/objects-reference');
  public globalSearch = (query: string) => this.request<any>(`/api/search?q=${encodeURIComponent(query)}`);
  public getChangelog = async () => {
    const response = await fetch('/docs/changelog.md');
    if (!response.ok) throw new Error('Failed to load changelog');
    return response.text();
  };
  public getManualDoc = async (docId: string) => {
    const response = await fetch(`/docs/manual/${docId}.md`);
    if (!response.ok) throw new Error(`Failed to load manual doc: ${docId}`);
    return response.text();
  };

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
  public downloadSnapshot = (id: string, archive_password: string) => this.streamRequest('/api/system/snapshots/export', { method: 'POST', body: JSON.stringify({ id, archive_password }) });
  public revertSnapshot = (id: string) => this.request<any>('/api/system/snapshots/revert', { method: 'POST', body: JSON.stringify({ id }) });
  public importSnapshot = (formData: FormData) => this.request<any>('/api/system/snapshots/import', { method: 'POST', body: formData });
  public exportSnapshots = () => this.request<any>('/api/system/snapshots/export');

  // Audit Logs
  public getAuditLogs = () => this.request<any[]>('/api/audit/logs');

  // Device Groups CRUD
  public createDeviceGroup = (name: string, vendor: string, parentId: number | null, description: string | null = null) => this.request<any>('/api/device-groups/create', { method: 'POST', body: JSON.stringify({ name, vendor, parent_id: parentId, description }) });
  public updateDeviceGroup = (id: number, name: string, vendor: string, parentId: number | null, description: string | null = null) => this.request<any>('/api/device-groups/update', { method: 'POST', body: JSON.stringify({ id, name, vendor, parent_id: parentId, description }) });
  public deleteDeviceGroup = (id: number) => this.request<any>('/api/device-groups/delete', { method: 'POST', body: JSON.stringify({ id }) });

  // Templates CRUD
  public createTemplate = (name: string, vendor: string, description: string = '') => this.request<any>('/api/templates/create', { method: 'POST', body: JSON.stringify({ name, vendor, description }) });
  public updateTemplate = (id: number, name: string, vendor: string, description: string = '') => this.request<any>('/api/templates/update', { method: 'POST', body: JSON.stringify({ id, name, vendor, description }) });
  public deleteTemplate = (id: number) => this.request<any>('/api/templates/delete', { method: 'POST', body: JSON.stringify({ id }) });

  // Template Stacks CRUD
  public createTemplateStack = (name: string, vendor: string, templateIds: number[], description: string = '') => this.request<any>('/api/template-stacks/create', { method: 'POST', body: JSON.stringify({ name, vendor, template_ids: templateIds, description }) });
  public updateTemplateStack = (id: number, name: string, vendor: string, templateIds: number[], description: string = '') => this.request<any>('/api/template-stacks/update', { method: 'POST', body: JSON.stringify({ id, name, vendor, template_ids: templateIds, description }) });
  public deleteTemplateStack = (id: number) => this.request<any>('/api/template-stacks/delete', { method: 'POST', body: JSON.stringify({ id }) });

  // Devices CRUD
  public getDevicesInventory = () => this.request<any>('/api/devices/inventory');
  public createDevice = (name: string, serial: string, ipAddress: string, vendor: string, deviceGroupId: number | null, templateStackId: number | null, templateId: number | null) => this.request<any>('/api/devices/create', { method: 'POST', body: JSON.stringify({ name, serial, ip_address: ipAddress, vendor, device_group_id: deviceGroupId, template_stack_id: templateStackId, template_id: templateId }) });
  public updateDevice = (id: number, name: string, serial: string, ipAddress: string, vendor: string, deviceGroupId: number | null, templateStackId: number | null, templateId: number | null) => this.request<any>('/api/devices/update', { method: 'POST', body: JSON.stringify({ id, name, serial, ip_address: ipAddress, vendor, device_group_id: deviceGroupId, template_stack_id: templateStackId, template_id: templateId }) });
  public deleteDevice = (id: number) => this.request<any>('/api/devices/delete', { method: 'POST', body: JSON.stringify({ id }) });

  // Objects & Policies
  public getObjects = (type: string, scopesStr?: string) => {
    let url = `/api/objects?type=${encodeURIComponent(type)}`;
    if (scopesStr) url += `&scopes=${encodeURIComponent(scopesStr)}`;
    return this.request<any[]>(url);
  };
  public getObjectCounts = (scopesStr: string) => this.request<any>(`/api/objects/counts?scopes=${encodeURIComponent(scopesStr)}`);
  public getObjectDependencies = (type: string, id?: string, name?: string) => {
    const params = new URLSearchParams();
    if (id) params.append('id', id);
    if (name) params.append('name', name);
    params.append('type', type);
    return this.request<any[]>(`/api/objects/dependencies?${params.toString()}`);
  };
  public getGroupMembers = (groupId: number, type: string, flatten: boolean) => this.request<any>(`/api/objects/group-members?group_id=${groupId}&type=${encodeURIComponent(type)}&flatten=${flatten}`);
  public getPolicies = (type: string, scope: string, rulebase: string) => this.request<any>(`/api/policies?type=${encodeURIComponent(type)}&scope=${encodeURIComponent(scope)}&rulebase=${encodeURIComponent(rulebase)}`);

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

  // Logs API
  public getLogs = (client_id: string, limit: number = 50, offset: number = 0) => this.request<{data: any[], total: number, limit: number, offset: number}>(`/api/logs?client_id=${client_id}&limit=${limit}&offset=${offset}`);
  public getLogHeatmap = (client_id: string, x_axis: string[], y_axis: string[]) => {
    const params = new URLSearchParams({ client_id });
    if (x_axis?.length) params.append('x_axis', x_axis.join(','));
    if (y_axis?.length) params.append('y_axis', y_axis.join(','));
    return this.request<any>(`/api/logs/heatmap?${params.toString()}`);
  };
  public importLogs = (client_id: string, formData: FormData) => this.request<any>(`/api/logs/import?client_id=${client_id}`, { method: 'POST', body: formData });
  public deleteLogs = (client_id: string) => this.request<any>(`/api/logs/delete?client_id=${client_id}`, { method: 'DELETE' });
  public deleteLogsBatch = (client_id: string, ids: string[]) => this.request<any>(`/api/logs/delete-batch?client_id=${client_id}`, { method: 'POST', body: JSON.stringify({ ids }) });
  public generateCandidateRules = (client_id: string, passes: any[], limit: number = 1000, activeCellFilter: Record<string, string[]>[] = [], analysisColumns: string[] = []) => this.request<any>(`/api/logs/candidates`, { method: 'POST', body: JSON.stringify({ client_id, passes, limit, active_cell_filter: activeCellFilter, analysis_columns: analysisColumns }) });
  public getLogSchema = () => this.request<string[]>(`/api/logs/schema`);

  // CLI Engine
  public generateCliCommands = (payload: { entityType: string, entityIds: number[], scopeUuid: string, includeNested: boolean }) => 
    this.request<{commands: string[]}>('/api/cli/generate', { method: 'POST', body: JSON.stringify(payload) });
}