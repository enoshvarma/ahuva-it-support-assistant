# Ahuva IT Support Assistant

A desktop app for on-site network work — serial console, SSH/Telnet, IP scanner, packet capture, and an AI assistant that knows Cisco, Juniper, FortiGate and more. Built on Electron, runs on Windows.

## Install

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-windows.ps1 | iex
```

From CMD:

```cmd
powershell -ExecutionPolicy Bypass -Command "irm 'https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-windows.ps1' | iex"
```

Installs Git and Node.js if you don't have them (no admin needed), clones the repo, creates a desktop shortcut, and launches the app. Shows up in Add/Remove Programs if you want to uninstall later.

## Update

Same command as above — it just does a git pull and restarts. Or from the install folder:

```powershell
cd "$env:LOCALAPPDATA\AhuvaITAssistant"; git pull; npm start
```

## Packet capture

Needs Wireshark installed with Npcap selected during setup — [wireshark.org](https://www.wireshark.org). Without it the device-side capture still works (FortiGate, Cisco EPC, MikroTik, etc.).

## License

MIT
