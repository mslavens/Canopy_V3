package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type Zone struct {
	ID         int    `json:"id"`
	DeviceUUID string `json:"device_uuid"`
	Scope      string `json:"scope"`
	Name       string `json:"name"`
	Type       string `json:"type"`
}

func handleGetZones(w http.ResponseWriter, r *http.Request) {
	activeDB.WriteLock()
	defer activeDB.WriteUnlock()

	rows, err := activeDB.DB().Query(`
		SELECT id, device_uuid, scope, name, type
		FROM zones
		ORDER BY name ASC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var zones []Zone
	for rows.Next() {
		var z Zone
		if err := rows.Scan(&z.ID, &z.DeviceUUID, &z.Scope, &z.Name, &z.Type); err != nil {
			continue
		}
		zones = append(zones, z)
	}
	if zones == nil {
		zones = []Zone{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(zones)
}

type Interface struct {
	ID         int    `json:"id"`
	DeviceUUID string `json:"device_uuid"`
	Scope      string `json:"scope"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	IPAddress  string `json:"ip_address"`
	Zone       string `json:"zone"` // We can derive this if needed
}

func handleGetInterfaces(w http.ResponseWriter, r *http.Request) {
	activeDB.WriteLock()
	defer activeDB.WriteUnlock()

	// Optionally join with network_topology to fetch the zone name
	rows, err := activeDB.DB().Query(`
		SELECT i.id, i.device_uuid, i.scope, i.name, i.type, i.ip_address, COALESCE(nt.zone_name, 'untrusted') as zone
		FROM interfaces i
		LEFT JOIN network_topology nt ON i.name = nt.interface_name AND i.device_uuid = nt.device_uuid
		ORDER BY i.name ASC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var interfaces []Interface
	for rows.Next() {
		var i Interface
		if err := rows.Scan(&i.ID, &i.DeviceUUID, &i.Scope, &i.Name, &i.Type, &i.IPAddress, &i.Zone); err != nil {
			continue
		}
		interfaces = append(interfaces, i)
	}
	if interfaces == nil {
		interfaces = []Interface{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(interfaces)
}

type Route struct {
	ID          int    `json:"id"`
	DeviceUUID  string `json:"device_uuid"`
	VRName      string `json:"vr_name"`
	RouteName   string `json:"route_name"`
	Destination string `json:"destination"`
	NextHop     string `json:"nexthop"`
	Interface   string `json:"interface"`
	Metric      int    `json:"metric"`
}

func handleGetRoutes(w http.ResponseWriter, r *http.Request) {
	activeDB.WriteLock()
	defer activeDB.WriteUnlock()

	rows, err := activeDB.DB().Query(`
		SELECT id, device_uuid, vr_name, route_name, destination, nexthop, interface, metric
		FROM static_routes
		ORDER BY vr_name ASC, route_name ASC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var routes []Route
	for rows.Next() {
		var rt Route
		var nextHop, iface sql.NullString
		if err := rows.Scan(&rt.ID, &rt.DeviceUUID, &rt.VRName, &rt.RouteName, &rt.Destination, &nextHop, &iface, &rt.Metric); err != nil {
			continue
		}
		rt.NextHop = nextHop.String
		rt.Interface = iface.String
		routes = append(routes, rt)
	}
	if routes == nil {
		routes = []Route{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(routes)
}

type Variable struct {
	ID         int    `json:"id"`
	DeviceUUID string `json:"device_uuid"`
	Scope      string `json:"scope"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Value      string `json:"value"`
}

func handleGetVariables(w http.ResponseWriter, r *http.Request) {
	activeDB.WriteLock()
	defer activeDB.WriteUnlock()

	rows, err := activeDB.DB().Query(`
		SELECT id, device_uuid, scope, name, type, value
		FROM variables
		ORDER BY scope ASC, name ASC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var variables []Variable
	for rows.Next() {
		var v Variable
		if err := rows.Scan(&v.ID, &v.DeviceUUID, &v.Scope, &v.Name, &v.Type, &v.Value); err != nil {
			continue
		}
		variables = append(variables, v)
	}
	if variables == nil {
		variables = []Variable{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(variables)
}
