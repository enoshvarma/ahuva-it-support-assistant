// Device fingerprinting: matches terminal output against vendor signatures.
// Includes ARP/ICMP/TCP-SYN discovery helpers for Phase 4 host discovery.

const SIGNATURES = [
  {
    vendor: "Allied Telesis", type: "Switch", kb: "allied-telesis",
    match: [/alliedware\s*plus/i, /^awplus/im, /Allied\s*Telesis/i, /^AT-\w+/im],
    modelPatterns: [/\b(AT-[A-Za-z0-9\-]+)\b/i],
    discovery: ["show system", "show version"]
  },
  {
    vendor: "Cisco ASA", type: "Firewall", kb: "cisco-asa",
    match: [/adaptive security appliance/i, /\bASA\b.*Version/i, /^ciscoasa/im, /Cisco Adaptive Security/i],
    modelPatterns: [/\b(ASA\d{3,4}[A-Za-z0-9\-]*)\b/i],
    discovery: ["show version"]
  },
  {
    vendor: "Cisco", type: "Router", kb: "cisco-ios",
    match: [/cisco ios.*router/i, /\bISR\b/i, /\bIOS-XE\b.*Router/i, /Cisco IOS XE/i],
    modelPatterns: [/(ISR\d{4}[A-Za-z0-9\-]*)/i, /(C\d{4}[A-Za-z0-9\-]*)/i],
    discovery: ["show version"]
  },
  {
    vendor: "Cisco", type: "Switch", kb: "cisco-ios",
    match: [/cisco ios/i, /catalyst/i, /\bC9\d{3}\b/i, /WS-C\d/i, /Cisco Catalyst/i],
    modelPatterns: [/(C9\d{3}[A-Za-z0-9\-]*)/i, /(WS-C[A-Za-z0-9\-]+)/i, /(CBS\d{3}[A-Za-z0-9\-]*)/i],
    discovery: ["show version"]
  },
  {
    vendor: "Fortinet", type: "Firewall", kb: "fortigate",
    match: [/fortigate/i, /fortios/i, /forticarrier/i, /Fortinet/i],
    modelPatterns: [/(FGT[A-Za-z0-9\-]+)/i, /(FortiGate-[A-Za-z0-9\-]+)/i, /(FG[0-9]+[A-Za-z0-9\-]*)/i],
    discovery: ["get system status"]
  },
  {
    vendor: "Palo Alto", type: "Firewall", kb: "generic-firewall",
    match: [/pan-os/i, /palo alto/i, /PA-[0-9]/i],
    modelPatterns: [/(PA-[0-9A-Za-z\-]+)/i],
    discovery: ["show system info"]
  },
  {
    vendor: "MikroTik", type: "Router", kb: "mikrotik",
    match: [/mikrotik/i, /routeros/i, /RouterOS/i],
    modelPatterns: [/(CCR[0-9A-Za-z\-]+)/i, /(RB[0-9A-Za-z\-]+)/i, /(hAP|hEX|cRS)\b/i],
    discovery: ["/system resource print"]
  },
  {
    vendor: "Juniper", type: "Router", kb: "juniper",
    match: [/junos/i, /juniper/i, /JUNOS/i],
    modelPatterns: [/(MX[0-9]+)/i, /(EX[0-9]+)/i, /(QFX[0-9]+)/i, /(SRX[0-9]+)/i],
    discovery: ["show version"]
  },
  {
    vendor: "Quantum", type: "Switch", kb: "quantum",
    match: [/\bQuantum\b/i],
    modelPatterns: [],
    discovery: ["show version"]
  },
  {
    vendor: "HPE/Aruba", type: "Switch", kb: "generic-switch",
    match: [/aruba/i, /procurve/i, /hewlett|hpe/i, /Aruba Networks/i],
    modelPatterns: [/(2930[MF][A-Za-z0-9\-]*)/i, /(2540[A-Za-z0-9\-]*)/i],
    discovery: ["show version"]
  }
];

const PROBE_COMMANDS = [
  "show version",
  "show system",
  "get system status",
  "/system resource print",
  "show system info"
];

function fingerprintDevice(outputText) {
  const text = String(outputText || "");
  for (const sig of SIGNATURES) {
    if (sig.match.some(re => re.test(text))) {
      let model = "";
      for (const mp of sig.modelPatterns) {
        const m = text.match(mp);
        if (m) { model = m[1]; break; }
      }
      return {
        vendor: sig.vendor,
        type: sig.type,
        kb: sig.kb,
        model,
        confidence: "high",
        matched: true
      };
    }
  }
  return { vendor: "", type: "", kb: "", model: "", confidence: "none", matched: false };
}

// ---------- Host discovery helpers (ARP / ICMP) ----------
// These run over the existing device session — we send discovery commands and
// parse the output rather than launching raw socket scans from the laptop.

