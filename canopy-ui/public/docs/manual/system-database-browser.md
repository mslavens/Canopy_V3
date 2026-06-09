# Database Browser Guide

The Database Browser is a direct window into Canopy's "brain" (the SQLite state engine). It allows you to look at the raw data extracted from your firewall configurations.

Don't worry if you've never used SQL (Structured Query Language) before! This tool is **Read-Only**, meaning you can freely explore the data without any fear of breaking, deleting, or altering your configurations.

## SQL 101: The Basics

To look at data, you use a `SELECT` statement. Think of it like politely asking the database a specific question.

### 1. "Show me everything in a table"
Use the `*` (asterisk) symbol to mean "all columns".
```sql
SELECT * FROM devices;
```
*This will show you every single imported device and all of its details.*

### 2. "Show me specific columns"
Instead of `*`, you can list exactly what you want to see.
```sql
SELECT interface_name, network_cidr FROM network_topology;
```
*This trims the noise and only shows the interface names and their IP addresses.*

### 3. "Filter the results" (The WHERE clause)
You can use `WHERE` to find specific needles in the haystack.
```sql
SELECT * FROM devices WHERE vendor = 'PaloAlto';
```
*This filters the table to only show devices where the vendor column exactly matches 'PaloAlto'.*

---

## Available Canopy Tables
You can query the following tables to see your data:
- **`devices`**: Tracks your imported firewall appliances (Names, Vendors, UUIDs).
- **`network_topology`**: Tracks the routing map (Interfaces, Subnets, Security Zones).
- **`license_vault`**: Tracks system activation status.