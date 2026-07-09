import { useState, useEffect } from 'react';
import { CanopyApiClient } from '../api/client';

export const useEnabledAdapters = (auth: { url: string; token: string } | null) => {
  const [enabledAdapters, setEnabledAdapters] = useState<string[]>(['paloalto', 'fortinet', 'cisco']);

  useEffect(() => {
    let isMounted = true;
    const fetchAdapters = async () => {
      if (!auth) return;
      try {
        const apiClient = new CanopyApiClient(auth);
        const data = await apiClient.getAdapters();
        if (isMounted && data) {
          const disabledJSON = localStorage.getItem('canopy_disabled_adapters');
          let disabledList: string[] = [];
          if (disabledJSON) {
            try { disabledList = JSON.parse(disabledJSON); } catch(e) {}
          }
          const filtered = data.filter((a) => !disabledList.includes(a));
          setEnabledAdapters(filtered);
        }
      } catch (err) {
        console.error('Failed to fetch enabled adapters', err);
      }
    };
    fetchAdapters();

    const handleStorageChange = () => { fetchAdapters(); };
    window.addEventListener('canopy_adapter_toggled', handleStorageChange);

    return () => {
      isMounted = false;
      window.removeEventListener('canopy_adapter_toggled', handleStorageChange);
    };
  }, [auth]);

  return enabledAdapters;
};
