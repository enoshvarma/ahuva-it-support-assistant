/**
 * Ahuva Network Scanner — Advanced IP Scanner + Nmap fusion engine.
 * Pure Node.js — no native binaries required (Nmap used when present).
 *
 * Capabilities:
 *  • ICMP ping host discovery          • TCP-SYN port probing
 *  • ARP table MAC resolution          • OUI vendor lookup
 *  • DNS PTR / mDNS hostname lookup   • NetBIOS-NS UDP name resolution
 *  • Wake-on-LAN (WoL) magic packet   • Nmap enrichment when available
 */

"use strict";

const net     = require("net");
const dgram   = require("dgram");
const dns     = require("dns").promises;
const cp      = require("child_process");
const os      = require("os");

// ── OUI vendor prefix table (24-bit / first 3 bytes of MAC) ──────────────────
// A curated subset of IEEE OUI covering common enterprise gear.
const OUI = {
  "00:00:0C": "Cisco",          "00:01:42": "Cisco",         "00:01:43": "Cisco",
  "00:1A:A1": "Cisco",          "F4:6D:04": "Cisco",         "68:86:A7": "Cisco",
  "D4:8C:B5": "Cisco",          "A4:93:4C": "Cisco",         "CC:98:91": "Cisco",
  "00:1A:2F": "Cisco",          "00:26:CB": "Cisco",         "3C:CE:73": "Cisco",
  "00:50:BA": "D-Link",         "1C:AF:F7": "D-Link",        "B0:C5:54": "D-Link",
  "00:0F:B5": "Netgear",        "00:18:4D": "Netgear",       "2C:B0:5D": "Netgear",
  "A0:40:A0": "Netgear",        "04:A1:51": "Netgear",
  "00:04:96": "Extreme Networks","00:E0:2B": "Extreme Networks",
  "00:16:CA": "Juniper Networks","2C:6B:F5": "Juniper Networks","F0:9E:4A": "Juniper Networks",
  "00:00:5E": "IANA/Cisco",
  "00:08:9F": "Allied Telesis",  "00:00:CD": "Allied Telesis", "00:18:6E": "Allied Telesis",
  "70:54:F5": "Allied Telesis",
  "00:0C:E5": "Fortinet",        "00:09:0F": "Fortinet",       "3C:FD:FE": "Fortinet",
  "90:6C:AC": "Fortinet",        "08:5B:0E": "Fortinet",
  "00:18:0A": "Palo Alto Networks","C4:B5:01": "Palo Alto Networks",
  "6C:F0:49": "MikroTik",        "4C:5E:0C": "MikroTik",       "74:4D:28": "MikroTik",
  "D4:CA:6D": "MikroTik",        "B8:69:F4": "MikroTik",       "DC:2C:6E": "MikroTik",
  "00:1B:17": "Ubiquiti",        "FC:EC:DA": "Ubiquiti",       "80:2A:A8": "Ubiquiti",
  "24:A4:3C": "Ubiquiti",        "44:D9:E7": "Ubiquiti",       "00:27:22": "Ubiquiti",
  "00:17:F2": "Apple",           "3C:15:C2": "Apple",          "A8:51:AB": "Apple",
  "00:1C:BF": "Apple",           "F4:F1:5A": "Apple",
  "B8:27:EB": "Raspberry Pi",    "DC:A6:32": "Raspberry Pi",   "E4:5F:01": "Raspberry Pi",
  "00:21:97": "HP/HPE",          "3C:D9:2B": "HP/HPE",         "94:18:82": "HP/HPE",
  "EC:B1:D7": "HP/HPE",          "38:EA:A7": "HP/HPE",         "D0:67:26": "HP/HPE",
  "00:1A:4B": "Dell",            "00:21:9B": "Dell",            "18:A9:9B": "Dell",
  "D4:BE:D9": "Dell",            "F8:DB:88": "Dell",
  "00:50:56": "VMware",          "00:0C:29": "VMware",          "00:05:69": "VMware",
  "52:54:00": "QEMU/KVM",        "08:00:27": "VirtualBox",
  "00:0A:F7": "Watchguard",      "00:90:7F": "Watchguard",
  "00:13:F7": "SonicWall",       "00:17:C5": "SonicWall",
  "AC:F2:C5": "Aruba/HP",        "00:1A:1E": "Aruba/HP",       "D8:C7:C8": "Aruba/HP",
  "94:B4:0F": "Aruba/HP",        "24:DE:C6": "Aruba/HP",
};

