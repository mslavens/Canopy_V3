import { useEffect } from 'react';
import { CanopyApiClient } from '../api/client';

export const useNetworkTabCounts = (apiClient: CanopyApiClient | null, selectedScopeUuid: string, visibleScopes: string[]) => {
  useEffect(() => {
    let isMounted = true;
    const loadTabCounts = async () => {
      if (!apiClient || !selectedScopeUuid) return;
      try {
        const scopesStr = visibleScopes.map(s => `'${s}'`).join(',');
        const filter = scopesStr ? `WHERE device_uuid IN (${scopesStr})` : '';
        const [zones, ifs, routes, vars] = await Promise.all([
          apiClient.queryDb(`SELECT COUNT(*) as c FROM zones ${filter}`),
          apiClient.queryDb(`SELECT COUNT(*) as c FROM interfaces ${filter}`),
          apiClient.queryDb(`SELECT COUNT(*) as c FROM static_routes ${filter}`),
          apiClient.queryDb(`SELECT COUNT(*) as c FROM variables ${filter}`)
        ]);
        
        if (isMounted) {
          window.dispatchEvent(new CustomEvent('update-tab-counts', {
            detail: {
              'Zones': zones?.rows?.[0]?.c || 0,
              'Interfaces': ifs?.rows?.[0]?.c || 0,
              'Route Table': routes?.rows?.[0]?.c || 0,
              'Template Variables': vars?.rows?.[0]?.c || 0
            }
          }));
        }
      } catch (err) {
        console.error("Failed to load network tab counts", err);
      }
    };
    loadTabCounts();
    return () => { isMounted = false; };
  }, [apiClient, selectedScopeUuid, visibleScopes]);
};
