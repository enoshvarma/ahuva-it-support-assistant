# Generic Switch guidance (HPE/Aruba/others)
Most enterprise switches are IOS-like: `enable` -> `configure terminal` -> `show running-config` -> save with `write memory`.
- Aruba/ArubaOS-CX: `show running-config`, `write memory`, VLANs via `vlan 10` then `interface 1/1/5` `vlan access 10`.
- HPE ProVision: `configure`, `vlan 10 untagged 5`, `write memory`.
Always confirm exact syntax with `?` on the device before applying config commands. Back up with `show running-config` first.
