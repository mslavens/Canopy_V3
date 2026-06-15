import { useMemo, useCallback } from 'react';

export interface ScopeHierarchyNode {
  label: string;
  value: string;
  depth: number;
  type: 'global' | 'shared' | 'device-group' | 'firewall';
}

export function useScopeHierarchy(
  deviceGroups: any[],
  firewalls: any[],
  options?: {
    includeShowAll?: boolean;
    firewallValueKey?: 'uuid' | 'serial'; // Defaults to 'serial' (e.g., 'fw-1234')
  }
) {
  const includeShowAll = options?.includeShowAll ?? true;
  const firewallValueKey = options?.firewallValueKey ?? 'serial';

  const scopeNameMap = useMemo(() => {
    const map: Record<string, string> = {
      'paloalto-panorama-global': 'Shared',
      'paloalto-dg-shared': 'Shared'
    };
    if (includeShowAll) {
      map['show-all'] = 'Show all';
    }
    
    deviceGroups.forEach(dg => {
      map[dg.uuid] = dg.name;
    });
    firewalls.forEach(fw => {
      const key = firewallValueKey === 'uuid' ? fw.uuid : `fw-${fw.serial}`;
      map[key] = fw.name;
    });
    return map;
  }, [deviceGroups, firewalls, includeShowAll, firewallValueKey]);

  const hierarchyOptions = useMemo(() => {
    const opts: ScopeHierarchyNode[] = [];
    
    if (includeShowAll) {
      opts.push({ label: 'Show all', value: 'show-all', depth: 0, type: 'global' });
    }
    opts.push({ label: 'Shared', value: 'paloalto-panorama-global', depth: 0, type: 'shared' });

    const buildNode = (parentId: number | null, depth: number) => {
      const levelGroups = deviceGroups.filter(g => g.parent_id === parentId);
      levelGroups.forEach(dg => {
        if (dg.uuid === 'paloalto-dg-shared') {
          buildNode(dg.id, depth);
          return;
        }
        opts.push({
          label: dg.name,
          value: dg.uuid,
          depth: depth,
          type: 'device-group'
        });

        // Find firewalls for this group
        const groupFirewalls = firewalls.filter(fw => fw.device_group_id === dg.id);
        groupFirewalls.forEach(fw => {
          opts.push({
            label: fw.name,
            value: firewallValueKey === 'uuid' ? fw.uuid : `fw-${fw.serial}`,
            depth: depth + 1,
            type: 'firewall'
          });
        });

        // Recursively build children
        buildNode(dg.id, depth + 1);
      });
    };

    buildNode(null, 1);
    return opts;
  }, [deviceGroups, firewalls, includeShowAll, firewallValueKey]);

  const getVisibleScopes = useCallback((currentScope: string) => {
    if (currentScope === 'show-all') return [];
    
    const scopes: string[] = [];
    scopes.push(currentScope);
    let activeScope = currentScope;

    // Check if it's a firewall based on the key strategy
    const isFirewallScope = firewallValueKey === 'uuid' 
      ? firewalls.some(fw => fw.uuid === currentScope)
      : currentScope.startsWith('fw-');

    if (isFirewallScope) {
      const fw = firewallValueKey === 'uuid' 
        ? firewalls.find(f => f.uuid === currentScope)
        : firewalls.find(f => `fw-${f.serial}` === currentScope);
        
      if (fw && fw.device_group_id) {
        const dg = deviceGroups.find(g => g.id === fw.device_group_id);
        if (dg) {
          scopes.push(dg.uuid);
          activeScope = dg.uuid;
        }
      }
    }
    
    let curr = deviceGroups.find(dg => dg.uuid === activeScope);
    while (curr && curr.parent_id) {
      const parent = deviceGroups.find(dg => dg.id === curr.parent_id);
      if (parent) {
        scopes.push(parent.uuid);
        curr = parent;
      } else {
        break;
      }
    }
    
    if (!scopes.includes('paloalto-panorama-global')) {
      scopes.push('paloalto-panorama-global');
    }
    
    return scopes.filter(uuid => uuid !== 'paloalto-dg-shared');
  }, [deviceGroups, firewalls, firewallValueKey]);

  return {
    hierarchyOptions,
    scopeNameMap,
    getVisibleScopes
  };
}
