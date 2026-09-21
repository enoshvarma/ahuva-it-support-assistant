/* bridge.js — Implements window.ahuva for Capacitor Android
 * Replaces Electron's preload.js IPC bridge.
 * Loads AFTER modules.js (pure logic) and Capacitor's runtime. */

(function () {
  "use strict";

  // ──── Capacitor plugin references ────────────────────────────────────────
  const { Preferences }  = Capacitor.Plugins;
  const { Filesystem }   = Capacitor.Plugins;
  const { Browser }      = Capacitor.Plugins;
  const AhuvaSession     = Capacitor.Plugins.AhuvaSession;
  const AhuvaNetwork     = Capacitor.Plugins.AhuvaNetwork;

  // ──── Pure-logic modules (from modules.js bundle) ─────────────────────────
  const M = window.AhuvaModules;

  // ──── Settings persistence ────────────────────────────────────────────────
  const SETTINGS_KEY = "ahuva_settings";
  let _cachedSettings = null;

  async function _loadSettings() {
    if (_cachedSettings) return _cachedSettings;
    try {
      const { value } = await Preferences.get({ key: SETTINGS_KEY });
      _cachedSettings = value ? JSON.parse(value) : {};
    } catch { _cachedSettings = {}; }
    return _cachedSettings;
  }

  async function _saveSettings(s) {
    _cachedSettings = s;
    await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(s) });
  }

  // ──── Restore point persistence ───────────────────────────────────────────
  const RESTORE_KEY = "ahuva_restore_point";

  // ──── Error log persistence ───────────────────────────────────────────────
  const ERRORS_KEY = "ahuva_errors";
  const ERROR_PATTERNS = [
    /% invalid input/i, /% incomplete command/i, /% ambiguous command/i,
    /% authorization failed/i, /% access denied/i, /command not found/i,
    /error:/i, /failed/i, /timed out/i
  ];

  // ──── Event bus ───────────────────────────────────────────────────────────
  const _listeners = {
    sessionData: [], sessionClosed: [], sessionError: [],
    updateAvailable: [], researchDue: [], scanProgress: []
  };

  function _emit(type, data) {
    for (const cb of (_listeners[type] || [])) { try { cb(data); } catch {} }
  }

  // Listen for native plugin events
  if (AhuvaSession) {
    AhuvaSession.addListener("sessionData",   d => _emit("sessionData", d.data));
    AhuvaSession.addListener("sessionClosed", d => _emit("sessionClosed", d.reason || "closed"));
    AhuvaSession.addListener("sessionError",  d => _emit("sessionError", d.message || "error"));
  }
  if (AhuvaNetwork) {
    AhuvaNetwork.addListener("scanProgress",  d => _emit("scanProgress", d));
  }

  // ──── AI provider (fetch-based, browser-compatible) ───────────────────────

  function _buildAIRequest(settings, systemPrompt, messages, opts) {
    const provider = String(settings.provider || "anthropic");
    const model    = String(settings.model || "").trim();
    const apiKey   = String(settings.apiKey || "").trim();

    if (provider === "google") {
      const base = String(settings.baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/+$/, "");
      return { url: base + "/chat/completions", headers: { "content-type": "application/json", ...(apiKey ? { authorization: "Bearer " + apiKey } : {}) },
        body: { model: model || "gemini-2.0-flash", messages: [{ role: "system", content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: String(m.content || "") }))] } };
    }
    if (provider === "anthropic") {
      const base = String(settings.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
      return { url: base + "/v1/messages", headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: { model: model || "claude-sonnet-4-6", max_tokens: opts.webSearch ? 4000 : 3500, system: systemPrompt,
          messages: messages.map(m => ({ role: m.role, content: String(m.content || "") })),
          ...(opts.webSearch ? { tools: [{ type: "web_search_20250305", name: "web_search" }] } : {}) } };
    }
    if (provider === "ollama") {
      const base = String(settings.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
      return { url: base + "/api/chat", headers: { "content-type": "application/json" },
        body: { model: model || "llama3.1", stream: false, messages: [{ role: "system", content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: String(m.content || "") }))] } };
    }
    // openai / openai-compatible
    const defaultBase = provider === "openai" ? "https://api.openai.com/v1" : "";
    const base = String(settings.baseUrl || defaultBase).replace(/\/+$/, "");
    if (!base) throw new Error("This provider requires a Base URL in Settings.");
    return { url: base + "/chat/completions", headers: { "content-type": "application/json", ...(apiKey ? { authorization: "Bearer " + apiKey } : {}) },
      body: { model: model || "gpt-4o-mini", messages: [{ role: "system", content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: String(m.content || "") }))] } };
  }

  function _extractText(provider, data) {
    try {
      if (provider === "anthropic") return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
      if (provider === "ollama") return (data.message && data.message.content) || "";
      return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    } catch { return ""; }
  }

  function _parseCopilotReply(text) {
    const fallback = { reply: String(text || "").trim(), commands: [], needs: [] };
    if (!text) return { reply: "(empty response from AI provider)", commands: [], needs: [] };
    let raw = String(text).trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) raw = fence[1].trim();
    const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return fallback;
    try {
      const obj = JSON.parse(raw.slice(start, end + 1));
      const commands = Array.isArray(obj.commands)
        ? obj.commands.filter(c => c && typeof c.cmd === "string" && c.cmd.trim()).map(c => ({ cmd: c.cmd.trim(), why: String(c.why || "").trim() }))
        : [];
      const needs = Array.isArray(obj.needs) ? obj.needs.map(String) : [];
      return { reply: String(obj.reply || "").trim() || fallback.reply, commands, needs };
    } catch { return fallback; }
  }

  async function _callAI(settings, systemPrompt, messages, opts) {
    const MAX_RETRIES = 2;
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const req = _buildAIRequest(settings, systemPrompt, messages, opts || {});
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);
        const res = await fetch(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body), signal: controller.signal });
        clearTimeout(timer);
        const bodyText = await res.text();
        if (!res.ok) {
          let msg = bodyText.slice(0, 400);
          try { const j = JSON.parse(bodyText); msg = (j.error && (j.error.message || j.error.type)) || msg; } catch {}
          const err = new Error("AI provider error (HTTP " + res.status + "): " + msg);
          err.status = res.status;
          throw err;
        }
        const data = JSON.parse(bodyText);
        return _parseCopilotReply(_extractText(settings.provider || "anthropic", data));
      } catch (e) {
        lastErr = e;
        if (attempt < MAX_RETRIES && e.status && (e.status === 429 || e.status === 503 || e.status === 529)) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
          continue;
        }
        break;
      }
    }
    throw lastErr;
  }

  // ──── Knowledge base (loads bundled KB files via fetch) ────────────────────

  let _kbChunks = null;

  async function _loadKB() {
    if (_kbChunks) return _kbChunks;
    _kbChunks = [];
    const KB_FILES = [
      "allied-telesis.md", "cisco-ios.md", "cisco-asa.md", "core-switching.md",
      "field-checklist.md", "firewall-deep.md", "fortigate.md", "generic-firewall.md",
      "generic-router.md", "generic-switch.md", "juniper.md", "mikrotik.md",
      "quantum.md", "servers-linux-windows.md", "storage-nas-netapp.md",
      "troubleshooting-playbooks.md"
    ];
    for (const f of KB_FILES) {
      try {
        const res = await fetch("kb/" + f);
        if (!res.ok) continue;
        const text = await res.text();
        // Chunk on headings, max 1600 chars
        const sections = text.split(/(?=^#{1,3}\s)/m);
        for (const sec of sections) {
          const trimmed = sec.trim();
          if (trimmed.length < 20) continue;
          const chunk = trimmed.length > 1600 ? trimmed.slice(0, 1600) : trimmed;
          _kbChunks.push({ source: f.replace(".md", ""), text: chunk, keywords: chunk.toLowerCase() });
        }
      } catch {}
    }
    return _kbChunks;
  }

  function _searchKB(query) {
    if (!_kbChunks || !_kbChunks.length) return [];
    const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const scored = _kbChunks.map(c => {
      let score = 0;
      for (const t of terms) { if (c.keywords.includes(t)) score++; }
      return { ...c, score };
    }).filter(c => c.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 6);
  }

  // ──── Packet capture device-side commands (from packets.js) ───────────────

  const DEVICE_CAPTURE_CMDS = {
    fortigate: [
      { cmd: 'diagnose sniffer packet any "host {IP}" 4 100', why: "Capture 100 packets on all interfaces for a specific host" },
      { cmd: 'diagnose sniffer packet {IFACE} "" 4 50',       why: "Capture 50 packets on a specific interface" }
    ],
    cisco: [
      { cmd: "monitor capture CAP interface {IFACE} both", why: "Set up EPC capture point" },
      { cmd: "monitor capture CAP match any",               why: "Capture all traffic" },
      { cmd: "monitor capture CAP start",                   why: "Start capture" },
      { cmd: "monitor capture CAP stop",                    why: "Stop capture" },
      { cmd: "show monitor capture CAP buffer brief",       why: "View captured packets" }
    ],
    "allied-telesis": [
      { cmd: "debug ip packet interface {IFACE}",           why: "Enable packet debug on interface" },
      { cmd: "show log | include IP-PKT",                   why: "View captured entries" }
    ],
    mikrotik: [
      { cmd: '/tool sniffer set filter-interface={IFACE} filter-ip-address={IP}', why: "Configure sniffer filter" },
      { cmd: "/tool sniffer start",                         why: "Start capture" },
      { cmd: "/tool sniffer stop",                          why: "Stop capture" },
      { cmd: "/tool sniffer packet print",                  why: "View captured packets" }
    ],
    "palo-alto": [
      { cmd: "debug dataplane packet-diag set filter match source {IP}", why: "Set capture filter" },
      { cmd: "debug dataplane packet-diag set capture stage receive file cap.pcap", why: "Configure capture" },
      { cmd: "debug dataplane packet-diag set capture on",  why: "Start capture" },
      { cmd: "debug dataplane packet-diag set capture off", why: "Stop capture" }
    ],
    juniper: [
      { cmd: "monitor traffic interface {IFACE} count 100", why: "Capture 100 packets on interface" }
    ]
  };

  function _deviceCaptureCmds(vendor) {
    const v = String(vendor || "").toLowerCase();
    for (const [key, cmds] of Object.entries(DEVICE_CAPTURE_CMDS)) {
      if (v.includes(key)) return cmds;
    }
    return [{ cmd: "show monitor capture", why: "Check your vendor's packet capture capability" }];
  }

  // ──── Research persistence ────────────────────────────────────────────────

  const RESEARCH_KEY = "ahuva_research";

  // ──── window.ahuva — the public API ──────────────────────────────────────

  window.ahuva = {

    // ─── Settings ────────────────────────────────────────────────────────
    getSettings: () => _loadSettings(),
    saveSettings: (s) => _saveSettings(s),

    testAI: async () => {
      const settings = await _loadSettings();
      return _callAI(settings, "Reply with exactly: CONNECTION_OK", [{ role: "user", content: "ping" }], {});
    },

    modelPresets: (provider) => {
      const freeOnly = provider && provider.freeOnly;
      const p = (provider && provider.provider) || provider;
      return { presets: M.models.presetsFor(p, freeOnly), providers: M.models.PROVIDER_LABELS, freeNote: M.models.FREE_NOTE, groqNote: M.models.GROQ_NOTE };
    },

    // ─── Serial ports ────────────────────────────────────────────────────
    listSerialPorts: async () => {
      if (!AhuvaSession) return [];
      try { return (await AhuvaSession.listSerialPorts()).ports || []; } catch { return []; }
    },

    // ─── Device session ──────────────────────────────────────────────────
    connect: async (cfg) => {
      if (!AhuvaSession) throw new Error("Native session plugin not available");
      return AhuvaSession.connect(cfg);
    },
    disconnect: async () => {
      if (!AhuvaSession) return;
      return AhuvaSession.disconnect();
    },
    write: async (data) => {
      if (!AhuvaSession) return;
      return AhuvaSession.write({ data });
    },
    sendCommand: async (cmd) => {
      if (!AhuvaSession) return;
      return AhuvaSession.sendCommand({ command: cmd });
    },

    // ─── Safety / mode (pure JS) ────────────────────────────────────────
    classify:   (cmd) => M.safety.classifyCommand(String(cmd || "")),
    detectMode: (buf) => M.mode.detectCliMode(buf),
    prepFor:    (p)   => M.mode.prepCommandsFor(p.mode, p.cmd),

    // ─── Device fingerprinting (pure JS) ────────────────────────────────
    fingerprint: (text) => M.detect.fingerprintDevice(text),
    probes:      ()     => M.detect.PROBE_COMMANDS,
    arpCmds:     (brand)=> M.detect.arpDiscoveryCommands(brand),
    parsePing:   (text) => M.detect.parsePingOutput(text),

    // ─── Backup / restore ───────────────────────────────────────────────
    storeRestorePoint: async (p) => {
      await Preferences.set({ key: RESTORE_KEY, value: JSON.stringify(p) });
      return { ok: true };
    },
    getRestorePoint: async () => {
      const { value } = await Preferences.get({ key: RESTORE_KEY });
      return value ? JSON.parse(value) : null;
    },
    saveBackup: async (p) => {
      // Save to Downloads-accessible area
      try {
        const filename = "backup_" + (p.hostname || "device") + "_" + new Date().toISOString().slice(0, 10) + ".txt";
        await Filesystem.writeFile({ path: filename, data: p.config || p.data || "", directory: "DOCUMENTS", encoding: "utf8" });
        return { ok: true, path: filename };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // ─── Error scanning ─────────────────────────────────────────────────
    scanErrors: (text) => {
      const lines = String(text || "").split("\n");
      const found = [];
      for (const line of lines) {
        for (const p of ERROR_PATTERNS) {
          if (p.test(line)) { found.push(line.trim()); break; }
        }
      }
      return found;
    },
    recordError: async (info) => {
      try {
        const { value } = await Preferences.get({ key: ERRORS_KEY });
        const log = value ? JSON.parse(value) : [];
        log.push({ ...info, ts: Date.now() });
        if (log.length > 200) log.splice(0, log.length - 200);
        await Preferences.set({ key: ERRORS_KEY, value: JSON.stringify(log) });
      } catch {}
    },

    // ─── Packet capture ─────────────────────────────────────────────────
    pktCheck:      () => ({ installed: false, reason: "Packet capture requires Wireshark/tshark (desktop only). Use on-device capture instead." }),
    pktIfaces:     () => [],
    pktDeviceCmds: (p) => _deviceCaptureCmds(p),
    pktCapture:    () => { throw new Error("Local packet capture is not available on Android. Use the on-device capture button for your switch/firewall's built-in sniffer."); },
    pktExport:     () => { throw new Error("Not available on Android."); },

    // ─── AI copilot ─────────────────────────────────────────────────────
    askAI: async (payload) => {
      const settings = await _loadSettings();
      await _loadKB();
      const kbHits = _searchKB((payload.context && payload.context.brand || "") + " " + (payload.prompt || ""));
      const systemPrompt = M.prompt.buildSystemPrompt({
        session:  payload.context || {},
        kbChunks: kbHits,
        terminalTail: payload.context && payload.context.terminalTail || "",
        cliMode:  payload.context && payload.context.cliMode || null,
        autopilot: payload.context && payload.context.autopilot,
        errorNotes: payload.context && payload.context.errorNotes || ""
      });
      const messages = payload.history || [];
      messages.push({ role: "user", content: payload.prompt || "" });
      return _callAI(settings, systemPrompt, messages, {});
    },

    // ─── Knowledge base ─────────────────────────────────────────────────
    kbInfo: async () => {
      const chunks = await _loadKB();
      const sources = [...new Set(chunks.map(c => c.source))];
      return { chunks: chunks.length, sources, userDocs: 0 };
    },
    kbImport: () => {
      // Mobile KB import not yet supported
      return { ok: false, error: "Knowledge base import is not yet available on Android. Built-in vendor docs are pre-loaded." };
    },

    // ─── Research ───────────────────────────────────────────────────────
    researchInfo: async () => {
      const { value } = await Preferences.get({ key: RESEARCH_KEY });
      const info = value ? JSON.parse(value) : {};
      return { enabled: info.enabled || false, lastRun: info.lastRun || null, sources: info.sources || [], digests: info.digests || [] };
    },
    researchRun: async (p) => {
      // Research uses AI to fetch and summarise vendor advisories
      const settings = await _loadSettings();
      const { value } = await Preferences.get({ key: RESEARCH_KEY });
      const info = value ? JSON.parse(value) : {};
      const sources = info.sources || [
        "https://tools.cisco.com/security/center/publicationListing.x",
        "https://www.fortiguard.com/psirt",
        "https://supportportal.juniper.net/s/category/Security-Advisories"
      ];
      const prompt = "Summarise the latest network security advisories relevant to: " + sources.join(", ");
      try {
        const result = await _callAI(settings, "You are a network security research assistant. Provide a concise digest of recent advisories.", [{ role: "user", content: prompt }], { webSearch: settings.provider === "anthropic" });
        const digest = { date: new Date().toISOString(), content: result.reply };
        info.lastRun = digest.date;
        info.digests = (info.digests || []).concat(digest).slice(-10);
        await Preferences.set({ key: RESEARCH_KEY, value: JSON.stringify(info) });
        return { ok: true, digest };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    researchRead:       async (f) => { const { value } = await Preferences.get({ key: RESEARCH_KEY }); const info = value ? JSON.parse(value) : {}; return (info.digests || []).find(d => d.date === f) || null; },
    researchSetEnabled: async (on) => { const { value } = await Preferences.get({ key: RESEARCH_KEY }); const info = value ? JSON.parse(value) : {}; info.enabled = !!on; await Preferences.set({ key: RESEARCH_KEY, value: JSON.stringify(info) }); },
    researchSetSources: async (s) => { const { value } = await Preferences.get({ key: RESEARCH_KEY }); const info = value ? JSON.parse(value) : {}; info.sources = s; await Preferences.set({ key: RESEARCH_KEY, value: JSON.stringify(info) }); },
    researchOpenFolder: () => { /* No file manager on Android from WebView */ },

    // ─── Switch config (pure JS) ────────────────────────────────────────
    swcfgVendors:  () => M.switchConfig.SUPPORTED_VENDORS,
    swcfgGenerate: (params) => M.switchConfig.generateBaseline(params),
    swcfgPush: async (p) => {
      if (!AhuvaSession) throw new Error("Not connected to a device");
      const cmds = p.commands || p;
      for (const cmd of (Array.isArray(cmds) ? cmds : [cmds])) {
        await AhuvaSession.sendCommand({ command: String(cmd).trim() });
        await new Promise(r => setTimeout(r, 300));
      }
      return { ok: true };
    },

    // ─── Updater ────────────────────────────────────────────────────────
    checkUpdate: async () => {
      try {
        const res = await fetch("https://api.github.com/repos/enoshvarma/ahuva-it-support-assistant/releases/latest");
        if (!res.ok) return { available: false };
        const data = await res.json();
        const remote = String(data.tag_name || "").replace(/^v/, "");
        const current = "1.7.0";
        if (remote && remote !== current) return { available: true, version: remote, url: data.html_url };
        return { available: false };
      } catch { return { available: false }; }
    },
    openExternal: async (url) => {
      try { await Browser.open({ url }); } catch { window.open(url, "_blank"); }
    },

    // ─── Network scanner ────────────────────────────────────────────────
    scannerStart: async (p) => {
      if (!AhuvaNetwork) throw new Error("Network scanner plugin not available");
      return AhuvaNetwork.scanRange({ target: p.target, opts: p.opts || {} });
    },
    scannerNmap: async () => {
      return { error: "Nmap enrichment requires the nmap binary (not available on Android by default)." };
    },
    scannerWoL: async (p) => {
      if (!AhuvaNetwork) throw new Error("Network plugin not available");
      return AhuvaNetwork.wakeOnLan({ mac: p.mac, broadcast: p.broadcast });
    },
    scannerTraceroute: async (p) => {
      if (!AhuvaNetwork) throw new Error("Network plugin not available");
      return AhuvaNetwork.traceroute({ ip: p.ip });
    },

    // ─── Event listeners ────────────────────────────────────────────────
    onSessionData:     (cb) => _listeners.sessionData.push(cb),
    onSessionClosed:   (cb) => _listeners.sessionClosed.push(cb),
    onSessionError:    (cb) => _listeners.sessionError.push(cb),
    onUpdateAvailable: (cb) => _listeners.updateAvailable.push(cb),
    onResearchDue:     (cb) => _listeners.researchDue.push(cb),
    onScanProgress:    (cb) => _listeners.scanProgress.push(cb),
  };

  // Check for updates on startup
  setTimeout(async () => {
    try {
      const u = await window.ahuva.checkUpdate();
      if (u.available) _emit("updateAvailable", u);
    } catch {}
  }, 5000);

  console.log("[Ahuva] Bridge initialized for Android");
})();
