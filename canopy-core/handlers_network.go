package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"canopy-core/engine"
)

type Zone struct {
	ID         int    `json:"id"`
	DeviceUUID string `json:"device_uuid"`
	Scope      string `json:"scope"`
	Name       string `json:"name"`
	Type       string `json:"type"`
}

func handleGetNetworkCounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	scopesParam := r.URL.Query().Get("scopes")
	var filter string
	var args []interface{}
	if scopesParam != "" {
		scopes := strings.Split(scopesParam, ",")
		placeholders := make([]string, len(scopes))
		for i, s := range scopes {
			placeholders[i] = "?"
			args = append(args, s)
		}
		filter = " WHERE device_uuid IN (" + strings.Join(placeholders, ",") + ")"
	}

	vaultMutex.RLock()
	if activeDB == nil {
		vaultMutex.RUnlock()
		http.Error(w, `{"error": "No active workspace loaded"}`, http.StatusBadRequest)
		return
	}
	db := activeDB
	vaultMutex.RUnlock()

	dbConn := db.DB()

	var zonesCount, ifsCount, routesCount, varsCount int
	dbConn.QueryRow("SELECT COUNT(*) FROM zones"+filter, args...).Scan(&zonesCount)
	dbConn.QueryRow("SELECT COUNT(*) FROM interfaces"+filter, args...).Scan(&ifsCount)
	dbConn.QueryRow("SELECT COUNT(*) FROM static_routes"+filter, args...).Scan(&routesCount)
	dbConn.QueryRow("SELECT COUNT(*) FROM variables"+filter, args...).Scan(&varsCount)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{
		"Zones":              zonesCount,
		"Interfaces":         ifsCount,
		"Route Table":        routesCount,
		"Template Variables": varsCount,
	})
}

