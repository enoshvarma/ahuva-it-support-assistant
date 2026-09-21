# Allied Telesis (AlliedWare Plus) Command Reference

## Basic access and modes
```
enable                      ! privileged mode
configure terminal          ! global config mode
exit / end                  ! step back / return to privileged
show running-config         ! current config
show startup-config
copy running-config startup-config   ! save (or: write memory / wr)
```

## VLAN creation (Ahuva standard convention)
```
configure terminal
vlan database
  vlan 10 name DATA
  vlan 20 name VOICE
  vlan 30 name MGMT
  vlan 40 name GUEST
  vlan 50 name CCTV
  vlan 60 name WIFI_AP
exit
```
Verify: `show vlan` and `show vlan brief`

## Access port (assign a port to a VLAN)
```
interface port1.0.5
  switchport mode access
  switchport access vlan 10
exit
```
Verify: `show interface port1.0.5 switchport`

## Trunk port (uplink carrying multiple VLANs)
```
interface port1.0.25
  switchport mode trunk
  switchport trunk allowed vlan add 10,20,30,40,50,60
  switchport trunk native vlan 30
exit
```
Verify: `show interface port1.0.25 switchport`

## Port range configuration
```
interface port1.0.1-port1.0.24
  switchport mode access
  switchport access vlan 10
```

## Management IP on a VLAN interface
```
interface vlan30
  ip address 192.168.30.2/24
exit
ip route 0.0.0.0/0 192.168.30.1
```
Warning: changing the management IP over SSH can drop the session. Prefer console for this.

## PoE control per port
```
interface port1.0.7
  power-inline enable        ! or: no power-inline enable
```
Verify: `show power-inline` and `show power-inline interface port1.0.7`

## Common show / diagnostic commands
```
show interface status
show interface port1.0.5
show mac address-table
show mac address-table interface port1.0.5
show ip interface brief
show spanning-tree
show system
show version                 ! model, firmware
show log
show arp
ping 192.168.30.1
```

## Port enable / disable
```
interface port1.0.5
  shutdown            ! disable (disruptive!)
  no shutdown         ! enable
```

## Spanning tree (RSTP default on AW+)
```
spanning-tree mode rstp
interface port1.0.5
  spanning-tree portfast          ! edge port for end devices
  spanning-tree bpduguard enable
```
Verify: `show spanning-tree`

## Description and housekeeping
```
interface port1.0.5
  description AP-Block-A-Room101
```

## Config backup over terminal
`show running-config` then save the terminal output to file. On AW+ you can also:
```
copy running-config tftp://192.168.30.50/backup.cfg
```

## AMF (Allied Telesis Management Framework) basics
```
show atmf
show atmf nodes
atmf working-set group all      ! run commands on all members (use with care)
```
