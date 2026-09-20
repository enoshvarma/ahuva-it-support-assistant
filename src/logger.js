// Structured multi-level logger. Writes to stdout and a rotating log file.
// Usage: const log = require('./logger').child('module-name');
//        log.info('message', { key: 'value' });

const fs = require("fs");
const path = require("path");
const os = require("os");

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_NAMES = ["DEBUG", "INFO ", "WARN ", "ERROR"];

const configuredLevel = LEVELS[String(process.env.AHUVA_LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;

let logFileStream = null;
let logFilePath = null;

function initFileLogging(logDir) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    logFilePath = path.join(logDir, `ahuva-${stamp}.log`);
    logFileStream = fs.createWriteStream(logFilePath, { flags: "a" });
  } catch {
    // File logging is best-effort; console always works.
  }
}

function formatLine(level, module, msg, data) {
  const ts = new Date().toISOString();
  const lvl = LEVEL_NAMES[level] || "?    ";
  const base = `[${ts}] ${lvl} [${module}] ${msg}`;
  const extra = data && Object.keys(data).length ? " " + JSON.stringify(data) : "";
  return base + extra;
}

function write(level, module, msg, data) {
  if (level < configuredLevel) return;
  const line = formatLine(level, module, msg, data);
  if (level >= LEVELS.warn) {
    console.error(line);
  } else {
    console.log(line);
  }
  if (logFileStream) {
    try { logFileStream.write(line + os.EOL); } catch { /* swallow */ }
  }
}

function child(module) {
  return {
    debug: (msg, data) => write(LEVELS.debug, module, msg, data),
    info:  (msg, data) => write(LEVELS.info,  module, msg, data),
    warn:  (msg, data) => write(LEVELS.warn,  module, msg, data),
    error: (msg, data) => write(LEVELS.error, module, msg, data)
  };
}

module.exports = { child, initFileLogging, logFilePath: () => logFilePath };
