// Packet analysis — two real capture paths:
//
// 1) LOCAL CAPTURE via tshark (Wireshark CLI). Saves .pcapng so the engineer can
//    open it in the GUI. Requires Wireshark + Npcap (Windows) or libpcap (Unix).
// 2) DEVICE-SIDE CAPTURE — vendor built-in sniffers run over the live session.
//    Works on switched networks where the laptop isn't in the traffic path.
//
// Phase 2 hardening: cross-platform tshark resolution, privilege detection,
// non-blocking async streaming, graceful driver-missing handling.

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { spawn, execFile } = require("child_process");
const log  = require("./logger").child("packets");
const { sanitiseCaptureFilter, isValidHost } = require("./validate");

// ---------- tshark binary resolution ----------

// Known install paths per platform
const TSHARK_PATHS = {
  win32: [
    "C:\\Program Files\\Wireshark\\tshark.exe",
    "C:\\Program Files (x86)\\Wireshark\\tshark.exe"
  ],
  darwin: [
    "/Applications/Wireshark.app/Contents/MacOS/tshark",
    "/usr/local/bin/tshark",
    "/opt/homebrew/bin/tshark"
  ],
  linux: [
    "/usr/bin/tshark",
    "/usr/local/bin/tshark"
  ]
};

function findTshark() {
  const platform = process.platform;
  const candidates = TSHARK_PATHS[platform] || [];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* keep looking */ }
  }
  // Fall back to PATH search on non-Windows (tshark may be in a custom prefix)
  return platform === "win32" ? null : "tshark";
}

// ---------- privilege / driver detection ----------

function checkCapturePrerequisites() {
  const platform = process.platform;
  const issues = [];

  if (platform === "win32") {
    // Check Npcap/WinPcap presence by looking for the driver service key
    try {
      const { execSync } = require("child_process");
      const out = execSync("sc query npcap 2>nul", { timeout: 3000, encoding: "utf8" });
      if (!out.includes("RUNNING")) issues.push("Npcap service is not running. Open Services and start Npcap Packet Filter Driver.");
    } catch {
      issues.push("Npcap/WinPcap not detected. Install Npcap from https://npcap.com to enable local capture.");
    }
    // Check admin rights
    try {
      const { execSync } = require("child_process");
      execSync("net session 2>nul", { timeout: 2000 });
    } catch {
      issues.push("Run as Administrator for packet capture (Npcap requires elevated privileges).");
    }
  } else if (platform === "linux") {
    // Check if user is in the wireshark/pcap group or has CAP_NET_RAW
    try {
      const groups = os.userInfo().username;
      const { execSync } = require("child_process");
      const groupOut = execSync("groups", { timeout: 2000, encoding: "utf8" });
      if (!groupOut.includes("wireshark") && process.getuid && process.getuid() !== 0) {
        issues.push("Add your user to the 'wireshark' group: sudo usermod -aG wireshark $USER — then log out and back in.");
      }
    } catch { /* best-effort */ }
  } else if (platform === "darwin") {
    // On macOS, /dev/bpfN devices need read permission (usually granted to 'access_bpf' group)
    try {
      fs.accessSync("/dev/bpf0", fs.constants.R_OK);
    } catch {
      issues.push("No permission to /dev/bpf0. Grant Wireshark capture permission: sudo chmod o+r /dev/bpf* — or install ChmodBPF helper included with Wireshark.");
    }
  }
  return issues;
}

// ---------- public API ----------

function tsharkAvailable() {
  return new Promise(resolve => {
    const bin = findTshark();
    if (!bin) {
      const msg = process.platform === "win32"
        ? "Wireshark not found. Install from https://www.wireshark.org/ and ensure Npcap is selected during setup."
        : "tshark not found. Install Wireshark: sudo apt install tshark (Ubuntu) or brew install wireshark (macOS).";
      return resolve({ available: false, path: null, installHint: msg });
    }
    execFile(bin, ["-v"], { timeout: 8000 }, (err, stdout) => {
      if (err) {
        log.warn("tshark -v failed", { bin, message: err.message });
        return resolve({ available: false, path: bin, error: err.message });
      }
      const version = String(stdout || "").split("\n")[0].trim();
      const prereqIssues = checkCapturePrerequisites();
      log.info("tshark available", { version, issues: prereqIssues.length });
      resolve({ available: true, path: bin, version, prereqIssues });
    });
  });
}

