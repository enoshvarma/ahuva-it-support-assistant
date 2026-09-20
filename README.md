# Ahuva IT Support Assistant

**AI-guided network configuration copilot for field engineers**
*Ahuva Electronic Technologies Pvt. Ltd.*

---

## Overview

Ahuva IT Support Assistant is a cross-platform desktop application (Electron) that gives field network engineers a real-time AI copilot while configuring switches, routers, and firewalls over SSH, Telnet, or serial console. It:

- Connects to devices over **SSH**, **Telnet**, or **RS-232 serial console**
- Auto-detects the vendor (Cisco, Allied Telesis, Fortinet, MikroTik, Juniper, Palo Alto, HPE/Aruba, Quantum) from terminal output
- Detects the CLI mode (user exec, privileged, config, interface config, paging) to sequence commands correctly
- Calls your configured AI provider (Anthropic Claude, OpenAI GPT, OpenRouter, local Ollama) and proposes the right commands with explanations
- Runs an **Autopilot mode** that sends safe commands automatically; disruptive/destructive commands always require manual approval
- Integrates with **Wireshark/tshark** for local packet capture and AI-powered traffic analysis
- Supports **vendor-native packet capture** (FortiGate sniffer, Cisco EPC, MikroTik sniffer, Palo Alto, Juniper)
- Logs command errors and teaches the AI to avoid repeating them
- Stores **config backups** and restore points before making changes
- Runs weekly **AI research digests** to keep the knowledge base current

### Architecture

```
Electron main process (main.js)
├── src/session.js       — SSH / Telnet / Serial device sessions
├── src/ai-providers.js  — Anthropic / OpenAI / OpenRouter / Ollama client
├── src/packets.js       — Wireshark tshark integration + device-side capture cmds
├── src/detect.js        — Vendor fingerprinting, ARP discovery, ping metric parsing
├── src/safety.js        — Command safety classifier (safe / caution / danger)
├── src/mode.js          — CLI mode detection (user / priv / config / config-if)
├── src/prompt.js        — System prompt builder (KB + terminal context + mode)
├── src/kb.js            — Knowledge base search (built-in + user-imported docs)
├── src/errorlog.js      — Error learning (records failures, teaches AI lessons)
├── src/models.js        — AI model preset catalogue
├── src/research.js      — Weekly web-fetch + AI research digest engine
├── src/telemetry.js     — Optional team telemetry (no secrets sent)
├── src/logger.js        — Structured multi-level logger (stdout + rotating file)
└── src/validate.js      — Input validation / sanitisation (injection prevention)

renderer/                 — Electron renderer (HTML/CSS/JS, xterm.js terminal)
kb/                       — Built-in knowledge base (Cisco, Allied Telesis, etc.)
```

### Security Highlights

- **No hardcoded secrets** — all credentials and API keys live in Electron's userData directory (never in the app bundle or git)
- **Input validation** on all connection parameters (host, port, username, serial port, baud rate, capture filter)
- **Command sanitisation** — shell metacharacters blocked before any command reaches the device session
- **CSP + contextIsolation + sandbox** — renderer runs sandboxed, no direct Node access
- **External URL blocking** — renderer navigation to non-`file://` URLs is rejected
- **Safety classifier** — destructive commands (`erase`, `write erase`, `format`) are always flagged danger; disruptive commands require confirmation

---

## Prerequisites

### All Platforms
- **Node.js 20+** (for development builds)
- An API key for your chosen AI provider (Anthropic, OpenAI, or OpenRouter), OR a local **Ollama** installation

### Windows
- **Npcap** — required for local packet capture
  - Download: https://npcap.com/#download
  - During install, check **"Install Npcap in WinPcap API-compatible mode"**
  - Run the app as **Administrator** for capture (Npcap driver requires elevated privileges)
