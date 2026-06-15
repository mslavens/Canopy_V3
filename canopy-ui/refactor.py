import re

def refactor_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # 1. Update activeSubTab switch in fetchRecords
    content = content.replace(
        "case 'Security Profiles':",
        "case 'Antivirus':\n        case 'Anti-Spyware':\n        case 'Vulnerability Protection':\n        case 'URL Filtering':\n        case 'File Blocking':\n        case 'WildFire Analysis':"
    )
    # Remove case 'Custom Objects': logic in fetchRecords
    custom_obj_fetch_old = """        case 'Custom Objects':
          if (activeCustomObjectTab === 'categories') {
            query = isShowAll
              ? `SELECT * FROM custom_url_categories ORDER BY name ASC;`
              : `SELECT * FROM custom_url_categories WHERE device_uuid IN (${scopeFilter}) ORDER BY name ASC;`;
          } else {
            query = isShowAll
              ? `SELECT * FROM external_dynamic_lists ORDER BY name ASC;`
              : `SELECT * FROM external_dynamic_lists WHERE device_uuid IN (${scopeFilter}) ORDER BY name ASC;`;
          }
          break;"""
    custom_obj_fetch_new = """        case 'URL Categories':
          query = isShowAll
            ? `SELECT * FROM custom_url_categories ORDER BY name ASC;`
            : `SELECT * FROM custom_url_categories WHERE device_uuid IN (${scopeFilter}) ORDER BY name ASC;`;
          break;
        case 'External Dynamic Lists':
          query = isShowAll
            ? `SELECT * FROM external_dynamic_lists ORDER BY name ASC;`
            : `SELECT * FROM external_dynamic_lists WHERE device_uuid IN (${scopeFilter}) ORDER BY name ASC;`;
          break;"""
    content = content.replace(custom_obj_fetch_old, custom_obj_fetch_new)

    # 2. Remove activeCustomObjectTab from useEffect deps
    content = content.replace(", activeCustomObjectTab", "")

    # 3. Replace activeSubTab === 'Security Profiles' with an includes check for actionCols
    content = content.replace(
        "else if (activeSubTab === 'Security Profiles') {",
        "else if (['Antivirus', 'Anti-Spyware', 'Vulnerability Protection', 'URL Filtering', 'File Blocking', 'WildFire Analysis'].includes(activeSubTab)) {"
    )

    # 4. Update actionCols for Custom Objects
    content = content.replace(
        "} else if (activeSubTab === 'Custom Objects') {\n      if (activeCustomObjectTab === 'categories') {",
        "} else if (activeSubTab === 'URL Categories') {"
    )
    content = content.replace(
        "} else {\n        return [\n          { key: 'description', label: 'Description', width: '220px' }",
        "} else if (activeSubTab === 'External Dynamic Lists') {\n        return [\n          { key: 'description', label: 'Description', width: '220px' }"
    )

    # 5. Update getEntityColumns
    content = content.replace(
        "} else if (activeSubTab === 'Security Profiles') {",
        "} else if (['Antivirus', 'Anti-Spyware', 'Vulnerability Protection', 'URL Filtering', 'File Blocking', 'WildFire Analysis'].includes(activeSubTab)) {"
    )
    content = content.replace(
        "} else if (activeSubTab === 'Custom Objects') {\n      if (activeCustomObjectTab === 'categories') {",
        "} else if (activeSubTab === 'URL Categories') {"
    )
    content = content.replace(
        "} else {\n        columns = [\n          { key: 'name', label: 'Name', width: '200px' },",
        "} else if (activeSubTab === 'External Dynamic Lists') {\n        columns = [\n          { key: 'name', label: 'Name', width: '200px' },"
    )

    # 6. Update handleDelete
    content = content.replace(
        "else if (activeSubTab === 'Security Profiles') await apiClient.deleteSecurityProfile(obj.id);",
        "else if (['Antivirus', 'Anti-Spyware', 'Vulnerability Protection', 'URL Filtering', 'File Blocking', 'WildFire Analysis'].includes(activeSubTab)) await apiClient.deleteSecurityProfile(obj.id);"
    )
    content = content.replace(
        """          else if (activeSubTab === 'Custom Objects') {
            if (activeCustomObjectTab === 'categories') await apiClient.deleteCustomURLCategory(obj.id);
            else await apiClient.deleteExternalDynamicList(obj.id);
          }""",
        """          else if (activeSubTab === 'URL Categories') await apiClient.deleteCustomURLCategory(obj.id);
          else if (activeSubTab === 'External Dynamic Lists') await apiClient.deleteExternalDynamicList(obj.id);"""
    )
    # Also for handleDeleteSelected
    content = content.replace(
        "else if (activeSubTab === 'Security Profiles') await apiClient.deleteSecurityProfile(row.id);",
        "else if (['Antivirus', 'Anti-Spyware', 'Vulnerability Protection', 'URL Filtering', 'File Blocking', 'WildFire Analysis'].includes(activeSubTab)) await apiClient.deleteSecurityProfile(row.id);"
    )
    content = content.replace(
        """            else if (activeSubTab === 'Custom Objects') {
              if (activeCustomObjectTab === 'categories') await apiClient.deleteCustomURLCategory(row.id);
              else await apiClient.deleteExternalDynamicList(row.id);
            }""",
        """            else if (activeSubTab === 'URL Categories') await apiClient.deleteCustomURLCategory(row.id);
            else if (activeSubTab === 'External Dynamic Lists') await apiClient.deleteExternalDynamicList(row.id);"""
    )

    # 7. Update openCreateModal
    content = content.replace(
        "case 'Security Profiles':",
        "case 'Antivirus':\n      case 'Anti-Spyware':\n      case 'Vulnerability Protection':\n      case 'URL Filtering':\n      case 'File Blocking':\n      case 'WildFire Analysis':"
    )
    content = content.replace(
        """      case 'Custom Objects':
        if (activeCustomObjectTab === 'categories') {
          setCrudMode('create');
          setSelectedObject({ id: '', name: '', description: '', type: 'URL Category', device_uuid: formScopeUuid });
        } else {
          setCrudMode('create');
          setSelectedObject({ id: '', name: '', description: '', type: 'ip', source_url: '', recurring: 'five-minute', device_uuid: formScopeUuid });
        }
        break;""",
        """      case 'URL Categories':
        setCrudMode('create');
        setSelectedObject({ id: '', name: '', description: '', type: 'URL Category', device_uuid: formScopeUuid });
        break;
      case 'External Dynamic Lists':
        setCrudMode('create');
        setSelectedObject({ id: '', name: '', description: '', type: 'ip', source_url: '', recurring: 'five-minute', device_uuid: formScopeUuid });
        break;"""
    )

    # 8. Update handleSave
    content = content.replace(
        "if (activeSubTab === 'Security Profiles') {",
        "if (['Antivirus', 'Anti-Spyware', 'Vulnerability Protection', 'URL Filtering', 'File Blocking', 'WildFire Analysis'].includes(activeSubTab)) {"
    )
    content = content.replace(
        """        if (activeCustomObjectTab === 'categories') {
          payload = { ...payload, type: 'URL Category' };
          if (crudMode === 'create') await apiClient.createCustomURLCategory(payload);
          else await apiClient.updateCustomURLCategory(selectedObject.id, payload);
        } else {
          payload = { ...payload, type: formListType, source_url: formSourceURL, recurring: formRecurring };
          if (crudMode === 'create') await apiClient.createExternalDynamicList(payload);
          else await apiClient.updateExternalDynamicList(selectedObject.id, payload);
        }""",
        """        if (activeSubTab === 'URL Categories') {
          payload = { ...payload, type: 'URL Category' };
          if (crudMode === 'create') await apiClient.createCustomURLCategory(payload);
          else await apiClient.updateCustomURLCategory(selectedObject.id, payload);
        } else if (activeSubTab === 'External Dynamic Lists') {
          payload = { ...payload, type: formListType, source_url: formSourceURL, recurring: formRecurring };
          if (crudMode === 'create') await apiClient.createExternalDynamicList(payload);
          else await apiClient.updateExternalDynamicList(selectedObject.id, payload);
        }"""
    )

    # 9. Update Sub-tabs segment selector row (Delete it!)
    content = re.sub(r"\{\/\*\s*Sub-tabs segment selector row\s*\*\/.*?\}\s*\)\s*\}\s*\{\/\*\s*Toolbar\s*\*\/\}", "{/* Toolbar */}", content, flags=re.DOTALL)

    # 10. Fix the CRUD modal renders
    content = content.replace(
        "{activeSubTab === 'Custom Objects' && activeCustomObjectTab === 'categories' && (",
        "{activeSubTab === 'URL Categories' && ("
    )
    content = content.replace(
        "{activeSubTab === 'Custom Objects' && activeCustomObjectTab === 'edls' && (",
        "{activeSubTab === 'External Dynamic Lists' && ("
    )
    content = content.replace(
        "{activeSubTab === 'Security Profiles' && (",
        "{['Antivirus', 'Anti-Spyware', 'Vulnerability Protection', 'URL Filtering', 'File Blocking', 'WildFire Analysis'].includes(activeSubTab) && ("
    )

    with open(filepath, 'w') as f:
        f.write(content)

if __name__ == "__main__":
    refactor_file("/Users/mslavens/Documents/__Dev/AntigravityBuild/Canopy_V3/canopy-ui/src/pages/ObjectsPage.tsx")
