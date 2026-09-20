# Generic Firewall guidance (Palo Alto / others)
- Palo Alto PAN-OS: CLI `show system info` to identify; config mode `configure`; `set` commands; `commit` to apply (nothing takes effect until commit). Rollback: `revert config`.
- Always identify with the status command first, back up (`save config to ...` / export), and verify after commit.
- Management-plane changes can drop your session — have out-of-band access ready.
