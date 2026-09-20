# Quantum Networks Switch Reference (NITW deployment)

## Access
Quantum managed switches generally follow an IOS-like CLI:
```
enable
configure terminal
show running-config
write memory          ! save configuration
```
Default console: 115200 or 9600 baud, 8-N-1. Web UI is often the primary management method — if CLI syntax fails, verify via the web interface.

## VLANs (IOS-like syntax)
```
vlan 10
 name DATA
interface gigabitethernet 0/5
 switchport mode access
 switchport access vlan 10
```
Verify: `show vlan`

## Useful show commands
```
show version
show vlan
show interface status
show mac-address-table
show ip interface
show poe status        ! on PoE models (syntax varies by model)
```

## Notes for site work
- Quantum syntax varies between model families. If a command returns "% Invalid input", run `?` at that mode level to list valid keywords for this exact model before retrying.
- Always record model and firmware (`show version`) in the handover doc.
