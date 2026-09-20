// Electron main process — IPC bridge between renderer and Node.js backend.
// All device I/O, AI calls, file operations, and settings live here.

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs   = require("fs");
const os   = require("os");

const { initFileLogging } = require("./src/logger");
const log = require("./src/logger").child("main");

const { DeviceSession, listSerialPorts } = require("./src/session");
const { KnowledgeBase }                  = require("./src/kb");
const { callAI }                         = require("./src/ai-providers");
const { classifyCommand }                = require("./src/safety");
const { buildSystemPrompt }              = require("./src/prompt");
const { detectCliMode, prepCommandsFor } = require("./src/mode");
const { sendEvent }                      = require("./src/telemetry");
const { fingerprintDevice, PROBE_COMMANDS, arpDiscoveryCommands, parsePingOutput } = require("./src/detect");
const { ErrorLog, extractErrors }        = require("./src/errorlog");
const packets                            = require("./src/packets");
const models                             = require("./src/models");
const research                           = require("./src/research");
const { sanitiseCommand }                = require("./src/validate");
const { checkForUpdate }                 = require("./src/updater");
const { analyseCapture }                 = require("./src/pcap-analyser");
const switchConfig                       = require("./src/switch-config");
const pkg                                = require("./package.json");

let win = null;
const session = new DeviceSession();
let kb = null;
let sessionBackup = null;
let errorLog = null;

// ---------- paths ----------
const userDataDir   = () => process.env.AHUVA_USER_DATA || app.getPath("userData");
const settingsPath  = () => path.join(userDataDir(), "settings.json");
const userDocsDir   = () => path.join(userDataDir(), "docs");
const backupsDir    = () => path.join(userDataDir(), "backups");
const researchDir   = () => path.join(userDataDir(), "research");
const capturesDir   = () => path.join(userDataDir(), "captures");
const logsDir       = () => path.join(userDataDir(), "logs");

// ---------- settings ----------
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), "utf8")); }
  catch { return { provider: "anthropic", model: "", apiKey: "", baseUrl: "" }; }
}

function saveSettings(s) {
  // Never persist secrets to the git-tracked project directory.
  // Settings stay exclusively inside Electron's userData (not the app bundle).
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2), "utf8");
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: "#07111f",
    title: "Ahuva IT Support Assistant",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Prevent navigation to external URLs from within the renderer
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
      log.warn("Blocked renderer navigation to external URL", { url: url.slice(0, 100) });
    }
  });

  // Smoke-test hook: AHUVA_SMOKE=/path/screenshot.png
  if (process.env.AHUVA_SMOKE) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const opens = { settings: "btn-settings", packets: "tab-packets" };
          const openKey = process.env.AHUVA_SMOKE_OPEN;
          if (openKey && opens[openKey]) {
            await win.webContents.executeJavaScript(
              `document.getElementById(${JSON.stringify(opens[openKey])})?.click()`
            );
          } else if (openKey === "login") {
            await win.webContents.executeJavaScript(`typeof openLoginModal === 'function' && openLoginModal()`);
          } else if (openKey === "research") {
            await win.webContents.executeJavaScript(`document.getElementById("btn-research")?.click()`);
          }
          await new Promise(r => setTimeout(r, 400));
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.AHUVA_SMOKE, img.toPNG());
        } catch (e) { log.error("Smoke capture failed", { message: e.message }); }
        app.quit();
      }, 2500);
    });
  }
}

// ---------- update check ----------
function scheduleUpdateCheck() {
  setTimeout(async () => {
    try {
      const result = await checkForUpdate(pkg.version);
      if (result.hasUpdate && win && !win.isDestroyed()) {
        win.webContents.send("update:available", result);
        log.info("Update available", { latest: result.latestVersion });
      }
    } catch (e) { log.warn("Update check failed", { message: e.message }); }
  }, 12000);
}

