# Storage Networking — NAS, NetApp, SAN

## NetApp ONTAP — essentials
```
version
system node show
network interface show                 ! LIFs
network port show                      ! physical ports
network port ifgrp show                ! link aggregation
vserver show
volume show
aggr show
```
Create a data LIF:
```
network interface create -vserver svm1 -lif data1 -role data \
  -home-node node1 -home-port a0a-50 -address 192.168.60.20 -netmask 255.255.255.0
```
VLAN + ifgrp:
```
network port ifgrp create -node node1 -ifgrp a0a -distr-func ip -mode multimode_lacp
network port ifgrp add-port -node node1 -ifgrp a0a -port e0c
network port vlan create -node node1 -vlan-name a0a-50
```
Routes: `network route create -vserver svm1 -destination 0.0.0.0/0 -gateway 192.168.60.1`
NFS/CIFS:
```
vserver nfs create -vserver svm1 -access true
vserver cifs create -vserver svm1 -cifs-server FILER1 -domain ahuva.local
volume create -vserver svm1 -volume vol_data -aggregate aggr1 -size 500GB -junction-path /data
```
Diagnostics: `network ping -lif data1 -destination 192.168.60.1`, `statistics show -object lif`, `event log show`

## Generic NAS (Synology / QNAP / TrueNAS)
- Management is web-GUI first; SSH available for diagnostics.
- Bond/LAG: must match the switch's channel-group (LACP 802.3ad on both sides).
- Jumbo frames: if enabling MTU 9000 on NAS, the ENTIRE path (switch ports, server NICs) must match, or you get silent fragmentation drops.
- Common commands over SSH (Linux-based): `ip a`, `ethtool eth0`, `cat /proc/net/bonding/bond0`, `showmount -e`

## Switch side for storage
```
interface range Gi1/0/10 - 11
 channel-group 5 mode active
 description NAS-LACP
interface Port-channel5
 switchport mode trunk
 switchport trunk allowed vlan 60
 mtu 9198                      ! jumbo, if used end-to-end
 spanning-tree portfast trunk
```
Verify: `show etherchannel 5 summary`, `show interfaces Port-channel5`

## iSCSI / SAN notes
- Use a DEDICATED VLAN (and ideally dedicated NICs) for iSCSI. No routing if avoidable.
- Enable flow control OR jumbo frames consistently — never mismatched.
- Multipath: two separate paths/subnets, never a single LAG for redundancy claims.
- Disable STP delays on storage ports: `spanning-tree portfast trunk`.

## Storage troubleshooting order
1. Link + speed: `show interface status` on switch, `ethtool` on host.
2. LACP state on both ends — a half-formed bundle causes intermittent drops.
3. MTU consistency: `ping -M do -s 8972 <target>` (Linux) must succeed if jumbo.
4. VLAN reachability: is the storage VLAN allowed on every trunk in the path?
5. Latency/errors: `show interface | include error|drop` — CRC errors mean cabling/SFP.