- **Wireshark** — installs `tshark.exe`; Npcap is included in Wireshark's installer
  - Download: https://www.wireshark.org/download.html

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install wireshark tshark
# Add your user to the wireshark group so you can capture without sudo
sudo usermod -aG wireshark $USER
newgrp wireshark   # or log out and back in
```

For RHEL/CentOS/Fedora:
```bash
sudo dnf install wireshark-cli
sudo usermod -aG wireshark $USER
```

Grant `dumpcap` the `CAP_NET_RAW` capability (alternative to the group approach):
```bash
sudo setcap cap_net_raw,cap_net_admin=eip /usr/bin/dumpcap
```

### macOS
```bash
brew install wireshark
# Grant BPF device permissions (required for packet capture)
sudo chmod o+r /dev/bpf*
```

Alternatively, install the Wireshark `.dmg` from https://www.wireshark.org/ — it includes a **ChmodBPF** helper that grants permanent permissions.

---

## Installation

### Pre-built Installer (Recommended for Field Engineers)
Download the latest release installer from the releases page:
- **Windows:** `Ahuva-IT-Support-Assistant-Setup-x.x.x.exe`
- **macOS:** `Ahuva-IT-Support-Assistant-x.x.x.dmg`
- **Linux:** `Ahuva-IT-Support-Assistant-x.x.x.AppImage`

Run the installer and follow the prompts.

### Build from Source

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/ahuva-it-support-assistant.git
   cd ahuva-it-support-assistant
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run in development mode**
   ```bash
   npm start
   ```

4. **Build a distributable**
   ```bash
   # Windows
   npm run build:win

   # macOS
   npm run build:mac

   # Linux
   npm run build:linux
   ```

5. **Run unit tests**
   ```bash
   npm test
   ```

---

## First-Time Setup

1. **Launch the app**
2. Click **Settings** (gear icon, top-right)
3. Choose your **AI Provider** (Anthropic is recommended; Ollama for air-gapped sites)
4. Enter your **API Key** and select a **Model**
5. Click **Test Connection** to verify the key works
6. Click **Save**

### AI Provider Setup

| Provider | Where to get a key | Recommended model |
|---|---|---|
| Anthropic | https://console.anthropic.com | claude-sonnet-4-6 |
| OpenAI | https://platform.openai.com | gpt-4o |
| OpenRouter | https://openrouter.ai | anthropic/claude-sonnet-4.6 |
| Ollama (local) | https://ollama.ai | llama3.1 or qwen2.5 |

---

## Usage Examples

### Connect via SSH and configure a VLAN
1. Select **SSH**, enter host IP, port (22), username and password
2. Click **Connect**
3. The terminal opens; the app auto-detects the device (Cisco, Allied Telesis, etc.)
4. In the chat panel, type: `Create VLAN 100 named OFFICE and assign it to port Gi1/0/5 as access`
5. The AI proposes the commands in order (with mode-entry steps if needed)
6. Click **Run All** or approve each command individually

### Connect via Serial Console
1. Select **Serial**
2. Choose the COM port from the dropdown (the app lists all detected ports)
3. Select baud rate (9600 for most switches)
4. Click **Connect**

### Local Packet Capture (requires Wireshark)
1. Click the **Packets** tab
2. Select a network interface from the dropdown
3. Optionally set a BPF capture filter (e.g., `host 192.168.1.1`)
4. Set duration (1–120 seconds) and max packets
5. Click **Start Capture** — the AI analyses the result and flags anomalies

### Export a Capture
After a capture completes:
- Click **Export JSON** or **Export CSV** to save a structured report

### Check Command Safety
Every AI-proposed command is pre-classified:
- **Green (safe)** — runs in autopilot mode automatically
- **Yellow (caution)** — requires explicit confirmation (reboot, IP change, spanning-tree mode)
- **Red (danger)** — always blocked until you tick "I understand" (`erase`, `write erase`, `format`)

---

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `AHUVA_USER_DATA` | Override userData directory (CI/testing) | Electron default |
| `AHUVA_LOG_LEVEL` | Log level: `debug`, `info`, `warn`, `error` | `info` |
| `AHUVA_NO_TELEMETRY` | Disable team telemetry events | off |
| `AHUVA_SMOKE` | Path to write a smoke-test screenshot, then quit | off |
| `AHUVA_SMOKE_OPEN` | Which screen to open for smoke test | — |

---

## Supported Devices

| Vendor | Types | KB Coverage |
|---|---|---|
| Allied Telesis | Switches (x950, x930, x550, etc.) | Full AlliedWare Plus |
| Cisco | IOS/IOS-XE Switches & Routers, ASA Firewall | Full |
| Fortinet | FortiGate Firewalls | Full FortiOS |
| MikroTik | RouterOS Routers & Switches | Full |
| Juniper | JunOS MX/EX/QFX/SRX | Core |
| Palo Alto | PAN-OS Firewalls | Core |
| HPE/Aruba | ProCurve Switches | Basic |
| Quantum | Switches | Basic |

---

## Troubleshooting

### "Wireshark/tshark not found"
- **Windows:** Install Wireshark from https://www.wireshark.org/ — the default path `C:\Program Files\Wireshark\tshark.exe` is checked automatically.
- **Linux:** `sudo apt install tshark`
- **macOS:** `brew install wireshark`

### "Run as Administrator for packet capture" (Windows)
Right-click the app icon → **Run as administrator**, or start Npcap service from `services.msc`.

### SSH "All configured authentication methods failed"
Older switches (Catalyst 2960, etc.) use legacy KEX algorithms. The app already enables them. If still failing, check the switch's `transport input ssh` setting and ensure SSHv2 is not explicitly disabled.

### Serial port not in dropdown
- **Windows:** Check Device Manager → Ports (COM & LPT) for the COM port number.
- **Linux:** Run `ls /dev/ttyUSB* /dev/ttyS*` and ensure your user is in the `dialout` group: `sudo usermod -aG dialout $USER`
- **macOS:** Check `ls /dev/tty.*` for the port path.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-improvement`
3. Run tests: `npm test`
4. Commit and open a pull request

---

## License

UNLICENSED — Proprietary software of Ahuva Electronic Technologies Pvt. Ltd.
