# Cisco IOS / IOS-XE Command Reference

## Basic access and modes
```
enable
configure terminal
exit / end
show running-config
copy running-config startup-config     ! save (or: write memory)
```

## VLAN creation (Ahuva standard convention)
```
configure terminal
vlan 10
 name DATA
vlan 20
 name VOICE
vlan 30
 name MGMT
vlan 40
 name GUEST
vlan 50
 name CCTV
vlan 60
 name WIFI_AP
exit
```
Verify: `show vlan brief`

## Access port
```
interface GigabitEthernet1/0/5
 switchport mode access
 switchport access vlan 10
 spanning-tree portfast
```
Verify: `show interfaces GigabitEthernet1/0/5 switchport`

## Voice VLAN on an access port
```
interface GigabitEthernet1/0/5
 switchport access vlan 10
 switchport voice vlan 20
```

## Trunk port
```
interface GigabitEthernet1/0/25
 switchport mode trunk
 switchport trunk allowed vlan 10,20,30,40,50,60
 switchport trunk native vlan 30
```
Verify: `show interfaces GigabitEthernet1/0/25 trunk`

## Interface range
```
interface range GigabitEthernet1/0/1 - 24
 switchport mode access
 switchport access vlan 10
```

## Management SVI
```
interface vlan 30
 ip address 192.168.30.2 255.255.255.0
 no shutdown
ip default-gateway 192.168.30.1
```
Warning: changing the management IP over SSH can drop the session.

## Common show / diagnostic commands
```
show ip interface brief
show interfaces status
show interfaces GigabitEthernet1/0/5
show mac address-table
show mac address-table interface GigabitEthernet1/0/5
show cdp neighbors
show cdp neighbors detail
show version
show inventory
show spanning-tree
show logging
show power inline                  ! PoE status
ping 192.168.30.1
```

## Port enable / disable
```
interface GigabitEthernet1/0/5
 shutdown             ! disable (disruptive!)
 no shutdown          ! enable
```

## PoE per port
```
interface GigabitEthernet1/0/7
 power inline auto        ! or: power inline never
```
Verify: `show power inline GigabitEthernet1/0/7`

## Errdisable recovery (port went err-disabled)
```
show interfaces status err-disabled
errdisable recovery cause all
errdisable recovery interval 300
```
Or bounce the port: `shutdown` then `no shutdown`.

## SSH enablement on a new switch
```
hostname SW-BLOCK-A
ip domain-name ahuva.local
crypto key generate rsa modulus 2048
username admin privilege 15 secret <password>
line vty 0 15
 transport input ssh
 login local
```

## Description and housekeeping
```
interface GigabitEthernet1/0/5
 description AP-Block-A-Room101
```