/** Look up OUI vendor from a MAC string like "AA:BB:CC:DD:EE:FF". */
function macVendor(mac) {
  if (!mac) return "";
  const norm = mac.toUpperCase().replace(/-/g, ":");
  const prefix = norm.slice(0, 8);
  return OUI[prefix] || "";
}

// ── Subnet helpers ────────────────────────────────────────────────────────────

/** Parse "192.168.1.0/24" or "192.168.1.1-192.168.1.100" or single IP. */
function parseRange(target) {
  target = String(target || "").trim();
  if (target.includes("/")) {
    const [base, bits] = target.split("/");
    const prefixLen = parseInt(bits, 10);
    if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) throw new Error("Invalid CIDR prefix length");
    const baseNum = ipToNum(base);
    const mask    = prefixLen === 0 ? 0 : (0xFFFFFFFF << (32 - prefixLen)) >>> 0;
    const network = (baseNum & mask) >>> 0;
    const count   = Math.pow(2, 32 - prefixLen);
    const ips = [];
    for (let i = 1; i < count - 1; i++) ips.push(numToIp((network + i) >>> 0));
    return ips;
  }
  if (target.includes("-")) {
    const [start, end] = target.split("-");
    const s = ipToNum(start.trim()), e = ipToNum(end.trim());
    if (s > e) throw new Error("Start IP must be ≤ end IP");
    const ips = [];
    for (let i = s; i <= e; i++) ips.push(numToIp(i >>> 0));
    return ips;
  }
  return [target]; // single IP
}

function ipToNum(ip) {
  return ip.split(".").reduce((acc, oct) => ((acc << 8) | parseInt(oct, 10)) >>> 0, 0);
}
function numToIp(n) {
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join(".");
}

// ── ARP table (reads OS cache) ────────────────────────────────────────────────

/** Returns {ip: mac} map from the OS ARP table. Cross-platform. */
function readArpTable() {
  return new Promise(resolve => {
    const cmd  = process.platform === "win32" ? "arp" : "arp";
    const args = process.platform === "win32" ? ["-a"] : ["-a"];
    cp.execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve({});
      const table = {};
      const re = process.platform === "win32"
        // Windows: "  192.168.1.1          aa-bb-cc-dd-ee-ff     dynamic"
        ? /(\d+\.\d+\.\d+\.\d+)\s+([\da-fA-F]{2}[:\-][\da-fA-F]{2}[:\-][\da-fA-F]{2}[:\-][\da-fA-F]{2}[:\-][\da-fA-F]{2}[:\-][\da-fA-F]{2})/g
        // Linux/Mac: "? (192.168.1.1) at aa:bb:cc:dd:ee:ff [ether]"
        : /\((\d+\.\d+\.\d+\.\d+)\) at ([\da-fA-F:]{17})/g;
      let m;
      while ((m = re.exec(stdout)) !== null) {
        const ip  = m[1];
        const mac = m[2].replace(/-/g, ":").toLowerCase();
        table[ip] = mac;
      }
      resolve(table);
    });
  });
}

// ── ICMP ping ─────────────────────────────────────────────────────────────────

