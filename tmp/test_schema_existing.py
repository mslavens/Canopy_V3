import sqlite3
import os

def main():
    file_path = "/Users/mslavens/Documents/__Dev/AntigravityBuild/Canopy_V3/canopy-core/main.go"
    with open(file_path, "r") as f:
        content = f.read()

    start_idx = content.find("var actSchema = `")
    schema_start = start_idx + len("var actSchema = `")
    schema_end = content.find("idx_interfaces_device_uuid", schema_start)
    backtick_idx = content.find("`", schema_end)
    
    act_schema = content[schema_start:backtick_idx]
    
    # Connect to the old Canopy-Dev workspace
    db_path = "/Users/mslavens/Library/Application Support/Canopy-Dev/workspace_1.db"
    
    # Or just Canopy-Dev-DEV workspace
    dev_db_path = "/Users/mslavens/Library/Application Support/Canopy-Dev-DEV/workspace_default.db"
    
    conn = sqlite3.connect(dev_db_path)
    try:
        conn.executescript(act_schema)
        print("actSchema successfully executed on Canopy-Dev-DEV!")
    except Exception as e:
        print("Error executing actSchema on Canopy-Dev-DEV:", e)

if __name__ == "__main__":
    main()
