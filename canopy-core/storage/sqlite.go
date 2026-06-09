package storage

import (
	"database/sql"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"sync"

	// SQLCipher driver
	_ "github.com/mutecomm/go-sqlcipher/v4"
)

// AppStateDB encapsulates the SQLite database connection and provides
// a mutex to enforce the single-threaded write constraint required by the schema.
type AppStateDB struct {
	db    *sql.DB
	wLock sync.Mutex
}

// Initialize configures and provisions an encrypted SQLite state engine layer.
func Initialize(dbName string, password string) (*AppStateDB, error) {
	dbPath := dbName
	if dataPath := os.Getenv("CANOPY_DATA_PATH"); dataPath != "" {
		// Ensure the directory exists
		if err := os.MkdirAll(dataPath, 0755); err != nil {
			return nil, fmt.Errorf("failed to create user data directory: %w", err)
		}
		dbPath = filepath.Join(dataPath, dbName)
		slog.Info("Using persistent user data directory for storage", slog.String("path", dbPath))
	} else {
		slog.Warn("CANOPY_DATA_PATH not set, using local directory for storage. This is not recommended for production.")
	}

	// Using DSN parameters to configure initial pragmas safely with SQLCipher encryption key
	dsn := fmt.Sprintf("file:%s?_pragma_key=%s&_pragma_cipher_page_size=4096&_journal=WAL&_timeout=5000&_fk=true", dbPath, url.QueryEscape(password))

	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database: %w", err)
	}

	// Explicitly execute pragmas to ensure constraint alignment across driver versions
	pragmas := []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA busy_timeout = 5000;",
		"PRAGMA foreign_keys = ON;", // Required for CASCADE delete in network_topology
	}

	for _, pragma := range pragmas {
		if _, err := db.Exec(pragma); err != nil {
			return nil, fmt.Errorf("failed to execute %s: %w", pragma, err)
		}
	}

	slog.Info("SQLite storage layer initialized successfully",
		slog.String("db", dbName),
		slog.String("mode", "WAL"),
		slog.Int("timeout", 5000),
	)

	return &AppStateDB{
		db: db,
	}, nil
}

// VerifyPassword attempts to open a temporary connection to validate a passphrase.
func VerifyPassword(dbName string, password string) bool {
	dbPath := dbName
	if dataPath := os.Getenv("CANOPY_DATA_PATH"); dataPath != "" {
		dbPath = filepath.Join(dataPath, dbName)
	}
	dsn := fmt.Sprintf("file:%s?_pragma_key=%s&_pragma_cipher_page_size=4096", dbPath, url.QueryEscape(password))
	testDB, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return false
	}
	defer testDB.Close()
	return testDB.Ping() == nil
}

// Close safely terminates the database connection.
func (s *AppStateDB) Close() error {
	return s.db.Close()
}

// DB returns the underlying sql.DB instance for scalable parallel read queries.
func (s *AppStateDB) DB() *sql.DB {
	return s.db
}

// WriteLock acquires the single-threaded write mutex lock.
func (s *AppStateDB) WriteLock() {
	s.wLock.Lock()
}

// WriteUnlock releases the single-threaded write mutex lock.
func (s *AppStateDB) WriteUnlock() {
	s.wLock.Unlock()
}
