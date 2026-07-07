# Device Inventory

The Device Inventory page provides a unified dashboard and list of all managed firewalls inside your workspaces. From here, you can monitor device status, serial numbers, IP addresses, software versions, and configuration scope associations.

## Key Columns

* **Device Name**: The hostname or identifier of the firewall.
* **Serial Number**: The hardware or VM serial number.
* **IP Address**: The management interface IP.
* **Device Group**: The assigned Device Group hierarchy (if any).
* **Template Stack**: The bound Template Stack configuration (if any).
* **Connection Status**: Real-time daemon sync connectivity.

## Key Actions

### Registering/Adding Devices
1. Click the **Add Device** button at the top of the inventory table.
2. Enter the device hostname/IP, serial, and choose optional Device Group or Template Stack assignments.
3. Click **Add Device** to save.

### Editing Devices
- Click the edit icon on the right side of a device row, or click the Device Name link to open the properties editor.
- Update management credentials, IP addresses, or scope bindings.

### Deleting Devices
- Click the delete icon on a device row to remove the unit from the active workspace inventory.
  > [!NOTE]
  > Removing a device does not delete its local firewall configuration, only its workspace management binding in Canopy.
