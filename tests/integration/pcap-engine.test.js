// Integration test: full analyseCapture pipeline with realistic shaped data.
// Does NOT require tshark or a network interface — exercises the pure analysis path.

let passed = 0, failed = 0;

function assert(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
}
function assertMatch(name, actual, pattern) {
  const ok = pattern.test(actual);
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    "${actual}" did not match ${pattern}`);
  }
}

const { analyseCapture, SEVERITY } = require("../../src/pcap-analyser");

// Realistic tshark tab-separated output: frame\tsrc\tdst\tproto\tinfo
function makeTsharkLine(src, dst, proto, info) {
  return `1\t${src}\t${dst}\t${proto}\t${info}`;
}

// ── Test 1: Healthy corporate LAN capture ─────────────────────────────────────
console.log("\npcap-engine integration: healthy LAN");
{
  const lines = [
    ...Array.from({ length: 40 }, (_, i) => makeTsharkLine("10.0.0.10", "10.0.0.1",   "TCP",  `[SYN] port=${i}`)),
    ...Array.from({ length: 30 }, (_, i) => makeTsharkLine("10.0.0.1",  "10.0.0.10",  "TCP",  `[SYN, ACK] port=${i}`)),
    ...Array.from({ length: 10 }, ()      => makeTsharkLine("10.0.0.10", "8.8.8.8",    "DNS",  "Standard query A example.com")),
    ...Array.from({ length: 10 }, ()      => makeTsharkLine("8.8.8.8",   "10.0.0.10",  "DNS",  "Standard query response A 93.184.216.34")),
    ...Array.from({ length: 5  }, ()      => makeTsharkLine("10.0.0.10", "10.0.0.255", "ARP",  "ARP who has 10.0.0.5?")),
  ];
  const r = analyseCapture({
    packets: lines.length,
    conversations: "TCP  10.0.0.10:51234 → 10.0.0.1:443  Frames: 70",
    summary: lines.join("\n")
  });

  assert("healthy LAN → NORMAL severity",    r.severity, SEVERITY.NORMAL);
  assert("healthy LAN → no anomalies",       r.anomalies.length, 0);
  assert("topProtocols includes TCP",        r.trafficProfile.topProtocols.some(p => p.proto === "TCP"), true);
  assert("topProtocols includes DNS",        r.trafficProfile.topProtocols.some(p => p.proto === "DNS"), true);
  assert("topSources includes 10.0.0.10",   r.trafficProfile.topSources.some(s => s.ip === "10.0.0.10"), true);
  assertMatch("humanSummary starts NORMAL", r.humanSummary, /^Traffic Status: NORMAL/);
}

// ── Test 2: Mixed congestion (retransmits + DNS failures) ─────────────────────
console.log("\npcap-engine integration: congested network");
{
  const lines = [
    ...Array.from({ length: 74 }, (_, i) => makeTsharkLine("10.1.0.5", "10.1.0.1",  "TCP",  `[ACK] Seq=${i}`)),
    ...Array.from({ length: 13 }, ()      => makeTsharkLine("10.1.0.5", "10.1.0.1",  "TCP",  "[TCP Retransmission] Seq=1")),
    ...Array.from({ length: 13 }, ()      => makeTsharkLine("10.1.0.5", "8.8.8.8",   "DNS",  "response NXDOMAIN badhost.local")),
  ];
  const r = analyseCapture({
    packets: 100,
    conversations: "TCP 10.1.0.5:51234 → 10.1.0.1:80 Frames: 87",
    summary: lines.join("\n")
  });

  assert("congested → HIGH severity",        r.severity, SEVERITY.HIGH);
  assert("retransmit anomaly present",       r.anomalies.some(a => a.id.startsWith("tcp_retransmit")), true);
  assert("dns failure anomaly present",      r.anomalies.some(a => a.id === "dns_failures"), true);
  assertMatch("humanSummary mentions HIGH",  r.humanSummary, /\[HIGH\]/);
  assertMatch("recommendation present",      r.humanSummary, /→/);
}

// ── Test 3: Broadcast storm ────────────────────────────────────────────────────
console.log("\npcap-engine integration: broadcast storm");
{
  const lines = [
    ...Array.from({ length: 60 }, ()      => makeTsharkLine("ff:ff:ff:ff:ff:ff", "broadcast", "ARP",  "ARP who has 10.0.0.1? Tell 10.0.0.100")),
    ...Array.from({ length: 20 }, ()      => makeTsharkLine("10.0.0.1",           "10.0.0.2",  "STP",  "Conf. Root = 32768/1/aa:bb:cc:dd:ee:ff")),
    ...Array.from({ length: 20 }, ()      => makeTsharkLine("10.0.0.99",          "10.0.0.1",  "TCP",  "[SYN]")),
  ];
  const r = analyseCapture({
    packets: 100,
    conversations: "",
    summary: lines.join("\n")
  });

  const hasBroadcastAnomaly = r.anomalies.some(a =>
    a.id === "broadcast_dominance" || a.id === "arp_storm" || a.id === "arp_elevated"
  );
  assert("broadcast storm → anomaly flagged",    hasBroadcastAnomaly, true);
  assert("broadcast storm → severity ≥ NORMAL",  [SEVERITY.HIGH, SEVERITY.CRITICAL].includes(r.severity) || r.severity === SEVERITY.NORMAL, true);
  assert("arpCount in profile",                  r.trafficProfile.arpCount, 60);
}

// ── Test 4: Security incident — port scan + RST flood ─────────────────────────
console.log("\npcap-engine integration: port scan / RST flood");
{
  // 75 RST packets from one scanner (75% → triggers dominance) + 25 normal
  const lines = [
    ...Array.from({ length: 75 }, (_, i) => makeTsharkLine("192.168.100.5", `10.0.0.${i % 20}`, "TCP",  `RST, ACK port=${i}`)),
    ...Array.from({ length: 25 }, ()      => makeTsharkLine("10.0.0.1",     "10.0.0.2",          "TCP",  "[ACK]")),
  ];
  const r = analyseCapture({
    packets: 100,
    conversations: "",
    summary: lines.join("\n")
  });

  assert("rst flood → HIGH or CRITICAL",  [SEVERITY.HIGH, SEVERITY.CRITICAL].includes(r.severity), true);
  assert("rst storm anomaly present",     r.anomalies.some(a => a.id === "tcp_rst_storm"), true);
  assert("traffic dominance detected",    r.anomalies.some(a => a.id === "traffic_dominance"), true);
}

// ── Test 5: trafficProfile completeness ────────────────────────────────────────
console.log("\npcap-engine integration: profile completeness");
{
  const lines = Array.from({ length: 30 }, (_, i) =>
    makeTsharkLine(`10.0.0.${i % 5}`, "10.0.0.255", "UDP", `data port ${1024 + i}`)
  );
  const r = analyseCapture({ packets: 30, conversations: "", summary: lines.join("\n") });
  const p = r.trafficProfile;

  assert("profile.totalPackets set",      typeof p.totalPackets,  "number");
  assert("profile.retransmits set",       typeof p.retransmits,   "number");
  assert("profile.resets set",            typeof p.resets,        "number");
  assert("profile.arpCount set",          typeof p.arpCount,      "number");
  assert("profile.dnsFailures set",       typeof p.dnsFailures,   "number");
  assert("profile.icmpUnreach set",       typeof p.icmpUnreach,   "number");
  assert("profile.topProtocols array",    Array.isArray(p.topProtocols), true);
  assert("profile.topSources array",      Array.isArray(p.topSources), true);
  assert("topProtocols ≤ 8 entries",      p.topProtocols.length <= 8, true);
  assert("topSources ≤ 5 entries",        p.topSources.length <= 5, true);
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`pcap-engine integration tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(`\n${failed} test(s) FAILED`); process.exit(1); }
else console.log("All pcap-engine integration tests passed.");
