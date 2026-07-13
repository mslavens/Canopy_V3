import { useMemo, useCallback } from 'react';

export interface ScopeHierarchyNode {
  label: string;
  value: string;
  depth: number;
  type: 'global' | 'shared' | 'device-group' | 'firewall' | 'template' | 'template-stack';
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
      'fortinet-global-adom': 'Global ADOM',
      'cisco-global-domain': 'Global Domain',
      'paloalto-dg-shared': 'Shared'
    };
    if (includeShowAll) {
      map['show-all'] = 'Show all';
    }

    deviceGroups.forEach(dg => {
      map[dg.uuid] = dg.name === 'Panorama Shared' ? 'Shared' : dg.name;
    });
    firewalls.forEach(fw => {
      const key = firewallValueKey === 'uuid' ? fw.uuid : `fw-${fw.serial}`;
      map[key] = fw.name || fw.serial;
    });
    return map;
  }, [deviceGroups, firewalls, includeShowAll, firewallValueKey]);

  const hierarchyOptions = useMemo(() => {
    const opts: ScopeHierarchyNode[] = [];

    if (includeShowAll) {
      opts.push({ label: 'Show all', value: 'show-all', depth: 0, type: 'global' });
    }
    const vendorRoots = [
      { label: 'Shared', value: 'paloalto-panorama-global' },
      { label: 'Global ADOM', value: 'fortinet-global-adom' },
      { label: 'Global Domain', value: 'cisco-global-domain' }
    ];

    const buildNode = (parentId: number | null, depth: number) => {
      const levelGroups = deviceGroups.filter(g => g.parent_id === parentId);
      levelGroups.forEach(dg => {
        if (dg.uuid === 'paloalto-dg-shared') {
          buildNode(dg.id, depth);
          return;
        }
        
        // Skip root scopes from being added as regular groups
        if (['paloalto-panorama-global', 'fortinet-global-adom', 'cisco-global-domain'].includes(dg.uuid)) {
           // We already manually add them at depth 0, but we need to build their children
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
            label: fw.name || fw.serial,
            value: firewallValueKey === 'uuid' ? fw.uuid : `fw-${fw.serial}`,
            depth: depth + 1,
            type: 'firewall'
          });
        });

        // Recursively build children
        buildNode(dg.id, depth + 1);
      });
    };

    // Find physical root nodes (those with parent_id = null)
    // We only care about pushing the roots that actually exist in the DB (or just pushing them all).
    // Wait, the DB device_groups table contains them.
    const rootDGs = deviceGroups.filter(g => g.parent_id === null);
    
    // Sort roots for consistent display
    const orderedRoots = rootDGs.filter(g => ['paloalto-panorama-global', 'fortinet-global-adom', 'cisco-global-domain'].includes(g.uuid)).sort((a, b) => {
       const order = ['paloalto-panorama-global', 'fortinet-global-adom', 'cisco-global-domain'];
       return order.indexOf(a.uuid) - order.indexOf(b.uuid);
    });

    orderedRoots.forEach(root => {
       opts.push({ label: root.name === 'Panorama Shared' ? 'Shared' : root.name, value: root.uuid, depth: 0, type: 'shared' });
       buildNode(root.id, 1);
    });


    // Simpler logic for strays:
    const strayRoots = rootDGs.filter(g => !['paloalto-panorama-global', 'fortinet-global-adom', 'cisco-global-domain'].includes(g.uuid));
    strayRoots.forEach(stray => {
        opts.push({
          label: stray.name,
          value: stray.uuid,
          depth: 0,
          type: 'device-group'
        });
        const groupFirewalls = firewalls.filter(fw => fw.device_group_id === stray.id);
        groupFirewalls.forEach(fw => {
          opts.push({
            label: fw.name || fw.serial,
            value: firewallValueKey === 'uuid' ? fw.uuid : `fw-${fw.serial}`,
            depth: 1,
            type: 'firewall'
          });
        });
        buildNode(stray.id, 1);
    });

    // Add unassigned firewalls at the root level
    const unassignedFirewalls = firewalls.filter(fw => !fw.device_group_id);
    unassignedFirewalls.forEach(fw => {
      opts.push({
        label: fw.name || fw.serial,
        value: firewallValueKey === 'uuid' ? fw.uuid : `fw-${fw.serial}`,
        depth: 1,
        type: 'firewall'
      });
    });

    return opts;
  }, [deviceGroups, firewalls, includeShowAll, firewallValueKey]);

  const getVisibleScopes = useCallback((currentScope: string) => {
    if (!currentScope || currentScope === 'show-all') return [];

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

    // Find the vendor of the top-most group or the item itself
    let vendor = 'paloalto';
    if (curr && curr.vendor) {
      vendor = curr.vendor.toLowerCase();
    } else if (isFirewallScope) {
      const fw = firewallValueKey === 'uuid'
        ? firewalls.find(f => f.uuid === currentScope)
        : firewalls.find(f => `fw-${f.serial}` === currentScope);
      if (fw && fw.vendor) vendor = fw.vendor.toLowerCase();
    }

    // Only push the root scope for the specific vendor if we haven't already included it
    if (vendor === 'fortinet') {
      if (!scopes.includes('fortinet-global-adom')) scopes.push('fortinet-global-adom');
    } else if (vendor === 'cisco') {
      if (!scopes.includes('cisco-global-domain')) scopes.push('cisco-global-domain');
    } else {
      if (!scopes.includes('paloalto-panorama-global')) scopes.push('paloalto-panorama-global');
    }

    return scopes.filter(uuid => uuid !== 'paloalto-dg-shared');
  }, [deviceGroups, firewalls, firewallValueKey]);

  return {
    hierarchyOptions,
    scopeNameMap,
    getVisibleScopes
  };
}
