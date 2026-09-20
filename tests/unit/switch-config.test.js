// Unit tests for src/switch-config.js
// Run via: node scripts/test-units.js  OR  node tests/unit/switch-config.test.js

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

const BASE_PARAMS = {
  vendor:      "cisco-ios",
  hostname:    "CORE-SW-01",
  mgmtIp:      "192.168.1.254",
  mgmtMask:    "255.255.255.0",
  mgmtVlan:    "1",
  gateway:     "192.168.1.1",
  adminUser:   "admin",
  adminPass:   "Password1!",
  enableSecret:"Secret1!",
  vlans:       [{ id: "10", name: "Data" }, { id: "20", name: "Voice" }]
};

// ── validateParams ────────────────────────────────────────────────────────────
console.log("\nswitch-config: validateParams");
{
  assert("valid params → no errors", sc.validateParams(BASE_PARAMS).length, 0);
}
{
  const errs = sc.validateParams({ ...BASE_PARAMS, hostname: "" });
  assert("missing hostname → error", errs.length > 0, true);
}
{
  const errs = sc.validateParams({ ...BASE_PARAMS, mgmtIp: "not@valid!" });
  assert("invalid IP → error", errs.some(e => /ip/i.test(e)), true);
}
{
  const errs = sc.validateParams({ ...BASE_PARAMS, mgmtMask: "bad-mask" });
  assert("invalid mask → error", errs.some(e => /mask/i.test(e)), true);
}
{
  const errs = sc.validateParams({ ...BASE_PARAMS, vendor: "unknown-vendor" });
  assert("unknown vendor → error", errs.some(e => /vendor/i.test(e)), true);
}
{
  const errs = sc.validateParams({ ...BASE_PARAMS, vlans: [{ id: "abc", name: "Bad" }] });
  assert("invalid VLAN id → error", errs.some(e => /vlan/i.test(e)), true);
}

// ── generateBaseline — Cisco IOS ──────────────────────────────────────────────
console.log("\nswitch-config: Cisco IOS baseline");
{
  const r = sc.generateBaseline(BASE_PARAMS);
  assert("result vendor", r.vendor, "cisco-ios");
  assertMatch("hostname in config",  r.config, /hostname CORE-SW-01/);
  assertMatch("management IP",       r.config, /192\.168\.1\.254/);
  assertMatch("VLAN 10 in config",   r.config, /vlan 10/i);
  assertMatch("VLAN 20 in config",   r.config, /vlan 20/i);
  assertMatch("enable secret",       r.config, /enable secret/);
  assertMatch("username line",       r.config, /username admin/);
  assertMatch("SSH domain or transport", r.config, /ip ssh|transport input ssh/i);
  assert("commands array non-empty", Array.isArray(r.commands) && r.commands.length > 0, true);
  assert("notes array present",      Array.isArray(r.notes), true);
}

// ── generateBaseline — Cisco NX-OS ────────────────────────────────────────────
console.log("\nswitch-config: Cisco NX-OS baseline");
{
  const r = sc.generateBaseline({ ...BASE_PARAMS, vendor: "cisco-nxos" });
  assert("nxos vendor", r.vendor, "cisco-nxos");
  assertMatch("nxos feature ssh", r.config, /feature ssh/i);
  assertMatch("nxos hostname", r.config, /hostname CORE-SW-01/);
}

// ── generateBaseline — MikroTik ───────────────────────────────────────────────
console.log("\nswitch-config: MikroTik baseline");
{
  const r = sc.generateBaseline({ ...BASE_PARAMS, vendor: "mikrotik" });
  assert("mikrotik vendor", r.vendor, "mikrotik");
  assertMatch("mikrotik /ip address", r.config, /\/ip address/i);
}

// ── generateBaseline — FortiGate ──────────────────────────────────────────────
console.log("\nswitch-config: FortiGate baseline");
{
  const r = sc.generateBaseline({ ...BASE_PARAMS, vendor: "fortinet" });
  assert("fortinet vendor", r.vendor, "fortinet");
  assertMatch("fortinet config system global", r.config, /config system global/i);
}

// ── generateBaseline — Juniper ────────────────────────────────────────────────
console.log("\nswitch-config: Juniper baseline");
{
  const r = sc.generateBaseline({ ...BASE_PARAMS, vendor: "juniper" });
  assert("juniper vendor", r.vendor, "juniper");
  assertMatch("juniper set system", r.config, /set system/i);
}

// ── generateBaseline — generic ────────────────────────────────────────────────
console.log("\nswitch-config: generic baseline");
{
  const r = sc.generateBaseline({ ...BASE_PARAMS, vendor: "generic" });
  assert("generic vendor", r.vendor, "generic");
  assert("generic config non-empty", r.config.length > 0, true);
}

// ── edge: no VLANs ────────────────────────────────────────────────────────────
console.log("\nswitch-config: edge cases");
{
  const r = sc.generateBaseline({ ...BASE_PARAMS, vlans: [] });
  assert("no vlans → config generated", r.config.length > 0, true);
}
{
  const r = sc.generateBaseline({ ...BASE_PARAMS, vlans: [{ id: "4094", name: "Max VLAN" }] });
  assertMatch("vlan 4094 in config", r.config, /4094/);
}

// ── SUPPORTED_VENDORS exported ────────────────────────────────────────────────
console.log("\nswitch-config: SUPPORTED_VENDORS");
{
  assert("vendors is array",           Array.isArray(sc.SUPPORTED_VENDORS), true);
  assert("cisco-ios in vendors",       sc.SUPPORTED_VENDORS.includes("cisco-ios"), true);
  assert("mikrotik in vendors",        sc.SUPPORTED_VENDORS.includes("mikrotik"), true);
  assert("at least 6 vendors",         sc.SUPPORTED_VENDORS.length >= 6, true);
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`switch-config tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(`\n${failed} test(s) FAILED`); process.exit(1); }
else console.log("All switch-config tests passed.");
