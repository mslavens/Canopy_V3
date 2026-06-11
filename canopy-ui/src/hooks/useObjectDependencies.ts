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

    // 2. Query rules from SQLite DB via API client (checking both ID and Name references)
    if (apiClient) {
      let query = '';
      let params: any[] = [];
      
      if (type === 'address') {
        query = `
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule (Source)' AS typeLabel FROM rule_address_mappings ram JOIN security_rules sr ON ram.rule_id = sr.id AND ram.rule_type = 'security' WHERE ram.direction = 'source' AND (ram.address_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule (Destination)' AS typeLabel FROM rule_address_mappings ram JOIN security_rules sr ON ram.rule_id = sr.id AND ram.rule_type = 'security' WHERE ram.direction = 'destination' AND (ram.address_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT nr.rule_name AS name, 'NAT Rule (Source)' AS typeLabel FROM rule_address_mappings ram JOIN nat_rules nr ON ram.rule_id = nr.id AND ram.rule_type = 'nat' WHERE ram.direction = 'source' AND (ram.address_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT nr.rule_name AS name, 'NAT Rule (Destination)' AS typeLabel FROM rule_address_mappings ram JOIN nat_rules nr ON ram.rule_id = nr.id AND ram.rule_type = 'nat' WHERE ram.direction = 'destination' AND (ram.address_id = ? OR ram.ad_hoc_value = ?)
        `;
        params = [id, name, id, name, id, name, id, name];
      } else if (type === 'addressGroup') {
        query = `
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule (Source)' AS typeLabel FROM rule_address_mappings ram JOIN security_rules sr ON ram.rule_id = sr.id AND ram.rule_type = 'security' WHERE ram.direction = 'source' AND (ram.group_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule (Destination)' AS typeLabel FROM rule_address_mappings ram JOIN security_rules sr ON ram.rule_id = sr.id AND ram.rule_type = 'security' WHERE ram.direction = 'destination' AND (ram.group_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT nr.rule_name AS name, 'NAT Rule (Source)' AS typeLabel FROM rule_address_mappings ram JOIN nat_rules nr ON ram.rule_id = nr.id AND ram.rule_type = 'nat' WHERE ram.direction = 'source' AND (ram.group_id = ? OR ram.ad_hoc_value = ?)
          UNION
          SELECT DISTINCT nr.rule_name AS name, 'NAT Rule (Destination)' AS typeLabel FROM rule_address_mappings ram JOIN nat_rules nr ON ram.rule_id = nr.id AND ram.rule_type = 'nat' WHERE ram.direction = 'destination' AND (ram.group_id = ? OR ram.ad_hoc_value = ?)
        `;
        params = [id, name, id, name, id, name, id, name];
      } else if (type === 'service') {
        query = `
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule' AS typeLabel FROM rule_service_mappings rsm JOIN security_rules sr ON rsm.rule_id = sr.id AND rsm.rule_type = 'security' WHERE rsm.service_id = ? OR rsm.ad_hoc_value = ?
          UNION
          SELECT DISTINCT nr.rule_name AS name, 'NAT Rule' AS typeLabel FROM rule_service_mappings rsm JOIN nat_rules nr ON rsm.rule_id = nr.id AND rsm.rule_type = 'nat' WHERE rsm.service_id = ? OR rsm.ad_hoc_value = ?
        `;
        params = [id, name, id, name];
      } else if (type === 'serviceGroup') {
        query = `
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule' AS typeLabel FROM rule_service_mappings rsm JOIN security_rules sr ON rsm.rule_id = sr.id AND rsm.rule_type = 'security' WHERE rsm.group_id = ? OR rsm.ad_hoc_value = ?
          UNION
          SELECT DISTINCT nr.rule_name AS name, 'NAT Rule' AS typeLabel FROM rule_service_mappings rsm JOIN nat_rules nr ON rsm.rule_id = nr.id AND rsm.rule_type = 'nat' WHERE rsm.group_id = ? OR rsm.ad_hoc_value = ?
        `;
        params = [id, name, id, name];
      } else if (type === 'application') {
        query = `
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule' AS typeLabel FROM rule_application_mappings ram JOIN security_rules sr ON ram.rule_id = sr.id AND ram.rule_type = 'security' WHERE ram.custom_app_id = ? OR ram.predefined_app_name = ?
        `;
        params = [id, name];
      } else if (type === 'applicationGroup') {
        query = `
          SELECT DISTINCT sr.rule_name AS name, 'Security Rule' AS typeLabel FROM rule_application_mappings ram JOIN security_rules sr ON ram.rule_id = sr.id AND ram.rule_type = 'security' WHERE ram.predefined_app_name = ?
        `;
        params = [name];
      }

      if (query) {
        try {
          let formattedQuery = query;
          for (const param of params) {
            const escapedParam = typeof param === 'number' ? param : `'${String(param).replace(/'/g, "''")}'`;
            formattedQuery = formattedQuery.replace('?', String(escapedParam));
          }
          
          const res = await apiClient.queryDb(formattedQuery);
          if (res && res.rows) {
            res.rows.forEach((row: any) => {
              dependencies.push({
                id: row.id || 0,
                name: row.name,
                tableName: 'securityRules',
                fieldName: 'rules',
                typeLabel: row.typeLabel
              });
            });
          }
        } catch (e) {
          console.error("Failed to query rule dependencies", e);
        }
      }
    }

    return dependencies;
  }, []);

  return { getDependencies };
};
