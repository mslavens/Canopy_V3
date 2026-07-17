package main

import (
	"encoding/json"
	"net/http"

	"canopy-core/engine"

	"golang.org/x/exp/slog"
)

type SandboxResolveRequest struct {
	IPAddress   string   `json:"ip_address"`
	DeviceUUIDs []string `json:"device_uuids"` // Optional, if empty searches all
}

func handleResolveSandbox(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SandboxResolveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Malformed JSON payload", http.StatusBadRequest)
		return
	}

	vaultMutex.RLock()
	if activeDB == nil {
		vaultMutex.RUnlock()
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
		return
	}
	dbConn := activeDB.DB()
	vaultMutex.RUnlock()

	// Use engine to perform sandbox resolution
	// In the real path evaluation, it takes source and dest. For sandbox, we want to see how an IP resolves locally.
	// Since engine.FindPath evaluates source/dest to find the topology path, we'll need a Sandbox specific logic
	// But actually, engine.RouteLookup computes the routing table match. Let's see if engine has a RouteLookup function.
	
	// Wait, we can implement the same logic from useZoneResolver.jsx here.
	// Query all devices, interfaces, and routes from the database.
	
	payload, err := engine.SandboxResolveIP(dbConn, req.IPAddress, req.DeviceUUIDs)
	if err != nil {
		slog.Error("Sandbox evaluation failed", slog.String("error", err.Error()))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(payload)
}

func handleToolsOptimize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req engine.OptimizeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Malformed JSON payload", http.StatusBadRequest)
		return
	}

	vaultMutex.RLock()
	if activeDB == nil {
		vaultMutex.RUnlock()
		w.WriteHeader(http.StatusLocked)
		json.NewEncoder(w).Encode(map[string]string{"error": "Storage vault is locked."})
		return
	}
	dbConn := activeDB.DB()
	vaultMutex.RUnlock()

	insights, err := engine.Optimize(dbConn, req)
	if err != nil {
		slog.Error("Optimization evaluation failed", slog.String("error", err.Error()))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"insights": insights})
}
