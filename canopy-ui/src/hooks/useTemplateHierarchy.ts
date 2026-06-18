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

    // Add Template Stacks
    templateStacks.forEach(ts => {
      opts.push({
        label: ts.name,
        value: ts.uuid,
        depth: 1,
        type: 'template-stack'
      });

      // Find firewalls for this template stack
      const stackFirewalls = firewalls.filter(fw => fw.template_stack_id === ts.id);
      stackFirewalls.forEach(fw => {
        opts.push({
          label: fw.name,
          value: firewallValueKey === 'uuid' ? fw.uuid : `fw-${fw.serial}`,
          depth: 2,
          type: 'firewall'
        });
      });
    });

    // Add standalone Templates
    templates.forEach(t => {
      opts.push({
        label: t.name,
        value: t.uuid,
        depth: 1,
        type: 'template'
      });

      // Find firewalls specifically assigned to this template directly
      const tmplFirewalls = firewalls.filter(fw => fw.template_id === t.id && !fw.template_stack_id);
      tmplFirewalls.forEach(fw => {
        opts.push({
          label: fw.name,
          value: firewallValueKey === 'uuid' ? fw.uuid : `fw-${fw.serial}`,
          depth: 2,
          type: 'firewall'
        });
      });
    });

    // Add unassigned firewalls
    const unassignedFirewalls = firewalls.filter(fw => !fw.template_id && !fw.template_stack_id);
    unassignedFirewalls.forEach(fw => {
      opts.push({
        label: fw.name,
        value: firewallValueKey === 'uuid' ? fw.uuid : `fw-${fw.serial}`,
        depth: 1,
        type: 'firewall'
      });
    });
    
    return opts;
  }, [templates, templateStacks, firewalls, includeShowAll, firewallValueKey]);

  // For networks, the "visible scopes" array isn't as strictly nested hierarchically 
  // in the dropdown UI because template stacks contain templates, but we don't 
  // visually render the templates under the stack in the dropdown (it's a flat list).
  // However, we still want to provide the correct "Context Context" string sequence.
  // The backend already resolves ancestry. Here, we just return a simple list 
  // for the "Scope Context:" label display.
  const getVisibleScopes = useCallback((currentScope: string) => {
    if (!currentScope || currentScope === 'show-all') return [];
    
    const scopes: string[] = [];
    scopes.push(currentScope);

    // If the scope is a firewall, check if it belongs to a stack or template
    const fw = firewalls.find(f => (firewallValueKey === 'uuid' ? f.uuid === currentScope : `fw-${f.serial}` === currentScope));
    
    let activeStackId: number | null = null;
    
    if (fw) {
      if (fw.template_stack_id) {
        activeStackId = fw.template_stack_id;
        const stack = templateStacks.find(ts => ts.id === fw.template_stack_id);
        if (stack) scopes.push(stack.uuid);
      } else if (fw.template_id) {
        const tmpl = templates.find(t => t.id === fw.template_id);
        if (tmpl) scopes.push(tmpl.uuid);
      }
    } else {
      // Is currentScope a stack?
      const stack = templateStacks.find(ts => ts.uuid === currentScope);
      if (stack) {
        activeStackId = stack.id;
      }
    }

    if (activeStackId) {
       // get all templates in this stack, ordered by sequence ascending
       // sequence 1 is top priority, so sequence 1 overrides sequence 2
       const stackTemplates = templateStackMembers.filter(m => m.stack_id === activeStackId).sort((a, b) => a.sequence - b.sequence);
       stackTemplates.forEach(m => scopes.push(m.template_uuid));
    }

    return scopes;
  }, [firewalls, templates, templateStacks, templateStackMembers, firewallValueKey]);

  return {
    hierarchyOptions,
    scopeNameMap,
    getVisibleScopes
  };
}
