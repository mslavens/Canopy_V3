# Architectural & Implementation Constraints

## Relational Mapping & Scope Integrity
- **Polymorphic Scopes:** All administrative objects (addresses, services, tags) and policy rules (security, NAT, decryption) must map to their respective configurations strictly using integer IDs referencing a centralized `scopes` table. 
- **Separation of Concerns (Appliances vs. Scopes):** Structural Panorama configurations (Device Groups, Templates, Template Stacks) must never be mixed inside tables representing physical/virtual appliances. Actual firewalls must reside exclusively in `managed_devices_raw` and bind to groups or stacks via structured foreign keys.
- **Cascading Name Integrity:** Do not use string-based name matching to link firewalls to templates or device groups. All relationships must map using database primary key integer IDs so that updates (e.g. renaming an appliance) propagate automatically.

## Developer Tooling & Database Integrity
- **Database Browser Synchronization:** When modifying the database schema (adding new tables, deleting tables, or modifying table structures), you MUST update the `tableCategories` catalog registry inside [DatabaseBrowserPage.tsx](file:///Users/mslavens/Documents/__Dev/AntigravityBuild/Canopy_V3/canopy-ui/src/pages/DatabaseBrowserPage.tsx) so that the new tables are instantly exposed as sidebar shortcuts with proper descriptive labels, icons, and summaries.
- **Schema Catalog Consistency:** Ensure that any newly introduced tables, system metadata tables, or schema updates are accounted for, and verify that they render correctly inside the Schema Catalog meta-queries.

