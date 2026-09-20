// Detects the switch CLI mode from the live terminal buffer so commands are
// never fired in the wrong mode (the exact failure seen on site: running
// "show running-config" while still in user-exec ">" mode).

function detectCliMode(buffer) {
  const clean = String(buffer || "")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\r/g, "");
  const lines = clean.split("\n").map(l => l.trimEnd()).filter(l => l.trim().length);
  const last = lines[lines.length - 1] || "";

  if (/(password|passcode)\s*[:：]?\s*$/i.test(last)) return { mode: "auth", prompt: last, label: "Login required" };
  if (/(login|username|user name)\s*[:：]?\s*$/i.test(last)) return { mode: "auth", prompt: last, label: "Login required" };
  // paging must be checked BEFORE prompt chars, since "<--- more --->" ends in ">"
  if (/--\s*more\s*--/i.test(last) || /press any key to continue/i.test(last) ||
      /<--- more --->/i.test(last) || (/lines \d+-\d+/.test(last) && /more/i.test(last)))
    return { mode: "paging", prompt: last, label: "Paged output" };
  if (/\(config-if[^)]*\)#\s*$/.test(last)) return { mode: "config-if", prompt: last, label: "Interface config" };
  if (/\(config[^)]*\)#\s*$/.test(last)) return { mode: "config", prompt: last, label: "Global config" };
  if (/#\s*$/.test(last)) return { mode: "priv", prompt: last, label: "Privileged (#)" };
  if (/>\s*$/.test(last)) return { mode: "user", prompt: last, label: "User exec (>)" };
  return { mode: "unknown", prompt: last, label: "Unknown" };
}

// Given the current mode and a command, return prep commands needed first.
// e.g. user mode + "show running-config" -> ["enable"]
//      priv mode + "vlan database"       -> ["configure terminal"]
const CONFIG_STARTERS = /^(vlan\b|interface\b|hostname\b|ip route\b|spanning-tree\b|username\b|line\b|banner\b|snmp-server\b|ntp\b|no\s+(vlan|interface)\b|errdisable\b|power-inline\b)/i;
const PRIV_ONLY = /^(show\s+running-config|show\s+startup-config|copy\b|write\b|configure\b|reload\b|terminal\s+length\b|erase\b|delete\b|dir\b|ping\b|traceroute\b|clear\b)/i;

function prepCommandsFor(mode, cmd) {
  const c = String(cmd || "").trim();
  const prep = [];
  if (mode === "user") {
    if (PRIV_ONLY.test(c) || CONFIG_STARTERS.test(c)) prep.push("enable");
    if (CONFIG_STARTERS.test(c)) prep.push("configure terminal");
  } else if (mode === "priv") {
    if (CONFIG_STARTERS.test(c)) prep.push("configure terminal");
  } else if ((mode === "config" || mode === "config-if")) {
    // show/copy from config mode: AW+ & modern IOS accept "do"
    if (/^(show|copy|write|ping)\b/i.test(c) && !/^do\s/i.test(c)) prep.push("__DO_PREFIX__");
  }
  return prep;
}

// Cleans captured terminal text: strips --More-- pager lines, the backspace
// sequences devices use to erase them, and "press any key" artifacts, so
// backups and AI context contain pure config/output.
function cleanPagedOutput(text) {
  return String(text || "")
    .replace(/[^\S\n]*--\s*more\s*--[^\S\n]*/gi, "")
    .replace(/<--- more --->/gi, "")
    .replace(/press any key to continue.*$/gim, "")
    .replace(/[^\x08\n]\x08/g, "")       // char+backspace = erased char
    .replace(/\x08+/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

module.exports = { detectCliMode, prepCommandsFor, cleanPagedOutput };
