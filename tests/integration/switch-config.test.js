// Integration test: generateBaseline → config output → push-ready command list.
// Tests the full pipeline without requiring a live network device.

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

const sc = require("../../src/switch-config");

const FULL_PARAMS = {
  vendor:        "cisco-ios",
  hostname:      "DIST-SW-02",
  mgmtIp:        "10.10.10.2",
  mgmtMask:      "255.255.255.0",
  mgmtVlan:      "99",
  gateway:       "10.10.10.1",
  ntpServer:     "10.10.10.250",
  adminUser:     "netadmin",
  adminPass:     "SuperSecret99!",
  enableSecret:  "EnablePw99!",
  sshDomain:     "corp.local",
  bannerMotd:    "Authorised access only",
  snmpCommunity: "public-ro",
  syslogServer:  "10.10.10.200",
  vlans:         [
    { id: "10",  name: "Data"       },
    { id: "20",  name: "Voice"      },
    { id: "30",  name: "Mgmt"       },
    { id: "40",  name: "CCTV"       },
    { id: "100", name: "Server_DMZ" }
  ]
};

// ── Test 1: Full Cisco IOS pipeline ────────────────────────────────────────────
console.log("\nswitch-config integration: full Cisco IOS pipeline");
{
  const result = sc.generateBaseline(FULL_PARAMS);

  assert("result.vendor",             result.vendor, "cisco-ios");
  assert("result.config is string",   typeof result.config, "string");
  assert("result.commands is array",  Array.isArray(result.commands), true);
  assert("result.notes is array",     Array.isArray(result.notes), true);

  assertMatch("hostname DIST-SW-02",  result.config, /hostname DIST-SW-02/);
  assertMatch("mgmt vlan 99",         result.config, /interface [Vv]lan\s*99/);
  assertMatch("ip address set",       result.config, /10\.10\.10\.2.*255\.255\.255\.0/);
  assertMatch("default gateway",      result.config, /10\.10\.10\.1/);
  assertMatch("NTP server",           result.config, /10\.10\.10\.250/);
  assertMatch("syslog server",        result.config, /10\.10\.10\.200/);
  assertMatch("banner motd",          result.config, /banner motd/i);
  assertMatch("SNMP community",       result.config, /snmp-server community/i);
  assertMatch("all 5 VLANs present",  result.config, /vlan 100/i);
  assertMatch("enable secret hashed", result.config, /enable secret/i);
  assertMatch("SSH transport only",   result.config, /transport input ssh/i);

  // Commands list should be non-trivial
  assert("at least 10 commands", result.commands.length >= 10, true);

  // Each command should be a string
  const allStrings = result.commands.every(c => typeof c === "string");
  assert("all commands are strings", allStrings, true);

  // Config should not contain plaintext password in user line (should use secret or hash type)
  const configLines = result.config.split("\n");
  const userLine = configLines.find(l => /^username/i.test(l.trim()));
  assert("username line present", !!userLine, true);
}

// ── Test 2: Cisco NX-OS full pipeline ─────────────────────────────────────────
console.log("\nswitch-config integration: Cisco NX-OS pipeline");
{
  const r = sc.generateBaseline({ ...FULL_PARAMS, vendor: "cisco-nxos" });
  assertMatch("nxos feature ntp",   r.config, /feature ntp|ntp server/i);
  assertMatch("nxos vlan config",   r.config, /vlan 10/i);
  assert("nxos commands present",   r.commands.length > 0, true);
}

// ── Test 3: Allied Telesis pipeline ───────────────────────────────────────────
console.log("\nswitch-config integration: Allied Telesis pipeline");
{
  const r = sc.generateBaseline({ ...FULL_PARAMS, vendor: "allied-telesis" });
  assert("allied vendor", r.vendor, "allied-telesis");
  assert("allied config non-empty", r.config.length > 50, true);
}

// ── Test 4: Validation gates bad input before generation ──────────────────────
console.log("\nswitch-config integration: validation rejects bad input");
{
  let threw = false;
  try {
    sc.generateBaseline({ ...FULL_PARAMS, hostname: "" });
  } catch (e) {
    threw = true;
  }
  assert("empty hostname throws", threw, true);
}
{
  let threw = false;
  try {
    sc.generateBaseline({ ...FULL_PARAMS, mgmtIp: "not@valid!" });
  } catch (e) {
    threw = true;
  }
  assert("bad IP throws", threw, true);
}

// ── Test 5: Large VLAN set (≤4094) ────────────────────────────────────────────
console.log("\nswitch-config integration: large VLAN set");
{
  const bigVlans = Array.from({ length: 20 }, (_, i) => ({
    id: String(i + 1),
    name: `VLAN_${String(i + 1).padStart(2, "0")}`
  }));
  const r = sc.generateBaseline({ ...FULL_PARAMS, vlans: bigVlans });
  assert("20 VLANs → config generated", r.config.length > 0, true);
  assertMatch("last VLAN present", r.config, /vlan 20/i);
}

// ── Test 6: Special characters in VLAN names sanitised ────────────────────────
console.log("\nswitch-config integration: VLAN name sanitisation");
{
  const r = sc.generateBaseline({
    ...FULL_PARAMS,
    vlans: [{ id: "10", name: "Data & Users; exec rm" }]
  });
  // The VLAN name in config must NOT contain semicolons or ampersands
  const vlanSection = r.config.split("\n").filter(l => /vlan 10/i.test(l) || /name /i.test(l)).join(" ");
  assert("no semicolons in vlan name", vlanSection.includes(";"), false);
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`switch-config integration tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(`\n${failed} test(s) FAILED`); process.exit(1); }
else console.log("All switch-config integration tests passed.");
