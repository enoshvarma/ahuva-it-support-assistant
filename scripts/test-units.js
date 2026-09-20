// Minimal unit tests — run with: node scripts/test-units.js
// No test framework dependency. Exit code 0 = pass, non-zero = fail.

let passed = 0;
let failed = 0;

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

function section(title) { console.log(`\n${title}`); }

// ---- validate.js ----
section("validate.js");
const v = require("../src/validate");
assert("valid IPv4",            v.isValidHost("192.168.1.1"), true);
assert("valid hostname",        v.isValidHost("switch.corp"), true);
assert("invalid host empty",    v.isValidHost(""),            false);
assert("valid port 22",         v.isValidPort(22),            true);
assert("invalid port 0",        v.isValidPort(0),             false);
assert("invalid port 99999",    v.isValidPort(99999),         false);
assert("valid COM port",        v.isValidSerialPort("COM3"),   true);
assert("valid tty port",        v.isValidSerialPort("/dev/ttyUSB0"), true);
assert("invalid serial port",   v.isValidSerialPort("ttyUSB0"), false);
assert("valid baud 9600",       v.isValidBaudRate(9600),       true);
assert("invalid baud 12345",    v.isValidBaudRate(12345),      false);
assert("valid username",        v.isValidUsername("admin"),    true);
assert("invalid username empty",v.isValidUsername(""),         false);

let threw = false;
try { v.sanitiseCommand("show version; rm -rf /"); } catch { threw = true; }
assert("sanitise blocks semicolon injection", threw, true);

threw = false;
try { v.sanitiseCommand("show version | grep X"); } catch { threw = true; }
assert("sanitise blocks pipe", threw, true);

assert("sanitise allows normal cmd", v.sanitiseCommand("show running-config"), "show running-config");

// ---- safety.js ----
section("safety.js");
const { classifyCommand } = require("../src/safety");
assert("erase -> danger",         classifyCommand("erase startup-config").level,    "danger");
assert("write erase -> danger",   classifyCommand("write erase").level,             "danger");
assert("reload -> caution",       classifyCommand("reload").level,                  "caution");
assert("shutdown -> caution",     classifyCommand("shutdown").level,                "caution");
assert("ip address -> caution",   classifyCommand("ip address 10.0.0.1").level,     "caution");
assert("show version -> safe",    classifyCommand("show version").level,            "safe");
assert("show arp -> safe",        classifyCommand("show arp").level,                "safe");
assert("empty cmd -> safe",       classifyCommand("").level,                        "safe");

// ---- mode.js ----
section("mode.js");
const { detectCliMode } = require("../src/mode");
assert("user mode", detectCliMode("switch>").mode, "user");
assert("priv mode", detectCliMode("switch#").mode, "priv");
assert("config mode", detectCliMode("switch(config)#").mode, "config");
assert("config-if mode", detectCliMode("switch(config-if)#").mode, "config-if");
assert("auth mode", detectCliMode("Password:").mode, "auth");
assert("paging mode", detectCliMode("--More--").mode, "paging");

// ---- detect.js ----
section("detect.js");
const { fingerprintDevice, parseArpTable, parsePingOutput } = require("../src/detect");

const ciscoOut = "Cisco IOS Software, Catalyst L3 Switch, Version 15.2\nswitch uptime is 1 day";
const fp = fingerprintDevice(ciscoOut);
assert("fingerprint Cisco", fp.vendor, "Cisco");
assert("fingerprint Cisco type", fp.type, "Switch");

const awOut = "AlliedWare Plus 5.5.0 AT-x950-28XTQm";
const fp2 = fingerprintDevice(awOut);
assert("fingerprint Allied Telesis", fp2.vendor, "Allied Telesis");

const arpTable = `Protocol  Address    Age  Hardware Addr    Type  Interface
Internet  10.0.0.1   -    aabb.cc00.0100   ARPA  Vlan1
Internet  10.0.0.2   10   aabb.cc00.0200   ARPA  Vlan1`;
const arpEntries = parseArpTable(arpTable);
assert("ARP parse count", arpEntries.length, 2);
assert("ARP parse IP", arpEntries[0].ip, "10.0.0.1");

const pingOut = "Success rate is 100 percent (5/5), round-trip min/avg/max = 1/2/5 ms";
const ping = parsePingOutput(pingOut);
assert("ping parse avg RTT", ping.avgRtt, 2);
assert("ping parse loss", ping.packetLoss, 0);
assert("ping parse jitter", ping.jitter, 4);

// ---- ai-providers.js ----
section("ai-providers.js");
const { parseCopilotReply, buildRequest } = require("../src/ai-providers");
const clean = parseCopilotReply('{"reply":"ok","commands":[{"cmd":"show version","why":"check firmware"}],"needs":[]}');
assert("parse reply", clean.reply, "ok");
assert("parse commands length", clean.commands.length, 1);
assert("parse cmd", clean.commands[0].cmd, "show version");

const fenced = parseCopilotReply('```json\n{"reply":"ok","commands":[],"needs":[]}\n```');
assert("parse fenced JSON", fenced.reply, "ok");

const bad = parseCopilotReply("Sorry, I cannot help with that.");
assert("parse fallback", bad.reply, "Sorry, I cannot help with that.");

// ---- telemetry.js ----
section("telemetry.js");
const tel = require("../src/telemetry");
const ev = tel.buildEvent("connect", { appVersion: "1.5.0", brand: "Cisco", conn: "ssh" }, { engineerName: "Alice" });
assert("telemetry event type", ev.type, "connect");
assert("telemetry engineer", ev.engineer, "Alice");
assert("telemetry no API key", Object.keys(ev).includes("apiKey"), false);

// ---- Summary ----
console.log(`\n${"─".repeat(40)}`);
console.log(`Tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(`\n${failed} test(s) FAILED`); process.exit(1); }
else console.log("All tests passed.");
