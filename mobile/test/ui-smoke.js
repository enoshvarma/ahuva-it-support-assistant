#!/usr/bin/env node
// Drives the built Android web app (mobile/www) in Chromium at phone size with mocked
// native plugins, exercising the real renderer + bridge end to end.
// Usage: node test/ui-smoke.js [screenshotDir]
const path = require("path");
const fs = require("fs");
const http = require("http");
const { chromium } = require("playwright");

const WWW = path.join(__dirname, "..", "www");
const SHOTS = process.argv[2] || path.join(__dirname, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".md": "text/markdown", ".png": "image/png", ".svg": "image/svg+xml" };
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const p = path.join(WWW, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
      if (!p.startsWith(WWW) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    }).listen(0, "127.0.0.1", () => resolve(srv));
  });
}

// Stand-in for Capacitor's injected runtime + our native plugins.
const MOCK_NATIVE = `
(() => {
  const listeners = {};
  const on = (plugin) => (event, cb) => { (listeners[plugin + ":" + event] ||= []).push(cb); return Promise.resolve({ remove(){} }); };
  const fire = (plugin, event, data) => (listeners[plugin + ":" + event] || []).forEach(cb => cb(data));
  const store = {};
  window.__native = { calls: [], written: "" };
  const rec = (name, args) => window.__native.calls.push({ name, args });
  let connected = false;
  window.Capacitor = { Plugins: {
    Preferences: {
      get: async ({ key }) => ({ value: key in store ? store[key] : null }),
      set: async ({ key, value }) => { store[key] = value; },
    },
    App: { getInfo: async () => ({ version: "1.7.0", build: "5" }), addListener: on("App") },
    AhuvaSession: {
      addListener: on("AhuvaSession"),
      connect: async (cfg) => {
        rec("connect", cfg);
        if (cfg.connType === "ssh" && cfg.password !== "cisco") throw new Error("Authentication failed — check the username and password.");
        connected = true;
        setTimeout(() => fire("AhuvaSession", "sessionData", { data: "\\r\\nC2960-LAB#" }), 50);
        return { ok: true };
      },
      disconnect: async () => { connected = false; rec("disconnect"); return { ok: true }; },
      write: async ({ data }) => {
        rec("write", data);
        window.__native.written += data;
        if (!connected) throw new Error("Not connected to any device.");
        const cmd = data.replace(/\\r$/, "");
        let out = "";
        if (/^show version/.test(cmd)) out = "Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE11\\r\\nModel number : WS-C2960-24TT-L";
        else if (/^terminal length/.test(cmd)) out = "";
        else if (/^show running-config/.test(cmd)) out = "Building configuration...\\r\\nhostname C2960-LAB\\r\\ninterface Vlan1\\r\\n ip address 10.0.0.2 255.255.255.0\\r\\nend";
        else if (cmd) out = "% Invalid input detected at '^' marker.";
        setTimeout(() => fire("AhuvaSession", "sessionData", { data: cmd + "\\r\\n" + out + "\\r\\nC2960-LAB#" }), 30);
      },
      listSerialPorts: async () => ({ ports: [{ path: "usb:1002:0", friendly: "FT232R USB UART" }] }),
      saveTextFile: async ({ filename, text }) => { rec("saveTextFile", { filename, len: text.length, text }); return { path: filename }; },
      openUrl: async ({ url }) => { rec("openUrl", url); return { ok: true }; },
      reportStatus: async (m) => { rec("reportStatus", m); },
      selfTestConfig: async () => ({ host: null }),
    },
    AhuvaNetwork: {
      addListener: on("AhuvaNetwork"),
      scanRange: async (o) => {
        rec("scanRange", o);
        const hosts = [
          { ip: "10.0.0.1", status: "online", mac: "00:1A:A1:11:22:33", hostname: "gw.lab", openPorts: [22, 443], notes: [] },
          { ip: "10.0.0.2", status: "online", mac: "", hostname: "", openPorts: [23, 80], notes: ["NetBIOS: SW2"] },
          { ip: "10.0.0.3", status: "offline", mac: "", hostname: "", openPorts: [], notes: [] },
        ];
        hosts.forEach((h, i) => setTimeout(() => fire("AhuvaNetwork", "scanProgress", { result: h, done: i + 1, total: hosts.length }), 20 * i));
        await new Promise(r => setTimeout(r, 120));
        return { results: hosts };
      },
      wakeOnLan: async (o) => { rec("wakeOnLan", o); return { ok: true }; },
      traceroute: async ({ ip }) => ({ ip, output: "traceroute to " + ip + "\\n 1  10.0.0.1  1.2 ms\\n 2  " + ip + "  3.4 ms\\n", error: false }),
    },
  }};
  window.alert = () => {}; window.confirm = () => true;
})();`;

