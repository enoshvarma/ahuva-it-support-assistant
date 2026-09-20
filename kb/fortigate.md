# Fortinet FortiGate (FortiOS) Reference — Firewall

## Access & basics
FortiOS CLI is NOT IOS-like. No "enable" mode.
```
get system status              ! model, firmware, serial (use to identify device)
show                           ! full config (from current context)
show full-configuration
execute backup config flash    ! or: execute backup config tftp <file> <server-ip>
```

## Config structure (table / edit / set / next / end)
```
config firewall address
    edit "SERVER-1"
        set subnet 192.168.10.5 255.255.255.255
    next
end
```

## Interfaces
```
config system interface
    edit "port5"
        set ip 192.168.50.1 255.255.255.0
        set allowaccess ping https ssh
    next
end
```
Verify: `get system interface physical` / `show system interface port5`

## Firewall policy
```
config firewall policy
    edit 0
        set name "LAN-to-WAN"
        set srcintf "port1"
        set dstintf "wan1"
        set srcaddr "all"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "ALL"
        set nat enable
    next
end
```
Verify: `show firewall policy`

## Save & rollback
FortiOS saves automatically on `end`. For rollback use configuration revisions:
```
execute revision list config
execute restore config flash <revision-id>
```
Warning: policy/interface changes on the management port can drop your session.

## Useful show/get
```
get system status
get hardware nic port1
diagnose sys top
get router info routing-table all
```
