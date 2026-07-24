package paloalto

import (
	"database/sql"
)

func getInheritedScopesFromDB(tx *sql.Tx, deviceUUID string) []string {
	var scopes []string
	curr := deviceUUID
	for curr != "" {
		scopes = append(scopes, curr)
		var parent sql.NullString
		err := tx.QueryRow("SELECT parent_uuid FROM scopes WHERE uuid = ?", curr).Scan(&parent)
		if err != nil || !parent.Valid {
			break
		}
		curr = parent.String
	}
	// Also ensure panorama global is in the list
	scopes = append(scopes, "paloalto-panorama-global")
	return scopes
}

func resolveAddressFromDB(tx *sql.Tx, deviceUUID, name string) (int64, int64, bool) {
	scopes := getInheritedScopesFromDB(tx, deviceUUID)
	for _, scopeUUID := range scopes {
		var id int64
		err := tx.QueryRow("SELECT id FROM address_objects WHERE device_uuid = ? AND name = ?", scopeUUID, name).Scan(&id)
		if err == nil {
			return id, 0, true
		}
		err = tx.QueryRow("SELECT id FROM address_groups WHERE device_uuid = ? AND name = ?", scopeUUID, name).Scan(&id)
		if err == nil {
			return 0, id, true
		}
	}
	return 0, 0, false
}

func resolveServiceFromDB(tx *sql.Tx, deviceUUID, name string) (int64, int64, bool) {
	scopes := getInheritedScopesFromDB(tx, deviceUUID)
	for _, scopeUUID := range scopes {
		var id int64
		err := tx.QueryRow("SELECT id FROM service_objects WHERE device_uuid = ? AND name = ?", scopeUUID, name).Scan(&id)
		if err == nil {
			return id, 0, true
		}
		err = tx.QueryRow("SELECT id FROM service_groups WHERE device_uuid = ? AND name = ?", scopeUUID, name).Scan(&id)
		if err == nil {
			return 0, id, true
		}
	}
	return 0, 0, false
}

func resolveApplicationFromDB(tx *sql.Tx, deviceUUID, name string) (int64, int64, bool) {
	scopes := getInheritedScopesFromDB(tx, deviceUUID)
	for _, scopeUUID := range scopes {
		var id int64
		err := tx.QueryRow("SELECT id FROM application_objects WHERE device_uuid = ? AND name = ?", scopeUUID, name).Scan(&id)
		if err == nil {
			return id, 0, true
		}
		err = tx.QueryRow("SELECT id FROM application_groups WHERE device_uuid = ? AND name = ?", scopeUUID, name).Scan(&id)
		if err == nil {
			return 0, id, true
		}
	}
	return 0, 0, false
}

func resolveTagFromDB(tx *sql.Tx, deviceUUID, name string) (int64, bool) {
	scopes := getInheritedScopesFromDB(tx, deviceUUID)
	for _, scopeUUID := range scopes {
		var id int64
		err := tx.QueryRow("SELECT id FROM tags WHERE device_uuid = ? AND name = ?", scopeUUID, name).Scan(&id)
		if err == nil {
			return id, true
		}
	}
	return 0, false
}
