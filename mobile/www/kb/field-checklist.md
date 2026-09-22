# Ahuva Field Engineer — On-Site Procedure

## Before touching any production switch
1. Confirm scope with the client in writing (which ports, which VLANs, which switches).
2. Take a configuration backup: `show running-config` — save the full output to file.
3. Note model, firmware, serial: `show version` / `show system` / `show inventory`.
4. Check current state before changes: `show vlan brief`, `show interface status`.
5. For disruptive work (reload, uplink changes, STP, management IP): agree a maintenance window with the client first.

## During changes
- One small change at a time; verify with a show command after each block.
- Never change the management IP or uplink config over SSH without console access as fallback.
- Keep a change log: time, command, result.

## After changes
1. Verify end-to-end: ping gateway, check `show mac address-table` for expected devices, confirm client devices get DHCP.
2. Save the config: `copy running-config startup-config` (Cisco/AW+) or `write memory`.
3. Take a fresh post-change backup.
4. Update handover documentation: port map, VLAN table, credentials, serials.
5. Get client sign-off on completed work.

## Escalation
If a change causes an outage you cannot resolve in 15 minutes: roll back to the backup config, restore service first, diagnose afterwards. Inform the project lead.
