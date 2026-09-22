# MikroTik RouterOS Reference — Router

## Access
RouterOS uses a path-based CLI, NOT IOS. No enable mode.
```
/system resource print        ! identify device (board, version)
/export                       ! full config export
/export file=backup           ! save export to file
/system backup save name=backup
```

## IP address on an interface
```
/ip address add address=192.168.88.1/24 interface=ether2
/ip address print
```

## Firewall filter rule
```
/ip firewall filter add chain=forward action=accept connection-state=established,related
/ip firewall filter print
```

## NAT (masquerade)
```
/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade
```

## Save / restore
Config is applied live and persists automatically. To roll back:
```
/system backup load name=backup      ! restores a binary backup (reboots)
/import file=backup.rsc              ! re-applies a text export (additive)
```
Warning: firewall/NAT/address changes on the management path can lock you out — have console/Winbox fallback.
