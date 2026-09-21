# Generic Router / Firewall guidance
When the exact vendor is unknown or not in the built-in references:
1. Identify first — run the vendor's status command: `show version` (IOS/JunOS-like), `get system status` (FortiOS), `/system resource print` (RouterOS), `show system info` (PAN-OS).
2. Do NOT guess destructive syntax. Use the device's own help: `?` (IOS/Forti), `[Tab]` completion, or `show ?`.
3. Back up before changes using the device's native export/backup command.
4. Prefer the device's native rollback/revision feature over manual paste-back.
5. Verify every change with the matching show/get command before moving on.
