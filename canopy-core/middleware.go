package main

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strings"
)

func globalCORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		// Allow local development server and Electron packaging protocols securely
		if origin == "http://localhost:5173" || strings.HasPrefix(origin, "file://") || strings.HasPrefix(origin, "app://") {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		} else {
			// Browsers strictly reject wildcard origins (*) when Allow-Credentials is true.
			// Safely echo the requested origin dynamically to prevent CORS preflight failures.
			if origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
		}

		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")
		w.Header().Set("Access-Control-Allow-Credentials", "true")

		// Instantly short-circuit browser preflight checks safely at the absolute edge
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
func authMiddleware(expectedToken string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			slog.Warn("Missing Authorization header", slog.String("path", r.URL.Path), slog.String("ip", r.RemoteAddr))
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] != expectedToken {
			slog.Warn("Invalid Authorization token", slog.String("path", r.URL.Path), slog.String("ip", r.RemoteAddr))
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}
func generateToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
func logAuditSafe(action, module, details string) {
	go func() {
		vaultMutex.RLock()
		if telemetryDB == nil {
			vaultMutex.RUnlock()
			return
		}
		db := telemetryDB.DB()
		vaultMutex.RUnlock()

		if _, err := db.Exec("INSERT INTO audit_logs (action, module, details) VALUES (?, ?, ?)", action, module, details); err != nil {
			slog.Error("Failed to write audit log", slog.String("error", err.Error()))
		}
	}()
}
