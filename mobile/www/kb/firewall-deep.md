# Firewall Configuration — Multi-vendor Deep Reference

## Universal method
1. Identify: `show version` / `get system status` / `show system info`
2. Back up BEFORE changes (native export/revision).
3. Objects → NAT → Policy → Verify → Save/Commit.
4. Test with a live session check before declaring success.

## FortiGate (FortiOS)
Address object + policy:
```
config firewall address
    edit "SRV-CCTV"
        set subnet 192.168.50.10 255.255.255.255
    next
end
config firewall policy
    edit 0
        set name "CCTV-to-NVR"
        set srcintf "port2"  
        set dstintf "port3"
        set srcaddr "SRV-CCTV"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "HTTPS" "RTSP"
        set logtraffic all
        set nat enable
    next
end
```
Virtual IP (port forward):
```
config firewall vip
    edit "NVR-WEB"
        set extip 203.0.113.10
        set mappedip 192.168.50.10
        set extintf "wan1"
        set portforward enable
        set extport 8443
        set mappedport 443
    next
end
```
Verify: `diagnose firewall iprope lookup`, `get router info routing-table all`, `diagnose sniffer packet any 'host 192.168.50.10' 4`
Rollback: `execute revision list config` then `execute restore config flash <id>`

## Cisco ASA
```
object network NVR
 host 192.168.50.10
 nat (inside,outside) static 203.0.113.10
access-list OUTSIDE_IN extended permit tcp any object NVR eq 443
access-group OUTSIDE_IN in interface outside
```
Verify: `show access-list`, `show xlate`, `show conn`, `packet-tracer input outside tcp 8.8.8.8 1234 203.0.113.10 443`
Save: `write memory`

## Palo Alto (PAN-OS)
```
configure
set address SRV-CCTV ip-netmask 192.168.50.10/32
set rulebase security rules Allow-CCTV from trust to untrust source SRV-CCTV destination any application any service any action allow
commit
```
Nothing applies until `commit`. Rollback: `revert config`.

## Rule hygiene (all vendors)
- Order matters — first match wins. Put specific rules ABOVE broad ones.
- Never leave an any/any/allow rule above your real policy.
- Always log new rules initially, then tune.
- Name rules descriptively (`CCTV-to-NVR`, not `rule12`).

## Common troubleshooting
- Traffic blocked? Check rule hit counters, then NAT, then routing.
- Asymmetric routing breaks stateful inspection — verify return path.
- FortiGate: `diagnose debug flow` shows exactly which policy matched.
- ASA: `packet-tracer` simulates a flow end-to-end without touching traffic.
