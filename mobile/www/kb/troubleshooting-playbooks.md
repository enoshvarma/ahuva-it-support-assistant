# Field Troubleshooting Playbooks (fast paths)

## "Device has no network"
1. Physical: `show interface status` — is the port up? Right VLAN?
2. `show mac address-table interface <port>` — is the MAC learned?
3. If no MAC: cable/NIC/port issue. Try another port; check `show interface <port>` for CRC/errors.
4. If MAC present but no IP: DHCP problem — is the VLAN's DHCP relay/helper set?
   `ip helper-address 192.168.30.5` (Cisco) on the SVI.
5. If IP present but no internet: check gateway (`ping` from switch), then routing, then firewall.

## "Slow network"
1. `show interface <port> | include error|drop|CRC` — errors = physical layer (cable/SFP).
2. Duplex mismatch: one side half, other full → massive slowness. Both should be auto/full.
3. `show processes cpu` — is the switch CPU pegged (loop/broadcast storm)?
4. `show spanning-tree` — topology changes flapping = loop or unstable link.
5. Check uplink utilization — a saturated 1G uplink for 24 users is the usual cause.

## "Port keeps going down / err-disabled"
```
show interfaces status err-disabled
show logging | include DOWN|ERR
```
Common causes: BPDU guard triggered (someone plugged a switch into an edge port), port security violation, link flap.
Recover: fix cause, then `shutdown` / `no shutdown`, or `errdisable recovery cause all`.

## "PoE device not powering"
1. `show power inline` — is the port delivering? Is the budget exhausted?
2. Check class/wattage: 802.3af=15.4W, 802.3at=30W, 802.3bt=60/90W. Camera needs may exceed budget.
3. `power inline auto` / `power-inline enable` on the port.
4. Try a known-good PoE device on the same port to isolate device vs port.

## "Can't reach a VLAN"
1. Does the VLAN exist on EVERY switch in the path? `show vlan brief`
2. Is it allowed on every trunk? `show interface <trunk> trunk` / `show interface <port> switchport`
3. Is there an SVI with an IP (for routing)? `show ip interface brief`
4. Is there a route/gateway? `show ip route`
5. ACL or firewall blocking? Check hit counters.

## "Loop / broadcast storm"
Symptoms: all ports' LEDs blinking in sync, CPU 100%, network unusable.
1. `show spanning-tree` — look for constant topology changes.
2. `show interface | include rate` — find the port with insane broadcast rate.
3. Shut the offending port immediately, then trace the cable.
4. Prevent: `spanning-tree bpduguard enable` + `storm-control broadcast level 5` on edge ports.

## Pre-handover verification (always)
```
show running-config          ! backed up?
show vlan brief              ! all VLANs present
show interface status        ! all intended ports up, right VLANs
show ip interface brief      ! SVIs up
show power inline            ! PoE budget healthy
show logging | include ERR   ! no active errors
copy running-config startup-config
```
