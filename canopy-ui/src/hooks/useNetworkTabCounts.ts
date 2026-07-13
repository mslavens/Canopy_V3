import { useEffect } from 'react';
import { CanopyApiClient } from '../api/client';

export const useNetworkTabCounts = (apiClient: CanopyApiClient | null, selectedScopeUuid: string, visibleScopes: string[], syncTrigger: number = 0) => {
  useEffect(() => {
    let isMounted = true;
    const loadTabCounts = async () => {
      if (!apiClient || !selectedScopeUuid) return;
      try {
        const scopesStr = visibleScopes.join(',');
        const counts = await apiClient.getNetworkCounts(scopesStr);
        
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
  }, [apiClient, selectedScopeUuid, visibleScopes, syncTrigger]);
};
