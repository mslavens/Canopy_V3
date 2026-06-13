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
	"time"
	"log/slog"
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

	colRows, err := logDB.DB().Query(fmt.Sprintf("PRAGMA table_info('%s');", stagingTable))
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get staging columns: %v", err), http.StatusInternalServerError)
		return
	}
	existingCols := make(map[string]bool)
	for colRows.Next() {
		var cid int
		var name, ctype string
		var notnull bool
		var dfltValue interface{}
		var pk int
		colRows.Scan(&cid, &name, &ctype, &notnull, &dfltValue, &pk)
		existingCols[name] = true
	}
	colRows.Close()

	getStrCol := func(name string) string {
		if existingCols[name] {
			return fmt.Sprintf(`"%s"`, name)
		}
		return "'na'"
	}
	
	getNumCol := func(name string) string {
		if existingCols[name] {
			return fmt.Sprintf(`SUM(COALESCE(TRY_CAST("%s" AS BIGINT), 0))`, name)
		}
		return "0"
	}
	
	getCountCol := func(name string) string {
		if existingCols[name] {
			return fmt.Sprintf(`SUM(COALESCE(TRY_CAST("%s" AS BIGINT), 1))`, name)
		}
		return "SUM(1)"
	}

	insertCmd := fmt.Sprintf(`
		INSERT INTO traffic_logs (
			device_name, serial, rule_name, source_user, category, source_zone, source_ip, 
			dest_zone, dest_ip, application, dest_port, protocol, action, threat_type, 
			session_end_reason, nat_source_ip, nat_dest_ip, app_subcategory, app_category, 
			app_technology, count, bytes, bytes_sent, bytes_received, packets, packets_sent, packets_received, client_id
		)
		SELECT 
			%s, %s, %s, %s, %s, %s, %s,
			%s, %s, %s, 
			TRY_CAST(%s AS BIGINT), 
			%s, %s, %s, 
			%s, %s, %s, 
			%s, %s, %s,
			%s, %s, %s, %s, %s, %s, %s,
			'%s'
		FROM %s
		GROUP BY 
			%s, %s, %s, %s, %s, %s, %s,
			%s, %s, %s, 
			TRY_CAST(%s AS BIGINT), 
			%s, %s, %s, 
			%s, %s, %s, 
			%s, %s, %s;
	`, 
		getStrCol("Device Name"), getStrCol("Serial #"), getStrCol("Rule"), getStrCol("Source User"), getStrCol("Category"), getStrCol("Source Zone"), getStrCol("Source address"),
		getStrCol("Destination Zone"), getStrCol("Destination address"), getStrCol("Application"), 
		getStrCol("Destination Port"), 
		getStrCol("IP Protocol"), getStrCol("Action"), getStrCol("Threat/Content Type"), 
		getStrCol("Session End Reason"), getStrCol("NAT Source IP"), getStrCol("NAT Destination IP"), 
		getStrCol("Subcategory of app"), getStrCol("Category of app"), getStrCol("Technology of app"),
		getCountCol("Count"), getNumCol("Bytes"), getNumCol("Bytes Sent"), getNumCol("Bytes Received"), getNumCol("Packets"), getNumCol("Packets Sent"), getNumCol("Packets Received"),
		clientID, stagingTable,
		getStrCol("Device Name"), getStrCol("Serial #"), getStrCol("Rule"), getStrCol("Source User"), getStrCol("Category"), getStrCol("Source Zone"), getStrCol("Source address"),
		getStrCol("Destination Zone"), getStrCol("Destination address"), getStrCol("Application"), 
		getStrCol("Destination Port"), 
		getStrCol("IP Protocol"), getStrCol("Action"), getStrCol("Threat/Content Type"), 
		getStrCol("Session End Reason"), getStrCol("NAT Source IP"), getStrCol("NAT Destination IP"), 
		getStrCol("Subcategory of app"), getStrCol("Category of app"), getStrCol("Technology of app"),
	)

	res, err := logDB.DB().Exec(insertCmd)
	if err != nil {
		slog.Error("Failed to copy data from staging to logs table", slog.String("error", err.Error()))
		http.Error(w, fmt.Sprintf("Failed to map staging data to logs table: %v", err), http.StatusInternalServerError)
		return
	}

	logAuditSafe("Logs Imported", "Diagnostics", fmt.Sprintf("Imported traffic logs via CSV into workspace: %s", clientID))

	rowsAffected, _ := res.RowsAffected()

	// Drop staging
	logDB.DB().Exec(fmt.Sprintf("DROP TABLE IF EXISTS %s", stagingTable))

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(fmt.Sprintf(`{"status":"success", "rows": %d}`, rowsAffected)))
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

	query := "SELECT * EXCLUDE (id), CAST(id AS VARCHAR) as id FROM traffic_logs WHERE client_id = ? ORDER BY id DESC LIMIT ? OFFSET ?"
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

	var total int
	err = logDB.DB().QueryRow("SELECT COUNT(*) FROM traffic_logs WHERE client_id = ?", clientID).Scan(&total)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get total count: %v", err), http.StatusInternalServerError)
		return
	}

	if results == nil {
		results = []map[string]interface{}{}
	}

	response := map[string]interface{}{
		"data":   results,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func HandleGetLogSchema(w http.ResponseWriter, r *http.Request, logDB *storage.LogDB) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	query := "SELECT column_name FROM information_schema.columns WHERE table_name = 'traffic_logs'"
	rows, err := logDB.DB().Query(query)
	if err != nil {
		slog.Error("Failed to query log schema", slog.String("error", err.Error()))
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var columns []string
	excludeMap := map[string]bool{
		"id":               true,
		"client_id":        true,
		"count":            true,
		"bytes":            true,
		"bytes_sent":       true,
		"bytes_received":   true,
		"packets":          true,
		"packets_sent":     true,
		"packets_received": true,
	}

	for rows.Next() {
		var colName string
		if err := rows.Scan(&colName); err != nil {
			continue
		}
		if !excludeMap[colName] {
			columns = append(columns, colName)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(columns)
}

func HandleGetHeatmap(w http.ResponseWriter, r *http.Request, logDB *storage.LogDB) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	clientID := r.URL.Query().Get("client_id")
	if clientID == "" {
		http.Error(w, "client_id is required", http.StatusBadRequest)
		return
	}

	// Read grouping axes from query (comma separated)
	// Example: x_axis=source_zone,source_ip & y_axis=dest_zone,dest_ip,dest_port
	xAxisQuery := r.URL.Query().Get("x_axis")
	yAxisQuery := r.URL.Query().Get("y_axis")

	var selectFields []string
	var groupFields []string

	if xAxisQuery != "" {
		xAxisFields := strings.Split(xAxisQuery, ",")
		for _, f := range xAxisFields {
			f = strings.TrimSpace(f)
			if f != "" {
				selectFields = append(selectFields, f)
				groupFields = append(groupFields, f)
			}
		}
	}

	if yAxisQuery != "" {
		yAxisFields := strings.Split(yAxisQuery, ",")
		for _, f := range yAxisFields {
			f = strings.TrimSpace(f)
			if f != "" {
				selectFields = append(selectFields, f)
				groupFields = append(groupFields, f)
			}
		}
	}

	// Always compute aggregate metrics
	aggregateSelect := "SUM(COALESCE(count, 0)) as total_count, SUM(COALESCE(bytes, 0)) as total_bytes, SUM(COALESCE(packets, 0)) as total_packets"
	
	// Default behavior if no groups provided (just totals)
	var query string
	if len(groupFields) > 0 {
		groupStr := strings.Join(groupFields, ", ")
		query = fmt.Sprintf("SELECT %s, %s FROM traffic_logs WHERE client_id = ? GROUP BY %s ORDER BY total_count DESC LIMIT 1000", groupStr, aggregateSelect, groupStr)
	} else {
		query = fmt.Sprintf("SELECT %s FROM traffic_logs WHERE client_id = ?", aggregateSelect)
	}

	rows, err := logDB.DB().Query(query, clientID)
	if err != nil {
		slog.Error("Failed to query heatmap data", slog.String("error", err.Error()), slog.String("query", query))
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

	if results == nil {
		results = []map[string]interface{}{}
	}

	response := map[string]interface{}{
		"data": results,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
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

	logAuditSafe("Logs Cleared", "Diagnostics", "Cleared all traffic logs from workspace: "+clientID)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"success"}`))
}

func HandleDeleteLogsBatch(w http.ResponseWriter, r *http.Request, logDB *storage.LogDB) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	clientID := r.URL.Query().Get("client_id")
	if clientID == "" {
		http.Error(w, "client_id is required", http.StatusBadRequest)
		return
	}

	var payload struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid body", http.StatusBadRequest)
		return
	}

	if len(payload.IDs) == 0 {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"success"}`))
		return
	}

	logDB.WriteLock()
	defer logDB.WriteUnlock()

	// Use IN clause to delete multiple UUIDs
	placeholders := make([]string, len(payload.IDs))
	args := make([]interface{}, len(payload.IDs)+1)
	args[0] = clientID
	for i, id := range payload.IDs {
		placeholders[i] = "?"
		args[i+1] = id
	}

	query := fmt.Sprintf("DELETE FROM traffic_logs WHERE client_id = ? AND id IN (%s)", strings.Join(placeholders, ","))
	
	_, err := logDB.DB().Exec(query, args...)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to delete logs: %v", err), http.StatusInternalServerError)
		return
	}

	logAuditSafe("Logs Deleted", "Diagnostics", fmt.Sprintf("Deleted %d specific traffic logs from workspace: %s", len(payload.IDs), clientID))

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"success"}`))
}

type CandidateRulePass struct {
	ID        string   `json:"id"`
	GroupBy   []string `json:"group_by"`
	Aggregate []string `json:"aggregate"`
}

type GenerateCandidatesRequest struct {
	ClientID         string                 `json:"client_id"`
	Passes           []CandidateRulePass    `json:"passes"`
	Limit            int                    `json:"limit"`
	ActiveCellFilter []map[string][]string  `json:"active_cell_filter"`
	AnalysisColumns  []string               `json:"analysis_columns"`
}

func HandleGenerateCandidateRules(w http.ResponseWriter, r *http.Request, logDB *storage.LogDB) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req GenerateCandidatesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid body", http.StatusBadRequest)
		return
	}

	if req.ClientID == "" {
		http.Error(w, "client_id is required", http.StatusBadRequest)
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 1000 // default
	}

	// Build the base WHERE clause based on ActiveCellFilter
	var whereClauses []string
	var whereArgs []interface{}

	whereClauses = append(whereClauses, "client_id = ?")
	whereArgs = append(whereArgs, req.ClientID)

	if len(req.ActiveCellFilter) > 0 {
		var filterOrs []string
		for _, filter := range req.ActiveCellFilter {
			var filterAnds []string
			for col, vals := range filter {
				if len(vals) == 0 {
					continue
				}
				var qmarks []string
				for _, v := range vals {
					qmarks = append(qmarks, "?")
					whereArgs = append(whereArgs, v)
				}
				filterAnds = append(filterAnds, fmt.Sprintf(`"%s" IN (%s)`, col, strings.Join(qmarks, ",")))
			}
			if len(filterAnds) > 0 {
				filterOrs = append(filterOrs, fmt.Sprintf("(%s)", strings.Join(filterAnds, " AND ")))
			}
		}
		if len(filterOrs) > 0 {
			whereClauses = append(whereClauses, fmt.Sprintf("(%s)", strings.Join(filterOrs, " OR ")))
		}
	}

	whereClauseStr := strings.Join(whereClauses, " AND ")

	// The analysis fields provided by the UI to aggregate into
	var allFields []string
	if len(req.AnalysisColumns) > 0 {
		allFields = req.AnalysisColumns
	} else {
		// Fallback for legacy requests without analysis_columns
		allFields = []string{
			"source_zone", "source_ip", "dest_zone", "dest_ip", "dest_port", 
			"protocol", "application", "action",
		}
	}

	type RuleResult struct {
		PassID string                   `json:"pass_id"`
		Rules  []map[string]interface{} `json:"rules"`
	}

	var results []RuleResult

	// Track the column type to apply the correct aggregation functions.
	// Starts with all fields as 'scalar'.
	colTypes := make(map[string]string)
	for _, f := range allFields {
		colTypes[f] = "scalar"
	}

	var ctes []string

	for passIdx, pass := range req.Passes {
		// Enforce V1 logic: Any column not being aggregated must be grouped.
		// This guarantees that every pass projects every column in allFields.
		aggMap := make(map[string]bool)
		for _, col := range pass.Aggregate {
			aggMap[col] = true
		}
		var enforcedGroupBy []string
		for _, col := range allFields {
			if !aggMap[col] {
				enforcedGroupBy = append(enforcedGroupBy, col)
			}
		}
		pass.GroupBy = enforcedGroupBy

		var groupCols []string
		for _, col := range pass.GroupBy {
			groupCols = append(groupCols, fmt.Sprintf(`"%s"`, col))
		}
		groupStr := strings.Join(groupCols, ", ")

		var selectCols []string
		for _, col := range pass.GroupBy {
			selectCols = append(selectCols, fmt.Sprintf(`"%s"`, col))
		}
		for _, col := range pass.Aggregate {
			if colTypes[col] == "scalar" {
				// Aggregate scalar values into a sorted unique list
				selectCols = append(selectCols, fmt.Sprintf(`list_sort(list_distinct(list("%s"))) as "%s"`, col, col))
				colTypes[col] = "list"
			} else {
				// Aggregate list values by flattening, deduplicating, and sorting
				selectCols = append(selectCols, fmt.Sprintf(`list_sort(list_distinct(flatten(list("%s")))) as "%s"`, col, col))
			}
		}

		selectStr := strings.Join(selectCols, ", ")
		if selectStr == "" {
			selectStr = "1"
		}
		aggregateSelect := "SUM(COALESCE(count, 0)) as count, SUM(COALESCE(bytes, 0)) as bytes, SUM(COALESCE(packets, 0)) as packets"
		
		fromStr := "traffic_logs"
		whereStr := whereClauseStr
		if passIdx > 0 {
			fromStr = fmt.Sprintf("pass_%d", passIdx-1)
			whereStr = "1=1" // Filters are applied to traffic_logs in pass_0
		}

		var cte string
		if len(groupCols) > 0 {
			cte = fmt.Sprintf(`
				pass_%d AS (
					SELECT %s, %s 
					FROM %s 
					WHERE %s 
					GROUP BY %s
				)`, passIdx, selectStr, aggregateSelect, fromStr, whereStr, groupStr)
		} else {
			cte = fmt.Sprintf(`
				pass_%d AS (
					SELECT %s, %s 
					FROM %s 
					WHERE %s
				)`, passIdx, selectStr, aggregateSelect, fromStr, whereStr)
		}
		ctes = append(ctes, cte)

		query := fmt.Sprintf(`
			WITH %s
			SELECT * FROM pass_%d
			ORDER BY count DESC
			LIMIT ?
		`, strings.Join(ctes, ", "), passIdx)

		args := append(whereArgs, limit)
		rows, err := logDB.DB().Query(query, args...)
		if err != nil {
			slog.Error("Failed to query candidates data", slog.String("error", err.Error()), slog.String("query", query))
			http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
			return
		}

		cols, _ := rows.Columns()
		var passRules []map[string]interface{}

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
				
				// DuckDB returns LISTs as strings like `[val1, val2]` when scanned this way, or byte arrays depending on the driver.
				// For the V1 UI, we need actual arrays.
				if valStr, ok := (*val).(string); ok && strings.HasPrefix(valStr, "[") && strings.HasSuffix(valStr, "]") {
					valStr = valStr[1 : len(valStr)-1]
					if valStr == "" {
						m[colName] = []string{"any"}
					} else {
						// Simple parsing of DuckDB LIST output string representation
						arr := strings.Split(valStr, ", ")
						m[colName] = arr
					}
				} else if valBytes, ok := (*val).([]byte); ok {
					valStr := string(valBytes)
					if strings.HasPrefix(valStr, "[") && strings.HasSuffix(valStr, "]") {
						valStr = valStr[1 : len(valStr)-1]
						if valStr == "" {
							m[colName] = []string{"any"}
						} else {
							arr := strings.Split(valStr, ", ")
							m[colName] = arr
						}
					} else {
						m[colName] = []string{valStr}
					}
				} else {
					if *val == nil {
						m[colName] = []string{"any"}
					} else {
						m[colName] = []string{fmt.Sprintf("%v", *val)}
					}
				}
			}
			
			m["id"] = fmt.Sprintf("cand-%d", time.Now().UnixNano())
			
			// Format arrays explicitly for UI compatibility
			for _, f := range allFields {
				if _, exists := m[f]; !exists {
					m[f] = []string{"any"}
				}
			}

			passRules = append(passRules, m)
		}
		rows.Close()

		if passRules == nil {
			passRules = []map[string]interface{}{}
		}

		results = append(results, RuleResult{
			PassID: pass.ID,
			Rules:  passRules,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "success",
		"data":   results,
	})
}
