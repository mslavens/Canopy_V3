package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"canopy-core/storage"
)

func HandleImportLogs(w http.ResponseWriter, r *http.Request, telDB *storage.AppStateDB, logDB *storage.LogDB) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	err := r.ParseMultipartForm(500 << 20) // 500 MB max
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to parse form: %v", err), http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "File not found", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Parse client_id
	clientID := r.FormValue("client_id")
	if clientID == "" {
		http.Error(w, "client_id is required", http.StatusBadRequest)
		return
	}

	// Create temp file for DuckDB to read
	tempFile, err := os.CreateTemp("", "logs_import_*.csv")
	if err != nil {
		http.Error(w, "Failed to create temp file", http.StatusInternalServerError)
		return
	}
	defer os.Remove(tempFile.Name())

	if _, err := io.Copy(tempFile, file); err != nil {
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}
	tempFile.Close()

	// Run DuckDB import using read_csv_auto
	// We need to map the panorama CSV headers or insert directly
	// Let's assume standard Palo Alto Networks CSV format for now or just generic bulk insert
	// For now, we'll try to let read_csv_auto ingest it
	
	logDB.WriteLock()
	defer logDB.WriteUnlock()

	// DuckDB allows inserting from CSV natively
	// We'll insert into traffic_logs assuming headers match or we select specific columns
	// Since CSV headers from PAN-OS are very specific, we might just load it into a temporary table, then map it.
	
	// Create a staging table
	stagingTable := "staging_" + strings.ReplaceAll(filepath.Base(tempFile.Name()), ".", "_")

	importCmd := fmt.Sprintf(`CREATE TEMP TABLE %s AS SELECT * FROM read_csv_auto('%s');`, stagingTable, tempFile.Name())
	if _, err := logDB.DB().Exec(importCmd); err != nil {
		http.Error(w, fmt.Sprintf("Failed to load CSV into staging: %v", err), http.StatusInternalServerError)
		return
	}

	insertCmd := fmt.Sprintf(`
		INSERT INTO traffic_logs (
			device_name, serial, rule_name, source_user, category, source_zone, source_ip, 
			dest_zone, dest_ip, application, dest_port, protocol, action, threat_type, 
			session_end_reason, nat_source_ip, nat_dest_ip, app_subcategory, app_category, 
			app_technology, count, bytes, bytes_sent, bytes_received, packets, packets_sent, packets_received, client_id
		)
		SELECT 
			"Device Name", "Serial #", "Rule", "Source User", "Category", "Source Zone", "Source address",
			"Destination Zone", "Destination address", "Application", 
			TRY_CAST("Destination Port" AS BIGINT), 
			"IP Protocol", "Action", "Threat/Content Type", 
			"Session End Reason", "NAT Source IP", "NAT Destination IP", 
			"Subcategory of app", "Category of app", "Technology of app",
			TRY_CAST("Count" AS BIGINT),
			TRY_CAST("Bytes" AS BIGINT), 
			TRY_CAST("Bytes Sent" AS BIGINT), 
			TRY_CAST("Bytes Received" AS BIGINT), 
			TRY_CAST("Packets" AS BIGINT),
			TRY_CAST("Packets Sent" AS BIGINT), 
			TRY_CAST("Packets Received" AS BIGINT),
			'%s'
		FROM %s;
	`, clientID, stagingTable)

	_, err = logDB.DB().Exec(insertCmd)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to map staging data to logs table: %v", err), http.StatusInternalServerError)
		return
	}

	// Drop staging
	logDB.DB().Exec(fmt.Sprintf("DROP TABLE %s;", stagingTable))

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"success"}`))
}

func HandleGetLogs(w http.ResponseWriter, r *http.Request, logDB *storage.LogDB) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	clientID := r.URL.Query().Get("client_id")
	if clientID == "" {
		http.Error(w, "client_id is required", http.StatusBadRequest)
		return
	}

	limit := 100
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil {
			offset = parsed
		}
	}

	query := "SELECT * FROM traffic_logs WHERE client_id = ? ORDER BY id DESC LIMIT ? OFFSET ?"
	rows, err := logDB.DB().Query(query, clientID, limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	var results []map[string]interface{}

	for rows.Next() {
		columns := make([]interface{}, len(cols))
		columnPointers := make([]interface{}, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		if err := rows.Scan(columnPointers...); err != nil {
			continue
		}

		m := make(map[string]interface{})
		for i, colName := range cols {
			val := columnPointers[i].(*interface{})
			m[colName] = *val
		}
		results = append(results, m)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func HandleDeleteLogs(w http.ResponseWriter, r *http.Request, logDB *storage.LogDB) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	clientID := r.URL.Query().Get("client_id")
	if clientID == "" {
		http.Error(w, "client_id is required", http.StatusBadRequest)
		return
	}

	logDB.WriteLock()
	defer logDB.WriteUnlock()

	_, err := logDB.DB().Exec("DELETE FROM traffic_logs WHERE client_id = ?", clientID)
	if err != nil {
		http.Error(w, "Failed to delete logs", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"success"}`))
}
