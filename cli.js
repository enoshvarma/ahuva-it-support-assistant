#!/usr/bin/env node
// Ahuva IT Support Assistant — Terminal CLI (Termux / headless Linux)
// Provides the same core functionality as the Electron GUI but runs in any
// terminal: SSH/Telnet/serial sessions, AI copilot, network scanner,
// switch config generator, knowledge base, and packet capture.

"use strict";

const readline = require("readline");
const path     = require("path");
const fs       = require("fs");
const os       = require("os");

const { initFileLogging } = require("./src/logger");
const log = require("./src/logger").child("cli");

const { DeviceSession, listSerialPorts } = require("./src/session");
const { KnowledgeBase }                  = require("./src/kb");
const { callAI }                         = require("./src/ai-providers");
const { classifyCommand }                = require("./src/safety");
const { buildSystemPrompt }              = require("./src/prompt");
const { detectCliMode, prepCommandsFor } = require("./src/mode");
const { fingerprintDevice, PROBE_COMMANDS, arpDiscoveryCommands, parsePingOutput } = require("./src/detect");
const { ErrorLog, extractErrors }        = require("./src/errorlog");
const models                             = require("./src/models");
const { sanitiseCommand }                = require("./src/validate");
const switchConfig                       = require("./src/switch-config");
const scanner                            = require("./src/network-scanner");
const pkg                                = require("./package.json");

// ── Colours ────────────────────────────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  cyan:    "\x1b[36m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  magenta: "\x1b[35m",
  blue:    "\x1b[34m",
  white:   "\x1b[37m",
};

function clr(c, text) { return `${c}${text}${C.reset}`; }

// ── Paths ──────────────────────────────────────────────────────────────────────
const userDataDir  = process.env.AHUVA_USER_DATA || path.join(os.homedir(), ".ahuva-it-assistant");
const settingsPath = path.join(userDataDir, "settings.json");
const userDocsDir  = path.join(userDataDir, "docs");
const logsDir      = path.join(userDataDir, "logs");

for (const dir of [userDataDir, userDocsDir, logsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

initFileLogging(logsDir);

// ── Settings ───────────────────────────────────────────────────────────────────
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath, "utf8")); }
  catch { return { provider: "", model: "", apiKey: "", baseUrl: "" }; }
}

function saveSettings(s) {
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), "utf8");
}

// ── State ──────────────────────────────────────────────────────────────────────
const session       = new DeviceSession();
const kb            = new KnowledgeBase(path.join(__dirname, "kb"), userDocsDir);
const errorLog      = new ErrorLog(userDataDir);
let terminalBuffer  = "";
let sessionInfo     = { connType: "", host: "", port: "", brand: "", model: "", task: "" };
let sessionErrors   = [];

session.on("data", chunk => {
  process.stdout.write(chunk);
  terminalBuffer += chunk;
  if (terminalBuffer.length > 12000) terminalBuffer = terminalBuffer.slice(-8000);
});
session.on("closed", reason => console.log(clr(C.yellow, `\n[Session closed: ${reason}]`)));
session.on("error",  msg    => console.log(clr(C.red,    `\n[Session error: ${msg}]`)));

// ── Readline ───────────────────────────────────────────────────────────────────
const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
  prompt: clr(C.cyan, "ahuva> "),
});

function ask(q) {
  return new Promise(resolve => rl.question(clr(C.yellow, q + " "), resolve));
}

// ── Banner ─────────────────────────────────────────────────────────────────────
function showBanner() {
  console.log("");
  console.log(clr(C.cyan, "  ╔══════════════════════════════════════════════════════╗"));
  console.log(clr(C.cyan, "  ║   Ahuva IT Support Assistant  •  Terminal CLI        ║"));
  console.log(clr(C.cyan, `  ║   v${pkg.version}  •  ${os.platform()}/${os.arch()}                            ║`));
  console.log(clr(C.cyan, "  ╚══════════════════════════════════════════════════════╝"));
  console.log("");
  console.log(clr(C.dim,  "  Type 'help' for commands. Works on Termux, Linux, macOS."));
  console.log("");
}

