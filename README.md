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

**[⬇ Download the Android app](https://github.com/enoshvarma/ahuva-it-support-assistant/releases/download/android-latest/ahuva-it-support.apk)**

1. Open the link on your Android phone — the APK downloads directly
2. Open the downloaded file and tap **Install** (allow "Install unknown apps" for your browser if Android asks)
3. Launch **Ahuva IT Support** from the app drawer

Requires Android 5.1 or newer with an up-to-date **Android System WebView** (updated automatically through the Play Store on almost every phone). Every build is tested on Android 9, 11, 13 and 15 before the download link is updated.

### What works in the Android app

Same UI as the desktop app, laid out for phones with **Session / Terminal / Copilot** tabs at the bottom.

- SSH with legacy algorithm support (old Catalyst / Juniper / FortiGate) and keyboard-interactive login
- Telnet with RFC 854 option negotiation
- **USB serial console** with a USB-OTG console cable (FTDI, Prolific, CP210x, CH34x and Cisco USB-console / CDC-ACM)
- Quick-key row for Tab, `?`, Ctrl+C, Ctrl+Z, Esc and arrow keys — the keys switch CLIs need that phone keyboards lack
- AI copilot (Anthropic, OpenAI, Google, OpenRouter, Groq, Ollama on your LAN) with the knowledge base, device context and learned errors in every prompt
- Device auto-detection, CLI-mode tracking and command safety classification
- Restore point + config backup (saved wherever you choose — Downloads, Drive, …)
- Network scanner (ping, port scan, NetBIOS/DNS names, vendor lookup), traceroute and Wake-on-LAN
- Switch baseline config generator (Cisco IOS / NX-OS, Allied Telesis, MikroTik, Fortinet, Juniper, generic)
- On-device packet capture guidance (the switch/firewall's own sniffer)
- Knowledge base import, error learning and the weekly Research Center

Not on Android: local Wireshark/tshark capture and nmap enrichment (they need a laptop).

### Publishing to Google Play

The same release also contains `ahuva-it-support.aab` — upload that file in the Play Console. Before your first Play upload, add two repository secrets (**Settings → Secrets and variables → Actions**) so builds are signed with your own upload key:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | your upload keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |

Until those are set, builds are signed with a public CI key that is fine for direct installs but must not be used on Google Play.

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
