import { useMemo, useCallback } from 'react';
import { ScopeHierarchyNode } from './useScopeHierarchy';

export function useTemplateHierarchy(
  templates: any[],
  templateStacks: any[],
  firewalls: any[],
  templateStackMembers: any[] = [],
  options?: {
    includeShowAll?: boolean;
    firewallValueKey?: 'uuid' | 'serial';
  }
) {
  const includeShowAll = options?.includeShowAll ?? true;
  const firewallValueKey = options?.firewallValueKey ?? 'serial';

  const scopeNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (includeShowAll) {
      map['show-all'] = 'Show all';
    }
    
    templates.forEach(t => {
      map[t.uuid] = t.name;
    });
    templateStacks.forEach(ts => {
      map[ts.uuid] = ts.name;
    });
    firewalls.forEach(fw => {
      const key = firewallValueKey === 'uuid' ? fw.uuid : `fw-${fw.serial}`;
      map[key] = fw.name;
    });
    return map;
  }, [templates, templateStacks, firewalls, includeShowAll, firewallValueKey]);

  const hierarchyOptions = useMemo(() => {
    const opts: ScopeHierarchyNode[] = [];
    
    if (includeShowAll) {
      opts.push({ label: 'Show all', value: 'show-all', depth: 0, type: 'global' });
    }

    // Keep track of which templates are in stacks
    const templatesInStacks = new Set<number>();
    templateStackMembers.forEach(m => templatesInStacks.add(m.template_id));

    // Add Template Stacks and their nested templates
    templateStacks.forEach(ts => {
      opts.push({
        label: ts.name,
        value: ts.uuid,
        depth: 1,
        type: 'template-stack'
      });

      // Find templates for this stack
      const stackTemplates = templateStackMembers
        .filter(m => m.stack_id === ts.id)
        .sort((a, b) => a.sequence - b.sequence);
        
      stackTemplates.forEach(m => {
        const tmpl = templates.find(t => t.id === m.template_id);
        if (tmpl) {
          opts.push({
            label: tmpl.name,
            value: tmpl.uuid,
            depth: 2,
            type: 'template'
          });
        }
      });
    });

    // Add Standalone Templates
    const standaloneTemplates = templates.filter(t => !templatesInStacks.has(t.id));
    if (standaloneTemplates.length > 0) {
      // Add a non-selectable generic header
      opts.push({
        label: 'Standalone Templates',
        value: 'header-standalone-templates',
        depth: 0,
        type: 'global' // Treat as global depth 0 for sticky header
      });

      standaloneTemplates.forEach(t => {
        opts.push({
          label: t.name,
          value: t.uuid,
          depth: 1,
          type: 'template'
        });
      });
    }

    return opts;
  }, [templates, templateStacks, templateStackMembers, includeShowAll]);

  // Compute direct device counts for every stack and template
  const deviceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    
    // Count devices assigned directly to stacks
    templateStacks.forEach(ts => {
      counts[ts.uuid] = firewalls.filter(fw => fw.template_stack_id === ts.id).length;
    });
    
    // Count devices assigned directly to templates
    templates.forEach(t => {
      counts[t.uuid] = firewalls.filter(fw => fw.template_id === t.id).length;
    });
    
    return counts;
  }, [firewalls, templates, templateStacks]);

  // Export a helper to get devices for a specific scope (to render in the breadcrumb dropdown)
  const getDevicesForScope = useCallback((scopeUuid: string) => {
    if (!scopeUuid || scopeUuid === 'show-all') return [];
    
    // If it's a template stack
    const stack = templateStacks.find(ts => ts.uuid === scopeUuid);
    if (stack) {
      return firewalls.filter(fw => fw.template_stack_id === stack.id);
    }
    
    // If it's a template
    const tmpl = templates.find(t => t.uuid === scopeUuid);
    if (tmpl) {
      // Find all devices directly assigned to this template
      const directDevices = firewalls.filter(fw => fw.template_id === tmpl.id);
      
      // Find all stacks that include this template
      const stackIds = templateStackMembers
        .filter(m => m.template_id === tmpl.id)
        .map(m => m.stack_id);
        
      // Find all devices assigned to those stacks
      const stackDevices = firewalls.filter(fw => fw.template_stack_id && stackIds.includes(fw.template_stack_id));
      
      // Deduplicate by UUID
      const allDevices = [...directDevices, ...stackDevices];
      const uniqueDevices = Array.from(new Map(allDevices.map(fw => [fw.uuid, fw])).values());
      return uniqueDevices;
    }
    
    return [];
  }, [firewalls, templates, templateStacks, templateStackMembers]);

  // Export a helper to find the "Active Configuration Scope" (Stack or Template) for the breadcrumb
  // If a firewall is selected, this returns the Stack or Template that firewall belongs to.
  // If a Stack/Template is selected, it returns itself.
  const getActiveConfigScope = useCallback((currentScope: string) => {
    const fw = firewalls.find(f => (firewallValueKey === 'uuid' ? f.uuid === currentScope : `fw-${f.serial}` === currentScope));
    if (fw) {
      if (fw.template_stack_id) {
        return templateStacks.find(ts => ts.id === fw.template_stack_id)?.uuid || currentScope;
      } else if (fw.template_id) {
        return templates.find(t => t.id === fw.template_id)?.uuid || currentScope;
      }
    }
    return currentScope;
  }, [firewalls, templates, templateStacks, firewallValueKey]);

  // For networks, the "visible scopes" array isn't as strictly nested hierarchically 
  // in the dropdown UI because template stacks contain templates, but we don't 
  // visually render the templates under the stack in the dropdown (it's a flat list).
  // However, we still want to provide the correct "Context Context" string sequence.
  const getVisibleScopes = useCallback((targetScopeUuid: string, activeScopeUuid: string) => {
    if (!targetScopeUuid || targetScopeUuid === 'show-all') return [];
    
    // If the object is defined exactly at the active scope, just return it
    if (targetScopeUuid === activeScopeUuid) {
      return [activeScopeUuid];
    }
    
    const path: string[] = [];
    
    const activeIsDevice = !!firewalls.find(f => (firewallValueKey === 'uuid' ? f.uuid === activeScopeUuid : `fw-${f.serial}` === activeScopeUuid));
    const activeStack = templateStacks.find(ts => ts.uuid === activeScopeUuid);
    const activeTmpl = templates.find(t => t.uuid === activeScopeUuid);
    
    const targetTmpl = templates.find(t => t.uuid === targetScopeUuid);
    
    if (activeIsDevice) {
      const fw = firewalls.find(f => (firewallValueKey === 'uuid' ? f.uuid === activeScopeUuid : `fw-${f.serial}` === activeScopeUuid));
      path.push(activeScopeUuid);
      
      if (fw?.template_stack_id) {
        const stack = templateStacks.find(ts => ts.id === fw.template_stack_id);
        if (stack) {
          path.push(stack.uuid);
          if (targetTmpl && targetScopeUuid !== stack.uuid) {
            path.push(targetScopeUuid);
          }
        }
      } else if (fw?.template_id) {
        const tmpl = templates.find(t => t.id === fw.template_id);
        if (tmpl) {
          path.push(tmpl.uuid);
        }
      }
    } else if (activeStack) {
      path.push(activeScopeUuid);
      if (targetTmpl && targetScopeUuid !== activeScopeUuid) {
        path.push(targetScopeUuid);
      }
    } else if (activeTmpl) {
      path.push(activeScopeUuid);
    } else {
      path.push(targetScopeUuid);
    }
    
    return path;
  }, [firewalls, templates, templateStacks, firewallValueKey]);

  return {
    hierarchyOptions,
    scopeNameMap,
    getVisibleScopes,
    getDevicesForScope,
    getActiveConfigScope,
    deviceCounts
  };
}