// ── Help ───────────────────────────────────────────────────────────────────────
function showHelp() {
  console.log(`
${clr(C.bold + C.cyan, "CONNECTION")}
  ${clr(C.green, "ssh")}         Connect via SSH (interactive prompts)
  ${clr(C.green, "telnet")}      Connect via Telnet
  ${clr(C.green, "serial")}      Connect via serial port (USB OTG on Termux)
  ${clr(C.green, "disconnect")}  Disconnect current session
  ${clr(C.green, "send <cmd>")} Send a raw command to the connected device

${clr(C.bold + C.cyan, "AI COPILOT")}
  ${clr(C.green, "ask <question>")}  Ask the AI copilot for help
  ${clr(C.green, "detect")}          Auto-detect the connected device vendor/model
  ${clr(C.green, "task <desc>")}     Set the current task description

${clr(C.bold + C.cyan, "NETWORK TOOLS")}
  ${clr(C.green, "scan <target>")}     Scan IP range (e.g. 192.168.1.0/24)
  ${clr(C.green, "ping <host>")}       Ping a host
  ${clr(C.green, "traceroute <host>")} Traceroute to a host
  ${clr(C.green, "wol <mac>")}         Send Wake-on-LAN magic packet
  ${clr(C.green, "ports <host>")}      Scan common ports on a host

${clr(C.bold + C.cyan, "CONFIGURATION")}
  ${clr(C.green, "config")}     Generate a baseline switch config (interactive)
  ${clr(C.green, "vendors")}    List supported switch vendors

${clr(C.bold + C.cyan, "SETTINGS")}
  ${clr(C.green, "settings")}   View/edit AI provider settings
  ${clr(C.green, "models")}     List available AI models for current provider
  ${clr(C.green, "test-ai")}    Test AI connection

${clr(C.bold + C.cyan, "OTHER")}
  ${clr(C.green, "kb")}         Show knowledge base info
  ${clr(C.green, "status")}     Show current session status
  ${clr(C.green, "clear")}      Clear screen
  ${clr(C.green, "help")}       Show this help
  ${clr(C.green, "exit")}       Quit
`);
}

// ── Commands ───────────────────────────────────────────────────────────────────

async function cmdSSH() {
  const host     = await ask("Host/IP:");
  const port     = await ask("Port [22]:") || "22";
  const username = await ask("Username:");
  const password = await ask("Password:");
  console.log(clr(C.yellow, `Connecting via SSH to ${host}:${port}...`));
  try {
    await session.connectSSH({ host, port, username, password });
    sessionInfo = { connType: "ssh", host, port, brand: "", model: "", task: "" };
    console.log(clr(C.green, "Connected! Device output will appear below."));
    console.log(clr(C.dim,   "Type 'send <cmd>' to send commands, or type directly when connected."));
  } catch (e) {
    console.log(clr(C.red, `SSH connection failed: ${e.message}`));
  }
}

async function cmdTelnet() {
  const host = await ask("Host/IP:");
  const port = await ask("Port [23]:") || "23";
  console.log(clr(C.yellow, `Connecting via Telnet to ${host}:${port}...`));
  try {
    await session.connectTelnet({ host, port });
    sessionInfo = { connType: "telnet", host, port, brand: "", model: "", task: "" };
    console.log(clr(C.green, "Connected!"));
  } catch (e) {
    console.log(clr(C.red, `Telnet connection failed: ${e.message}`));
  }
}