function listInterfacesViaOS() {
  const ifaces = os.networkInterfaces();
  const FRIENDLY = {
    "Wi-Fi": "Wi-Fi", "WLAN": "Wi-Fi", "wlan": "Wi-Fi",
    "eth": "Ethernet", "en0": "Ethernet / Wi-Fi", "en1": "Ethernet / Wi-Fi",
    "Ethernet": "Ethernet", "Local Area Connection": "Ethernet"
  };
  return Object.entries(ifaces)
    .filter(([, addrs]) => addrs && addrs.length > 0 && !addrs.every(a => a.internal))
    .map(([name, addrs], idx) => {
      const ipv4 = addrs.find(a => a.family === "IPv4" && !a.internal);
      const ip   = ipv4 ? ipv4.address : "";
      const friendly = Object.keys(FRIENDLY).find(k => name.toLowerCase().includes(k.toLowerCase()));
      const label = friendly ? `${FRIENDLY[friendly]} — ${name}${ip ? " (" + ip + ")" : ""}` : `${name}${ip ? " (" + ip + ")" : ""}`;
      return { index: String(idx + 1), id: name, name: label };
    });
}

function listInterfaces() {
  return new Promise(resolve => {
    const bin = findTshark();
    if (!bin) return resolve(listInterfacesViaOS());
    execFile(bin, ["-D"], { timeout: 10000 }, (err, stdout) => {
      if (err) {
        log.warn("tshark -D failed, falling back to OS interfaces", { message: err.message });
        return resolve(listInterfacesViaOS());
      }
      const tsharkList = String(stdout || "").split("\n").filter(Boolean).map(line => {
        const m = line.match(/^(\d+)\.\s+(.+?)(?:\s+\((.+)\))?$/);
        if (!m) return null;
        const id = m[2].trim();
        const label = (m[3] || m[2]).trim();
        // Humanise known Windows interface patterns
        const human = label
          .replace(/\\Device\\NPF_\{[^}]+\}/, "")
          .replace(/^\s*|\s*$/g, "");
        return { index: m[1], id, name: human || label };
      }).filter(Boolean);

      // If tshark returned interfaces, prefer them; otherwise fall back to OS
      if (tsharkList.length > 0) return resolve(tsharkList);
      resolve(listInterfacesViaOS());
    });
  });
}

