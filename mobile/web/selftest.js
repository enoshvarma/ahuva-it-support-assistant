/* selftest.js — end-to-end checks run inside the Android emulator by CI.
 * Only activates in the "selftest" build type (native returns no host in release builds). */
(function () {
  "use strict";
  if (window.__ahuvaUnsupported) return;
  const Session = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AhuvaSession;
  if (!Session || !Session.selfTestConfig) return;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const withTimeout = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(what + " timed out after " + ms + "ms"); })]);

  function waitForData(buffer, needle, ms) {
    const end = Date.now() + ms;
    return (async () => {
      while (Date.now() < end) {
        if (buffer.text.includes(needle)) return true;
        await sleep(100);
      }
      throw new Error(`did not see "${needle}" in: ${JSON.stringify(buffer.text.slice(-300))}`);
    })();
  }

  async function run(host) {
    const a = window.ahuva;
    const results = [];
    const log = msg => Session.reportStatus({ selftest: true, message: msg });
    const step = async (name, fn) => {
      try {
        const detail = await withTimeout(Promise.resolve().then(fn), 60000, name);
        results.push({ name, ok: true, detail: detail == null ? "" : String(detail) });
        log(`PASS ${name} ${detail == null ? "" : String(detail).slice(0, 160)}`);
      } catch (e) {
        results.push({ name, ok: false, detail: String((e && e.message) || e) });
        log(`FAIL ${name} ${String((e && e.message) || e).slice(0, 400)}`);
      }
    };
    const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

    const original = await a.getSettings();
    const term = { text: "" };
    a.onSessionData(d => { term.text += d; });

    await step("app UI initialised", async () => {
      await sleep(1500);
      const kb = document.getElementById("kb-summary");
      assert(kb && /reference documents loaded/.test(kb.textContent), "KB summary not rendered by app.js");
      assert(document.querySelector(".xterm"), "terminal not rendered");
      const errs = window.__ahuvaBridgeInternals.startupErrors;
      assert(errs.length === 0, "startup JS errors: " + JSON.stringify(errs));
      return navigator.userAgent.match(/Chrome\/[\d.]+/)[0];
    });

    await step("knowledge base", async () => {
      const expected = (await (await fetch("kb/index.json")).json()).length;
      const info = await a.kbInfo();
      assert(info.docCount >= expected && info.chunkCount > 50, JSON.stringify(info).slice(0, 200));
      return `${info.docCount} docs / ${info.chunkCount} chunks`;
    });

    await step("settings persist", async () => {
      await a.saveSettings({ ...original, engineerName: "selftest" });
      const s = await a.getSettings();
      assert(s.engineerName === "selftest", "round trip failed");
    });

    await step("model presets", async () => {
      const r = await a.modelPresets({ provider: "anthropic", freeOnly: false });
      assert(r.presets.length > 0 && r.model && r.allProviders.includes("openai"), JSON.stringify(r).slice(0, 200));
      return `${r.presets.length} anthropic presets`;
    });

    await step("command safety + CLI mode", async () => {
      const d = await a.classify("write erase");
      assert(d.level === "danger", "write erase classified as " + d.level);
      const s = await a.classify("show version");
      assert(s.level === "safe", "show version classified as " + s.level);
      const mode = await a.detectMode("Switch(config)#");
      assert(mode && mode.mode, "detectMode returned " + JSON.stringify(mode));
      const prep = await a.prepFor(mode.mode, "show vlan brief");
      assert(prep, "prepFor returned nothing");
      return mode.mode;
    });

    await step("device fingerprint", async () => {
      const fp = await a.fingerprint("Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE11");
      assert(fp && /cisco/i.test(JSON.stringify(fp)), JSON.stringify(fp));
      return JSON.stringify(fp).slice(0, 80);
    });

    await step("switch config generator", async () => {
      const vendors = await a.swcfgVendors();
      for (const vendor of vendors) {
        const out = await a.swcfgGenerate({ vendor, hostname: "SW-TEST", mgmtIp: "10.0.0.2", mgmtMask: "255.255.255.0", gateway: "10.0.0.1", vlans: [{ id: 10, name: "USERS" }] });
        assert(out && JSON.stringify(out).includes("SW-TEST"), vendor + " produced no config");
      }
      return vendors.length + " vendors";
    });

    await step("on-device capture commands", async () => {
      const d = await a.pktDeviceCmds({ brand: "Fortinet", target: "10.1.1.1" });
      assert(d.label && d.commands.length > 2 && d.commands[0].cmd.includes("10.1.1.1"), JSON.stringify(d).slice(0, 200));
      const chk = await a.pktCheck();
      assert(chk.available === false && chk.reason, "pktCheck shape");
      return d.label;
    });

    await step("error learning", async () => {
      const errs = await a.scanErrors("Switch#sh vlan\n% Invalid input detected at '^' marker.\n");
      assert(errs.length === 1, JSON.stringify(errs));
      await a.recordError({ cmd: "sh vln", error: errs[0], brand: "Cisco", model: "C2960" });
      await a.recordError({ cmd: "sh vln", error: errs[0], brand: "Cisco", model: "C2960" });
      return errs[0];
    });

    await step("AI copilot (HTTP provider)", async () => {
      await a.saveSettings({ ...original, provider: "openai-compatible", baseUrl: `http://${host}:8080/v1`, apiKey: "selftest", model: "mock" });
      const r = await a.askAI({
        messages: [{ role: "user", content: "How do I see VLANs on a Cisco 2960?" }],
        session: { brand: "Cisco", model: "C2960", task: "check vlans", connType: "" },
        terminalTail: "Switch#", cliMode: { mode: "privileged" }, sessionErrors: [],
      });
      assert(r.reply === "selftest reply", "reply: " + JSON.stringify(r));
      assert(r.commands.length === 1 && r.commands[0].cmd === "show vlan brief", "commands: " + JSON.stringify(r.commands));
      const prompt = await (await fetch(`http://${host}:8080/last-request`)).json();
      const sys = prompt.messages[0].content;
      assert(/Cisco/.test(sys) && /Seen 2x on Cisco/.test(sys), "system prompt missing KB/lesson context");
      const t = await a.testAI();
      assert(t === "selftest reply", "testAI " + t);
      return "reply + commands parsed, KB + lessons in prompt";
    });

    await step("research digest", async () => {
      await a.researchSetSources([{ label: "Selftest source", url: `http://${host}:8080/source` }]);
      const r = await a.researchRun({ vendors: ["Cisco"] });
      assert(r.sourcesOk === 1 && r.digest.includes("Research digest"), JSON.stringify(r).slice(0, 300));
      const info = await a.researchInfo();
      assert(info.files.includes(r.file), "digest not listed");
      assert((await a.researchRead(r.file)).includes("selftest reply"), "digest content");
      return r.file;
    });

    await step("telnet session", async () => {
      term.text = "";
      await a.connect({ connType: "telnet", host, port: "2323" });
      await waitForData(term, "Username:", 15000);
      await a.sendCommand("show clock");
      await waitForData(term, "ECHO:show clock", 15000);
      await a.disconnect();
      return "negotiated + echoed";
    });

    await step("ssh session", async () => {
      term.text = "";
      await a.connect({ connType: "ssh", host, port: "2222", username: "ahuva", password: "Ahuva-Test-1" });
      await sleep(1500);
      await a.write("expr 40000 + 2\r");
      await waitForData(term, "40002", 20000);
      const verdict = await a.sendCommand("show version");
      assert(verdict.level === "safe", "sendCommand verdict " + JSON.stringify(verdict));
      await a.disconnect();
      return "login + remote command executed";
    });

    await step("network scanner", async () => {
      let progress = 0;
      a.onScanProgress(() => { progress++; });
      const res = await a.scannerStart(host, { concurrency: 4, fullScan: true, portFallback: true });
      assert(res.length === 1, "results " + res.length);
      const ports = res[0].openPorts.map(p => p.port);
      assert(ports.includes(8080), "open ports " + JSON.stringify(res[0]));
      assert(res[0].openPorts.find(p => p.port === 8080).service === "HTTP-Alt", "service names");
      assert(progress >= 1, "no progress events");
      return `${res[0].status} ports=${ports.join(",")}`;
    });

    await step("traceroute", async () => {
      const r = await a.scannerTraceroute(host);
      assert(r.ip === host && typeof r.output === "string" && r.output.length > 10, JSON.stringify(r));
      return r.output.split("\n").slice(0, 3).join(" | ");
    });

    await step("wake-on-lan", async () => {
      assert((await a.scannerWoL("00:11:22:33:44:55", "255.255.255.255")) === true, "WoL");
      let rejected = false;
      try { await a.scannerWoL("nonsense", "255.255.255.255"); } catch { rejected = true; }
      assert(rejected, "invalid MAC accepted");
    });

    await step("usb serial listing", async () => {
      const ports = await a.listSerialPorts();
      assert(Array.isArray(ports), "not an array");
      return ports.length + " USB serial ports";
    });

    await a.saveSettings(original);

    const passed = results.filter(r => r.ok).length;
    const overlay = document.createElement("pre");
    overlay.id = "selftest-report";
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;margin:0;padding:14px;overflow:auto;background:#07111f;color:#dde8f0;font:12px monospace;white-space:pre-wrap";
    overlay.textContent = `AHUVA SELF-TEST  ${passed}/${results.length} passed\n${navigator.userAgent}\n\n` +
      results.map(r => `${r.ok ? "PASS" : "FAIL"}  ${r.name}\n      ${r.detail}`).join("\n");
    document.body.appendChild(overlay);
    log(`SELFTEST RESULT ${passed === results.length ? "PASS" : "FAIL"} ${passed}/${results.length}`);
  }

  window.addEventListener("load", async () => {
    let cfg;
    try { cfg = await Session.selfTestConfig(); } catch { return; }
    if (!cfg || !cfg.host) return;
    await sleep(2500);
    try { await run(cfg.host); }
    catch (e) { Session.reportStatus({ selftest: true, error: true, message: "SELFTEST RESULT FAIL crashed: " + e.message }); }
  });
})();