async function cmdSerial() {
  const ports = await listSerialPorts();
  if (ports.length) {
    console.log(clr(C.cyan, "Available serial ports:"));
    ports.forEach((p, i) => console.log(`  ${i + 1}. ${p.path} ${p.friendly ? "(" + p.friendly + ")" : ""}`));
  } else {
    console.log(clr(C.yellow, "No serial ports detected. On Termux, use a USB OTG cable."));
  }
  const comPort  = await ask("Serial port path (e.g. /dev/ttyUSB0):");
  const baudRate = await ask("Baud rate [9600]:") || "9600";
  console.log(clr(C.yellow, `Connecting to ${comPort} at ${baudRate} baud...`));
  try {
    await session.connectSerial({ comPort, baudRate: Number(baudRate) });
    sessionInfo = { connType: "serial", comPort, baudRate, brand: "", model: "", task: "" };
    console.log(clr(C.green, "Connected!"));
  } catch (e) {
    console.log(clr(C.red, `Serial connection failed: ${e.message}`));
  }
}

async function cmdSend(cmd) {
  if (!session.connected) {
    console.log(clr(C.red, "Not connected. Use 'ssh', 'telnet', or 'serial' first."));
    return;
  }
  try {
    const safe = sanitiseCommand(cmd);
    const verdict = classifyCommand(safe);
    if (verdict.level === "danger") {
      console.log(clr(C.red, `[DANGER] ${verdict.reason}`));
      const confirm = await ask("Type 'yes' to proceed:");
      if (confirm !== "yes") { console.log("Cancelled."); return; }
    } else if (verdict.level === "caution") {
      console.log(clr(C.yellow, `[CAUTION] ${verdict.reason}`));
    }
    session.sendCommand(safe);
  } catch (e) {
    console.log(clr(C.red, `Command rejected: ${e.message}`));
  }
}

async function cmdAsk(question) {
  const settings = loadSettings();
  if (!settings.provider || !settings.apiKey) {
    console.log(clr(C.red, "AI provider not configured. Run 'settings' first."));
    return;
  }
  const cliMode    = detectCliMode(terminalBuffer);
  const kbChunks   = kb.search(question + " " + (sessionInfo.task || ""), sessionInfo.brand, 6);
  const lessons    = errorLog.lessonsFor(sessionInfo.brand);
  const sessionErrs = sessionErrors.slice(-5).map(
    e => `- Just now: "${e.error}" after running: ${e.cmd}`
  );
  const errorNotes = [...lessons, ...sessionErrs].join("\n");
  const systemPrompt = buildSystemPrompt({
    session:      sessionInfo,
    kbChunks,
    terminalTail: terminalBuffer.slice(-6000),
    cliMode,
    autopilot:    false,
    errorNotes
  });

  console.log(clr(C.dim, "Thinking..."));
  try {
    const result = await callAI(settings, systemPrompt, [{ role: "user", content: question }]);
    console.log("");
    console.log(clr(C.bold + C.green, "AI Copilot:"));
    console.log(result.reply || "(no reply)");

    if (result.commands && result.commands.length) {
      console.log("");
      console.log(clr(C.bold + C.cyan, "Suggested Commands:"));
      for (let i = 0; i < result.commands.length; i++) {
        const c = result.commands[i];
        const verdict = classifyCommand(c.cmd);
        const badge = verdict.level === "danger" ? clr(C.red, "[DANGER]")
                    : verdict.level === "caution" ? clr(C.yellow, "[CAUTION]")
                    : clr(C.green, "[SAFE]");
        console.log(`  ${i + 1}. ${badge} ${clr(C.white, c.cmd)}`);
        if (c.why) console.log(`     ${clr(C.dim, c.why)}`);
      }
      if (session.connected) {
        console.log("");
        const choice = await ask("Run command # (or 'all', or Enter to skip):");
        if (choice === "all") {
          for (const c of result.commands) {
            const verdict = classifyCommand(c.cmd);
            if (verdict.level === "danger") {
              console.log(clr(C.red, `Skipping dangerous command: ${c.cmd}`));
              continue;
            }
            console.log(clr(C.dim, `> ${c.cmd}`));
            session.sendCommand(c.cmd);
            await new Promise(r => setTimeout(r, 500));
          }
        } else if (/^\d+$/.test(choice)) {
          const idx = parseInt(choice) - 1;
          if (idx >= 0 && idx < result.commands.length) {
            const c = result.commands[idx];
            session.sendCommand(c.cmd);
          }
        }
      }
    }

    if (result.needs && result.needs.length) {
      console.log("");
      console.log(clr(C.yellow, "AI needs more info:"));
      result.needs.forEach(n => console.log(`  - ${n}`));
    }
    console.log("");
  } catch (e) {
    console.log(clr(C.red, `AI error: ${e.message}`));
  }
}

