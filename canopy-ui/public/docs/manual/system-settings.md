## System Settings

The Settings module allows you to configure workspace security and behavior preferences.

### General Preferences

#### Session Auto-Lock Timer
The session auto-lock timer automatically locks the Canopy workspace after a specified period of user inactivity (no mouse movement, scrolling, or keyboard input). When the timer expires, the SQLCipher database connection is securely severed, and you must re-enter your passphrase (or use Biometric unlock if enabled) to resume your session. Setting the timer to `0` disables the auto-lock feature completely.

### Authentication & Security Architecture

#### How does the passphrase work?
Canopy uses a Single-Key architecture powered by **SQLCipher**. Your passphrase is mathematically hashed into an AES-256 encryption key that encrypts your entire offline SQLite database at the byte level. Because Canopy is a local offline tool, there are no distinct user accounts.

#### What is the "Remember Me" feature?
When you check "Remember my passphrase" on the unlock screen, Canopy uses Electron's native `safeStorage` API. Your host operating system (macOS Keychain or Windows Credential Manager) generates a highly secure cryptographic key to encrypt your passphrase. Canopy only saves the scrambled result locally. This allows you to securely unlock the application after an auto-lock using OS-level biometrics (like TouchID or Windows Hello) without weakening the database encryption.

#### Can I recover my password?
**No.** Because there is no central server and no secondary Key Encryption Key (KEK) backdoor, losing your passphrase means your data is permanently inaccessible. If you forget your password, you must use the **Emergency Reset** option on the lock screen to destroy the vault and start over.

#### Factory Reset Workspace
If you need to completely erase all data, policies, and configuration from the current system, you can use the **Factory Reset Workspace** option under the *Danger Zone*. This securely deletes the SQLCipher database and all application preferences, immediately returning Canopy to a clean, uninitialized state.