// Input validation / sanitisation for all external-facing inputs.
// Centralised here so injection surfaces are auditable in one file.

// Matches a valid IPv4 address
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
// Matches a valid hostname (RFC 1123): labels up to 63 chars, total up to 253
const HOSTNAME_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$/;

function isValidHost(h) {
  const s = String(h || "").trim();
  if (!s || s.length > 253) return false;
  return IPV4_RE.test(s) || HOSTNAME_RE.test(s);
}

function isValidPort(p) {
  const n = Number(p);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

// Serial port path: COM1-COM256 on Windows, /dev/tty* on Unix
function isValidSerialPort(p) {
  const s = String(p || "").trim();
  return /^COM\d{1,3}$/i.test(s) || /^\/dev\/tty[A-Za-z0-9]+$/.test(s);
}

// Baud rate: standard values only
const VALID_BAUDS = new Set([300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400, 460800, 921600]);
function isValidBaudRate(b) {
  return VALID_BAUDS.has(Number(b));
}

// Username: printable ASCII, no control chars, max 64 chars
function isValidUsername(u) {
  const s = String(u || "");
  return s.length >= 1 && s.length <= 64 && /^[\x20-\x7E]+$/.test(s);
}

// CLI command: reject anything with shell meta-chars that should never appear in
// a network device command. These chars would only matter if someone tried to
// inject a shell command into the send path.
const SHELL_INJECT_RE = /[;&|`$(){}[\]<>\\]/;
function sanitiseCommand(cmd) {
  const s = String(cmd || "").trimEnd();
  // Allow up to 512 chars; strip trailing whitespace; reject shell metacharacters
  if (s.length > 512) throw new Error("Command too long (max 512 chars).");
  if (SHELL_INJECT_RE.test(s)) throw new Error("Command contains disallowed characters.");
  return s;
}

// Capture filter (BPF expression): allow printable ASCII, limit length
function sanitiseCaptureFilter(f) {
  const s = String(f || "").trim();
  if (s.length > 256) throw new Error("Capture filter too long (max 256 chars).");
  // Reject shell metacharacters in BPF filter passed to tshark -f
  if (/[;&|`$()\\<>]/.test(s)) throw new Error("Capture filter contains disallowed characters.");
  return s;
}

// IP range / CIDR: simple validation
const CIDR_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\/(?:[12]?\d|3[012]))?$/;
function isValidCIDR(c) {
  return CIDR_RE.test(String(c || "").trim());
}

module.exports = {
  isValidHost,
  isValidPort,
  isValidSerialPort,
  isValidBaudRate,
  isValidUsername,
  sanitiseCommand,
  sanitiseCaptureFilter,
  isValidCIDR
};