// LEGACY=1 removes APIs newer than Chrome 69 (Android 9's stock WebView) so the polyfills in compat.js are exercised.
const STRIP_MODERN_APIS = `
(() => {
  delete window.globalThis;
  delete window.queueMicrotask;
  delete Array.prototype.flat;
  delete Array.prototype.flatMap;
  delete Object.fromEntries;
  delete String.prototype.trimEnd;
  delete String.prototype.trimStart;
  delete Promise.allSettled;
  delete AbortSignal.timeout;
  delete Element.prototype.replaceChildren;
  delete Document.prototype.replaceChildren;
  delete DocumentFragment.prototype.replaceChildren;
  delete Blob.prototype.text;
})();`;

const AI_REPLY = {
  choices: [{ message: { content: JSON.stringify({
    reply: "Run show vlan brief to list VLANs.",
    commands: [{ cmd: "show vlan brief", why: "List VLANs and member ports" }],
    needs: [],
  }) } }],
};

async function main() {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  let aiRequests = [];
  await page.route("https://ai.test/**", async route => {
    aiRequests.push(JSON.parse(route.request().postData()));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(AI_REPLY) });
  });
  await page.route("https://api.github.com/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "Android APK v1.7.0", body: "versionCode: 5", html_url: "https://github.com/x" }) }));
  if (process.env.LEGACY === "1") await page.addInitScript(STRIP_MODERN_APIS);
  await page.addInitScript(MOCK_NATIVE);
  const view = async v => { await page.click(`#m-nav button[data-view="${v}"]`); await page.waitForTimeout(150); };

  const results = [];
  const check = async (name, fn) => {
    try { const d = await fn(); results.push(["PASS", name, d || ""]); }
    catch (e) { results.push(["FAIL", name, e.message.split("\n")[0]]); }
  };
  const shot = n => page.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: false });
  const text = sel => page.locator(sel).innerText();

  await page.goto(base);
  await page.waitForTimeout(1500);

  await check("app boots with KB + welcome", async () => {
    const kb = await text("#kb-summary");
    if (!/16 reference documents loaded/.test(kb)) throw new Error(kb);
    const chat = await text("#chat");
    if (!/on-site copilot/.test(chat)) throw new Error("welcome missing");
    return kb.split("\n")[0];
  });
  await shot("01-home");

  await check("settings: model presets + test AI", async () => {
    await page.click("#btn-settings");
    await page.selectOption("#s-provider", "openai-compatible");
    await page.waitForTimeout(200);
    await page.fill("#s-base", "https://ai.test/v1");
    await page.fill("#s-key", "sk-test");
    await page.fill("#s-model", "mock-model");
    await page.click("#s-test");
    await page.waitForFunction(() => /reachable|✗/.test(document.getElementById("s-test-result").textContent), null, { timeout: 5000 });
    const r = await text("#s-test-result");
    if (!/Provider reachable/.test(r)) throw new Error(r);
    await shot("02-settings");
    await page.click("#s-save");
    const saved = await page.evaluate(() => window.ahuva.getSettings());
    if (saved.baseUrl !== "https://ai.test/v1" || saved.provider !== "openai-compatible") throw new Error(JSON.stringify(saved));
    return r.trim();
  });

  await check("ssh wrong password shows error", async () => {
    await view("session");
    await page.click("#seg-ssh");
    await page.fill("#f-host", "10.0.0.2");
    await page.fill("#f-user", "admin");
    await page.fill("#f-pass", "nope");
    await page.click("#btn-connect");
    await page.waitForTimeout(400);
    const chat = await page.evaluate(() => document.getElementById("chat").textContent);
    if (!/Authentication failed/.test(chat)) throw new Error("no auth error shown");
  });

  await check("ssh connect + device auto-detect", async () => {
    await page.fill("#f-pass", "cisco");
    await page.click("#btn-connect");
    await page.waitForFunction(() => /Connected/i.test(document.getElementById("conn-label").textContent), null, { timeout: 8000 });
    const connectCall = await page.evaluate(() => window.__native.calls.filter(c => c.name === "connect").pop().args);
    if (connectCall.connType !== "ssh" || connectCall.host !== "10.0.0.2" || connectCall.username !== "admin") throw new Error(JSON.stringify(connectCall));
    await page.waitForTimeout(6000);
    const written = await page.evaluate(() => window.__native.written);
    if (!/\r/.test(written)) throw new Error("commands not CR-terminated");
    const label = await text("#conn-label");
    const mview = await page.evaluate(() => document.body.dataset.mview);
    if (mview !== "terminal") throw new Error("did not switch to terminal view: " + mview);
    return label.trim();
  });
  await page.evaluate(() => { const b = document.getElementById("consent-ok"); if (b && b.offsetParent) b.click(); });
  await shot("03-connected");

  await check("terminal shows device output", async () => {
    const t = await page.evaluate(() => document.querySelector(".xterm-rows").textContent);
    if (!/C2960-LAB#/.test(t)) throw new Error(t.slice(0, 200));
  });

  await check("quick keys send Tab / Ctrl+C", async () => {
    await page.evaluate(() => { window.__native.written = ""; });
    await page.click('#m-keys button:has-text("Tab")');
    await page.click('#m-keys button:has-text("Ctrl+C")');
    const w = await page.evaluate(() => window.__native.written);
    if (w !== "\t\x03") throw new Error(JSON.stringify(w));
  });

  await check("copilot: ask AI with KB + session context", async () => {
    await view("copilot");
    await page.waitForFunction(() => !state.busy, null, { timeout: 30000 });
    aiRequests = [];
    await page.fill("#chat-input", "How do I list the VLANs?");
    await page.click("#btn-send");
    await page.waitForFunction(() => /show vlan brief/.test(document.getElementById("chat").innerText), null, { timeout: 8000 });
    const req = aiRequests.pop();
    const sys = req.messages[0].content;
    if (!/10\.0\.0\.2|C2960|Cisco/.test(sys)) throw new Error("session context missing from system prompt");
    if (!req || req.messages.slice(-1)[0].content !== "How do I list the VLANs?") {
      const dbg = await page.evaluate(() => ({ busy: state.busy, hist: state.history.slice(-3).map(h => h.role + ":" + String(h.content).slice(0, 60)) }));
      throw new Error("user message not sent " + JSON.stringify({ n: aiRequests.length, last: req && req.messages.slice(-1)[0].content.slice(0, 80), dbg }));
    }
    return `system prompt ${sys.length} chars`;
  });
  await shot("04-copilot");

  await check("config backup saves file", async () => {
    await view("terminal");
    await page.click("#btn-backup");
    await page.waitForFunction(() => window.__native.calls.some(c => c.name === "saveTextFile"), null, { timeout: 40000 });
    const call = await page.evaluate(() => window.__native.calls.find(c => c.name === "saveTextFile").args);
    if (!/^config-backup-/.test(call.filename) || !/hostname C2960-LAB/.test(call.text)) throw new Error(JSON.stringify(call).slice(0, 200));
    await page.waitForFunction(() => /Backup saved/.test(document.getElementById("chat").textContent), null, { timeout: 5000 });
    return call.filename;
  });

  await check("network scanner + WoL + traceroute", async () => {
    await view("copilot");
    await page.click("#tab-scanner");
    await page.fill("#scan-target", "10.0.0.0/30");
    await page.click("#scan-start");
    await page.waitForFunction(() => document.querySelectorAll("#scan-results .scan-host, #scan-results [data-ip]").length >= 2 || /10\.0\.0\.2/.test(document.getElementById("scan-results").innerText), null, { timeout: 8000 });
    const out = await text("#scan-results");
    if (!/Cisco/.test(out) || !/SSH|22/.test(out)) throw new Error(out.slice(0, 300));
    const scan = await page.evaluate(() => window.__native.calls.find(c => c.name === "scanRange").args);
    if (scan.target !== "10.0.0.0/30" || !Array.isArray(scan.ports)) throw new Error(JSON.stringify(scan));
    if (!(scan.portTimeout >= 1000)) throw new Error("port probe timeout too short for phone Wi-Fi: " + scan.portTimeout);
    await shot("05-scanner");
    const wol = await page.evaluate(() => window.ahuva.scannerWoL("00:11:22:33:44:55", "255.255.255.255"));
    const tr = await page.evaluate(() => window.ahuva.scannerTraceroute("10.0.0.2"));
    if (wol !== true || !/10\.0\.0\.1/.test(tr.output)) throw new Error("wol/trace");
    return (await text("#scan-summary")).trim();
  });

  await check("switch config generator", async () => {
    await page.click("#tab-swcfg");
    await page.waitForTimeout(300);
    await page.selectOption("#swcfg-vendor", "cisco-ios");
    await page.fill("#swcfg-hostname", "SW-FLOOR2");
    await page.fill("#swcfg-ip", "10.0.0.10");
    await page.fill("#swcfg-mask", "255.255.255.0");
    await page.fill("#swcfg-gw", "10.0.0.1");
    await page.click("#swcfg-generate");
    await page.waitForTimeout(300);
    const cfg = await page.locator("#swcfg-output").evaluate(el => el.value || el.textContent);
    if (!/hostname SW-FLOOR2/.test(cfg)) throw new Error(cfg.slice(0, 200));
    await shot("06-swcfg");
    return cfg.split("\n").length + " config lines";
  });

  await check("packets: on-device capture guidance", async () => {
    await page.click("#tab-packets");
    await page.waitForTimeout(300);
    const t = await text("#pkt-output");
    if (!/not available on Android/.test(t)) throw new Error(t.slice(0, 120));
    await page.waitForFunction(() => !state.busy, null, { timeout: 30000 });
    aiRequests = [];
    await page.click("#pkt-device");
    await page.waitForFunction(() => !state.busy, null, { timeout: 30000 });
    const last = aiRequests.length ? aiRequests[aiRequests.length - 1].messages.slice(-1)[0].content : "";
    if (!/on-device packet capture/i.test(last)) throw new Error("device capture not handed to copilot: " + last.slice(0, 80));
    const out = await page.evaluate(() => document.getElementById("pkt-output").textContent);
    if (!/Embedded Packet Capture/.test(out)) throw new Error(out.slice(0, 120));
  });

  await check("usb serial port listing", async () => {
    await view("session");
    await page.click("#seg-serial");
    await page.waitForTimeout(300);
    const opts = await page.locator("#f-com option").allInnerTexts();
    if (!opts.some(o => /FT232R/.test(o))) throw new Error(JSON.stringify(opts));
    return opts[0];
  });

  await check("research center renders", async () => {
    await page.click("#btn-research");
    await page.waitForTimeout(400);
    const t = await text("#drawer-research");
    if (!/Cisco|Fortinet|Allied/.test(t)) throw new Error("sources missing");
    await shot("07-research");
    await page.click("#research-close");
  });

  await check("layout fits phone width (no horizontal scroll)", async () => {
    const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth }));
    if (w.doc > w.vw + 1) throw new Error(JSON.stringify(w));
    return `${w.doc}px`;
  });

  await check("no JavaScript errors", async () => {
    const real = errors.filter(e => !/favicon/.test(e));
    if (real.length) throw new Error(real.slice(0, 3).join(" | "));
  });

  await browser.close();
  srv.close();
  for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? "  — " + d : ""}`);
  const failed = results.filter(r => r[0] === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} UI checks passed. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
