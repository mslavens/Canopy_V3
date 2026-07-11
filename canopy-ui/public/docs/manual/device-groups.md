# Device Group Management

Device Groups inside the Canopy framework allow you to organize firewall units into hierarchical structures for inheritance-based security policy distribution.

## Key Actions

### Creating Device Groups
1. Go to **Device Management > Device Groups**.
2. Right-click on a parent group (like `Shared`) to open the context menu.
3. Click **Add Child Group**.
4. Supply a group name and description, then click **Create Group**.

### Assigning Firewalls
1. Right-click any device group and select **Assign Firewalls**.
2. A modal will display all unassigned managed devices.
3. Check the devices you wish to bind to the group, then click **Assign Selected**.
4. You can also pop out the assignment view to a standalone window by clicking the popout icon.

### Editing & Deletion
* **Edit**: Choose **Edit Group** from the right-click menu to modify names or descriptions.
* **Delete**: Select **Delete Group** to permanently dissolve the group definition. 
  > [!WARNING]
  > Dissolving a device group will delete all security rules, zones, and variables associated with its scope.

### Generating CLI Commands
- Right-click any Device Group and select **Generate CLI** to generate the corresponding vendor set commands to synchronize your structures.