async function cmdDetect() {
  if (!session.connected) {
    console.log(clr(C.red, "Not connected to a device."));
    return;
  }
  console.log(clr(C.yellow, "Running discovery probes..."));
  for (const probe of PROBE_COMMANDS) {
    session.sendCommand(probe);
    await new Promise(r => setTimeout(r, 1500));
  }
  await new Promise(r => setTimeout(r, 2000));
  const fp = fingerprintDevice(terminalBuffer);
  if (fp.matched) {
    sessionInfo.brand = fp.vendor;
    sessionInfo.model = fp.model || "";
    console.log(clr(C.green, `Detected: ${fp.vendor} ${fp.type} ${fp.model ? "(" + fp.model + ")" : ""}`));
  } else {
    console.log(clr(C.yellow, "Could not auto-detect. Set manually with 'task' command."));
  }
}

async function cmdScan(target) {
  if (!target) { console.log(clr(C.red, "Usage: scan <ip/cidr>")); return; }
  console.log(clr(C.yellow, `Scanning ${target}...`));
  try {
    const results = await scanner.scanRange(target, { concurrency: 30 }, (result, done, total) => {
      if (result.status !== "offline") {
        const ports = result.openPorts.map(p => `${p.port}/${p.service}`).join(", ");
        console.log(
          `  ${clr(C.green, result.ip.padEnd(16))} ` +
          `${(result.hostname || "-").padEnd(24)} ` +
          `${(result.vendor || "-").padEnd(18)} ` +
          `${ports || "-"}`
        );
      }
      if (done % 20 === 0 || done === total) {
        process.stdout.write(clr(C.dim, `  [${done}/${total}]\r`));
      }
    });
    const online = results.filter(r => r.status !== "offline");
    console.log("");
    console.log(clr(C.green, `Scan complete: ${online.length} hosts found out of ${results.length} scanned.`));
  } catch (e) {
    console.log(clr(C.red, `Scan error: ${e.message}`));
  }
}

async function cmdPing(host) {
  if (!host) { console.log(clr(C.red, "Usage: ping <host>")); return; }
  const alive = await scanner.pingHost(host, 2000);
  console.log(alive ? clr(C.green, `${host} is reachable`) : clr(C.red, `${host} is unreachable`));
}

async function cmdTraceroute(host) {
  if (!host) { console.log(clr(C.red, "Usage: traceroute <host>")); return; }
  console.log(clr(C.yellow, `Tracing route to ${host}...`));
  const result = await scanner.traceroute(host);
  console.log(result.output);
}

async function cmdWoL(mac) {
  if (!mac) { console.log(clr(C.red, "Usage: wol <mac-address>")); return; }
  try {
    await scanner.sendWoL(mac);
    console.log(clr(C.green, `Wake-on-LAN packet sent to ${mac}`));
  } catch (e) {
    console.log(clr(C.red, `WoL error: ${e.message}`));
  }
}

async function cmdPorts(host) {
  if (!host) { console.log(clr(C.red, "Usage: ports <host>")); return; }
  console.log(clr(C.yellow, `Scanning ports on ${host}...`));
  const ports = await scanner.probePorts(host, Object.keys(scanner.ENTERPRISE_PORTS).map(Number), 800);
  if (ports.length) {
    console.log(clr(C.green, "Open ports:"));
    ports.forEach(p => console.log(`  ${String(p.port).padEnd(8)} ${p.service}`));
  } else {
    console.log(clr(C.yellow, "No open ports found."));
  }
}

