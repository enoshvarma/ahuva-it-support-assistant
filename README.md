# Ahuva IT Support Assistant

AI-guided network configuration copilot for field engineers — serial console, SSH/Telnet, IP scanner, packet capture, switch config generator, and an AI assistant that knows Cisco, Juniper, FortiGate, MikroTik, Allied Telesis and more.

Runs as a **desktop app** (Electron) on Windows/macOS/Linux, as a **native Android APK**, and as a **terminal CLI** on Android (Termux) and headless Linux.

## Install — Windows (Desktop)

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-windows.ps1 | iex
```

From CMD:

```cmd
powershell -ExecutionPolicy Bypass -Command "irm 'https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-windows.ps1' | iex"
```

## Install — macOS (Desktop)

```bash
curl -fsSL "https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-mac.sh" | bash
```

## Install — Linux (Desktop)

```bash
curl -fsSL "https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-linux.sh" | bash
```

## Install — Android (APK)

**[Download APK](https://github.com/enoshvarma/ahuva-it-support-assistant/releases/download/android-latest/ahuva-it-support.apk)**

1. Tap the link above on your Android phone to download
2. Open the downloaded APK and tap **Install** (enable "Install from unknown sources" if prompted)
3. Launch **Ahuva IT Support** from your app drawer

The APK is rebuilt automatically from the latest code on every push.

### What works in the Android app

- Full graphical UI (same as desktop)
- SSH connections with legacy algorithm support (old Cisco, Juniper, etc.)
- Telnet connections with IAC negotiation
- AI copilot (Anthropic, OpenAI, Google, Ollama, OpenRouter, Groq)
- Network scanner (ping sweep, port scan, DNS reverse lookup, latency)
- Wake-on-LAN (magic packet)
- Traceroute
- Device auto-detection (10+ vendors)
- Switch baseline config generator (Cisco IOS/NX-OS, Juniper, FortiGate, MikroTik, Allied Telesis)
- Command safety classification
- Knowledge base
- Error learning & Research Center
- xterm.js terminal emulator with full ANSI/VT100 support

> **Note:** Packet capture (tshark) is not available on Android — use the AI copilot to get device-side capture commands instead.

## Android IP Finder (network scanner APK)

A separate, lightweight app for finding every device on a network: names, IPs, MACs, manufacturers and open services,
plus port scanner, ping, traceroute and Wake-on-LAN.

**[Download IP Finder APK](https://github.com/enoshvarma/ahuva-it-support-assistant/releases/download/ipfinder-latest/ahuva-ip-finder.apk)** · Android 5.0+ · details in [ipfinder-android/README.md](ipfinder-android/README.md)

## Install — Android (Termux)

Runs in your pocket! Open [Termux](https://f-droid.org/packages/com.termux/) and paste:

```bash
curl -fsSL "https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-termux.sh" | bash
```

This installs Git, Node.js, build tools, and network utilities, then sets up the CLI. After install, just type:

```bash
ahuva
```

### What works on Termux

- SSH connections to switches/routers/firewalls
- Telnet connections
- USB serial console (with USB OTG cable + Termux:API)
- AI copilot (Anthropic, OpenAI, Google, Ollama, OpenRouter, Groq)
- Network scanner (ping sweep, port scan, ARP, DNS, WoL)
- Traceroute
- Device auto-detection (Cisco, Juniper, FortiGate, MikroTik, Allied Telesis, etc.)
- Switch baseline config generator (all vendors)
- Command safety classification (danger/caution/safe)
- Knowledge base with vendor reference docs
- Error learning (tracks mistakes, feeds lessons back to AI)

### Termux tips

- **USB Serial**: Install Termux:API from F-Droid, then `pkg install termux-api`. Connect a USB OTG console cable and use the `serial` command.
- **Storage access**: Run `termux-setup-storage` to save configs to your phone's Downloads folder.
- **Background**: Use `termux-wake-lock` to prevent Android from killing your SSH session.
- **Update**: Re-run the install command, or `cd ~/ahuva-it-assistant && git pull && npm install --omit=dev`.

## Update

Re-run the same install command for your platform — it detects the existing install and does a git pull. Or from the install folder:

```bash
git pull && npm install
```

## CLI mode (any platform)

You can run the terminal CLI on any platform (not just Termux):

```bash
node cli.js
```

Type `help` for the full command list. Key commands:

| Command | Description |
|---------|-------------|
| `ssh` | Connect via SSH (interactive) |
| `telnet` | Connect via Telnet |
| `serial` | Connect via serial port |
| `send <cmd>` | Send command to device |
| `ask <question>` | Ask AI copilot |
| `detect` | Auto-detect device vendor |
| `scan <ip/cidr>` | Network scan |
| `ping <host>` | Ping host |
| `ports <host>` | Port scan |
| `config` | Generate switch baseline config |
| `settings` | Configure AI provider |
| `status` | Show session info |

## Packet capture

Needs Wireshark installed with Npcap selected during setup — [wireshark.org](https://www.wireshark.org). Without it the device-side capture still works (FortiGate, Cisco EPC, MikroTik, etc.). On Termux, use the `ask` command to get device-side capture commands for your vendor.

## License

MIT
