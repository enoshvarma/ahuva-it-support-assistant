# Cisco ASA Reference — Firewall

## Modes (IOS-like)
```
enable
configure terminal
show running-config
write memory              ! save (or: copy running-config startup-config)
```

## Interfaces (nameif / security-level)
```
interface GigabitEthernet0/1
 nameif inside
 security-level 100
 ip address 192.168.1.1 255.255.255.0
 no shutdown
```
Verify: `show interface ip brief`, `show nameif`

## Objects & NAT
```
object network LAN
 subnet 192.168.1.0 255.255.255.0
 nat (inside,outside) dynamic interface
```

## Access rules
```
access-list OUTSIDE_IN extended permit tcp any host 192.168.1.10 eq 443
access-group OUTSIDE_IN in interface outside
```
Verify: `show access-list`, `show run access-group`

## Save & backup
```
copy running-config startup-config
copy running-config tftp://192.168.1.50/asa-backup.cfg
```
Warning: changing the management interface / access rules can cut your own session.

## Diagnostics
```
show version
show interface ip brief
show conn
show xlate
packet-tracer input inside tcp 192.168.1.5 1234 8.8.8.8 443
```