async function cmdConfig() {
  console.log(clr(C.cyan, "Baseline Switch Configuration Generator"));
  console.log(clr(C.dim, "Supported vendors: " + switchConfig.SUPPORTED_VENDORS.join(", ")));
  console.log("");

  const vendor   = await ask("Vendor (e.g. cisco-ios, mikrotik, fortinet):") || "generic";
  const hostname = await ask("Hostname:");
  const mgmtIp   = await ask("Management IP (optional):");
  const mgmtMask = await ask("Subnet mask or CIDR (e.g. 255.255.255.0 or 24):") || "255.255.255.0";
  const mgmtVlan = await ask("Management VLAN (optional):") || "1";
  const gateway  = await ask("Default gateway (optional):");
  const adminUser = await ask("Admin username (optional):");
  const adminPass = await ask("Admin password (optional):");
  const ntpServer = await ask("NTP server (optional):");

  const vlansStr = await ask("VLANs (comma-separated id:name, e.g. 10:Data,20:Voice):");
  const vlans = vlansStr ? vlansStr.split(",").map(v => {
    const [id, name] = v.trim().split(":");
    return { id, name: name || "" };
  }) : [];

  try {
    const result = switchConfig.generateBaseline({
      vendor, hostname, mgmtIp, mgmtMask, mgmtVlan, gateway,
      adminUser, adminPass, ntpServer, vlans
    });
    console.log("");
    console.log(clr(C.bold + C.green, "Generated Configuration:"));
    console.log(clr(C.dim, "─".repeat(60)));
    console.log(result.config);
    console.log(clr(C.dim, "─".repeat(60)));
    if (result.notes.length) {
      console.log(clr(C.yellow, "\nNotes:"));
      result.notes.forEach(n => console.log(`  - ${n}`));
    }

    const savePath = await ask("\nSave to file? (path or Enter to skip):");
    if (savePath) {
      fs.writeFileSync(savePath, result.config, "utf8");
      console.log(clr(C.green, `Saved to ${savePath}`));
    }
  } catch (e) {
    console.log(clr(C.red, `Error: ${e.message}`));
  }
}

async function cmdSettings() {
  const s = loadSettings();
  console.log(clr(C.cyan, "\nCurrent Settings:"));
  console.log(`  Provider: ${s.provider || "(not set)"}`);
  console.log(`  Model:    ${s.model || "(default)"}`);
  console.log(`  API Key:  ${s.apiKey ? "***" + s.apiKey.slice(-4) : "(not set)"}`);
  console.log(`  Base URL: ${s.baseUrl || "(default)"}`);
  console.log("");

  const providerList = models.allProviders();
  console.log(clr(C.dim, "Available providers: " + providerList.join(", ")));

  const provider = await ask("Provider (Enter to keep current):");
  if (provider) s.provider = provider;
  const apiKey = await ask("API Key (Enter to keep current):");
  if (apiKey) s.apiKey = apiKey;
  const model = await ask("Model (Enter to keep current):");
  if (model) s.model = model;
  const baseUrl = await ask("Base URL (Enter for default):");
  if (baseUrl) s.baseUrl = baseUrl;

  saveSettings(s);
  console.log(clr(C.green, "Settings saved."));
}

function cmdModels() {
  const s = loadSettings();
  const provider = s.provider || "anthropic";
  const presets = models.presetsFor(provider);
  console.log(clr(C.cyan, `\nModels for ${models.PROVIDER_LABELS[provider] || provider}:`));
  for (const m of presets) {
    const free = m.free ? clr(C.green, " [FREE]") : "";
    console.log(`  ${m.id.padEnd(45)} ${m.speed.padEnd(8)} ${m.cost.padEnd(5)}${free}`);
    console.log(`    ${clr(C.dim, m.note)}`);
  }
  console.log("");
}