// Bounded capture: duration capped at 120s, packet count at 5000.
// outDir is managed by main.js (inside userData); capture filter is sanitised.
function capture({ iface, seconds = 15, maxPackets = 400, filter = "", outDir }) {
  return new Promise((resolve, reject) => {
    const bin = findTshark();
    if (!bin) return reject(new Error(
      "Wireshark/tshark not found. Install Wireshark to enable local capture."
    ));

    // Validate inputs
    const capSeconds  = Math.max(1, Math.min(Number(seconds)    || 15,  120));
    const capPackets  = Math.max(1, Math.min(Number(maxPackets) || 400, 5000));
    let safeFilter = "";
    try { safeFilter = filter ? sanitiseCaptureFilter(filter) : ""; }
    catch (e) { return reject(new Error("Invalid capture filter: " + e.message)); }

    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const pcap  = path.join(outDir, `capture-${stamp}.pcapng`);

    const args = [
      "-i", String(iface),
      "-a", `duration:${capSeconds}`,
      "-c", String(capPackets),
      "-w", pcap
    ];
    if (safeFilter) args.push("-f", safeFilter);

    log.info("Starting capture", { iface, seconds: capSeconds, maxPackets: capPackets, filter: safeFilter });
    const proc = spawn(bin, args);
    let errBuf = "";
    proc.stderr.on("data", d => { errBuf += d.toString(); });
    proc.on("error", e => reject(new Error("Could not start tshark: " + e.message)));
    proc.on("close", code => {
      if (!fs.existsSync(pcap)) {
        log.error("Capture produced no file", { code, stderr: errBuf.slice(0, 300) });
        return reject(new Error("Capture produced no file. " + errBuf.slice(0, 200)));
      }
      log.info("Capture complete, decoding", { pcap });
      // Decode conversation stats + frame list for analysis
      execFile(bin, ["-r", pcap, "-q", "-z", "conv,ip"], { timeout: 30000, maxBuffer: 8e6 }, (e1, convOut) => {
        execFile(bin, [
          "-r", pcap, "-T", "fields", "-E", "separator=\t",
          "-e", "frame.number",
          "-e", "ip.src",
          "-e", "ip.dst",
          "-e", "_ws.col.Protocol",
          "-e", "_ws.col.Info",
          "-e", "tcp.analysis.retransmission",
          "-e", "tcp.analysis.out_of_order",
          "-e", "tcp.analysis.duplicate_ack",
          "-e", "tcp.flags.reset",
          "-e", "icmp.type",
          "-e", "dns.flags.rcode"
        ], { timeout: 30000, maxBuffer: 8e6 }, (e2, listOut) => {
          const lines = String(listOut || "").split("\n").filter(Boolean).slice(0, 500);
          resolve({
            pcap,
            packets: lines.length,
            conversations: String(convOut || "").slice(0, 8000),
            summary: lines.join("\n").slice(0, 24000)
          });
        });
      });
    });
  });
}

// Vendor-native capture commands executed over the existing device session.
// Useful when the laptop isn't in the traffic path (which is almost always true
// on a switched network).
function deviceCaptureCommands(brand, target) {
  if (target && !isValidHost(target)) target = "<host-ip>";
  const b = String(brand || "").toLowerCase();
  const host = target || "<host-ip>";

  if (b.includes("fortinet") || b.includes("forti")) {
    return {
      label: "FortiGate built-in sniffer",
      commands: [
        { cmd: `diagnose sniffer packet any 'host ${host}' 4 50 a`, why: "Capture 50 pkts to/from host — full headers + timestamps" },
        { cmd: `diagnose debug flow filter addr ${host}`, why: "Set flow-trace filter for this host" },
        { cmd: `diagnose debug flow trace start 20`, why: "Trace how firewall handles the next 20 packets (policy match, NAT, route)" },
        { cmd: `diagnose debug flow show function-name enable`, why: "Show function names in trace output for deeper analysis" },
        { cmd: `diagnose debug disable`, why: "Always disable debug when done — leaves it running degrades performance" }
      ]
    };
  }

  if (b.includes("cisco")) {
    return {
      label: "Cisco Embedded Packet Capture (EPC)",
      commands: [
        { cmd: `monitor capture CAP interface GigabitEthernet1/0/1 both`, why: "Define capture point — adjust interface to the target port" },
        { cmd: `monitor capture CAP match ipv4 host ${host} any`, why: "Filter to this host only" },
        { cmd: `monitor capture CAP start`, why: "Begin capturing" },
        { cmd: `monitor capture CAP stop`, why: "Stop after reproducing the issue" },
        { cmd: `show monitor capture CAP buffer brief`, why: "Display captured packets" },
        { cmd: `no monitor capture CAP`, why: "Clean up the capture session" }
      ]
    };
  }

  if (b.includes("allied")) {
    return {
      label: "Allied Telesis / AW+ capture",
      commands: [
        { cmd: `tcpdump host ${host}`, why: "Capture traffic for this host (AW+ shell tcpdump)" },
        { cmd: `show interface counters`, why: "Check error/drop counters first — often identifies the problem without a full capture" }
      ]
    };
  }

  if (b.includes("mikrotik")) {
    return {
      label: "MikroTik packet sniffer",
      commands: [
        { cmd: `/tool sniffer set filter-ip-address=${host} file-name=capture`, why: "Configure capture filter and output file" },
        { cmd: `/tool sniffer start`, why: "Start capture" },
        { cmd: `/tool sniffer stop`, why: "Stop after reproducing the issue" },
        { cmd: `/tool sniffer packet print`, why: "Display captured packets on screen" }
      ]
    };
  }

  if (b.includes("palo") || b.includes("pan")) {
    return {
      label: "Palo Alto packet capture",
      commands: [
        { cmd: `debug dataplane packet-diag set filter match destination ${host}`, why: "Set capture filter" },
        { cmd: `debug dataplane packet-diag set capture stage receive file pkt-rx.pcap`, why: "Capture on receive stage" },
        { cmd: `debug dataplane packet-diag set capture stage transmit file pkt-tx.pcap`, why: "Capture on transmit stage" },
        { cmd: `debug dataplane packet-diag start`, why: "Start packet capture" },
        { cmd: `debug dataplane packet-diag stop`, why: "Stop capture after reproducing issue" },
        { cmd: `debug dataplane packet-diag get capture`, why: "Display capture results" }
      ]
    };
  }

  if (b.includes("juniper") || b.includes("junos")) {
    return {
      label: "Juniper packet capture (monitor traffic)",
      commands: [
        { cmd: `monitor traffic interface ge-0/0/0 matching "host ${host}" count 50`, why: "Capture 50 packets matching this host on the interface" },
        { cmd: `show interfaces ge-0/0/0 detail | match "error|drop"`, why: "Check for hardware errors and drops" }
      ]
    };
  }

  return {
    label: "Port mirroring (SPAN) — vendor-neutral fallback",
    commands: [
      { cmd: `show running-config | include monitor`, why: "Check existing mirror sessions" }
    ],
    note: `If no built-in sniffer is available, mirror the target port to your laptop's port (SPAN/port-monitor), then capture locally with Wireshark. Filter: "host ${host}".`
  };
}

