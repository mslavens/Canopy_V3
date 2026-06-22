import { useEffect } from 'react';
import { CanopyApiClient } from '../api/client';

export const useObjectTabCounts = (
  apiClient: CanopyApiClient | null,
  selectedScopeUuid: string,
  visibleScopes: string[]
) => {
  useEffect(() => {
    let isMounted = true;
    const loadTabCounts = async () => {
      if (!apiClient || !selectedScopeUuid) return;
      if (selectedScopeUuid !== 'show-all' && visibleScopes.length === 0) return;

      try {
        const scopesStr = selectedScopeUuid === 'show-all' ? 'show-all' : visibleScopes.join(',');
        const res = await fetch(`${apiClient.auth.url}/api/objects/counts?scopes=${scopesStr}`, {
          headers: { 'Authorization': `Bearer ${apiClient.auth.token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch object tab counts');
        const counts = await res.json();

        if (isMounted) {
          window.dispatchEvent(new CustomEvent('update-tab-counts', {
            detail: counts
          }));
        }
      } catch (err) {
        console.error("Failed to load object tab counts", err);
      }
    };

    loadTabCounts();
    return () => { isMounted = false; };
  }, [apiClient, selectedScopeUuid, visibleScopes]);
};
