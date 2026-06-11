package main

import (
	"database/sql"
	"fmt"
	"io"
	"os"
	"testing"

	_ "github.com/mutecomm/go-sqlcipher/v4"
)

func TestPrintDatabaseScopes(t *testing.T) {
	srcPath := "/private/var/folders/pw/47p8khts3dvdvng8rjnj3_l00000gq/T/CanopyDevData/workspace_default.db"
	dbPath := "./local_workspace_default.db"

	// Copy database file locally
	srcFile, err := os.Open(srcPath)
	if err != nil {
		t.Fatalf("Failed to open src: %v", err)
	}
	defer srcFile.Close()

	destFile, err := os.Create(dbPath)
	if err != nil {
		t.Fatalf("Failed to create dest: %v", err)
	}
	defer destFile.Close()

	if _, err := io.Copy(destFile, srcFile); err != nil {
		t.Fatalf("Failed to copy: %v", err)
	}
	defer os.Remove(dbPath)

	t.Logf("Checking database locally at: %s", dbPath)

	passphrases := []string{
		"secretpassphrase",
		"",
		"admin",
		"password",
		"canopy",
	}

	var db *sql.DB
	var successfulPassphrase string

	for _, pass := range passphrases {
		dsn := fmt.Sprintf("file:%s?_pragma_key=%s&_pragma_cipher_page_size=4096", dbPath, pass)
		testDB, errOpen := sql.Open("sqlite3", dsn)
		if errOpen != nil {
			continue
		}
		
		// Try to query scopes to see if key works
		var count int
		errQuery := testDB.QueryRow("SELECT COUNT(*) FROM scopes").Scan(&count)
		if errQuery == nil {
			db = testDB
			successfulPassphrase = pass
			break
		}
		testDB.Close()
		err = errQuery
	}

	if db == nil {
		t.Fatalf("Failed to open database with any passphrase: %v", err)
	}

	t.Logf("Successfully opened database with passphrase: %q", successfulPassphrase)

	rows, err := db.Query("SELECT uuid, type, name, parent_uuid FROM scopes")
	if err != nil {
		t.Fatalf("Query failed: %v", err)
	}
	defer rows.Close()

	t.Log("SCOPES IN DATABASE:")
	for rows.Next() {
		var uuid, scopeType, name string
		var parentUUID sql.NullString
		if err := rows.Scan(&uuid, &scopeType, &name, &parentUUID); err != nil {
			t.Errorf("Scan error: %v", err)
			continue
		}
		t.Logf("- UUID: %q, Type: %q, Name: %q, Parent: %q", uuid, scopeType, name, parentUUID.String)
	}
}
