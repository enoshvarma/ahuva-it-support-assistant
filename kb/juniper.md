# Juniper Networks — JunOS Reference

## Connection & Setup
- Default CLI: `cli` (exits to shell)
- Enable operational mode: `cli`
- Enter configuration mode: `configure`
- Commit changes: `commit` (saves to running config)
- Discard uncommitted changes: `rollback 0`
- Show diff before committing: `show | compare`
- Exit configuration mode: `exit`

## Status Commands
```
show version                   # OS version, uptime, hardware model
show chassis hardware          # Physical hardware inventory
show interfaces terse          # All interfaces, link state, IP
show interfaces ge-0/0/0 detail  # Detailed stats for specific interface
show route                     # Routing table
show ospf neighbor             # OSPF adjacencies
show bgp summary               # BGP peer status
show arp                       # ARP table
show ethernet-switching table  # MAC address table (EX series switches)
show spanning-tree bridge      # STP state
show lldp neighbors            # LLDP neighbour discovery
```

## Interface Configuration
```
set interfaces ge-0/0/0 unit 0 family inet address 192.168.1.1/24
set interfaces ge-0/0/0 description "Uplink to core"
set interfaces ge-0/0/0 ether-options speed 1g
set interfaces ge-0/0/0 ether-options duplex full
delete interfaces ge-0/0/0 disable   # Enable disabled interface
set interfaces ge-0/0/0 disable      # Administratively disable
```

## VLAN Configuration (EX Series)
```
set vlans VLAN100 vlan-id 100
set vlans VLAN100 description "Office LAN"
set interfaces ge-0/0/0 unit 0 family ethernet-switching interface-mode access
set interfaces ge-0/0/0 unit 0 family ethernet-switching vlan members VLAN100
set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members all
set interfaces irb unit 100 family inet address 192.168.100.1/24  # L3 for VLAN100
```

## Routing
```
set routing-options static route 0.0.0.0/0 next-hop 10.0.0.1
set routing-options router-id 10.0.0.1
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0
```

## Security Policies (SRX)
```
set security policies from-zone trust to-zone untrust policy permit-all match source-address any
set security policies from-zone trust to-zone untrust policy permit-all match destination-address any
set security policies from-zone trust to-zone untrust policy permit-all match application any
set security policies from-zone trust to-zone untrust policy permit-all then permit
```

## Troubleshooting
```
show log messages | last 50             # Recent system log entries
show log messages | match error         # Filter for errors
ping 8.8.8.8 count 5                   # Ping with 5 packets
traceroute 8.8.8.8                     # Traceroute
monitor traffic interface ge-0/0/0 matching "host 10.0.0.1" count 20  # Packet capture
show interfaces ge-0/0/0 extensive | match "error|drop|resets"  # Error counters
```

## Save / Restore
```
save /var/tmp/config-backup.txt        # Save running config to file
load merge /var/tmp/config-backup.txt  # Restore from file
request system snapshot                # Full system snapshot
show system storage                    # Check disk usage before snapshot
```

## Known Gotchas
- JunOS uses a two-stage commit: `set` stages changes, `commit` applies them. `commit check` validates without applying.
- Older JunOS versions (< 18.x) use `family ethernet-switching` syntax; newer use `family bridge`.
- `rollback 1` restores the last committed config; `rollback 49` is the oldest saved.
- Always `show | compare` before `commit` on production — the diff prevents accidental overwrites.