// ---------- Export engine ----------

// Converts capture summary to structured JSON or CSV for reporting.
function exportCapture(captureResult, format = "json") {
  const { pcap, packets, conversations, summary } = captureResult;
  const frames = String(summary || "").split("\n").filter(Boolean).map(line => {
    const [num, src, dst, proto, ...infoParts] = line.split("\t");
    return { frame: num, src, dst, protocol: proto, info: infoParts.join("\t") };
  });

  if (format === "csv") {
    const header = "frame,src,dst,protocol,info\n";
    const rows = frames.map(f =>
      [f.frame, f.src, f.dst, f.protocol, `"${(f.info || "").replace(/"/g, '""')}"`].join(",")
    ).join("\n");
    return header + rows;
  }

  return JSON.stringify({
    capturedAt: new Date().toISOString(),
    pcapFile: pcap,
    totalFrames: packets,
    conversations: conversations,
    frames
  }, null, 2);
}

const ANALYSIS_SYSTEM = `You are a senior network engineer analysing a packet capture for an on-site field engineer.
Given the decoded packet list and IP conversation statistics, produce a SHORT, practical analysis:
1. What is actually happening (the dominant flows and protocols).
2. Any problems visible: retransmissions, TCP resets, failed handshakes, ARP storms, DHCP failures, DNS failures, TLS errors, duplicate IPs, excessive broadcast, high jitter.
3. The single most likely root cause, if a problem is present.
4. The next concrete diagnostic step (a specific command to run on the switch/firewall).
Be concise and specific — one paragraph per point. If the capture looks healthy, say so plainly. Never invent packets that are not in the data.`;

module.exports = {
  findTshark, tsharkAvailable, listInterfaces, capture,
  deviceCaptureCommands, exportCapture, checkCapturePrerequisites,
  ANALYSIS_SYSTEM
};
