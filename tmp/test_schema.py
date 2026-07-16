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
    
    conn = sqlite3.connect(":memory:")
    try:
        conn.executescript(act_schema)
        print("actSchema successfully executed!")
    except Exception as e:
        print("Error executing actSchema:", e)
        # Let's save it to a file to inspect exactly what Python is sending to sqlite
        with open("schema_dump.sql", "w") as f2:
            f2.write(act_schema)
            
if __name__ == "__main__":
    main()
