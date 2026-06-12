package storage

import (
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	_ "github.com/marcboeker/go-duckdb"
)

// LogDB encapsulates the DuckDB connection for analytics
type LogDB struct {
	db    *sql.DB
	wLock sync.Mutex
}

func InitializeLogStore(dbName string) (*LogDB, error) {
	dbPath := dbName
	if dataPath := os.Getenv("CANOPY_DATA_PATH"); dataPath != "" {
		dbPath = filepath.Join(dataPath, dbName)
	}

	// DuckDB DSN is simply the file path
	db, err := sql.Open("duckdb", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open duckdb: %w", err)
	}

	// Initialize traffic logs table
	trafficSchema := `
	CREATE TABLE IF NOT EXISTS traffic_logs (
		id UUID DEFAULT gen_random_uuid(),
		device_name VARCHAR,
		serial VARCHAR,
		rule_name VARCHAR,
		source_user VARCHAR,
		category VARCHAR,
		source_zone VARCHAR,
		source_ip VARCHAR,
		dest_zone VARCHAR,
		dest_ip VARCHAR,
		application VARCHAR,
		dest_port BIGINT,
		protocol VARCHAR,
		action VARCHAR,
		threat_type VARCHAR,
		session_end_reason VARCHAR,
		nat_source_ip VARCHAR,
		nat_dest_ip VARCHAR,
		app_subcategory VARCHAR,
		app_category VARCHAR,
		app_technology VARCHAR,
		count BIGINT,
		bytes BIGINT,
		bytes_sent BIGINT,
		bytes_received BIGINT,
		packets BIGINT,
		packets_sent BIGINT,
		packets_received BIGINT,
		client_id VARCHAR
	);`

	if _, err := db.Exec(trafficSchema); err != nil {
		return nil, fmt.Errorf("failed to create traffic_logs table: %w", err)
	}

	slog.Info("DuckDB log storage initialized successfully",
		slog.String("db", dbName),
	)

	return &LogDB{
		db: db,
	}, nil
}

func (s *LogDB) Close() error {
	return s.db.Close()
}

func (s *LogDB) DB() *sql.DB {
	return s.db
}

func (s *LogDB) WriteLock() {
	s.wLock.Lock()
}

func (s *LogDB) WriteUnlock() {
	s.wLock.Unlock()
}
