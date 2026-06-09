# Architectural & Implementation Constraints

## Relational Mapping & Scope Integrity
- **Polymorphic Scopes:** All administrative objects (addresses, services, tags) and policy rules (security, NAT, decryption) must map to their respective configurations strictly using integer IDs referencing a centralized `scopes` table. 
- **Separation of Concerns (Appliances vs. Scopes):** Structural Panorama configurations (Device Groups, Templates, Template Stacks) must never be mixed inside tables representing physical/virtual appliances. Actual firewalls must reside exclusively in `managed_devices_raw` and bind to groups or stacks via structured foreign keys.
- **Cascading Name Integrity:** Do not use string-based name matching to link firewalls to templates or device groups. All relationships must map using database primary key integer IDs so that updates (e.g. renaming an appliance) propagate automatically.
