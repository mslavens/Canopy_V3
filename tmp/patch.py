import sys
import os

def main():
    file_path = "/Users/mslavens/Documents/__Dev/AntigravityBuild/Canopy_V3/canopy-core/main.go"
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return
        
    with open(file_path, "r") as f:
        content = f.read()

    tables_to_update = [
        "device_groups", "templates", "template_stacks", "network_topology", "interfaces", "zones",
        "variables", "address_objects", "address_groups", "service_objects", "service_groups",
        "application_objects", "regions", "schedules", "tags", "security_profiles", "log_forwarding_profiles",
        "security_profile_groups", "custom_url_categories", "external_dynamic_lists", "security_rules",
        "nat_rules", "qos_rules", "pbf_rules", "decryption_rules", "application_override_rules",
        "tunnel_inspection_rules", "authentication_rules", "dos_rules", "static_routes", "managed_devices_raw",
        "application_groups", "application_group_members", "rule_address_mappings", "rule_service_mappings",
        "rule_application_mappings", "rule_zone_mappings", "rule_category_mappings", "entity_tag_mappings",
        "security_rule_profiles", "template_stack_members_raw"
    ]

    start_idx = content.find("var actSchema = `")
    if start_idx == -1:
        print("Could not find actSchema")
        return
    end_idx = content.find("`\n", start_idx)
    
    act_schema = content[start_idx:end_idx]
    
    triggers = []
    has_id_cache = {}
    
    for table in tables_to_update:
        search_str = f"CREATE TABLE IF NOT EXISTS {table} ("
        idx = act_schema.find(search_str)
        if idx != -1:
            end_table_idx = act_schema.find(");", idx)
            if end_table_idx == -1:
                print(f"Could not find end of table {table}")
                continue
                
            table_def = act_schema[idx:end_table_idx]
            
            has_id = "id INTEGER PRIMARY KEY" in table_def or "id TEXT PRIMARY KEY" in table_def
            has_id_cache[table] = has_id
            
            if "created_at DATETIME" not in table_def:
                table_def = table_def.rstrip() + ",\n\t\tcreated_at DATETIME DEFAULT CURRENT_TIMESTAMP"
            if "updated_at DATETIME" not in table_def:
                table_def = table_def.rstrip() + ",\n\t\tupdated_at DATETIME DEFAULT CURRENT_TIMESTAMP"
            
            # Reconstruct act_schema
            act_schema = act_schema[:idx] + table_def + "\n\t" + act_schema[end_table_idx:]
            
            if has_id:
                trigger = f"""
	CREATE TRIGGER IF NOT EXISTS update_timestamp_{table}
	AFTER UPDATE ON {table}
	FOR EACH ROW
	BEGIN
		UPDATE {table} SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
	END;"""
                if f"update_timestamp_{table}" not in act_schema:
                    triggers.append(trigger)
        else:
            print(f"Skipping table {table} as it was not found in actSchema.")

    if triggers:
        act_schema += "\n" + "".join(triggers) + "\n"

    new_content = content[:start_idx] + act_schema + content[end_idx:]

    inject_marker = 'db.Exec("ALTER TABLE workspaces ADD COLUMN color TEXT;")'
    inject_pos = new_content.find(inject_marker)
    if inject_pos != -1:
        end_of_line = new_content.find('\\n', inject_pos)
        if end_of_line == -1:
            end_of_line = inject_pos + len(inject_marker)
        
        # We need to insert real newlines since we are writing to go file
        alters = []
        for table in tables_to_update:
            alters.append(f'\\n\\tdb.Exec("ALTER TABLE {table} ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP;")')
            alters.append(f'\\n\\tdb.Exec("ALTER TABLE {table} ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;")')
            if has_id_cache.get(table):
                alters.append(f'\\n\\tdb.Exec(`CREATE TRIGGER IF NOT EXISTS update_timestamp_{table} AFTER UPDATE ON {table} FOR EACH ROW BEGIN UPDATE {table} SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id; END;`)')
        
        # Unescape the \n and \t for the go file
        alters_str = "".join(alters).replace('\\n', '\n').replace('\\t', '\t')
        new_content = new_content[:end_of_line] + alters_str + new_content[end_of_line:]
    else:
        print("Could not find a place to inject ALTERs")
        return

    with open(file_path, "w") as f:
        f.write(new_content)

    print("Success")

if __name__ == "__main__":
    main()
