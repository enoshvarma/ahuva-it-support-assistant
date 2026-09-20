// Unit tests for src/pcap-analyser.js
// Run via: node scripts/test-units.js (included from there)
// Or directly: node tests/unit/pcap-analyser.test.js

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
function assertOneOf(name, actual, choices) {
  const ok = choices.includes(actual);
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    expected one of: ${choices.join(", ")}`);
    console.error(`    actual: ${actual}`);
  }
}

const { analyseCapture, SEVERITY } = require("../../src/pcap-analyser");

// ── helpers ──────────────────────────────────────────────────────────────────
function makeLine(src, dst, proto, info) {
  return `1\t${src}\t${dst}\t${proto}\t${info}`;
}

// ── 1. Clean traffic → NORMAL, no anomalies ──────────────────────────────────
console.log("\npcap-analyser: clean traffic");
{
  // Use 5 sources evenly split (each 20%) so no single source triggers dominance check
  const lines = Array.from({ length: 50 }, (_, i) =>
    makeLine(`10.0.0.${(i % 5) + 1}`, "10.0.0.10", "TCP", `[SYN] Seq=0 port=${i}`)
  );
  const r = analyseCapture({ packets: 50, conversations: "", summary: lines.join("\n") });
  assert("clean → severity NORMAL", r.severity, SEVERITY.NORMAL);
  assert("clean → no anomalies",    r.anomalies.length, 0);
  assert("humanSummary contains NORMAL", r.humanSummary.includes("NORMAL"), true);
}

// ── 2. TCP retransmission → CRITICAL (≥15%) ───────────────────────────────────
console.log("\npcap-analyser: TCP retransmission critical");
{
  const normal = Array.from({ length: 80 }, (_, i) =>
    makeLine("10.0.0.1", "10.0.0.2", "TCP", `[SYN] Seq=${i}`)
  );
  const rexmit = Array.from({ length: 20 }, () =>
    makeLine("10.0.0.1", "10.0.0.2", "TCP", "[TCP Retransmission] Seq=1")
  );
  const r = analyseCapture({ packets: 100, conversations: "", summary: [...normal, ...rexmit].join("\n") });
  assert("rexmit critical → severity CRITICAL", r.severity, SEVERITY.CRITICAL);
  assert("rexmit critical → anomaly found",     r.anomalies.some(a => a.id === "tcp_retransmit_critical"), true);
  assert("trafficProfile.retransmits = 20",      r.trafficProfile.retransmits, 20);
}

// ── 3. TCP retransmission → HIGH (≥5%, <15%) ─────────────────────────────────
console.log("\npcap-analyser: TCP retransmission high");
{
  const normal = Array.from({ length: 92 }, (_, i) =>
    makeLine("10.0.0.1", "10.0.0.2", "TCP", `[SYN] Seq=${i}`)
  );
  const rexmit = Array.from({ length: 8 }, () =>
    makeLine("10.0.0.1", "10.0.0.2", "TCP", "[TCP Dup ACK] Seq=1")
  );
  const r = analyseCapture({ packets: 100, conversations: "", summary: [...normal, ...rexmit].join("\n") });
  assert("rexmit high → severity HIGH",     r.severity, SEVERITY.HIGH);
  assert("rexmit high → anomaly id high",   r.anomalies.some(a => a.id === "tcp_retransmit_high"), true);
}

// ── 4. TCP RST storm ──────────────────────────────────────────────────────────
console.log("\npcap-analyser: TCP RST storm");
{
  const lines = Array.from({ length: 60 }, () =>
    makeLine("192.168.1.1", "10.0.0.99", "TCP", "RST, ACK seq=1")
  );
  const r = analyseCapture({ packets: 60, conversations: "", summary: lines.join("\n") });
  assert("rst storm → anomaly found",  r.anomalies.some(a => a.id === "tcp_rst_storm"), true);
  assert("rst storm → severity ≥ HIGH", [SEVERITY.HIGH, SEVERITY.CRITICAL].includes(r.severity), true);
  assert("trafficProfile.resets = 60", r.trafficProfile.resets, 60);
}

// ── 5. ARP storm → CRITICAL (≥20%) ───────────────────────────────────────────
console.log("\npcap-analyser: ARP storm");
{
  const normal = Array.from({ length: 75 }, () =>
    makeLine("10.0.0.1", "10.0.0.2", "TCP", "[SYN]")
  );
  const arps = Array.from({ length: 25 }, () =>
    makeLine("ff:ff:ff:ff:ff:ff", "broadcast", "ARP", "ARP who has 10.0.0.5?")
  );
  const r = analyseCapture({ packets: 100, conversations: "", summary: [...normal, ...arps].join("\n") });
  assert("arp storm critical", r.anomalies.some(a => a.id === "arp_storm"), true);
  assert("arp trafficProfile",  r.trafficProfile.arpCount, 25);
}

// ── 6. DNS failures ───────────────────────────────────────────────────────────
console.log("\npcap-analyser: DNS failures");
{
  const lines = Array.from({ length: 15 }, () =>
    makeLine("10.0.0.1", "8.8.8.8", "DNS", "Standard query response NXDOMAIN host.local")
  );
  const r = analyseCapture({ packets: 15, conversations: "", summary: lines.join("\n") });
  assert("dns failures anomaly", r.anomalies.some(a => a.id === "dns_failures"), true);
  assert("dns trafficProfile",   r.trafficProfile.dnsFailures, 15);
}

// ── 7. ICMP unreachables ──────────────────────────────────────────────────────
console.log("\npcap-analyser: ICMP unreachable");
{
  const lines = Array.from({ length: 10 }, () =>
    makeLine("10.0.0.1", "10.0.0.99", "ICMP", "Destination unreachable (port unreachable)")
  );
  const r = analyseCapture({ packets: 10, conversations: "", summary: lines.join("\n") });
  assert("icmp unreach anomaly", r.anomalies.some(a => a.id === "icmp_unreach"), true);
  assert("icmp trafficProfile",  r.trafficProfile.icmpUnreach, 10);
}

// ── 8. Traffic source dominance ────────────────────────────────────────────────
console.log("\npcap-analyser: traffic source dominance");
{
  const dominant = Array.from({ length: 80 }, () =>
    makeLine("192.168.1.99", "10.0.0.0/24", "TCP", "[SYN]")
  );
  const other = Array.from({ length: 20 }, () =>
    makeLine("10.0.0.1", "10.0.0.2", "TCP", "[ACK]")
  );
  const r = analyseCapture({ packets: 100, conversations: "", summary: [...dominant, ...other].join("\n") });
  assert("dominance anomaly", r.anomalies.some(a => a.id === "traffic_dominance"), true);
  assert("topSources first ip", r.trafficProfile.topSources[0].ip, "192.168.1.99");
}

// ── 9. Broadcast dominance ─────────────────────────────────────────────────────
console.log("\npcap-analyser: broadcast dominance");
{
  const lines = [
    ...Array.from({ length: 50 }, () => makeLine("ff:ff", "ff:ff", "ARP",  "ARP who has")),
    ...Array.from({ length: 20 }, () => makeLine("0.0.0.0", "224.0.0.251", "MDNS", "mDNS query")),
    ...Array.from({ length: 30 }, () => makeLine("10.0.0.1", "10.0.0.2", "TCP", "[ACK]"))
  ];
  const r = analyseCapture({ packets: 100, conversations: "", summary: lines.join("\n") });
  assert("broadcast dominance anomaly", r.anomalies.some(a => a.id === "broadcast_dominance" || a.id === "arp_storm"), true);
}

// ── 10. Edge: empty input ──────────────────────────────────────────────────────
console.log("\npcap-analyser: edge cases");
{
  const r = analyseCapture({ packets: 0, conversations: "", summary: "" });
  assert("empty input → NORMAL",     r.severity, SEVERITY.NORMAL);
  assert("empty input → 0 anomalies", r.anomalies.length, 0);
}
{
  const r = analyseCapture({ packets: 1, conversations: "", summary: "not\ttab\tsep\tformat" });
  assert("malformed lines → no crash", typeof r.severity, "string");
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`pcap-analyser tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(`\n${failed} test(s) FAILED`); process.exit(1); }
else console.log("All pcap-analyser tests passed.");