/** Returns true if the host responds to ping within timeoutMs. */
function pingHost(ip, timeoutMs = 1000) {
  return new Promise(resolve => {
    const isWin = process.platform === "win32";
    const cmd   = isWin ? "ping" : "ping";
    const args  = isWin
      ? ["-n", "1", "-w", String(timeoutMs), ip]
      : ["-c", "1", "-W", String(Math.ceil(timeoutMs / 1000)), ip];
    cp.execFile(cmd, args, { timeout: timeoutMs + 2000 }, (err, stdout) => {
      if (err) return resolve(false);
      // "TTL=" present on Windows; "1 received" on Unix
      resolve(/ttl=/i.test(stdout) || /1 received/i.test(stdout) || /bytes from/i.test(stdout));
    });
  });
}

// ── TCP port probing ──────────────────────────────────────────────────────────

const ENTERPRISE_PORTS = {
  21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP",
  53: "DNS",  80: "HTTP", 110: "POP3", 143: "IMAP",
  161: "SNMP", 389: "LDAP", 443: "HTTPS", 445: "SMB",
  3306: "MySQL", 3389: "RDP", 5900: "VNC", 8080: "HTTP-Alt",
  8443: "HTTPS-Alt", 8888: "HTTP-Dev", 9200: "Elasticsearch",
};

const QUICK_PORTS = [22, 23, 80, 443, 3389, 5900, 445];

/** Returns list of open ports from ENTERPRISE_PORTS. */
function probePorts(ip, ports = QUICK_PORTS, timeoutMs = 600) {
  const tasks = ports.map(port =>
    new Promise(resolve => {
      const sock = new net.Socket();
      let done = false;
      const finish = open => { if (!done) { done = true; sock.destroy(); resolve({ port, open }); } };
      sock.setTimeout(timeoutMs);
      sock.on("connect", () => finish(true));
      sock.on("timeout", () => finish(false));
      sock.on("error",   () => finish(false));
      try { sock.connect(port, ip); } catch { finish(false); }
    })
  );
  return Promise.all(tasks).then(results =>
    results.filter(r => r.open).map(r => ({ port: r.port, service: ENTERPRISE_PORTS[r.port] || "?" }))
  );
}

// ── DNS PTR / hostname ────────────────────────────────────────────────────────

async function resolveHostname(ip) {
  try {
    const names = await dns.reverse(ip);
    return (names && names[0]) || "";
  } catch { return ""; }
}

// ── NetBIOS-NS name query (UDP 137) ──────────────────────────────────────────

