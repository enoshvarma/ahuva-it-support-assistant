# Ahuva IT Support Assistant

Enterprise network troubleshooting assistant built for on-site IT engineers.  
Serial console · SSH / Telnet · IP Scanner · Packet Capture · AI-powered analysis.

---

## Install on Windows — one command

Open **PowerShell** and paste:

```powershell
irm https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-windows.ps1 | iex
```

Or from **Command Prompt (cmd.exe)**:

```cmd
powershell -ExecutionPolicy Bypass -Command "irm 'https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-windows.ps1' | iex"
```

That's it. The script will:
- Install **Git** and **Node.js 20 LTS** if missing (via winget — no admin needed)
- Clone the repo to `%LOCALAPPDATA%\AhuvaITAssistant`
- Run `npm install` (downloads Electron + dependencies)
- Create a **Desktop shortcut** and **Start Menu entry**
- Register in **Control Panel → Add/Remove Programs** for clean uninstall
- Launch the app automatically

---

## Update

Re-run the same one-liner at any time — it does a `git pull` and re-installs only what changed.

```powershell
irm https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-windows.ps1 | iex
```

Or from the install folder (PowerShell):

```powershell
cd "$env:LOCALAPPDATA\AhuvaITAssistant"; git pull; npm start
```

---

## Requirements

| Tool | Required | Notes |
|------|----------|-------|
| Node.js 20+ | Yes | auto-installed by the script |
| Git | Yes | auto-installed by the script |
| Wireshark + Npcap | Packet capture only | [wireshark.org](https://www.wireshark.org) |

---

## Features

- **Serial Console** — Connect to switches/routers via COM port (auto-detected)
- **SSH / Telnet** — Direct session with command logging
- **IP Scanner** — CIDR/range scan with MAC vendor, port probing, WoL, traceroute
- **Packet Capture** — Local tshark or device-side capture (Cisco EPC, FortiGate, MikroTik, etc.)
- **AI Assistant** — Anthropic Claude integration for real-time troubleshooting
- **Knowledge Base** — Built-in docs for Cisco, Juniper, FortiGate, Allied Telesis, MikroTik

---

## Uninstall

Control Panel → **Add or Remove Programs** → search **Ahuva IT Support Assistant** → Uninstall.

---

## License

MIT
