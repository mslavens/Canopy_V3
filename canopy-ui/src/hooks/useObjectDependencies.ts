import { useCallback } from 'react';

export interface DependencyCandidate {
  id: number | string;
  uuid?: string; // V3 does not have uuid column, but kept for compatibility
  name: string;
  device_uuid: string;
  [key: string]: any;
}

export interface ObjectDataSources {
  addresses: DependencyCandidate[];
  addressGroups: DependencyCandidate[];
  services: DependencyCandidate[];
  serviceGroups: DependencyCandidate[];
  applications: DependencyCandidate[];
  applicationGroups: DependencyCandidate[];
  tags: DependencyCandidate[];
  customObjects?: DependencyCandidate[];
  customObjectGroups?: DependencyCandidate[];
  securityRules?: DependencyCandidate[];
}

export interface DependencyResult {
  id: string | number;
  name: string;
  tableName: string;
  fieldName: string;
  typeLabel: string;
}

export const useObjectDependencies = () => {
  const getDependencies = useCallback(async (
    item: DependencyCandidate,
    type: string,
    dataSources: ObjectDataSources,
    apiClient?: any
  ): Promise<DependencyResult[]> => {
    if (!item || !type || !dataSources) return [];
    
    const dependencies: DependencyResult[] = [];
    const id = item.id;
    const name = item.name;

    // Helper to check in-memory tables
    const checkTable = (
      table: DependencyCandidate[] | undefined,
      tableName: string,
      field: string,
      label: string,
      checkName = false
    ) => {
      if (!table) return;
      
      try {
        const results = table.filter(obj => {
          const val = obj[field];
          if (!val) return false;
          
          if (Array.isArray(val)) {
            return (id && val.includes(id)) || (checkName && name && val.includes(name));
          }
          // In some cases, members might be comma-separated strings instead of arrays
          if (typeof val === 'string' && (field === 'member_list' || field === 'members')) {
            const arr = val.split(',');
            return (id && arr.includes(String(id))) || (checkName && name && arr.includes(name));
          }
          
          return (id && val === id) || (checkName && name && val === name);
        });

        results.forEach(res => {
          dependencies.push({
            id: res.id,
            name: res.name,
            tableName,
            fieldName: field,
            typeLabel: label
          });
        });
      } catch (error) {
        console.error(`Error checking dependencies in ${tableName}:`, error);
      }
    };

    // 1. Check in-memory group memberships
    if (type === 'address') {
      checkTable(dataSources.addressGroups, 'addressGroups', 'member_list', 'Address Group', true);
    } else if (type === 'service') {
      checkTable(dataSources.serviceGroups, 'serviceGroups', 'member_list', 'Service Group', true);
    } else if (type === 'application') {
      checkTable(dataSources.applicationGroups, 'applicationGroups', 'member_list', 'Application Group', true);
    } else if (type === 'addressGroup') {
      checkTable(dataSources.addressGroups, 'addressGroups', 'member_list', 'Address Group', true); // Nested groups
    } else if (type === 'serviceGroup') {
      checkTable(dataSources.serviceGroups, 'serviceGroups', 'member_list', 'Service Group', true); // Nested groups
    } else if (type === 'applicationGroup') {
      checkTable(dataSources.applicationGroups, 'applicationGroups', 'member_list', 'Application Group', true); // Nested groups
    }

    // 2. Query rules from backend API
    if (apiClient) {
      try {
        const url = new URL(`${apiClient.auth.url}/api/objects/dependencies`);
        if (id) url.searchParams.append('id', String(id));
        if (name) url.searchParams.append('name', String(name));
        url.searchParams.append('type', String(type));

        const res = await fetch(url.toString(), {
          headers: { 'Authorization': `Bearer ${apiClient.auth.token}` }
        });
        
        if (res.ok) {
          const rows = await res.json();
          if (rows && rows.length > 0) {
            rows.forEach((row: any) => {
              dependencies.push({
                id: row.id || 0,
                name: row.name,
                tableName: 'securityRules',
                fieldName: 'rules',
                typeLabel: row.typeLabel
              });
            });
          }
        }
      } catch (e) {
        console.error("Failed to query rule dependencies", e);
      }
    }

    return dependencies;
  }, []);

  return { getDependencies };
};
