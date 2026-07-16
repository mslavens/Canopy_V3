import re
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
    
    triggers = []
    has_id_cache = {}

    for table in tables_to_update:
        pattern_str = r"(CREATE TABLE IF NOT EXISTS " + table + r"\s*\()([^;]+?)\);"
        
        def repl(match):
            table_def = match.group(2)
            has_id = "id INTEGER PRIMARY KEY" in table_def or "id TEXT PRIMARY KEY" in table_def
            has_id_cache[table] = has_id
            
            insert_str = ""
            if "created_at DATETIME" not in table_def:
                insert_str += "\n\t\tcreated_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
            if "updated_at DATETIME" not in table_def:
                insert_str += "\n\t\tupdated_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
                
            return f"{match.group(1)}{insert_str}{table_def}\n\t);"
            
        new_content, count = re.subn(pattern_str, repl, content)
        if count == 0:
            print(f"Skipping {table} - not found.")
        else:
            content = new_content
            
            if has_id_cache.get(table):
                trigger = f"""
	CREATE TRIGGER IF NOT EXISTS update_timestamp_{table}
	AFTER UPDATE ON {table}
	FOR EACH ROW
	BEGIN
		UPDATE {table} SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
	END;"""
                if trigger not in content:
                    triggers.append(trigger)

    # Inject triggers before the end of actSchema backtick
    if triggers:
        schema_end = content.find("idx_interfaces_device_uuid")
        if schema_end != -1:
            backtick_idx = content.find("`", schema_end)
            if backtick_idx != -1:
                content = content[:backtick_idx] + "\n" + "".join(triggers) + "\n" + content[backtick_idx:]
            else:
                print("Could not find backtick for actSchema")
        else:
            print("Could not find idx_interfaces_device_uuid")

    # Inject ALTER TABLEs for existing databases
    inject_marker = 'db.Exec("ALTER TABLE security_rules ADD COLUMN log_setting TEXT;")'
    inject_pos = content.find(inject_marker)
    if inject_pos != -1:
        end_of_line = content.find('\n', inject_pos)
        if end_of_line == -1:
            end_of_line = inject_pos + len(inject_marker)
        
        alters = []
        for table in tables_to_update:
            alters.append(f'\\n\\tdb.Exec("ALTER TABLE {table} ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP;")')
            alters.append(f'\\n\\tdb.Exec("ALTER TABLE {table} ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;")')
            if has_id_cache.get(table):
                alters.append(f'\\n\\tdb.Exec(`CREATE TRIGGER IF NOT EXISTS update_timestamp_{table} AFTER UPDATE ON {table} FOR EACH ROW BEGIN UPDATE {table} SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id; END;`)')
        
        alters_str_real = "".join(alters).replace('\\n', '\n').replace('\\t', '\t')
        
        # ensure we don't inject multiple times
        if "update_timestamp_device_groups AFTER UPDATE ON device_groups" not in content[inject_pos:]:
            content = content[:end_of_line] + alters_str_real + content[end_of_line:]
    else:
        print("Could not find a place to inject ALTERs")

    with open(file_path, "w") as f:
        f.write(content)
        
    print("Success")

if __name__ == "__main__":
    main()
