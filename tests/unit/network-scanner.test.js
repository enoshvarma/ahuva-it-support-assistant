// Unit tests for network-scanner pure functions (no network I/O).
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

const scanner = require("../../src/network-scanner");

// ── parseRange ────────────────────────────────────────────────────────────────
console.log("\nnetwork-scanner: parseRange");
{
  const single = scanner.parseRange("10.0.0.1");
  assert("single IP yields 1 host", single.length, 1);
  assert("single IP value", single[0], "10.0.0.1");
}
{
  const range = scanner.parseRange("192.168.1.1-192.168.1.3");
  assert("dash range length", range.length, 3);
  assert("dash range first", range[0], "192.168.1.1");
  assert("dash range last", range[2], "192.168.1.3");
}
{
  const cidr = scanner.parseRange("10.0.0.0/30");
  // /30 = 4 addresses, 2 usable hosts (skip .0 network and .3 broadcast)
  assert("CIDR /30 usable hosts", cidr.length, 2);
  assert("CIDR /30 first", cidr[0], "10.0.0.1");
  assert("CIDR /30 last", cidr[1], "10.0.0.2");
}
{
  const cidr24 = scanner.parseRange("192.168.1.0/24");
  assert("CIDR /24 yields 254 hosts", cidr24.length, 254);
}

// ── macVendor OUI lookup ──────────────────────────────────────────────────────
console.log("\nnetwork-scanner: macVendor");
{
  assert("Cisco OUI", scanner.macVendor("00:00:0C:11:22:33"), "Cisco");
  assert("unknown OUI returns empty", scanner.macVendor("FF:FF:FF:00:00:00"), "");
  assert("empty MAC returns empty",   scanner.macVendor(""), "");
  assert("lowercase MAC", scanner.macVendor("00:00:0c:aa:bb:cc"), "Cisco");
}

// ── ENTERPRISE_PORTS constant (object map port→service) ───────────────────────
console.log("\nnetwork-scanner: port lists");
{
  assert("ENTERPRISE_PORTS SSH 22",   scanner.ENTERPRISE_PORTS[22],   "SSH");
  assert("ENTERPRISE_PORTS RDP 3389", scanner.ENTERPRISE_PORTS[3389], "RDP");
  assert("ENTERPRISE_PORTS SMB 445",  scanner.ENTERPRISE_PORTS[445],  "SMB");
  assert("QUICK_PORTS is array", Array.isArray(scanner.QUICK_PORTS), true);
  assert("QUICK_PORTS includes 22",   scanner.QUICK_PORTS.includes(22),   true);
  assert("QUICK_PORTS includes 3389", scanner.QUICK_PORTS.includes(3389), true);
  assert("QUICK_PORTS subset of ENTERPRISE",
    scanner.QUICK_PORTS.every(p => scanner.ENTERPRISE_PORTS[p] !== undefined), true);
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
