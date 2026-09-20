"use strict";
// Deterministic PCAP traffic analyser — no AI dependency.
// Consumes tshark decoded text (tab-separated fields) + conversation stats
// and returns structured severity-annotated findings.
// Follows SRP: pure analysis, no I/O, no side effects.

const SEVERITY = Object.freeze({ NORMAL: "normal", HIGH: "high", CRITICAL: "critical" });

const RETRANSMIT_RE = /\[TCP Retransmission\]|\[TCP Out-Of-Order\]|\[TCP Dup ACK\]|\[TCP Fast Retransmission\]/i;
const RST_RE        = /RST,\s*ACK|\[TCP RST\]/i;
const ICMP_UNREACH  = /unreachable|port unreachable|host unreachable/i;
const DNS_FAIL_RE   = /NXDOMAIN|No such name/i;
const ARP_RE        = /ARP.*who.has|ARP.*Reply/i;

// Protocols that are predominantly broadcast/multicast — elevated ratios are anomalous
const BROADCAST_PROTOS = new Set(["ARP", "LLDP", "STP", "CDP", "MDNS", "SSDP", "LLC", "LOOP"]);

/**
 * Analyse a completed capture.
 * @param {{ packets: number, conversations: string, summary: string }} capture
 * @returns {{ severity, anomalies, trafficProfile, humanSummary }}
 */