function netbiosQuery(ip, timeoutMs = 800) {
  return new Promise(resolve => {
    // NetBIOS Name Service query — "Adapter Status" request (0x0A 0x00)
    const txid  = Buffer.alloc(2); txid.writeUInt16BE(Math.floor(Math.random() * 0xFFFF));
    const query = Buffer.concat([
      txid,
      Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
      Buffer.from([0x20]),
      // encoded wildcard "*"
      Buffer.from("CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "ascii"),
      Buffer.from([0x00, 0x00, 0x21, 0x00, 0x01])
    ]);
    const sock = dgram.createSocket("udp4");
    let done = false;
    const finish = (name) => { if (!done) { done = true; try { sock.close(); } catch {} resolve(name); } };
    const timer = setTimeout(() => finish(""), timeoutMs);
    sock.on("message", msg => {
      clearTimeout(timer);
      try {
        // Response: names start at byte 57, each 18 bytes: 15 name + 1 type + 2 flags
        const numNames = msg.readUInt8(56);
        for (let i = 0; i < numNames && i < 10; i++) {
          const off    = 57 + i * 18;
          const raw    = msg.slice(off, off + 15).toString("ascii").replace(/\x00/g, "").trim();
          const flags  = msg.readUInt16BE(off + 16);
          const isGroup = (flags & 0x8000) !== 0;
          if (raw && !isGroup) return finish(raw);
        }
      } catch {}
      finish("");
    });
    sock.on("error", () => { clearTimeout(timer); finish(""); });
    try {
      sock.bind(() => sock.send(query, 0, query.length, 137, ip));
    } catch { clearTimeout(timer); finish(""); }
  });
}

// ── mDNS hostname query ───────────────────────────────────────────────────────

function mdnsQuery(ip, timeoutMs = 700) {
  return new Promise(resolve => {
    // Build a PTR query for <reversed>.in-addr.arpa
    const parts   = ip.split(".").reverse();
    const arpa    = parts.join(".") + ".in-addr.arpa";
    const labels  = arpa.split(".");
    let qLen = 2 + 2 + 2 + 2 + 2; // header basics
    for (const l of labels) qLen += 1 + l.length;
    qLen += 1 + 4; // null terminator + QTYPE+QCLASS
    const pkt = Buffer.alloc(12 + qLen);
    pkt.writeUInt16BE(0x0000, 0); // txid=0 for mDNS
    pkt.writeUInt16BE(0x0000, 2); // flags: query
    pkt.writeUInt16BE(1, 4);      // QDCOUNT = 1
    let pos = 12;
    for (const label of labels) {
      pkt.writeUInt8(label.length, pos++);
      pkt.write(label, pos, "ascii");
      pos += label.length;
    }
    pkt.writeUInt8(0, pos++);
    pkt.writeUInt16BE(12, pos); pos += 2; // QTYPE PTR
    pkt.writeUInt16BE(1,  pos); pos += 2; // QCLASS IN
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let done = false;
    const finish = h => { if (!done) { done = true; try { sock.close(); } catch {} resolve(h); } };
    setTimeout(() => finish(""), timeoutMs);
    sock.on("error", () => finish(""));
    sock.on("message", msg => {
      try {
        const anCount = msg.readUInt16BE(6);
        if (anCount === 0) return finish("");
        // Parse first answer — simplistic: scan for readable string
        const str = msg.toString("ascii", 12).replace(/[^\x20-\x7E.]/g, " ").trim();
        const m   = str.match(/([a-zA-Z0-9_-]+\.local)/);
        finish(m ? m[1] : "");
      } catch { finish(""); }
    });
    try {
      sock.bind(() => sock.send(pkt, 0, pkt.length, 5353, "224.0.0.251"));
    } catch { finish(""); }
  });
}

// ── Nmap enrichment (optional) ────────────────────────────────────────────────

function nmapAvailable() {
  return new Promise(resolve => {
    cp.execFile("nmap", ["--version"], { timeout: 3000 }, err => resolve(!err));
  });
}

function nmapScan(ip, ports) {
  return new Promise(resolve => {
    const portStr = ports.join(",");
    const args = ["-sV", "--version-light", "-T4", "-p", portStr,
                  "--open", "-oX", "-", ip];
    cp.execFile("nmap", args, { timeout: 30000 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const services = [];
      const re = /<port protocol="[^"]*" portid="(\d+)">.*?<state state="open"[^/]*\/>.*?<service name="([^"]*)"(?:[^/]*version="([^"]*)")?/gs;
      let m;
      while ((m = re.exec(stdout)) !== null) {
        services.push({ port: parseInt(m[1], 10), service: m[2], version: m[3] || "" });
      }
      resolve(services);
    });
  });
}

// ── Wake-on-LAN ───────────────────────────────────────────────────────────────

/** Send a WoL magic packet to a MAC address. */
function sendWoL(mac, broadcast = "255.255.255.255") {
  return new Promise((resolve, reject) => {
    const macBytes = mac.replace(/[:\-]/g, "").match(/.{2}/g);
    if (!macBytes || macBytes.length !== 6) return reject(new Error("Invalid MAC address"));
    const macBuf = Buffer.from(macBytes.map(b => parseInt(b, 16)));
    // Magic packet: 6 x 0xFF + 16 x MAC
    const magic = Buffer.concat([Buffer.alloc(6, 0xFF), ...Array(16).fill(macBuf)]);
    const sock  = dgram.createSocket("udp4");
    sock.once("error", err => { sock.close(); reject(err); });
    sock.bind(() => {
      sock.setBroadcast(true);
      sock.send(magic, 0, magic.length, 9, broadcast, err => {
        sock.close();
        if (err) reject(err); else resolve(true);
      });
    });
  });
}

// ── Full single-host scan ─────────────────────────────────────────────────────

async function scanHost(ip, opts = {}) {
  const result = { ip, status: "offline", mac: "", vendor: "", hostname: "", openPorts: [], notes: [] };
  const portList = opts.fullScan ? Object.keys(ENTERPRISE_PORTS).map(Number) : QUICK_PORTS;

  // Step 1: ping
  const alive = await pingHost(ip, opts.pingTimeout || 1000);
  if (!alive && !opts.portFallback) {
    return result;
  }
  result.status = alive ? "online" : "filtered";

  // Step 2: ARP MAC (from pre-loaded table passed in opts.arpTable)
  const arpTable = opts.arpTable || {};
  if (arpTable[ip]) {
    result.mac    = arpTable[ip];
    result.vendor = macVendor(result.mac);
  }

  // Step 3: hostname resolution (parallel: DNS + NetBIOS + mDNS)
  const [dnsName, nbName, mDnsName] = await Promise.all([
    resolveHostname(ip),
    netbiosQuery(ip, 600),
    mdnsQuery(ip, 600),
  ]);
  result.hostname = nbName || dnsName || mDnsName || "";
  if (nbName)   result.notes.push(`NetBIOS: ${nbName}`);
  if (mDnsName) result.notes.push(`mDNS: ${mDnsName}`);

  // Step 4: TCP port probes
  const openPorts = await probePorts(ip, portList, opts.portTimeout || 600);
  result.openPorts = openPorts;

  // Step 5: Nmap enrichment (only if available and requested)
  if (opts.useNmap && openPorts.length > 0) {
    try {
      const nmapPorts = await nmapScan(ip, openPorts.map(p => p.port));
      if (nmapPorts.length > 0) {
        result.openPorts = nmapPorts;
        result.notes.push("Enriched by nmap");
      }
    } catch { /* nmap optional */ }
  }

  return result;
}

// ── Range scan (async, with progress callback) ────────────────────────────────

/**
 * Scan a range of IPs.
 * @param {string} target   - "192.168.1.0/24" | "192.168.1.1-20" | single IP
 * @param {object} opts     - { concurrency, fullScan, useNmap, pingTimeout, portTimeout }
 * @param {function} onProgress - called with each completed HostResult
 * @returns {Promise<HostResult[]>}  all results when done
 */
async function scanRange(target, opts = {}, onProgress = null) {
  const ips         = parseRange(target);
  const concurrency = Math.min(opts.concurrency || 50, 200);
  const arpTable    = await readArpTable();
  const scanOpts    = { ...opts, arpTable };
  const results     = [];

  // Process in concurrent batches
  for (let i = 0; i < ips.length; i += concurrency) {
    const batch   = ips.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(ip => scanHost(ip, scanOpts)));
    for (const r of batchResults) {
      results.push(r);
      if (onProgress) onProgress(r, results.length, ips.length);
    }
  }
  return results;
}

// ── Traceroute ────────────────────────────────────────────────────────────────

function traceroute(ip) {
  return new Promise(resolve => {
    const isWin = process.platform === "win32";
    const cmd   = isWin ? "tracert" : "traceroute";
    const args  = isWin ? ["-d", "-h", "20", ip] : ["-m", "20", "-n", ip];
    cp.execFile(cmd, args, { timeout: 30000 }, (err, stdout) => {
      resolve({ ip, output: stdout || String(err || "traceroute failed"), error: !!err });
    });
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  parseRange,
  macVendor,
  pingHost,
  probePorts,
  resolveHostname,
  netbiosQuery,
  mdnsQuery,
  nmapAvailable,
  nmapScan,
  sendWoL,
  scanHost,
  scanRange,
  traceroute,
  readArpTable,
  ENTERPRISE_PORTS,
  QUICK_PORTS,
};
