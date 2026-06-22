import { useEffect } from 'react';
import { CanopyApiClient } from '../api/client';

export const useNetworkTabCounts = (apiClient: CanopyApiClient | null, selectedScopeUuid: string, visibleScopes: string[]) => {
  useEffect(() => {
    let isMounted = true;
    const loadTabCounts = async () => {
      if (!apiClient || !selectedScopeUuid) return;
      try {
        const scopesStr = visibleScopes.join(',');
        const res = await fetch(`${apiClient.auth.url}/api/networks/counts?scopes=${scopesStr}`, {
          headers: { 'Authorization': `Bearer ${apiClient.auth.token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch network tab counts');
        const counts = await res.json();
        
        if (isMounted) {
          window.dispatchEvent(new CustomEvent('update-tab-counts', {
            detail: counts
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
