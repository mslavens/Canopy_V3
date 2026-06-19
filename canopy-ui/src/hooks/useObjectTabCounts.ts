import { useEffect } from 'react';

export const useObjectTabCounts = (
  visibleScopes: string[],
  allAddresses: any[],
  allAddressGroups: any[],
  allServices: any[],
  allServiceGroups: any[],
  allApplications: any[],
  allApplicationGroups: any[],
  allTags: any[],
  allSecurityProfiles: any[]
) => {
  useEffect(() => {
    if (visibleScopes.length === 0) return;

    const inScope = (item: any) => visibleScopes.includes(item.device_uuid);

    const counts = {
      'Address Objects': allAddresses.some(inScope) ? 1 : 0,
      'Address Groups': allAddressGroups.some(inScope) ? 1 : 0,
      'Services': allServices.some(inScope) ? 1 : 0,
      'Service Groups': allServiceGroups.some(inScope) ? 1 : 0,
      'Applications': allApplications.some(inScope) ? 1 : 0,
      'Application Groups': allApplicationGroups.some(inScope) ? 1 : 0,
      'Tags': allTags.some(inScope) ? 1 : 0,
      'Log Forwarding Profiles': 0, // Unimplemented
      'Antivirus': allSecurityProfiles.some(p => p.type === 'antivirus' && inScope(p)) ? 1 : 0,
      'Anti-Spyware': allSecurityProfiles.some(p => p.type === 'spyware' && inScope(p)) ? 1 : 0,
      'Vulnerability Protection': allSecurityProfiles.some(p => p.type === 'vulnerability' && inScope(p)) ? 1 : 0,
      'URL Filtering': allSecurityProfiles.some(p => p.type === 'url-filtering' && inScope(p)) ? 1 : 0,
      'File Blocking': allSecurityProfiles.some(p => p.type === 'file-blocking' && inScope(p)) ? 1 : 0,
      'WildFire Analysis': allSecurityProfiles.some(p => p.type === 'wildfire' && inScope(p)) ? 1 : 0,
      'Security Profile Groups': 0, // Unimplemented
      'URL Categories': 0, // Unimplemented
      'External Dynamic Lists': 0 // Unimplemented
    };

    window.dispatchEvent(new CustomEvent('update-tab-counts', { detail: counts }));
  }, [
    visibleScopes,
    allAddresses,
    allAddressGroups,
    allServices,
    allServiceGroups,
    allApplications,
    allApplicationGroups,
    allTags,
    allSecurityProfiles
  ]);
};
