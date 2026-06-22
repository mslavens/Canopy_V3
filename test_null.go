package main

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/mattn/go-sqlite3"
)

func main() {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec("CREATE TABLE test (id INTEGER, val INTEGER)")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec("INSERT INTO test (id, val) VALUES (1, NULL), (2, 42)")
	if err != nil {
		log.Fatal(err)
	}

	rows, err := db.Query("SELECT id, val FROM test")
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	for rows.Next() {
		var id int
		var val *int
		err := rows.Scan(&id, &val)
		if err != nil {
			fmt.Printf("Row %d Error: %v\n", id, err)
		} else {
			if val == nil {
				fmt.Printf("Row %d: nil\n", id)
			} else {
				fmt.Printf("Row %d: %d\n", id, *val)
			}
		}
	}
}
