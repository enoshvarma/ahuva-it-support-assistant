# Server Configuration — Linux & Windows (network-facing)

## Linux network config
Netplan (Ubuntu):
```
# /etc/netplan/01-netcfg.yaml
network:
  version: 2
  ethernets:
    ens192:
      addresses: [192.168.30.20/24]
      routes:
        - to: default
          via: 192.168.30.1
      nameservers:
        addresses: [192.168.30.5, 8.8.8.8]
```
Apply: `sudo netplan apply` — Verify: `ip a`, `ip r`, `resolvectl status`

RHEL/CentOS (nmcli):
```
nmcli con mod ens192 ipv4.addresses 192.168.30.20/24 ipv4.gateway 192.168.30.1 ipv4.dns "192.168.30.5" ipv4.method manual
nmcli con up ens192
```

VLAN sub-interface:
```
ip link add link ens192 name ens192.50 type vlan id 50
ip addr add 192.168.50.20/24 dev ens192.50
ip link set ens192.50 up
```

Bonding/teaming:
```
nmcli con add type bond con-name bond0 ifname bond0 bond.options "mode=802.3ad,miimon=100"
nmcli con add type ethernet ifname ens192 master bond0
```

Firewall (firewalld):
```
firewall-cmd --permanent --add-service=https
firewall-cmd --permanent --add-port=8443/tcp
firewall-cmd --reload
firewall-cmd --list-all
```
UFW: `ufw allow 443/tcp`, `ufw status verbose`

Diagnostics:
```
ss -tulpn                 ! listening ports
ip -s link                ! interface errors/drops
ethtool ens192            ! link speed/duplex
traceroute -n 8.8.8.8
tcpdump -i ens192 -nn host 192.168.50.10
dig @192.168.30.5 server.local
```

## Windows Server networking
```powershell
New-NetIPAddress -InterfaceAlias "Ethernet0" -IPAddress 192.168.30.21 -PrefixLength 24 -DefaultGateway 192.168.30.1
Set-DnsClientServerAddress -InterfaceAlias "Ethernet0" -ServerAddresses 192.168.30.5,8.8.8.8
Get-NetIPConfiguration
Test-NetConnection 192.168.50.10 -Port 443
Get-NetAdapter | Format-Table Name,Status,LinkSpeed
New-NetFirewallRule -DisplayName "Allow NVR" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow
```
NIC teaming: `New-NetLbfoTeam -Name Team1 -TeamMembers "Ethernet0","Ethernet1" -TeamingMode Lacp`

DHCP scope (Windows):
```powershell
Add-DhcpServerv4Scope -Name "DATA" -StartRange 192.168.10.50 -EndRange 192.168.10.250 -SubnetMask 255.255.255.0
Set-DhcpServerv4OptionValue -ScopeId 192.168.10.0 -Router 192.168.10.1 -DnsServer 192.168.30.5
```

## Server-to-switch checklist
- Port should be access (single VLAN) or trunk (if server tags VLANs) — match both sides.
- Speed/duplex: leave both auto unless there's a documented reason.
- If teaming with LACP, the switch side MUST be a matching channel-group.
- Verify: switch `show mac address-table interface <port>` shows the server MAC.
