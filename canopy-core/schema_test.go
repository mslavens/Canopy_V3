package main

import (
	"database/sql"
	"fmt"
	"testing"

	_ "github.com/mutecomm/go-sqlcipher/v4"
)

func TestSchema(t *testing.T) {
	db, err := sql.Open("sqlite3", "file::memory:?cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(actSchema)
	if err != nil {
		t.Fatalf("Error executing actSchema: %v", err)
	}
	fmt.Println("actSchema executed successfully!")
}
