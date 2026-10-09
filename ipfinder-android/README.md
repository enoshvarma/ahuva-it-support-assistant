# Ahuva IP Finder (Android)

A fast LAN scanner for Android, in the spirit of Advanced IP Scanner. It lists every device on your Wi-Fi,
Ethernet, hotspot or VPN network with its name, IP, MAC address, manufacturer, device type and open services.
You can then open each service in the right app.

**[Download APK](https://github.com/enoshvarma/ahuva-it-support-assistant/releases/download/ipfinder-latest/ahuva-ip-finder.apk)** · Android 5.0+ · about 0.7 MB · no ads, no tracking, no internet needed

## Features

| Area | What you get |
|---|---|
| Scan | Auto-detects your subnet (Wi-Fi, Ethernet, hotspot, USB tether, VPN). Accepts any range: `192.168.1.0/24`, `192.168.1.1-254`, `10.0.0.1-10.0.1.255`, `192.168.1.*`, lists or hostnames. A /24 finishes in about 5 s. |
| Discovery | ICMP ping, TCP probes (finds hosts that block ping), NetBIOS, mDNS/Bonjour, UPnP/SSDP, reverse DNS, ARP |
| Device info | Name, IP, MAC, manufacturer (IEEE OUI database, 40k vendors), model, device type, OS guess, workgroup, logged-on user, web page title, SSH/FTP banners, TLS certificate name |
| Services | Checks about 70 common ports on every host: HTTP(S), SSH, Telnet, RDP, VNC, SMB, FTP, RTSP, printers, databases, MQTT, Plex and more |
| Open in apps | One tap opens a service in whichever installed app handles it: browser, SSH/Telnet client (Termius, JuiceSSH, ConnectBot), Microsoft Remote Desktop, VNC viewer, file manager (SMB/FTP), VLC (RTSP). "Open with…" and custom URIs cover anything else. |
| Tools | Full port scanner (1-65535), ping, traceroute, Wake-on-LAN, DNS lookup, network info (SSID, signal, gateway, DNS, public IP), subnet calculator |
| Organise | Favorites, rename, notes, NEW badge for devices not seen before, search, filters, sort, last scan saved |
| Export | CSV (Excel), HTML report, JSON, plain text. Share them or save to a file. |
| Look | Dark or light theme (or follow the system); phones, tablets, Chromebooks, any orientation |

## Android limits worth knowing

- **MAC addresses on Android 10+.** Android blocks every non-root app from reading the ARP table. The app still
  gets MACs from NetBIOS (Windows, Samba, NAS) and mDNS (Apple devices and more). Other devices show their IP and name only.
  On Android 9 and older, every MAC is shown.
- **Remote shutdown** of Windows PCs (an Advanced IP Scanner feature) uses Windows RPC and admin credentials. It isn't
  possible from Android, so it isn't included. RDP, SSH and the web UI open in the matching apps instead.
- **Wi-Fi name (SSID).** Android only reveals it to apps with location permission. The app asks for it only when you tap
  *Show Wi-Fi name* in Network info.

## Build

```bash
cd ipfinder-android
./gradlew assembleRelease      # app/build/outputs/apk/release/app-release.apk
./gradlew testReleaseUnitTest lintRelease
```

There are no third-party runtime dependencies (plain Android SDK, Java 8 language level). `minSdk 21`, `targetSdk 35`.
It ships as one universal APK that runs on every CPU (arm, arm64, x86, x86_64).

CI (`.github/workflows/build-ipfinder.yml`) runs unit tests, lint and a signed release build. Then it installs the APK on
Android 5.0, 10 and 14 emulators, runs a real scan, opens every screen and monkey-tests the UI. On `main` it publishes
the APK to the `ipfinder-latest` release.

### Release signing

For updates to install over an existing copy, every build must use the same key. Create one once:

```bash
keytool -genkeypair -keystore ipfinder.keystore -alias ipfinder -keyalg RSA -keysize 3072 -validity 10000
base64 -w0 ipfinder.keystore   # copy the output
```

Then add these repository secrets: `IPFINDER_KEYSTORE_B64` (the base64 text), `IPFINDER_KEYSTORE_PASSWORD`,
`IPFINDER_KEY_ALIAS` (`ipfinder`) and optionally `IPFINDER_KEY_PASSWORD`. Without them, CI signs with a one-off key and
prints a warning. For local release builds, put `storeFile`, `storePassword`, `keyAlias` and `keyPassword` in
`ipfinder-android/keystore.properties` (git-ignored).

## Privacy

Everything runs on the phone. There are no accounts, analytics or uploads. The only request to the internet is the
optional *Public IP* button (api.ipify.org).