func handleGetZones(w http.ResponseWriter, r *http.Request) {
	activeDB.WriteLock()
	defer activeDB.WriteUnlock()

	deviceUUID := r.URL.Query().Get("device_uuid")
	
	query := `
		SELECT id, device_uuid, scope, name, type
		FROM zones
	`
	
	var args []interface{}
	ancestry := engine.GetScopeLineage(activeDB.DB(), deviceUUID)
	
	if deviceUUID != "" && len(ancestry) > 0 {
		placeholders := make([]string, len(ancestry))
		for i, id := range ancestry {
			placeholders[i] = "?"
			args = append(args, id)
		}
		query += " WHERE device_uuid IN (" + strings.Join(placeholders, ",") + ")"
	}
	
	query += " ORDER BY name ASC"

	rows, err := activeDB.DB().Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	// Create map to keep most specific zone if multiple templates define the same zone name
	zonesMap := make(map[string]Zone)
	ancestryRank := make(map[string]int)
	for i, uuid := range ancestry {
		ancestryRank[uuid] = i
	}
	zonesRank := make(map[string]int)

	var zones []Zone
	for rows.Next() {
		var z Zone
		if err := rows.Scan(&z.ID, &z.DeviceUUID, &z.Scope, &z.Name, &z.Type); err != nil {
			continue
		}
		
		if deviceUUID != "" {
			rank := ancestryRank[z.DeviceUUID]
			if existingRank, exists := zonesRank[z.Name]; !exists || rank >= existingRank {
				zonesMap[z.Name] = z
				zonesRank[z.Name] = rank
			}
		} else {
			zones = append(zones, z)
		}
	}
	
	if deviceUUID != "" {
		for _, z := range zonesMap {
			zones = append(zones, z)
		}
	}

	if zones == nil {
		zones = []Zone{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(zones)
}

type Interface struct {
	ID                int    `json:"id"`
	DeviceUUID        string `json:"device_uuid"`
	Scope             string `json:"scope"`
	Name              string `json:"name"`
	Type              string `json:"type"`
	IPAddress         string `json:"ip_address"`
	ResolvedIPAddress string `json:"resolved_ip_address"`
	Zone              string `json:"zone"`
	VRName            string `json:"vr_name"`
}

func handleGetInterfaces(w http.ResponseWriter, r *http.Request) {
	activeDB.WriteLock()
	defer activeDB.WriteUnlock()

	deviceUUID := r.URL.Query().Get("device_uuid")
	
	query := `
		SELECT id, device_uuid, scope, name, type, ip_address, COALESCE(zone, 'untrusted'), COALESCE(vr_name, 'default')
		FROM interfaces
	`
	
	var args []interface{}
	ancestry := engine.GetScopeLineage(activeDB.DB(), deviceUUID)
	
	if deviceUUID != "" && len(ancestry) > 0 {
		placeholders := make([]string, len(ancestry))
		for i, id := range ancestry {
			placeholders[i] = "?"
			args = append(args, id)
		}
		query += " WHERE device_uuid IN (" + strings.Join(placeholders, ",") + ")"
	}
	
	query += " ORDER BY name ASC"

	rows, err := activeDB.DB().Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	vars := engine.ResolveVariables(activeDB.DB(), ancestry)
	
	// Create map to keep most specific interface if multiple templates define the same interface name
	interfacesMap := make(map[string]Interface)
	ancestryRank := make(map[string]int)
	for i, uuid := range ancestry {
		ancestryRank[uuid] = i
	}
	interfacesRank := make(map[string]int)

	var interfaces []Interface
	for rows.Next() {
		var i Interface
		if err := rows.Scan(&i.ID, &i.DeviceUUID, &i.Scope, &i.Name, &i.Type, &i.IPAddress, &i.Zone, &i.VRName); err != nil {
			continue
		}
		
		// Resolve variables for IP Address
		i.ResolvedIPAddress = engine.ApplyVariables(i.IPAddress, vars)
		
		if deviceUUID != "" {
			rank := ancestryRank[i.DeviceUUID]
			if existingRank, exists := interfacesRank[i.Name]; !exists || rank >= existingRank {
				interfacesMap[i.Name] = i
				interfacesRank[i.Name] = rank
			}
		} else {
			interfaces = append(interfaces, i)
		}
	}
	
	if deviceUUID != "" {
		for _, i := range interfacesMap {
			interfaces = append(interfaces, i)
		}
	}

	if interfaces == nil {
		interfaces = []Interface{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(interfaces)
}

type Route struct {
	ID                  int    `json:"id"`
	DeviceUUID          string `json:"device_uuid"`
	VRName              string `json:"vr_name"`
	RouteName           string `json:"route_name"`
	Destination         string `json:"destination"`
	ResolvedDestination string `json:"resolved_destination"`
	NextHop             string `json:"nexthop"`
	ResolvedNextHop     string `json:"resolved_nexthop"`
	Interface           string `json:"interface"`
	Metric              int    `json:"metric"`
}

func handleGetRoutes(w http.ResponseWriter, r *http.Request) {
	activeDB.WriteLock()
	defer activeDB.WriteUnlock()

	deviceUUID := r.URL.Query().Get("device_uuid")
	
	query := `
		SELECT id, device_uuid, vr_name, route_name, destination, nexthop, interface, metric
		FROM static_routes
	`
	
	var args []interface{}
	ancestry := engine.GetScopeLineage(activeDB.DB(), deviceUUID)
	
	if deviceUUID != "" && len(ancestry) > 0 {
		placeholders := make([]string, len(ancestry))
		for i, id := range ancestry {
			placeholders[i] = "?"
			args = append(args, id)
		}
		query += " WHERE device_uuid IN (" + strings.Join(placeholders, ",") + ")"
	}
	
	query += " ORDER BY vr_name ASC, route_name ASC"

	rows, err := activeDB.DB().Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	vars := engine.ResolveVariables(activeDB.DB(), ancestry)
	
	// Create map to keep most specific route if multiple templates define the same route name
	// In Palo Alto, a route is unique by VR Name + Route Name
	routesMap := make(map[string]Route)
	ancestryRank := make(map[string]int)
	for i, uuid := range ancestry {
		ancestryRank[uuid] = i
	}
	routesRank := make(map[string]int)

	var routes []Route
	for rows.Next() {
		var rt Route
		var nextHop, iface sql.NullString
		if err := rows.Scan(&rt.ID, &rt.DeviceUUID, &rt.VRName, &rt.RouteName, &rt.Destination, &nextHop, &iface, &rt.Metric); err != nil {
			continue
		}
		rt.NextHop = nextHop.String
		rt.Interface = iface.String
		
		// Substitute variables in Destination and NextHop
		rt.ResolvedDestination = engine.ApplyVariables(rt.Destination, vars)
		rt.ResolvedNextHop = engine.ApplyVariables(rt.NextHop, vars)
		
		if deviceUUID != "" {
			rank := ancestryRank[rt.DeviceUUID]
			mapKey := rt.VRName + "::" + rt.RouteName
			if existingRank, exists := routesRank[mapKey]; !exists || rank >= existingRank {
				routesMap[mapKey] = rt
				routesRank[mapKey] = rank
			}
		} else {
			routes = append(routes, rt)
		}
	}
	
	if deviceUUID != "" {
		for _, rt := range routesMap {
			routes = append(routes, rt)
		}
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

	deviceUUID := r.URL.Query().Get("device_uuid")

	query := `
		SELECT id, device_uuid, scope, name, type, value
		FROM variables
	`
	var args []interface{}
	ancestry := engine.GetScopeLineage(activeDB.DB(), deviceUUID)
	
	if deviceUUID != "" && len(ancestry) > 0 {
		placeholders := make([]string, len(ancestry))
		for i, id := range ancestry {
			placeholders[i] = "?"
			args = append(args, id)
		}
		query += " WHERE device_uuid IN (" + strings.Join(placeholders, ",") + ")"
	} else if deviceUUID != "" {
		query += " WHERE device_uuid = ?"
		args = append(args, deviceUUID)
	}

	query += " ORDER BY scope ASC, name ASC"

	rows, err := activeDB.DB().Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	varsMap := make(map[string]Variable)
	ancestryRank := make(map[string]int)
	for i, uuid := range ancestry {
		ancestryRank[uuid] = i
	}
	varsRank := make(map[string]int)

	var variables []Variable
	for rows.Next() {
		var v Variable
		if err := rows.Scan(&v.ID, &v.DeviceUUID, &v.Scope, &v.Name, &v.Type, &v.Value); err != nil {
			continue
		}
		
		if deviceUUID != "" {
			rank := ancestryRank[v.DeviceUUID]
			if existingRank, exists := varsRank[v.Name]; !exists || rank >= existingRank {
				varsMap[v.Name] = v
				varsRank[v.Name] = rank
			}
		} else {
			variables = append(variables, v)
		}
	}
	
	if deviceUUID != "" {
		for _, v := range varsMap {
			variables = append(variables, v)
		}
	}

	if variables == nil {
		variables = []Variable{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(variables)
}
