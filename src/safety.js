// Command safety classifier.
// Every AI-proposed command passes through here BEFORE it can be run.
// Levels: "safe" | "caution" | "danger"
// The main process gate is authoritative; the renderer also shows warnings.

const DANGER_PATTERNS = [
  /\berase\b/i,
  /\bwrite\s+erase\b/i,
  /\bformat\b/i,
  /\bdelete\b/i,
  /\bfactory[- ]?(default|reset)\b/i,
  /\bboot\s+system\b/i,
  /\brm\s+-rf\b/i,
  /\bwipe\b/i,
  /\bzeroize\s+(all|key-pair|rsa|ecdsa)\b/i,
  /\bno\s+startup-config\b/i,
  /\bformat\s+flash\b/i
];

const CAUTION_PATTERNS = [
  /\breload\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /^\s*no\s+interface\b/i,
  /^\s*no\s+vlan\b/i,
  /\bspanning-tree\s+mode\b/i,
  /\benable\s+(secret|password)\b/i,
  /\busername\b.*\bpassword\b/i,
  /\bip\s+address\b/i,
  /\bno\s+ip\s+address\b/i,
  /\bcrypto\s+key\s+zeroize\b/i,
  /\bvtp\s+mode\b/i,
  /\bno\s+access-list\b/i,
  /\bno\s+ip\s+access-group\b/i,
  /\bno\s+firewall\b/i,
  /\bno\s+crypto\b/i,
  /\bservice\s+password-encryption\b/i,
  /\bno\s+spanning-tree\b/i,
  /\bredistribute\b/i,
  /\bno\s+router\b/i,
  /\bclear\s+ip\s+route\b/i,
  /\bclear\s+arp\b/i,
  /\bsystem\s+(restart|shutdown)\b/i,
  /\bdiagnose\s+sys\s+kill\b/i,
  /execute\s+factoryreset\b/i
];

function classifyCommand(cmd) {
  const c = String(cmd || "").trim();
  if (!c) return { level: "safe", reason: "" };
  for (const p of DANGER_PATTERNS) {
    if (p.test(c)) {
      return {
        level: "danger",
        reason: "Destructive command — can permanently wipe config or files. Back up the running config first and confirm this is intentional."
      };
    }
  }
  for (const p of CAUTION_PATTERNS) {
    if (p.test(c)) {
      return {
        level: "caution",
        reason: "Disruptive command — may reboot the device, take down links, or cut your management session. Confirm a maintenance window before running."
      };
    }
  }
  return { level: "safe", reason: "" };
}

module.exports = { classifyCommand, DANGER_PATTERNS, CAUTION_PATTERNS };
