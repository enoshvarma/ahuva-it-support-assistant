# Core Switching & L3 — Design and Configuration

## Core vs Distribution vs Access
- **Access**: end devices, PoE, port security, VLAN assignment, portfast/edge.
- **Distribution**: L3 SVIs, inter-VLAN routing, HSRP/VRRP, route summarization, ACLs.
- **Core**: high-speed L3 transit only. No ACLs, no policy — keep it fast and simple.

## Inter-VLAN routing (SVI) — Cisco
```
ip routing
interface vlan 10
 ip address 192.168.10.1 255.255.255.0
 no shutdown
interface vlan 50
 ip address 192.168.50.1 255.255.255.0
 no shutdown
```
Verify: `show ip interface brief`, `show ip route`

## Inter-VLAN routing — AlliedWare Plus
```
interface vlan10
 ip address 192.168.10.1/24
ip route 0.0.0.0/0 192.168.10.254
```

## First-hop redundancy
HSRP (Cisco):
```
interface vlan 10
 standby 10 ip 192.168.10.1
 standby 10 priority 110
 standby 10 preempt
```
VRRP (AW+ / multi-vendor):
```
router vrrp 10 vlan10
 virtual-ip 192.168.10.1 backup
 priority 110
 preempt-mode true
 enable
```
Verify: `show standby brief` / `show vrrp`

## Link aggregation (LACP)
Cisco:
```
interface range Gi1/0/23 - 24
 channel-group 1 mode active
interface Port-channel1
 switchport mode trunk
```
AlliedWare Plus:
```
interface port1.0.23-port1.0.24
 channel-group 1 mode active
interface po1
 switchport mode trunk
```
Verify: `show etherchannel summary` / `show static-channel-group`

## Stacking (AW+ VCStack / Cisco StackWise)
```
show stack                     ! AW+
show switch                    ! Cisco
```
Config syncs across members. A reload affects the ENTIRE stack — confirm maintenance window.

## Spanning tree hardening
```
spanning-tree mode rapid-pvst          ! Cisco
spanning-tree vlan 1-100 root primary  ! core should be root
interface Gi1/0/5
 spanning-tree portfast
 spanning-tree bpduguard enable
```
AW+: `spanning-tree mode rstp`, `spanning-tree portfast bpdu-guard enable`

## OSPF (campus core)
```
router ospf 1
 router-id 10.0.0.1
 network 192.168.10.0 0.0.0.255 area 0
 passive-interface default
 no passive-interface Vlan10
```
Verify: `show ip ospf neighbor`, `show ip route ospf`

## Static routing
```
ip route 0.0.0.0 0.0.0.0 192.168.30.254           ! Cisco
ip route 0.0.0.0/0 192.168.30.254                 ! AW+
```

## QoS for voice/CCTV
```
mls qos                                  ! Cisco (older)
interface Gi1/0/5
 mls qos trust dscp
 priority-queue out
```

## Troubleshooting order (core)
1. `show ip interface brief` — is the SVI up?
2. `show ip route` — is the route present?
3. `show spanning-tree` — any blocked/looping ports?
4. `show mac address-table` — is the device learned on the expected port?
5. `show etherchannel summary` — are all bundle members up?
6. `show logging | include ERR|DOWN` — recent events
