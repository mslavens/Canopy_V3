package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

type Zone struct {
	ID         int    `json:"id"`
	DeviceUUID string `json:"device_uuid"`
	Scope      string `json:"scope"`
	Name       string `json:"name"`
	Type       string `json:"type"`
}

func getTemplateAncestry(deviceUUID string) []string {
	var ancestry []string
	
	if deviceUUID == "" {
		return ancestry
	}

	// 1. Check if the deviceUUID is explicitly a firewall (in managed_devices)
	var stackID sql.NullInt64
	var tmplID sql.NullInt64
	err := activeDB.DB().QueryRow("SELECT template_stack_id, template_id FROM managed_devices_raw WHERE device_uuid = ?", deviceUUID).Scan(&stackID, &tmplID)
	
	if err == nil {
		if stackID.Valid {
			// Find the stack device_uuid
			var stackUUID string
			activeDB.DB().QueryRow("SELECT device_uuid FROM template_stacks WHERE id = ?", stackID.Int64).Scan(&stackUUID)
			
			// Find all template device_uuids in sequence
			rows, err := activeDB.DB().Query(`
				SELECT t.device_uuid 
				FROM template_stack_members_raw m
				JOIN templates t ON m.template_id = t.id
				WHERE m.stack_id = ?
				ORDER BY m.sequence DESC
			`, stackID.Int64)
			if err == nil {
				defer rows.Close()
				for rows.Next() {
					var tUUID string
					rows.Scan(&tUUID)
					ancestry = append(ancestry, tUUID)
				}
			}
			ancestry = append(ancestry, stackUUID)
		} else if tmplID.Valid {
			var tUUID string
			activeDB.DB().QueryRow("SELECT device_uuid FROM templates WHERE id = ?", tmplID.Int64).Scan(&tUUID)
			ancestry = append(ancestry, tUUID)
		}
		
		// The device itself is the most specific
		ancestry = append(ancestry, deviceUUID)
	} else {
		// If it's not a firewall, check if it's a stack
		var sID int64
		errStack := activeDB.DB().QueryRow("SELECT id FROM template_stacks WHERE device_uuid = ?", deviceUUID).Scan(&sID)
		if errStack == nil {
			rows, err := activeDB.DB().Query(`
				SELECT t.device_uuid 
				FROM template_stack_members_raw m
				JOIN templates t ON m.template_id = t.id
				WHERE m.stack_id = ?
				ORDER BY m.sequence DESC
			`, sID)
			if err == nil {
				defer rows.Close()
				for rows.Next() {
					var tUUID string
					rows.Scan(&tUUID)
					ancestry = append(ancestry, tUUID)
				}
			}
			ancestry = append(ancestry, deviceUUID)
		} else {
			// Just a raw template or other scope
			ancestry = append(ancestry, deviceUUID)
		}
	}
	
	return ancestry
}

func resolveVariables(ancestry []string) map[string]string {
	resolved := make(map[string]string)
	if len(ancestry) == 0 {
		return resolved
	}
	for _, devUUID := range ancestry {
		rows, err := activeDB.DB().Query("SELECT name, value FROM variables WHERE device_uuid = ?", devUUID)
		if err == nil {
			for rows.Next() {
				var name, value string
				rows.Scan(&name, &value)
				resolved[name] = value
			}
			rows.Close()
		}
	}
	return resolved
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
	ancestry := getTemplateAncestry(deviceUUID)
	
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
	ID         int    `json:"id"`
	DeviceUUID string `json:"device_uuid"`
	Scope      string `json:"scope"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	IPAddress  string `json:"ip_address"`
	Zone       string `json:"zone"`
	VRName     string `json:"vr_name"`
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
	ancestry := getTemplateAncestry(deviceUUID)
	
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

	vars := resolveVariables(ancestry)
	
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
		
		// Substitute variables
		for vName, vVal := range vars {
			i.IPAddress = strings.ReplaceAll(i.IPAddress, vName, vVal)
		}
		
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

	deviceUUID := r.URL.Query().Get("device_uuid")
	
	query := `
		SELECT id, device_uuid, vr_name, route_name, destination, nexthop, interface, metric
		FROM static_routes
	`
	
	var args []interface{}
	ancestry := getTemplateAncestry(deviceUUID)
	
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

	vars := resolveVariables(ancestry)
	
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
		for vName, vVal := range vars {
			rt.Destination = strings.ReplaceAll(rt.Destination, vName, vVal)
			rt.NextHop = strings.ReplaceAll(rt.NextHop, vName, vVal)
		}
		
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
	ancestry := getTemplateAncestry(deviceUUID)
	
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