function arpDiscoveryCommands(brand) {
  const b = String(brand || "").toLowerCase();
  if (b.includes("cisco")) {
    return [
      { cmd: "show arp", why: "List all ARP entries — active hosts on local subnets" },
      { cmd: "show ip arp", why: "Detailed ARP with VLAN and interface mapping" },
      { cmd: "show mac address-table", why: "Layer-2 forwarding table — identifies which port each MAC is on" }
    ];
  }
  if (b.includes("allied")) {
    return [
      { cmd: "show arp", why: "ARP table" },
      { cmd: "show mac address-table", why: "MAC forwarding table" }
    ];
  }
  if (b.includes("fortinet") || b.includes("forti")) {
    return [
      { cmd: "get system arp", why: "ARP table for all interfaces" },
      { cmd: "diagnose ip arp list", why: "Detailed ARP with stale entries flagged" }
    ];
  }
  if (b.includes("mikrotik")) {
    return [
      { cmd: "/ip arp print", why: "ARP table" },
      { cmd: "/ip neighbor print", why: "CDP/LLDP-equivalent neighbour discovery" }
    ];
  }
  return [
    { cmd: "show arp", why: "ARP table (adjust for your vendor)" }
  ];
}

// Parse ARP output into a structured list of {ip, mac, iface} objects.
function parseArpTable(text) {
  const entries = [];
  // Cisco IOS: "Protocol  Address    Age   Hardware Addr    Type  Interface"
  //            "Internet  10.0.0.1   -     aabb.cc00.0100   ARPA  Vlan1"
  const ciscoRe = /Internet\s+([\d.]+)\s+[\d\-]+\s+([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})\s+\w+\s+(\S+)/gi;
  let m;
  while ((m = ciscoRe.exec(text)) !== null) entries.push({ ip: m[1], mac: m[2], iface: m[3] });

  // Generic: lines with IP and MAC-like patterns
  if (!entries.length) {
    const lines = text.split("\n");
    const genericRe = /((?:\d{1,3}\.){3}\d{1,3})\s.*?([0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2})/i;
    for (const line of lines) {
      const gm = genericRe.exec(line);
      if (gm) entries.push({ ip: gm[1], mac: gm[2], iface: "" });
    }
  }
  return entries;
}

// Diagnostic metrics parser: extract latency, packet loss from ping output.
function parsePingOutput(text) {
  const result = { host: "", packetsSent: 0, packetsReceived: 0, packetLoss: null, minRtt: null, avgRtt: null, maxRtt: null, jitter: null };

  // Cisco: "Success rate is 80 percent (4/5), round-trip min/avg/max = 1/2/5 ms"
  const ciscoStats = text.match(/Success rate is (\d+) percent \((\d+)\/(\d+)\)/i);
  if (ciscoStats) {
    result.packetsReceived = Number(ciscoStats[2]);
    result.packetsSent = Number(ciscoStats[3]);
    result.packetLoss = 100 - Number(ciscoStats[1]);
  }
  const ciscoRtt = text.match(/round-trip min\/avg\/max = (\d+)\/(\d+)\/(\d+) ms/i);
  if (ciscoRtt) {
    result.minRtt = Number(ciscoRtt[1]);
    result.avgRtt = Number(ciscoRtt[2]);
    result.maxRtt = Number(ciscoRtt[3]);
    result.jitter  = result.maxRtt - result.minRtt;
  }

  // Linux/macOS ping: "3 packets transmitted, 3 received, 0% packet loss"
  //                   "rtt min/avg/max/mdev = 0.4/1.2/2.1/0.7 ms"
  const linuxStats = text.match(/(\d+) packets transmitted,\s*(\d+) received,\s*([\d.]+)% packet loss/i);
  if (linuxStats) {
    result.packetsSent = Number(linuxStats[1]);
    result.packetsReceived = Number(linuxStats[2]);
    result.packetLoss = parseFloat(linuxStats[3]);
  }
  const linuxRtt = text.match(/rtt min\/avg\/max\/mdev = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+) ms/i);
  if (linuxRtt) {
    result.minRtt = parseFloat(linuxRtt[1]);
    result.avgRtt = parseFloat(linuxRtt[2]);
    result.maxRtt = parseFloat(linuxRtt[3]);
    result.jitter  = parseFloat(linuxRtt[4]);
  }

  // FortiOS ping stats: "5 packets transmitted, 5 packets received, 0.0% packet loss"
  const fortiStats = text.match(/(\d+) packets transmitted,\s*(\d+) packets received,\s*([\d.]+)% packet loss/i);
  if (fortiStats && !linuxStats) {
    result.packetsSent = Number(fortiStats[1]);
    result.packetsReceived = Number(fortiStats[2]);
    result.packetLoss = parseFloat(fortiStats[3]);
  }

  return result;
}

module.exports = { fingerprintDevice, PROBE_COMMANDS, SIGNATURES, arpDiscoveryCommands, parseArpTable, parsePingOutput };
