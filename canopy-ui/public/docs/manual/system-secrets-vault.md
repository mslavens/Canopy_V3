# Secrets Vault

The Secrets Vault securely stores API keys, tokens, and credentials used by the Canopy engine to authenticate with external infrastructure (such as Palo Alto firewalls or cloud APIs).

### Security & Encryption
All secrets are encrypted at rest inside your client workspace using your active passphrase via **SQLCipher**. They are never saved in plaintext and are only decrypted in memory when actively required by the backend engine to perform an external operation.

### Revealing Secrets
You can temporarily view a secret in plaintext by clicking the **Reveal** (eye) icon on the data grid. 

*Note: For strict compliance and security tracking, successfully revealing a secret will automatically generate an immutable event in the system's Security Audit Logs.*