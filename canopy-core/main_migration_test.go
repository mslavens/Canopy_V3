package main

import (
	"database/sql"
	"testing"

	_ "github.com/mutecomm/go-sqlcipher/v4"
)

func TestDatabaseMigration(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("failed to open in-memory db: %v", err)
	}
	defer db.Close()

	// 1. Create legacy schema (version 1)
	legacySchema := `
	CREATE TABLE IF NOT EXISTS framework_metadata (
		app_id TEXT PRIMARY KEY,
		schema_version INTEGER
	);
	CREATE TABLE IF NOT EXISTS devices (
		uuid TEXT PRIMARY KEY,
		name TEXT,
		vendor TEXT,
		parent_uuid TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE IF NOT EXISTS managed_devices (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_uuid TEXT,
		serial TEXT UNIQUE,
		name TEXT,
		ip_address TEXT,
		device_group TEXT,
		template_stack TEXT
	);
	CREATE TABLE IF NOT EXISTS template_stacks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		uuid TEXT UNIQUE,
		name TEXT UNIQUE
	);
	CREATE TABLE IF NOT EXISTS template_stack_members (
		stack_id INTEGER,
		template_name TEXT,
		sequence INTEGER
	);
	`
	if _, err := db.Exec(legacySchema); err != nil {
		t.Fatalf("failed to create legacy schema: %v", err)
	}

	// Insert version 1
	if _, err := db.Exec("INSERT INTO framework_metadata (app_id, schema_version) VALUES ('com.layeredblue.canopy', 1)"); err != nil {
		t.Fatalf("failed to insert metadata: %v", err)
	}

	// 2. Execute migration to version 2
	migrateWorkspaceDatabase(db)

	// 3. Execute actSchema
	if _, err := db.Exec(actSchema); err != nil {
		t.Fatalf("failed to execute actSchema after migration: %v", err)
	}

	// 4. Verify all tables and views exist
	tablesToVerify := []string{
		"scopes",
		"device_groups",
		"templates",
		"template_stacks",
		"template_stack_members_raw",
		"managed_devices_raw",
		"devices",
		"managed_devices",
		"template_stack_members",
	}

	for _, name := range tablesToVerify {
		var dummy int
		err := db.QueryRow("SELECT 1 FROM " + name + " LIMIT 1").Scan(&dummy)
		if err != nil && err != sql.ErrNoRows {
			t.Errorf("table or view %q is missing or has error: %v", name, err)
		}
	}
}