async function cmdTestAI() {
  const settings = loadSettings();
  if (!settings.provider) {
    console.log(clr(C.red, "Configure a provider first with 'settings'."));
    return;
  }
  console.log(clr(C.yellow, "Testing AI connection..."));
  try {
    const r = await callAI(settings,
      'Reply with JSON: {"reply":"connection ok","commands":[],"needs":[]}',
      [{ role: "user", content: "ping" }]);
    console.log(clr(C.green, `AI connection OK: ${r.reply}`));
  } catch (e) {
    console.log(clr(C.red, `AI connection failed: ${e.message}`));
  }
}

function cmdKB() {
  const info = kb.reload();
  console.log(clr(C.cyan, "\nKnowledge Base:"));
  console.log(`  Documents: ${info.docCount}`);
  console.log(`  Chunks:    ${info.chunkCount}`);
  console.log(`  Files:     ${info.files.join(", ")}`);
  console.log("");
}

function cmdStatus() {
  console.log(clr(C.cyan, "\nSession Status:"));
  console.log(`  Connected:  ${session.connected ? clr(C.green, "Yes") : clr(C.red, "No")}`);
  console.log(`  Type:       ${sessionInfo.connType || "-"}`);
  console.log(`  Host:       ${sessionInfo.host || sessionInfo.comPort || "-"}`);
  console.log(`  Brand:      ${sessionInfo.brand || "-"}`);
  console.log(`  Model:      ${sessionInfo.model || "-"}`);
  console.log(`  Task:       ${sessionInfo.task || "-"}`);
  if (session.connected) {
    const mode = detectCliMode(terminalBuffer);
    console.log(`  CLI Mode:   ${mode.label} (${mode.mode})`);
  }
  console.log("");
}

// ── Main loop ──────────────────────────────────────────────────────────────────

async function processCommand(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  const [cmd, ...argParts] = trimmed.split(/\s+/);
  const args = argParts.join(" ");

  switch (cmd.toLowerCase()) {
    case "help":       showHelp(); break;
    case "ssh":        await cmdSSH(); break;
    case "telnet":     await cmdTelnet(); break;
    case "serial":     await cmdSerial(); break;
    case "disconnect":
      await session.disconnect();
      sessionInfo = { connType: "", host: "", port: "", brand: "", model: "", task: "" };
      console.log(clr(C.green, "Disconnected."));
      break;
    case "send":       await cmdSend(args); break;
    case "ask":        await cmdAsk(args); break;
    case "detect":     await cmdDetect(); break;
    case "task":
      if (args) { sessionInfo.task = args; console.log(clr(C.green, `Task set: ${args}`)); }
      else console.log(clr(C.yellow, `Current task: ${sessionInfo.task || "(not set)"}`));
      break;
    case "scan":       await cmdScan(args); break;
    case "ping":       await cmdPing(args); break;
    case "traceroute": await cmdTraceroute(args); break;
    case "wol":        await cmdWoL(args); break;
    case "ports":      await cmdPorts(args); break;
    case "config":     await cmdConfig(); break;
    case "vendors":
      console.log(clr(C.cyan, "Supported vendors: ") + switchConfig.SUPPORTED_VENDORS.join(", "));
      break;
    case "settings":   await cmdSettings(); break;
    case "models":     cmdModels(); break;
    case "test-ai":    await cmdTestAI(); break;
    case "kb":         cmdKB(); break;
    case "status":     cmdStatus(); break;
    case "clear":
      process.stdout.write("\x1b[2J\x1b[H");
      break;
    case "exit":
    case "quit":
      await session.disconnect();
      console.log(clr(C.green, "Goodbye!"));
      process.exit(0);
      break;
    default:
      if (session.connected) {
        session.sendCommand(trimmed);
      } else {
        console.log(clr(C.red, `Unknown command: ${cmd}. Type 'help' for available commands.`));
      }
  }
}

showBanner();
rl.prompt();

rl.on("line", async (line) => {
  try {
    await processCommand(line);
  } catch (e) {
    console.log(clr(C.red, `Error: ${e.message}`));
  }
  rl.prompt();
});

rl.on("close", async () => {
  await session.disconnect();
  process.exit(0);
});
