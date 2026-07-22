// optimization.worker.ts
self.onmessage = (e: MessageEvent) => {
  const { values, options, domain, groupTolerance } = e.data;
  
  if (!values || !options || !domain) {
    self.postMessage({ results: {} });
    return;
  }

  const optionsMap = new Map<string, any>();
  options.forEach((o: any) => optionsMap.set(o.name, o));

  // Helper to recursively get leaf members
  const getDeepMembers = (targetName: string): string[] => {
    const target = optionsMap.get(targetName);
    if (!target || !target.member_list) return [targetName];
    
    const leaves = new Set<string>();
    const processItem = (itemName: string, visited: Set<string>) => {
      if (visited.has(itemName)) return;
      visited.add(itemName);
      const opt = optionsMap.get(itemName);
      if (opt && opt.member_list) {
        const members = opt.member_list.split(',').map((m: string) => m.trim());
        members.forEach((m: string) => processItem(m, new Set(visited)));
      } else {
        leaves.add(itemName);
      }
    };
    processItem(targetName, new Set());
    return Array.from(leaves);
  };

  const results: Record<string, any> = {};

  // We can compute the global flattenedAllInputs ONCE for all values
  const flattenedAllInputs = new Set<string>();
  const addToFlattened = (l: string, set: Set<string>) => {
     set.add(l);
     const o = optionsMap.get(l);
     if (o) {
       if (o.value) set.add(o.value);
       if (domain === 'service' && o.protocol && o.destination_port) {
         set.add(`${o.protocol.toLowerCase()}/${o.destination_port}`);
       }
     }
  };
  
  values.forEach((v: string) => getDeepMembers(v).forEach(l => addToFlattened(l, flattenedAllInputs)));

  const isLeafCoveredBy = (leafName: string, flattenedSet: Set<string>): boolean => {
     if (flattenedSet.has(leafName)) return true;
     const leafOpt = optionsMap.get(leafName);
     if (!leafOpt) return false;
     if (leafOpt.value && flattenedSet.has(leafOpt.value)) return true;
     if (domain === 'service' && leafOpt.protocol && leafOpt.destination_port) {
       return flattenedSet.has(`${leafOpt.protocol.toLowerCase()}/${leafOpt.destination_port}`);
     }
     return false;
  };
  
  const allGroups = options.filter((o: any) => o.member_list);

  for (const val of values) {
    const opt = optionsMap.get(val);
    const valIp = opt?.value || val;
    
    // Calculate matchingObjects
    let matchingObjects = options.filter((o: any) => {
      if (o.member_list || o.name === val) return false;
      if (domain === 'service') {
        if (!o.protocol || !o.destination_port) return false;
        return val.toLowerCase() === `${o.protocol.toLowerCase()}/${o.destination_port}`;
      }
      if (domain === 'application') {
        return val.toLowerCase() === o.name.toLowerCase();
      }
      return o.value === valIp;
    });

    const valFlattened = new Set<string>();
    getDeepMembers(val).forEach(l => addToFlattened(l, valFlattened));

    // Calculate validParents
    const validParents = allGroups
      .filter((o: any) => o.name !== val)
      .map((parent: any) => {
        const leaves = getDeepMembers(parent.name);
        if (leaves.length === 0) return null;
        
        let coveredWithVal = 0;
        let tokenContributes = false;
        leaves.forEach(l => {
          if (isLeafCoveredBy(l, flattenedAllInputs)) coveredWithVal++;
          if (isLeafCoveredBy(l, valFlattened)) tokenContributes = true;
        });
        
        const toleranceRatio = coveredWithVal / leaves.length;
        
        // Ensure the parent fully covers the current token `val`
        const parentFlattened = new Set<string>();
        leaves.forEach(l => addToFlattened(l, parentFlattened));
        let parentCoversVal = true;
        const valLeaves = getDeepMembers(val);
        for (const l of valLeaves) {
          if (!isLeafCoveredBy(l, parentFlattened)) {
            parentCoversVal = false;
            break;
          }
        }

        if (toleranceRatio >= groupTolerance && tokenContributes && parentCoversVal) {
           const pMembers = parent.member_list ? parent.member_list.split(',').map((m: string) => m.trim()) : [];
           let nestedGroupsCount = 0;
           pMembers.forEach((m: string) => {
              const mOpt = optionsMap.get(m);
              if (mOpt && mOpt.member_list) nestedGroupsCount++;
           });
           return { parent, pMembers, leaves, coveredLeavesCount: coveredWithVal, nestedGroupsCount, toleranceRatio };
        }
        return null;
    }).filter((item: any) => item !== null);

    results[val] = {
      matchingObjects,
      validParents
    };
  }

  self.postMessage({ results });
};