function analyseCapture({ packets, conversations, summary }) {
  const lines   = String(summary || "").split("\n").filter(Boolean);
  const anomalies = [];

  const counts = {
    total:       Number(packets) || lines.length,
    retransmits: 0,
    resets:      0,
    arpCount:    0,
    dnsFailures: 0,
    icmpUnreach: 0,
    protocols:   {},
    sources:     {},
    dests:       {}
  };

  for (const line of lines) {
    const [, src, dst, proto, info] = line.split("\t");
    if (proto) counts.protocols[proto] = (counts.protocols[proto] || 0) + 1;
    if (src)   counts.sources[src]     = (counts.sources[src]     || 0) + 1;
    if (dst)   counts.dests[dst]       = (counts.dests[dst]       || 0) + 1;

    const i = String(info || "");
    if (RETRANSMIT_RE.test(i)) counts.retransmits++;
    if (RST_RE.test(i))        counts.resets++;
    if (ARP_RE.test(i))        counts.arpCount++;
    if (DNS_FAIL_RE.test(i))   counts.dnsFailures++;
    if (ICMP_UNREACH.test(i))  counts.icmpUnreach++;
  }

  const total = counts.total || 1; // avoid divide-by-zero

  // ── 1. TCP retransmission rate ──────────────────────────────────────────────
  const rexmitPct = (counts.retransmits / total) * 100;
  if (rexmitPct >= 15) {
    anomalies.push({
      id: "tcp_retransmit_critical", severity: SEVERITY.CRITICAL,
      title: "Critical TCP Retransmission Rate",
      detail: `${counts.retransmits} retransmissions (${rexmitPct.toFixed(1)}%). Likely causes: congestion, link errors, duplex mismatch.`,
      recommendation: "Run 'show interfaces' — look for input/output errors and CRC counts. Check duplex/speed negotiation."
    });
  } else if (rexmitPct >= 5) {
    anomalies.push({
      id: "tcp_retransmit_high", severity: SEVERITY.HIGH,
      title: "Elevated TCP Retransmissions",
      detail: `${counts.retransmits} retransmissions (${rexmitPct.toFixed(1)}%). Possible intermittent congestion or marginal cable.`,
      recommendation: "Check interface error counters. Review QoS policies and buffer thresholds."
    });
  }

  // ── 2. TCP RST storm ────────────────────────────────────────────────────────
  if (counts.resets > 50) {
    anomalies.push({
      id: "tcp_rst_storm", severity: SEVERITY.HIGH,
      title: "High TCP Reset Volume",
      detail: `${counts.resets} TCP RST segments detected. Possible firewall ACL drops, port scans, or application crashes.`,
      recommendation: "Identify source IPs generating RSTs. Check ACLs and application health endpoints."
    });
  }

  // ── 3. ARP storm ────────────────────────────────────────────────────────────
  const arpPct = (counts.arpCount / total) * 100;
  if (arpPct >= 20) {
    anomalies.push({
      id: "arp_storm", severity: SEVERITY.CRITICAL,
      title: "ARP Storm Detected",
      detail: `${counts.arpCount} ARP packets (${arpPct.toFixed(1)}% of capture). Indicates broadcast storm or IP conflict.`,
      recommendation: "Isolate the offending subnet. Check for duplicate IPs ('show arp'), rogue DHCP, and enable ARP inspection."
    });
  } else if (arpPct >= 10) {
    anomalies.push({
      id: "arp_elevated", severity: SEVERITY.HIGH,
      title: "Elevated ARP Traffic",
      detail: `${counts.arpCount} ARP packets (${arpPct.toFixed(1)}%). May indicate IP conflict or high host churn.`,
      recommendation: "Check for duplicate IPs on the subnet with 'show arp | count'."
    });
  }

  // ── 4. DNS failures ─────────────────────────────────────────────────────────
  if (counts.dnsFailures >= 10) {
    anomalies.push({
      id: "dns_failures", severity: SEVERITY.HIGH,
      title: "Repeated DNS Failures (NXDOMAIN)",
      detail: `${counts.dnsFailures} DNS failures detected. Clients may have wrong DNS servers or misconfigured lookups.`,
      recommendation: "Verify DNS server reachability with 'dig @<server> <domain>'. Review split-DNS policy."
    });
  }

  // ── 5. ICMP unreachables ─────────────────────────────────────────────────────
  if (counts.icmpUnreach >= 5) {
    anomalies.push({
      id: "icmp_unreach", severity: SEVERITY.HIGH,
      title: "ICMP Unreachable Bursts",
      detail: `${counts.icmpUnreach} ICMP Unreachable messages. Indicates routing black-holes or missing return paths.`,
      recommendation: "Check routing table for missing entries ('show ip route'). Verify destination hosts are up."
    });
  }

  // ── 6. Traffic source dominance (possible scan/flood) ───────────────────────
  const sortedSrc = Object.entries(counts.sources).sort((a, b) => b[1] - a[1]);
  if (sortedSrc.length && counts.total > 20) {
    const [topSrc, topCount] = sortedSrc[0];
    const domPct = (topCount / total) * 100;
    if (domPct > 70) {
      anomalies.push({
        id: "traffic_dominance", severity: SEVERITY.HIGH,
        title: "Single Source Dominating Traffic",
        detail: `${topSrc} generated ${topCount} packets (${domPct.toFixed(1)}%). Possible scan, flood, or misconfigured service.`,
        recommendation: `Investigate ${topSrc}. Check access-lists and rate-limiting policies on the ingress port.`
      });
    }
  }

  // ── 7. Broadcast/multicast dominance ────────────────────────────────────────
  const broadcastCount = Array.from(BROADCAST_PROTOS)
    .reduce((sum, p) => sum + (counts.protocols[p] || 0), 0);
  const broadcastPct = (broadcastCount / total) * 100;
  if (counts.total > 30 && broadcastPct > 40) {
    anomalies.push({
      id: "broadcast_dominance", severity: SEVERITY.HIGH,
      title: "High Broadcast/Multicast Ratio",
      detail: `${broadcastPct.toFixed(1)}% of traffic is broadcast/multicast. Healthy networks are typically below 20%.`,
      recommendation: "Enable storm-control on access ports. Verify STP topology is stable and not re-converging."
    });
  }

  // ── Derive overall severity ──────────────────────────────────────────────────
  const severity = anomalies.some(a => a.severity === SEVERITY.CRITICAL) ? SEVERITY.CRITICAL
                 : anomalies.some(a => a.severity === SEVERITY.HIGH)     ? SEVERITY.HIGH
                 : SEVERITY.NORMAL;

  const topProtocols = Object.entries(counts.protocols)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([proto, count]) => ({ proto, count }));

  const topSources = sortedSrc.slice(0, 5).map(([ip, count]) => ({ ip, count }));

  return {
    severity,
    anomalies,
    trafficProfile: {
      totalPackets: counts.total,
      retransmits:  counts.retransmits,
      resets:       counts.resets,
      arpCount:     counts.arpCount,
      dnsFailures:  counts.dnsFailures,
      icmpUnreach:  counts.icmpUnreach,
      topProtocols,
      topSources
    },
    humanSummary: _buildSummary(severity, anomalies, counts)
  };
}

function _buildSummary(severity, anomalies, counts) {
  const label = severity.toUpperCase();
  const out   = [`Traffic Status: ${label} (${counts.total} packets analysed)`];

  if (!anomalies.length) {
    out.push("No anomalies detected. Traffic appears healthy.");
  } else {
    for (const a of anomalies) {
      out.push(`\n[${a.severity.toUpperCase()}] ${a.title}`);
      out.push(`  ${a.detail}`);
      out.push(`  → ${a.recommendation}`);
    }
  }

  const topProtos = Object.entries(counts.protocols)
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => p).join(", ");
  if (topProtos) out.push(`\nTop protocols: ${topProtos}`);

  return out.join("\n");
}

module.exports = { analyseCapture, SEVERITY };
