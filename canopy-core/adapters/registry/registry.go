package registry

import (
	"database/sql"
)

// VendorAdapter defines the standard interface for all vendor plugins.
type VendorAdapter interface {
	GetVendorID() string

	// Import Logic (Future)
	ParseConfig(tx *sql.Tx, fileContent []byte) error

	// Export / CLI Generation Logic
	GenerateAddressObjectCLI(scopePrefix, name, addrType, value, description string, tags []string) []string
	GenerateAddressGroupCLI(scopePrefix, name, grpType, filter string, members []string, description string, tags []string) []string
}

var adapters = make(map[string]VendorAdapter)

// Register adds a VendorAdapter to the global registry.
func Register(adapter VendorAdapter) {
	adapters[adapter.GetVendorID()] = adapter
}

// GetAdapter returns the registered adapter for the given vendor ID.
func GetAdapter(vendorID string) (VendorAdapter, bool) {
	adapter, ok := adapters[vendorID]
	return adapter, ok
}
