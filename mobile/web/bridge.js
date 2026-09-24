/* bridge.js — window.ahuva for Android. A port of main.js + preload.js: same method
 * signatures and return shapes, backed by Capacitor native plugins instead of Electron IPC. */
(function () {
  "use strict";
  if (window.__ahuvaUnsupported) return;

  const P = (window.Capacitor && window.Capacitor.Plugins) || {};
  const Preferences = P.Preferences;
  const AppInfo = P.App;
  const Session = P.AhuvaSession;
  const Network = P.AhuvaNetwork;
  const M = window.AhuvaModules;

  const startupErrors = window.__ahuvaErrors || [];

  // ── persistence ─────────────────────────────────────────────────────────
  const K = {
    settings: "ahuva_settings",
    restore: "ahuva_restore_point",
    errorStats: "ahuva_error_stats",
    errorReport: "ahuva_error_report",
    userDocs: "ahuva_user_docs",
    digests: "ahuva_research_digests",
  };

  async function getJSON(key, fallback) {
    try {
      const { value } = await Preferences.get({ key });
      return value ? JSON.parse(value) : fallback;
    } catch { return fallback; }
  }
  async function setJSON(key, value) {
    await Preferences.set({ key, value: JSON.stringify(value) });
  }

  const DEFAULT_SETTINGS = { provider: "anthropic", model: "", apiKey: "", baseUrl: "" };
  async function loadSettings() {
    const s = await getJSON(K.settings, null);
    return s && typeof s === "object" ? s : { ...DEFAULT_SETTINGS };
  }
  const saveSettings = s => setJSON(K.settings, s || {});

  let appVersion = "0.0.0";
  let appBuild = "0";
  const versionReady = (async () => {
    try { const i = await AppInfo.getInfo(); appVersion = i.version; appBuild = String(i.build); } catch {}
  })();

  // ── events ──────────────────────────────────────────────────────────────
  const listeners = { data: [], closed: [], error: [], research: [], update: [], scan: [] };
  const emit = (type, payload) => { for (const cb of listeners[type]) { try { cb(payload); } catch (e) { console.error(e); } } };

  let connected = false;
  let sessionBackup = null;

  if (Session) {
    Session.addListener("sessionData", d => emit("data", d.data));
    Session.addListener("sessionClosed", d => { connected = false; emit("closed", d.reason || "Connection closed"); });
    Session.addListener("sessionError", d => emit("error", d.message || "error"));
  }

  const PORT_NAMES = M.scanner.ENTERPRISE_PORTS;
  function enrichHost(r) {
    const mac = r.mac || "";
    return {
      ip: r.ip,
      status: r.status,
      mac,
      vendor: M.scanner.macVendor(mac),
      hostname: r.hostname || "",
      openPorts: (r.openPorts || []).map(port => ({ port, service: PORT_NAMES[port] || "?" })),
      notes: r.notes || [],
    };
  }
  if (Network) {
    Network.addListener("scanProgress", d => emit("scan", { result: enrichHost(d.result), done: d.done, total: d.total }));
  }

  // ── telemetry (only when a team dashboard URL is configured, same as desktop) ──
  async function sendEvent(type, data, settings) {
    const url = String((settings && settings.dashboardUrl) || "").trim();
    if (!url) return;
    try {
      await fetch(url.replace(/\/+$/, "") + "/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(settings.teamToken ? { authorization: "Bearer " + String(settings.teamToken).trim() } : {})
        },
        body: JSON.stringify({
          ts: new Date().toISOString(), type,
          engineer: (settings.engineerName || "").trim() || "android",
          app_version: String(data.appVersion || appVersion),
          brand: String(data.brand || ""), model: String(data.model || ""),
          level: String(data.level || ""), conn: String(data.conn || ""),
          platform: "android", arch: ""
        }),
      });
    } catch { /* non-fatal */ }
  }

  // ── knowledge base (built-in kb/ + imported docs + research digests) ─────
  let kbChunks = [];
  let builtinDocs = null;

  async function loadBuiltinDocs() {
    if (builtinDocs) return builtinDocs;
    const names = await (await fetch("kb/index.json")).json();
    const docs = [];
    for (const name of names) {
      try { docs.push({ name, text: await (await fetch("kb/" + name)).text() }); } catch { /* skip */ }
    }
    builtinDocs = docs;
    return docs;
  }

  async function kbReload() {
    const userDocs = await getJSON(K.userDocs, []);
    const docs = [...(await loadBuiltinDocs()), ...userDocs];
    kbChunks = docs.flatMap(M.kb.chunkDoc);
    return { docCount: docs.length, chunkCount: kbChunks.length, files: docs.map(d => d.name) };
  }
  const kbReady = kbReload().catch(e => { console.error("KB load failed", e); });

  function kbSearch(query, vendor, limit) {
    const qTokens = M.kb.tokenize(query + " " + (vendor || ""));
    const vend = (vendor || "").toLowerCase();
    return kbChunks
      .map(c => {
        let s = M.kb.scoreChunk(c, qTokens);
        if (vend && (c.source.toLowerCase().includes(vend.split(" ")[0]) || c.text.toLowerCase().includes(vend))) s += 3;
        return { c, s };
      })
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit || 4)
      .map(x => x.c);
  }

  async function addUserDocs(newDocs) {
    const docs = await getJSON(K.userDocs, []);
    for (const d of newDocs) {
      const i = docs.findIndex(x => x.name === d.name);
      if (i >= 0) docs[i] = d; else docs.push(d);
    }
    await setJSON(K.userDocs, docs);
  }

  function pickTextFiles() {
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = ".md,.txt,text/plain,text/markdown";
      input.style.display = "none";
      let settled = false;
      const done = files => { if (settled) return; settled = true; input.remove(); resolve(files); };
      input.addEventListener("change", () => done(Array.from(input.files || [])));
      input.addEventListener("cancel", () => done([]));
      window.addEventListener("focus", () => setTimeout(() => { if (!input.files || !input.files.length) done([]); }, 1500), { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  // ── error learning (errorlog.js semantics, stored in Preferences) ────────
  async function recordError({ cmd, error, brand, model, resolution }) {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    const esc = s => String(s || "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 90);
    const report = await getJSON(K.errorReport, []);
    report.push(`| ${ts} | ${esc(brand + " " + (model || ""))} | \`${esc(cmd)}\` | ${esc(error)} | ${esc(resolution || "seen")} |`);
    if (report.length > 500) report.splice(0, report.length - 500);
    await setJSON(K.errorReport, report);

    const stats = await getJSON(K.errorStats, { patterns: {} });
    const key = ((brand || "any") + " :: " + String(error || "").slice(0, 60)).toLowerCase();
    const p = stats.patterns[key] = stats.patterns[key] || { brand: brand || "any", error: String(error || "").slice(0, 120), count: 0, lastCmd: "" };
    p.count++;
    p.lastCmd = String(cmd || "").slice(0, 120);
    await setJSON(K.errorStats, stats);
    return { reportFile: "error-report" };
  }

  async function lessonsFor(brand, limit) {
    const stats = await getJSON(K.errorStats, { patterns: {} });
    const b = (brand || "").toLowerCase();
    return Object.values(stats.patterns)
      .filter(p => p.count >= 2 && (p.brand.toLowerCase() === b || p.brand === "any"))
      .sort((a, z) => z.count - a.count)
      .slice(0, limit || 4)
      .map(p => `- Seen ${p.count}x on ${p.brand}: "${p.error}" (last from: ${p.lastCmd}) — avoid the syntax/mode that causes this.`);
  }

  // ── research digests ────────────────────────────────────────────────────
  async function digestFiles() {
    const d = await getJSON(K.digests, {});
    return Object.keys(d).sort().reverse();
  }

  // ── update check (Android builds are published under the android-latest release) ──
  const REPO = "enoshvarma/ahuva-it-support-assistant";
  async function checkForUpdate() {
    await versionReady;
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/android-latest`, { headers: { accept: "application/vnd.github+json" } });
      if (!res.ok) return { hasUpdate: false };
      const rel = await res.json();
      const m = /versionCode:\s*(\d+)/.exec(rel.body || "");
      const v = /v(\d+\.\d+\.\d+)/.exec(rel.name || "");
      const latestBuild = m ? parseInt(m[1], 10) : 0;
      return {
        hasUpdate: latestBuild > parseInt(appBuild, 10),
        latestVersion: (v ? v[1] : appVersion) + (m ? ` (build ${latestBuild})` : ""),
        downloadUrl: rel.html_url || `https://github.com/${REPO}/releases/tag/android-latest`,
        releaseNotes: (rel.body || "").slice(0, 800),
      };
    } catch { return { hasUpdate: false }; }
  }

  function requireNative(plugin, what) {
    if (!plugin) throw new Error(what + " is unavailable — reinstall the app.");
    return plugin;
  }

  // ── window.ahuva ─────────────────────────────────────────────────────────
  window.ahuva = {
    // Settings
    getSettings: () => loadSettings(),
    saveSettings: async s => { await saveSettings(s); return true; },
    testAI: async () => {
      const settings = await loadSettings();
      const r = await M.ai.callAI(settings,
        'Reply with JSON: {"reply":"connection ok","commands":[],"needs":[]}',
        [{ role: "user", content: "ping" }]);
      return r.reply || "ok";
    },
    modelPresets: async ({ provider, freeOnly } = {}) => ({
      presets: M.models.presetsFor(provider, !!freeOnly),
      baseUrl: M.models.defaultBaseUrl(provider),
      model: M.models.defaultModel(provider),
      allProviders: M.models.allProviders(),
      labels: M.models.PROVIDER_LABELS,
    }),

    // Serial ports (USB-OTG console cables)
    listSerialPorts: async () => {
      if (!Session) return [];
      try { return (await Session.listSerialPorts()).ports || []; } catch { return []; }
    },

    // Device session
    connect: async cfg => {
      if (!cfg || !cfg.connType) throw new Error("Missing connection config.");
      const v = M.validate;
      if (cfg.connType === "ssh" || cfg.connType === "telnet") {
        if (!v.isValidHost(cfg.host)) throw new Error(`Invalid host: "${cfg.host}"`);
        const defPort = cfg.connType === "ssh" ? 22 : 23;
        if (!v.isValidPort(cfg.port || defPort)) throw new Error(`Invalid port: "${cfg.port}"`);
        if (cfg.connType === "ssh" && !v.isValidUsername(cfg.username)) throw new Error("Invalid username.");
      } else if (cfg.connType === "serial") {
        if (!/^usb:\d+:\d+$/.test(String(cfg.comPort || ""))) throw new Error("Select a USB console cable first (plug it in via USB-OTG and tap refresh).");
        if (!v.isValidBaudRate(cfg.baudRate || 9600)) throw new Error(`Invalid baud rate: "${cfg.baudRate}"`);
      } else {
        throw new Error(`Unknown connection type: "${cfg.connType}"`);
      }
      const settings = await loadSettings();
      sendEvent("connect", { brand: cfg.brand, model: cfg.model, conn: cfg.connType }, settings);
      await requireNative(Session, "Device connection").connect({
        connType: cfg.connType, host: cfg.host, port: cfg.port,
        username: cfg.username, password: cfg.password,
        comPort: cfg.comPort, baudRate: cfg.baudRate,
      });
      connected = true;
      sessionBackup = null;
      return true;
    },
    disconnect: async () => {
      connected = false;
      if (Session) await Session.disconnect();
      return true;
    },
    write: async data => {
      await requireNative(Session, "Device connection").write({ data: String(data || "") });
      return true;
    },
    sendCommand: async cmd => {
      let safe;
      try { safe = M.validate.sanitiseCommand(cmd); }
      catch (e) { throw new Error("Command rejected: " + e.message); }
      const verdict = M.safety.classifyCommand(safe);
      await requireNative(Session, "Device connection").write({ data: String(safe).replace(/[\r\n]+$/, "") + "\r" });
      loadSettings().then(s => sendEvent("command_run", { level: verdict.level }, s));
      return verdict;
    },

    // Safety / mode
    classify: async cmd => M.safety.classifyCommand(String(cmd || "")),
    detectMode: async buf => M.mode.detectCliMode(buf),
    prepFor: async (mode, cmd) => M.mode.prepCommandsFor(mode, cmd),

    // Device fingerprinting & discovery
    fingerprint: async text => M.detect.fingerprintDevice(text),
    probes: async () => M.detect.PROBE_COMMANDS,
    arpCmds: async brand => M.detect.arpDiscoveryCommands(brand),
    parsePing: async text => M.detect.parsePingOutput(text),

    // Backup / restore
    storeRestorePoint: async ({ text, device }) => {
      sessionBackup = { text, capturedAt: new Date().toISOString(), device: device || "" };
      try { await setJSON(K.restore, sessionBackup); } catch { /* best effort, same as desktop */ }
      return { ok: true, capturedAt: sessionBackup.capturedAt, chars: text.length };
    },
    getRestorePoint: async () => sessionBackup,
    saveBackup: async ({ text, model }) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `config-backup-${(model || "switch").replace(/\s+/g, "_")}-${stamp}.txt`;
      const r = await requireNative(Session, "File saving").saveTextFile({ filename, text });
      if (!r || !r.path) return null;
      loadSettings().then(s => sendEvent("backup", { model }, s));
      return r.path;
    },

    // Error logging
    scanErrors: async text => M.errorlog.extractErrors(text),
    recordError: async info => recordError(info || {}),

    // Packet capture (tshark needs a PC; on-device capture works fully)
    pktCheck: async () => ({
      available: false,
      reason: "Local packet capture needs Wireshark on a laptop, so it is not available on Android.\n\n" +
              "Use \"On-device capture\" — it runs the switch/firewall's own built-in packet sniffer over your live session, " +
              "which is usually the better tool on a switched network anyway."
    }),
    pktIfaces: async () => [],
    pktDeviceCmds: async ({ brand, target } = {}) => M.packets.deviceCaptureCommands(brand, target),
    pktCapture: async () => { throw new Error("Local capture is not available on Android — use On-device capture instead."); },
    pktExport: async () => { throw new Error("Local capture is not available on Android."); },

    // AI copilot
    askAI: async payload => {
      const settings = await loadSettings();
      if (!settings.provider) throw new Error("Configure an AI provider in Settings first.");
      await kbReady;
      const session = payload.session || {};
      const messages = payload.messages || [];
      const query = (messages.slice(-1)[0] || {}).content || "";
      const kbChunksHit = kbSearch(query + " " + (session.task || ""), session.brand, 6);
      const lessons = await lessonsFor(session.brand);
      const sessionErrs = (payload.sessionErrors || []).slice(-5).map(e => `- Just now: "${e.error}" after running: ${e.cmd}`);
      const systemPrompt = M.prompt.buildSystemPrompt({
        session,
        kbChunks: kbChunksHit,
        terminalTail: (payload.terminalTail || "").slice(-6000),
        cliMode: payload.cliMode,
        autopilot: !!settings.autopilot,
        errorNotes: [...lessons, ...sessionErrs].join("\n"),
      });
      sendEvent("ai_message", { brand: session.brand, model: session.model }, settings);
      return await M.ai.callAI(settings, systemPrompt, messages);
    },

    // Knowledge base
    kbInfo: async () => { await kbReady; return kbReload(); },
    kbImport: async () => {
      const files = await pickTextFiles();
      const docs = [];
      for (const f of files) {
        if (!/\.(md|txt)$/i.test(f.name)) continue;
        docs.push({ name: f.name, text: await f.text() });
      }
      if (docs.length) await addUserDocs(docs);
      return kbReload();
    },

    // Research
    researchInfo: async () => {
      const s = await loadSettings();
      return {
        enabled: !!s.researchEnabled,
        lastResearch: s.lastResearch || null,
        due: M.research.shouldRunWeekly(s.lastResearch),
        sources: s.researchSources && s.researchSources.length ? s.researchSources : M.research.DEFAULT_SOURCES,
        files: await digestFiles(),
      };
    },
    researchRun: async ({ vendors } = {}) => {
      const settings = await loadSettings();
      if (settings.provider === "ollama") {
        throw new Error("Research requires internet access; the offline Ollama provider cannot fetch sources. Switch to Anthropic/OpenAI for research.");
      }
      const useWebSearch = settings.provider === "anthropic";
      const result = await M.research.runResearch({
        vendors: vendors || [],
        sources: settings.researchSources && settings.researchSources.length ? settings.researchSources : M.research.DEFAULT_SOURCES,
        aiImpl: (systemPrompt, messages) => M.ai.callAI(settings, systemPrompt, messages, undefined, { webSearch: useWebSearch }),
      });
      const stamp = result.generatedAt.replace(/[:.]/g, "-").slice(0, 19);
      const fname = `research-digest-${stamp}.md`;
      const digests = await getJSON(K.digests, {});
      digests[fname] = result.digest;
      await setJSON(K.digests, digests);
      await addUserDocs([{ name: fname, text: result.digest }]);
      const kbInfo = await kbReload();
      const s2 = await loadSettings();
      s2.lastResearch = result.generatedAt;
      await saveSettings(s2);
      sendEvent("research_run", {}, s2);
      return {
        file: fname,
        digest: result.digest,
        sourcesOk: result.sources.filter(x => x.ok !== false).length,
        sourcesTotal: result.sources.length,
        kbDocs: kbInfo.docCount,
      };
    },
    researchRead: async fname => {
      const digests = await getJSON(K.digests, {});
      return digests[String(fname)] || "(could not read digest)";
    },
    researchSetEnabled: async on => { const s = await loadSettings(); s.researchEnabled = !!on; await saveSettings(s); return true; },
    researchSetSources: async sources => { const s = await loadSettings(); s.researchSources = sources; await saveSettings(s); return true; },
    researchOpenFolder: async () => true,

    // Session events
    onSessionData: cb => listeners.data.push(cb),
    onSessionClosed: cb => listeners.closed.push(cb),
    onSessionError: cb => listeners.error.push(cb),
    onResearchDue: cb => listeners.research.push(cb),

    // Switch baseline config generator
    swcfgVendors: async () => M.switchConfig.SUPPORTED_VENDORS,
    swcfgGenerate: async params => M.switchConfig.generateBaseline(params),
    swcfgPush: async cmds => {
      if (!connected) throw new Error("Not connected to a device.");
      const safe = (cmds || []).map(c => { try { return M.validate.sanitiseCommand(c); } catch { return null; } }).filter(Boolean);
      for (const cmd of safe) {
        await Session.write({ data: String(cmd).replace(/[\r\n]+$/, "") + "\r" });
        await new Promise(r => setTimeout(r, 250));
      }
      return { pushed: safe.length };
    },

    // Updates & links
    checkUpdate: () => checkForUpdate(),
    onUpdateAvailable: cb => listeners.update.push(cb),
    openExternal: async url => {
      if (typeof url !== "string" || !/^(https?|ssh|telnet|rdp):\/\//i.test(url)) return;
      const r = await requireNative(Session, "Link opening").openUrl({ url });
      if (r && r.ok === false && r.error) throw new Error(r.error);
    },

    // Network scanner
    scannerStart: async (target, opts) => {
      const o = opts || {};
      M.scanner.parseRange(target);
      const ports = o.fullScan ? Object.keys(PORT_NAMES).map(Number) : M.scanner.QUICK_PORTS;
      const res = await requireNative(Network, "Network scanner").scanRange({
        target: String(target || "").trim(),
        concurrency: Math.min(parseInt(o.concurrency, 10) || 50, 150),
        pingTimeout: parseInt(o.pingTimeout, 10) || 1000,
        portTimeout: parseInt(o.portTimeout, 10) || 600,
        portFallback: !!o.portFallback,
        ports,
      });
      return (res.results || []).map(enrichHost);
    },
    scannerNmap: async () => false,
    scannerWoL: async (mac, bcast) => {
      await requireNative(Network, "Network scanner").wakeOnLan({ mac: String(mac || ""), broadcast: String(bcast || "255.255.255.255") });
      return true;
    },
    scannerTraceroute: async ip => requireNative(Network, "Network scanner").traceroute({ ip: String(ip || "") }),
    onScanProgress: cb => listeners.scan.push(cb),
  };

  // Startup: weekly research reminder, update check, native health report.
  window.addEventListener("load", async () => {
    try {
      const s = await loadSettings();
      if (s.researchEnabled && M.research.shouldRunWeekly(s.lastResearch)) emit("research", undefined);
    } catch {}
    setTimeout(async () => {
      const u = await checkForUpdate();
      if (u.hasUpdate) emit("update", u);
    }, 12000);
    setTimeout(async () => {
      if (!Session) return;
      await versionReady;
      const kbInfo = await kbReady;
      const ok = !!(Session && Network && Preferences && M && document.getElementById("btn-connect") && startupErrors.length === 0);
      Session.reportStatus({
        message: `ready=${ok} version=${appVersion} build=${appBuild} webview=${(/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || "?"} ` +
                 `kbDocs=${kbInfo ? kbInfo.docCount : 0} errors=${JSON.stringify(startupErrors.slice(0, 5))}`,
        error: !ok,
      });
    }, 3000);
  });

  window.__ahuvaBridgeInternals = { startupErrors, kbReady, enrichHost };
})();
