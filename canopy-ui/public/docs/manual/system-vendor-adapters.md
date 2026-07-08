# Vendor Adapters

The **Vendor Adapters** page displays the actively loaded firewall configuration parsing and generation plugins.

Canopy's core engine is fundamentally vendor-agnostic, handling generic security policies, objects, and networks. To interoperate with specific firewalls, Canopy utilizes modular **Vendor Adapters**.

## Understanding Adapters

Each adapter provides the following capabilities:
- **CLI Generation:** Translates Canopy's generic internal state into the specific CLI syntax required by the target vendor.
- **Parsing (Ingestion):** Reads the proprietary XML, JSON, or configuration blobs from a firewall and normalizes them into Canopy's standard database schema.

### Active Adapters
When you view this page, you will see a card for every plugin currently registered with the Go engine. 

- **Status Badge:** A green "Active" badge indicates the plugin successfully registered with the Canopy Engine on startup.
- **Licensing:** In the future, this screen will integrate with Lemon Squeezy to allow you to purchase, activate, or renew licenses for specific vendor modules.

### Troubleshooting
If you expect to see an adapter but it is missing:
1. Ensure you have a valid license activated for the specific vendor module.
2. Check the Canopy Engine startup logs in **System > Audit Logs** to see if the plugin failed to initialize or experienced a licensing error.
3. Verify that your Canopy installation is up to date, as newer vendor adapters may require a recent engine version.
