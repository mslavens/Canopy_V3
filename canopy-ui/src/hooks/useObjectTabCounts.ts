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
        const scopesStr = selectedScopeUuid === 'show-all' ? '' : visibleScopes.map(s => `'${s}'`).join(',');
        const filter = scopesStr ? `WHERE device_uuid IN (${scopesStr})` : '';

        const [
          addr, addrGrp, svc, svcGrp, app, appGrp, tags, 
          logFwd, secProf, secProfGrp, urlCat, edl
        ] = await Promise.all([
          apiClient.queryDb(`SELECT COUNT(*) as c FROM address_objects ${filter}`),
          apiClient.queryDb(`SELECT COUNT(*) as c FROM address_groups ${filter}`),
          apiClient.queryDb(`SELECT COUNT(*) as c FROM service_objects ${filter}`),
          apiClient.queryDb(`SELECT COUNT(*) as c FROM service_groups ${filter}`),
          apiClient.queryDb(`SELECT COUNT(*) as c FROM application_objects ${filter}`),
          apiClient.queryDb(`SELECT COUNT(*) as c FROM application_groups ${filter}`),
          apiClient.queryDb(`SELECT COUNT(*) as c FROM tags ${filter}`),
          apiClient.queryDb(`SELECT COUNT(*) as c FROM log_forwarding_profiles ${filter}`),
          apiClient.queryDb(`SELECT type, COUNT(*) as c FROM security_profiles ${filter} GROUP BY type`),
          apiClient.queryDb(`SELECT COUNT(*) as c FROM security_profile_groups ${filter}`),
          apiClient.queryDb(`SELECT COUNT(*) as c FROM custom_url_categories ${filter}`),
          apiClient.queryDb(`SELECT COUNT(*) as c FROM external_dynamic_lists ${filter}`)
        ]);

        if (isMounted) {
          const secCounts: Record<string, number> = {
            'antivirus': 0, 'spyware': 0, 'vulnerability': 0, 
            'url-filtering': 0, 'file-blocking': 0, 'wildfire': 0
          };
          
          if (secProf && secProf.rows) {
            secProf.rows.forEach((r: any) => {
              secCounts[r.type] = r.c;
            });
          }

          window.dispatchEvent(new CustomEvent('update-tab-counts', {
            detail: {
              'Address Objects': addr?.rows?.[0]?.c || 0,
              'Address Groups': addrGrp?.rows?.[0]?.c || 0,
              'Services': svc?.rows?.[0]?.c || 0,
              'Service Groups': svcGrp?.rows?.[0]?.c || 0,
              'Applications': app?.rows?.[0]?.c || 0,
              'Application Groups': appGrp?.rows?.[0]?.c || 0,
              'Tags': tags?.rows?.[0]?.c || 0,
              'Log Forwarding Profiles': logFwd?.rows?.[0]?.c || 0,
              'Antivirus': secCounts['antivirus'],
              'Anti-Spyware': secCounts['spyware'],
              'Vulnerability Protection': secCounts['vulnerability'],
              'URL Filtering': secCounts['url-filtering'],
              'File Blocking': secCounts['file-blocking'],
              'WildFire Analysis': secCounts['wildfire'],
              'Security Profile Groups': secProfGrp?.rows?.[0]?.c || 0,
              'URL Categories': urlCat?.rows?.[0]?.c || 0,
              'External Dynamic Lists': edl?.rows?.[0]?.c || 0
            }
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