// ---------- startup ----------
app.whenReady().then(() => {
  initFileLogging(logsDir());
  log.info("App starting", { version: app.getVersion(), platform: process.platform, arch: process.arch });

  for (const dir of [userDocsDir(), backupsDir(), researchDir(), capturesDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  kb       = new KnowledgeBase(path.join(__dirname, "kb"), userDocsDir());
  errorLog = new ErrorLog(userDataDir());
  sendEvent("app_start", { appVersion: app.getVersion() }, loadSettings());
  createWindow();
  scheduleUpdateCheck();

  win && win.webContents.once("did-finish-load", () => {
    const s = loadSettings();
    if (s.researchEnabled && research.shouldRunWeekly(s.lastResearch)) {
      win.webContents.send("research:due");
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  session.disconnect();
  log.info("App quitting");
  if (process.platform !== "darwin") app.quit();
});

// Forward live terminal data to renderer
session.on("data",   chunk  => { if (win && !win.isDestroyed()) win.webContents.send("session:data", chunk); });
session.on("closed", reason => { if (win && !win.isDestroyed()) win.webContents.send("session:closed", reason); });
session.on("error",  msg    => { if (win && !win.isDestroyed()) win.webContents.send("session:error", msg); });

// ---------- IPC ----------
ipcMain.handle("settings:get",  ()     => loadSettings());
ipcMain.handle("settings:save", (_e, s) => { saveSettings(s); return true; });

ipcMain.handle("serial:list", () => listSerialPorts());

ipcMain.handle("session:connect", async (_e, cfg) => {
  // Validate connection config before passing to session layer
  if (!cfg || !cfg.connType) throw new Error("Missing connection config.");
  sendEvent("connect", { appVersion: app.getVersion(), brand: cfg.brand, model: cfg.model, conn: cfg.connType }, loadSettings());

  if (cfg.connType === "ssh") {
    await session.connectSSH({
      host: cfg.host, port: cfg.port,
      username: cfg.username, password: cfg.password
    });
  } else if (cfg.connType === "telnet") {
    await session.connectTelnet({ host: cfg.host, port: cfg.port });
  } else if (cfg.connType === "serial") {
    await session.connectSerial({ comPort: cfg.comPort, baudRate: cfg.baudRate });
  } else {
    throw new Error(`Unknown connection type: "${cfg.connType}"`);
  }

  sessionBackup = null;
  return true;
});

ipcMain.handle("session:disconnect", async () => { await session.disconnect(); return true; });

ipcMain.handle("session:write", (_e, data) => { session.write(String(data || "")); return true; });

ipcMain.handle("session:sendCommand", (_e, cmd) => {
  // Security gate: validate and classify BEFORE sending to device
  let safe;
  try { safe = sanitiseCommand(cmd); }
  catch (e) { throw new Error("Command rejected: " + e.message); }

  const verdict = classifyCommand(safe);
  session.sendCommand(safe);
  sendEvent("command_run", { appVersion: app.getVersion(), level: verdict.level }, loadSettings());
  log.info("Command sent", { level: verdict.level, cmd: safe.slice(0, 80) });
  return verdict;
});

ipcMain.handle("safety:classify", (_e, cmd) => classifyCommand(String(cmd || "")));

ipcMain.handle("ai:ask", async (_e, payload) => {
  const settings = loadSettings();
  if (!settings.provider) throw new Error("Configure an AI provider in Settings first.");
  const query      = (payload.messages.slice(-1)[0] || {}).content || "";
  const kbChunks   = kb.search(query + " " + (payload.session.task || ""), payload.session.brand, 6);
  const lessons    = errorLog.lessonsFor(payload.session.brand);
  const sessionErrs = (payload.sessionErrors || []).slice(-5).map(
    e => `- Just now: "${e.error}" after running: ${e.cmd}`
  );
  const errorNotes = [...lessons, ...sessionErrs].join("\n");
  const systemPrompt = buildSystemPrompt({
    session:     payload.session,
    kbChunks,
    terminalTail: (payload.terminalTail || "").slice(-6000),
    cliMode:     payload.cliMode,
    autopilot:   !!settings.autopilot,
    errorNotes
  });
  sendEvent("ai_message", { appVersion: app.getVersion(), brand: payload.session.brand, model: payload.session.model }, settings);
  return await callAI(settings, systemPrompt, payload.messages);
});

ipcMain.handle("mode:detect",      (_e, buffer) => detectCliMode(buffer));
ipcMain.handle("device:fingerprint", (_e, text)  => fingerprintDevice(text));
ipcMain.handle("device:probes",    ()             => PROBE_COMMANDS);
ipcMain.handle("device:arpCmds",   (_e, brand)   => arpDiscoveryCommands(brand));
ipcMain.handle("device:parsePing", (_e, text)    => parsePingOutput(text));

ipcMain.handle("errors:scan",   (_e, text) => extractErrors(text));
ipcMain.handle("errors:record", (_e, info) => errorLog.record(info));

ipcMain.handle("models:presets", (_e, provider) => ({
  presets:  models.presetsFor(provider),
  baseUrl:  models.defaultBaseUrl(provider),
  model:    models.defaultModel(provider)
}));

ipcMain.handle("mode:prep", (_e, { mode, cmd }) => prepCommandsFor(mode, cmd));

// ---------- Packet capture ----------
ipcMain.handle("pkt:check",      ()                       => packets.tsharkAvailable());
ipcMain.handle("pkt:ifaces",     ()                       => packets.listInterfaces());
ipcMain.handle("pkt:deviceCmds", (_e, { brand, target }) => packets.deviceCaptureCommands(brand, target));

ipcMain.handle("pkt:capture", async (_e, opts) => {
  const res      = await packets.capture({ ...opts, outDir: capturesDir() });
  const settings = loadSettings();

  // Deterministic analysis runs first (no AI needed, always available)
  const structured = analyseCapture(res);

  let aiAnalysis = "";
  try {
    const r = await callAI(settings, packets.ANALYSIS_SYSTEM, [{
      role: "user",
      content: `Deterministic pre-analysis:\n${structured.humanSummary}\n\n` +
               `IP conversations:\n${res.conversations}\n\n` +
               `Packet list (frame, src, dst, proto, info):\n${res.summary}`
    }]);
    aiAnalysis = r.reply || "";
  } catch (e) {
    aiAnalysis = "(AI analysis unavailable: " + e.message + ")";
    log.warn("Capture AI analysis failed", { message: e.message });
  }
  sendEvent("packet_capture", { appVersion: app.getVersion() }, settings);
  return { ...res, analysis: aiAnalysis, structured };
});

// ---------- Switch configuration ----------
ipcMain.handle("swcfg:vendors",  ()           => switchConfig.SUPPORTED_VENDORS);
ipcMain.handle("swcfg:generate", (_e, params) => switchConfig.generateBaseline(params));
ipcMain.handle("swcfg:push",     async (_e, { commands }) => {
  if (!session.connected) throw new Error("Not connected to a device.");
  const safe = (commands || []).map(c => {
    try { return sanitiseCommand(c); }
    catch { return null; }
  }).filter(Boolean);
  for (const cmd of safe) {
    session.sendCommand(cmd);
    await new Promise(r => setTimeout(r, 250));
  }
  return { pushed: safe.length };
});

ipcMain.handle("pkt:export", (_e, { captureResult, format }) =>
  packets.exportCapture(captureResult, format || "json")
);

ipcMain.handle("update:check", async () => {
  try { return await checkForUpdate(pkg.version); }
  catch { return { hasUpdate: false }; }
});

ipcMain.handle("shell:openExternal", (_e, url) => {
  if (typeof url === "string" && (url.startsWith("https://github.com/") || url.startsWith("https://github.com"))) {
    shell.openExternal(url);
  }
});

// ---------- Backup / restore ----------
ipcMain.handle("backup:store", (_e, { text, device }) => {
  sessionBackup = { text, capturedAt: new Date().toISOString(), device: device || "" };
  try {
    const stamp = sessionBackup.capturedAt.replace(/[:.]/g, "-").slice(0, 19);
    const f = path.join(backupsDir(), `restore-point-${(device || "device").replace(/\s+/g, "_")}-${stamp}.txt`);
    fs.writeFileSync(f, text, "utf8");
    sessionBackup.file = f;
  } catch (e) { log.warn("Could not persist backup to disk", { message: e.message }); }
  return { ok: true, capturedAt: sessionBackup.capturedAt, chars: text.length };
});

ipcMain.handle("backup:getRestorePoint", () => sessionBackup);

ipcMain.handle("backup:save", async (_e, { text, model }) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const r = await dialog.showSaveDialog(win, {
    title: "Save configuration backup",
    defaultPath: `config-backup-${(model || "switch").replace(/\s+/g, "_")}-${stamp}.txt`
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, text, "utf8");
  sendEvent("backup", { appVersion: app.getVersion(), model }, loadSettings());
  return r.filePath;
});

// ---------- AI connection test ----------
ipcMain.handle("ai:test", async () => {
  const settings = loadSettings();
  const r = await callAI(settings,
    'Reply with JSON: {"reply":"connection ok","commands":[],"needs":[]}',
    [{ role: "user", content: "ping" }]
  );
  return r.reply || "ok";
});

// ---------- Knowledge base ----------
ipcMain.handle("kb:info", () => kb.reload());

ipcMain.handle("kb:import", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Import reference documents (.md / .txt)",
    filters: [{ name: "Documents", extensions: ["md", "txt"] }],
    properties: ["openFile", "multiSelections"]
  });
  if (r.canceled) return kb.reload();
  for (const src of r.filePaths) {
    const dest = path.join(userDocsDir(), path.basename(src));
    fs.copyFileSync(src, dest);
  }
  return kb.reload();
});

// ---------- Research ----------
ipcMain.handle("research:info", () => {
  const s = loadSettings();
  let files = [];
  try { files = fs.readdirSync(researchDir()).filter(f => f.endsWith(".md")).sort().reverse(); } catch { }
  return {
    enabled:       !!s.researchEnabled,
    lastResearch:  s.lastResearch || null,
    due:           research.shouldRunWeekly(s.lastResearch),
    sources:       s.researchSources && s.researchSources.length ? s.researchSources : research.DEFAULT_SOURCES,
    files
  };
});

ipcMain.handle("research:setEnabled",  (_e, on)      => { const s = loadSettings(); s.researchEnabled = !!on; saveSettings(s); return true; });
ipcMain.handle("research:setSources",  (_e, sources) => { const s = loadSettings(); s.researchSources = sources; saveSettings(s); return true; });
ipcMain.handle("research:openFolder",  ()            => { shell.openPath(researchDir()); return true; });
ipcMain.handle("research:read",        (_e, fname)   => {
  try { return fs.readFileSync(path.join(researchDir(), path.basename(fname)), "utf8"); }
  catch { return "(could not read digest)"; }
});

ipcMain.handle("research:run", async (_e, { vendors }) => {
  const settings = loadSettings();
  if (settings.provider === "ollama") {
    throw new Error("Research requires internet access; the offline Ollama provider cannot fetch sources. Switch to Anthropic/OpenAI for research.");
  }
  const useWebSearch = settings.provider === "anthropic";
  const aiImpl = async (systemPrompt, messages) =>
    callAI(settings, systemPrompt, messages, undefined, { webSearch: useWebSearch });

  const result = await research.runResearch({
    vendors: vendors || [],
    sources: settings.researchSources && settings.researchSources.length
      ? settings.researchSources : research.DEFAULT_SOURCES,
    aiImpl
  });

  const stamp = result.generatedAt.replace(/[:.]/g, "-").slice(0, 19);
  const fname = `research-digest-${stamp}.md`;
  fs.writeFileSync(path.join(researchDir(), fname), result.digest, "utf8");
  fs.writeFileSync(path.join(userDocsDir(), fname), result.digest, "utf8");

  const kbInfo = kb.reload();
  const s2 = loadSettings(); s2.lastResearch = result.generatedAt; saveSettings(s2);
  sendEvent("research_run", { appVersion: app.getVersion() }, s2);
  log.info("Research run complete", { sources: result.sources.length, file: fname });
  return {
    file: fname,
    digest: result.digest,
    sourcesOk: result.sources.filter(x => x.ok !== false).length,
    sourcesTotal: result.sources.length,
    kbDocs: kbInfo.docCount
  };
});
