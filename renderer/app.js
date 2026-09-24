/* Ahuva IT Support Assistant — renderer logic */
const $ = id => document.getElementById(id);

/* ---------------- state ---------------- */
const state = {
  connected: false,
  connType: "ssh",
  session: {},          // host, port, comPort, baudRate, brand, model, task
  history: [],          // chat messages for the AI [{role, content}]
  outputBuffer: "",     // rolling live console text (capped)
  lastDataAt: 0,
  busy: false,
  autopilot: true,
  cliMode: { mode: "unknown", label: "—" },
  sessionApproved: false,
  detected: null,
  loginModalOpen: false,
  probingAborted: false,
  sessionErrors: [],
  _lastCmdMark: 0,
  cmdCount: 0,
  authCompleted: false,
  consentShown: false,
  _pendingConsentTimer: null
};
let autoRunAbort = null;   // function to cancel a pending auto-run batch
const MAX_BUFFER = 200000;

/* ---------------- terminal ---------------- */
const term = new Terminal({
  fontFamily: '"Cascadia Mono", Consolas, monospace',
  fontSize: 14,
  theme: {
    background:  "#04090f",
    foreground:  "#d8e8f0",
    cursor:      "#00bceb",
    cursorAccent:"#07111f",
    selectionBackground: "rgba(0,188,235,.25)",
    black:   "#0d1929", red:     "#f54141", green:  "#26d98d", yellow: "#f0b843",
    blue:    "#00bceb", magenta: "#9b7bf7", cyan:   "#26c4d4", white:  "#d8e8f0",
    brightBlack:   "#253e55", brightRed:   "#ff6b6b", brightGreen: "#3dffa0",
    brightYellow:  "#ffd060", brightBlue:  "#40d4ff", brightMagenta:"#b39dff",
    brightCyan:    "#4ae0ee", brightWhite: "#e8f4fc"
  },
  cursorBlink: true,
  scrollback: 5000
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open($("terminal"));
fit.fit();
window.addEventListener("resize", () => fit.fit());

term.onData(d => { if (state.connected) window.ahuva.write(d).catch(() => {}); });

let modeTimer = null;
let loginPromptTimer = null;
window.ahuva.onSessionData(chunk => {
  term.write(chunk);
  state.outputBuffer += chunk;
  if (state.outputBuffer.length > MAX_BUFFER) state.outputBuffer = state.outputBuffer.slice(-MAX_BUFFER);
  state.lastDataAt = Date.now();
  clearTimeout(modeTimer);
  modeTimer = setTimeout(refreshMode, 350);
  // detect login/password prompt and pause everything
  if (!state.loginModalOpen && !state.sessionApproved) {
    clearTimeout(loginPromptTimer);
    loginPromptTimer = setTimeout(() => checkForLoginPrompt(), 300);
  }
});

// A login prompt only counts if it is the CURRENT last line of the terminal.
// Historical "login:" / "Password:" lines from earlier attempts are ignored,
// so the modal can never re-open after a successful login.
async function checkForLoginPrompt() {
  if (state.loginModalOpen || !state.connected) return;
  const m = await window.ahuva.detectMode(state.outputBuffer.slice(-2000));
  if (m.mode === "auth") {
    state.probingAborted = true;   // stop any in-flight probe loop
    openLoginModal();
  }
}

async function refreshMode() {
  state.cliMode = await window.ahuva.detectMode(state.outputBuffer.slice(-2000));
  const el = $("mode-badge");
  if (el) {
    if (state.cliMode.mode === "paging") {
      el.innerHTML = '<span class="pager-dots"><i></i><i></i><i></i></span> paging…';
    } else {
      el.textContent = state.cliMode.label;
    }
    el.className = "mode-badge mode-" + state.cliMode.mode;
    el.classList.toggle("hidden", !state.connected);
  }
}
window.ahuva.onSessionClosed(reason => { setConnected(false); sysMsg("Session closed: " + reason); });
window.ahuva.onSessionError(msg => sysMsg("Session error: " + msg, true));


function cleanPaged(text) {
  return String(text || "")
    .replace(/[^\S\n]*--\s*more\s*--[^\S\n]*/gi, "")
    .replace(/<--- more --->/gi, "")
    .replace(/press any key to continue.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n");
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\r/g, "");
}

/* wait until console output settles (quiet >= quietMs, or maxMs elapsed) */
function waitForQuiet(quietMs = 900, maxMs = 9000) {
  const start = Date.now();
  return new Promise(res => {
    const t = setInterval(() => {
      const now = Date.now();
      if ((state.lastDataAt && now - state.lastDataAt >= quietMs && now - start >= quietMs) || now - start >= maxMs) {
        clearInterval(t); res();
      }
    }, 300);
  });
}

/* ---------------- connection panel ---------------- */
$("seg-ssh").onclick = () => setConnType("ssh");
$("seg-telnet").onclick = () => setConnType("telnet");
$("seg-serial").onclick = () => setConnType("serial");
function setConnType(t) {
  state.connType = t;
  $("seg-ssh").classList.toggle("active", t === "ssh");
  $("seg-telnet").classList.toggle("active", t === "telnet");
  $("seg-serial").classList.toggle("active", t === "serial");
  const ipMode = (t === "ssh" || t === "telnet");
  $("ssh-fields").classList.toggle("hidden", !ipMode);
  $("serial-fields").classList.toggle("hidden", t !== "serial");
  // telnet has no username/password fields on many devices (login is interactive)
  document.querySelectorAll("#ssh-fields .field").forEach((f, i) => {
    // fields: 0 host, 1 port, 2 user, 3 pass — hide user/pass for telnet
    if (i >= 2) f.classList.toggle("hidden", t === "telnet");
  });
  $("f-port").value = t === "telnet" ? "23" : "22";
  if (t === "serial") refreshComPorts();
}

async function refreshComPorts() {
  const ports = await window.ahuva.listSerialPorts();
  const sel = $("f-com");
  sel.innerHTML = "";
  if (!ports.length) {
    sel.innerHTML = '<option value="">No COM ports found</option>';
    return;
  }
  for (const p of ports) {
    const o = document.createElement("option");
    o.value = p.path;
    o.textContent = p.friendly ? `${p.path} — ${p.friendly}` : p.path;
    sel.appendChild(o);
  }
}
$("btn-refresh-com").onclick = refreshComPorts;

$("btn-connect").onclick = async () => {
  const cfg = {
    connType: state.connType,
    host: $("f-host").value.trim(),
    port: $("f-port").value.trim() || (state.connType === "telnet" ? "23" : "22"),
    username: $("f-user").value.trim(),
    password: $("f-pass").value,
    comPort: $("f-com").value,
    baudRate: $("f-baud").value,
    devtype: $("f-devtype").value,
    brand: $("f-brand").value,
    model: $("f-model").value.trim(),
    task: $("f-task").value.trim()
  };
  if (cfg.connType === "ssh" && (!cfg.host || !cfg.username)) return sysMsg("Enter the device IP and username first.", true);
  if (cfg.connType === "telnet" && !cfg.host) return sysMsg("Enter the device IP first.", true);
  if (cfg.connType === "serial" && !cfg.comPort) return sysMsg("Select a COM port first.", true);

  $("btn-connect").disabled = true;
  $("btn-connect").textContent = "Connecting…";
  try {
    await window.ahuva.connect(cfg);
    state.session = cfg;
    state.sessionApproved = false;
    sessionStart = Date.now();
    setConnected(true);
    sysMsg(`Connected to ${cfg.connType === "serial" ? cfg.comPort : cfg.host} via ${cfg.connType.toUpperCase()}.`);
    state.authCompleted = false;
    state.consentShown  = false;
    if (state.history.length === 0) aiIntro();
    // auto-detect device (unless the user picked a specific brand)
    if (cfg.devtype === "auto" || cfg.brand === "Auto-detect") await autoDetectDevice();
    // For SSH the connection itself handles auth — show consent immediately.
    // For Telnet/Serial the device may emit a login prompt; defer consent so the
    // login modal can fire first.  submitLogin() will call openConsent() on success.
    if (state.connType === "ssh") {
      openConsent();
    } else {
      state._pendingConsentTimer = setTimeout(() => {
        state._pendingConsentTimer = null;
        if (!state.consentShown) openConsent();
      }, 3500);
    }
  } catch (e) {
    sysMsg("Connection failed: " + e.message, true);
  } finally {
    $("btn-connect").disabled = false;
    $("btn-connect").textContent = "Connect";
  }
};
$("btn-disconnect").onclick = async () => { await window.ahuva.disconnect(); setConnected(false); sysMsg("Disconnected."); };

function setConnected(on) {
  state.connected = on;
  if (!on) {
    state.authCompleted = false;
    state.consentShown  = false;
    if (state._pendingConsentTimer) { clearTimeout(state._pendingConsentTimer); state._pendingConsentTimer = null; }
  }
  $("btn-restore").disabled = !(on && state.getRestoreReady);
  $("conn-led").className = "led " + (on ? "led-on" : "led-off");
  const dev = state.detected
    ? `${state.detected.vendor} ${state.detected.model || state.detected.type}`.trim()
    : (state.session.brand && state.session.brand !== "Auto-detect" ? `${state.session.brand} ${state.session.model || ""}`.trim() : "device");
  $("conn-label").textContent = on
    ? `Connected — ${dev} @ ${state.connType === "serial" ? state.session.comPort : state.session.host}`
    : "Not connected";
  $("btn-connect").classList.toggle("hidden", on);
  $("btn-disconnect").classList.toggle("hidden", !on);
  $("btn-backup").disabled = !on;
}


/* ---------------- auto-detect device ---------------- */
async function autoDetectDevice() {
  sysMsg("Detecting device…");
  const probes = await window.ahuva.probes();
  // wake the CLI, then try probe commands until one fingerprints
  const startLen = state.outputBuffer.length;
  try {
    state.probingAborted = false;
    state.lastDataAt = Date.now();
    await window.ahuva.sendCommand("");           // newline to get a prompt
    await waitForQuiet(700, 3000);
    if (state.probingAborted) return null;        // login prompt caught — stop
    for (const p of probes) {
      if (!state.connected || state.probingAborted) break;
      state.lastDataAt = Date.now();
      await window.ahuva.sendCommand(p);
      await waitForQuiet(1000, 6000);
      const fp = await window.ahuva.fingerprint(stripAnsi(state.outputBuffer.slice(startLen)));
      if (fp.matched) {
        state.detected = fp;
        state.session.brand = fp.vendor;
        if (fp.type) state.session.devtype = fp.type;
        if (fp.model) state.session.model = fp.model;
        $("f-brand").value = [...$("f-brand").options].some(o => o.value === fp.vendor) ? fp.vendor : "Other";
        if (fp.model) $("f-model").value = fp.model;
        if ([...$("f-devtype").options].some(o => o.value === fp.type)) $("f-devtype").value = fp.type;
        sysMsg(`Detected: ${fp.vendor} ${fp.type}${fp.model ? " (" + fp.model + ")" : ""}. Command syntax set accordingly.`);
        setConnected(true);
        return fp;
      }
    }
    sysMsg("Could not auto-detect the device from its output. Pick the brand/type manually on the left, or ask me and I'll help identify it.");
  } catch (e) {
    sysMsg("Detection stopped: " + e.message, true);
  }
  return null;
}

/* ---------------- chat ---------------- */
function addMsg(cls, text) {
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.textContent = text;
  $("chat").appendChild(div);
  $("chat").scrollTop = $("chat").scrollHeight;
  return div;
}
function sysMsg(text, isErr) { addMsg(isErr ? "msg-err" : "msg-sys", text); }

function aiIntro() {
  addMsg("msg-ai",
    "Connected. I'll detect the device, then ask you once to save a restore point before any change.\n\n" +
    "After that, tell me the task in plain words — switch, router or firewall — and I'll run the steps smoothly. " +
    "If anything goes wrong, hit \"Restore last config\" and I'll roll it back.");
}

$("btn-send").onclick = () => sendChat();
$("chat-input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

async function sendChat(injectedText) {
  const text = injectedText || $("chat-input").value.trim();
  if (!text || state.busy) return;
  if (!injectedText) { addMsg("msg-user", text); $("chat-input").value = ""; }
  state.history.push({ role: "user", content: text });
  await runAiTurn();
}

async function runAiTurn() {
  if (state.busy) return;
  state.busy = true;
  const thinking = addMsg("msg-sys", "Copilot is thinking…");
  try {
    await refreshMode();
    const res = await window.ahuva.askAI({
      messages: state.history.slice(-24),
      session: { ...state.session, connType: state.connected ? state.connType : "" },
      terminalTail: stripAnsi(state.outputBuffer).slice(-6000),
      cliMode: state.cliMode,
      sessionErrors: state.sessionErrors
    });
    thinking.remove();
    state.history.push({ role: "assistant", content: JSON.stringify(res) });
    if (res.reply) addMsg("msg-ai", res.reply);
    if (res.needs && res.needs.length) {
      const n = document.createElement("div");
      n.className = "msg needs";
      n.textContent = "Copilot needs: " + res.needs.join(" · ");
      $("chat").appendChild(n);
    }
    const cards = [];
    for (const c of res.commands || []) cards.push(await renderCommandCard(c));
    $("chat").scrollTop = $("chat").scrollHeight;
    if (state.autopilot && state.connected && state.sessionApproved) autoRunBatch(cards);
    else if (state.connected && !state.sessionApproved && (res.commands || []).length)
      sysMsg("Tip: click \"Back up & start session\" (or reconnect) to enable smooth auto-run. Until then, use the Run buttons.");
  } catch (e) {
    thinking.remove();
    sysMsg(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true);
  } finally {
    state.busy = false;
  }
}


/* ---------------- error chip (graphical) ---------------- */
function showErrorChip(cmd, err) {
  const chip = document.createElement("div");
  chip.className = "err-chip";
  chip.innerHTML = `
    <span class="err-chip-icon">!</span>
    <div class="err-chip-body">
      <div class="err-chip-title">Device rejected a command</div>
      <div class="err-chip-cmd"></div>
      <div class="err-chip-err"></div>
    </div>`;
  chip.querySelector(".err-chip-cmd").textContent = cmd;
  chip.querySelector(".err-chip-err").textContent = err;
  $("chat").appendChild(chip);
  $("chat").scrollTop = $("chat").scrollHeight;
}

/* ---------------- command cards + approval ---------------- */
async function renderCommandCard(c) {
  const verdict = await window.ahuva.classify(c.cmd);
  const card = document.createElement("div");
  card.className = "cmd-card";
  card.innerHTML = `
    <div class="cmd-line">
      <span class="cmd-dot dot-${verdict.level}"></span>
      <span class="cmd-text"></span>
    </div>
    <div class="cmd-why"></div>
    <button class="ghost small cmd-run">Run ▸</button>`;
  card.querySelector(".cmd-text").textContent = c.cmd;
  card.querySelector(".cmd-why").textContent = (c.why || "") + (verdict.reason ? "  ⚠ " + verdict.reason : "");
  const btn = card.querySelector(".cmd-run");
  btn.onclick = () => approveAndRun(c.cmd, verdict, btn);
  $("chat").appendChild(card);
  return { cmd: c.cmd, verdict, btn };
}

/* ---------------- auto-pilot: run the safe prefix of a batch after a 5s cancel window ---------------- */
async function autoRunBatch(cards) {
  const safeRun = [];
  for (const c of cards) {
    if (c.verdict.level !== "safe") break;   // stop at first caution/danger — those stay manual
    safeRun.push(c);
  }
  if (!safeRun.length) return;
  const skipped = cards.length - safeRun.length;

  // countdown banner with cancel
  const banner = document.createElement("div");
  banner.className = "auto-banner";
  const label = document.createElement("span");
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "ghost small";
  cancelBtn.textContent = "Cancel";
  banner.append(label, cancelBtn);
  $("chat").appendChild(banner);
  $("chat").scrollTop = $("chat").scrollHeight;

  let cancelled = false;
  cancelBtn.onclick = () => { cancelled = true; banner.remove(); sysMsg("Auto-run cancelled — use the Run buttons manually."); };
  autoRunAbort = cancelBtn.onclick;

  for (let t = 5; t > 0; t--) {
    if (cancelled) return;
    label.textContent = `⚡ Auto-running ${safeRun.length} command${safeRun.length > 1 ? "s" : ""} in ${t}s` + (skipped ? ` (${skipped} need manual approval)` : "");
    await new Promise(r => setTimeout(r, 1000));
  }
  if (cancelled) return;
  banner.remove();
  autoRunAbort = null;

  // sequential execution with mode-aware prep, one combined analysis at the end
  const mark = state.outputBuffer.length;
  for (const c of safeRun) {
    if (!state.connected) break;
    try {
      c.btn.classList.add("running"); c.btn.textContent = "Running…";
      await execWithPrep(c.cmd);
      c.btn.classList.remove("running");
      c.btn.textContent = "Ran ✓"; c.btn.classList.add("ran"); c.btn.disabled = true;
    } catch (e) {
      sysMsg(`Stopped at "${c.cmd}": ${e.message}`, true);
      break;
    }
  }
  const out = stripAnsi(state.outputBuffer.slice(mark)).trim().slice(0, 5000);
  await sendChat(`[LIVE OUTPUT after auto-running approved commands]\n${out || "(no output captured)"}\n\nVerify each command succeeded, confirm the change is applied, and give the next step.`);
}

/* run one command, auto-inserting mode-entry commands (enable / configure terminal / do-prefix) */
async function execWithPrep(cmd) {
  await refreshMode();
  const prep = await window.ahuva.prepFor(state.cliMode.mode, cmd);
  let finalCmd = cmd;
  for (const p of prep) {
    if (p === "__DO_PREFIX__") { finalCmd = "do " + cmd; continue; }
    state.lastDataAt = Date.now();
    await window.ahuva.sendCommand(p);
    await waitForQuiet(700, 5000);
    await refreshMode();
    if (state.cliMode.mode === "auth") throw new Error("Switch is asking for a password — type it in the terminal, then retry.");
  }
  state.lastDataAt = Date.now();
  state.cmdCount = (state.cmdCount || 0) + 1;
  await window.ahuva.sendCommand(finalCmd);
  await drainPager();
  await captureCommandErrors(finalCmd);
}

/* Auto-advance through --More-- / paged output by sending SPACE until the
   device returns to a normal prompt. Prevents the next command being typed
   into the pager (the reported bug). */
async function drainPager(maxPages = 200) {
  for (let i = 0; i < maxPages; i++) {
    await waitForQuiet(700, 8000);
    const m = await window.ahuva.detectMode(state.outputBuffer.slice(-400));
    if (m.mode !== "paging") break;
    state.lastDataAt = Date.now();
    await window.ahuva.write(" ");   // space = next page (Cisco/AW+/most vendors)
  }
  // make sure paging is fully cleared
  const m = await window.ahuva.detectMode(state.outputBuffer.slice(-400));
  if (m.mode === "paging") { await window.ahuva.write("q"); await waitForQuiet(500, 3000); }
}

/* Scan the just-produced output for known error signatures, surface them,
   record them for learning, and remember them for this session. */
async function captureCommandErrors(cmd) {
  const since = state._lastCmdMark != null ? state._lastCmdMark : 0;
  const out = stripAnsi(state.outputBuffer.slice(since));
  state._lastCmdMark = state.outputBuffer.length;
  const errors = await window.ahuva.scanErrors(out);
  for (const err of errors) {
    state.sessionErrors.push({ cmd, error: err });
    showErrorChip(cmd, err);
    window.ahuva.recordError({ cmd, error: err, brand: state.session.brand, model: state.session.model });
  }
}

let pendingConfirm = null;
function approveAndRun(cmd, verdict, btn) {
  if (!state.connected) return sysMsg("Not connected — connect to the switch first.", true);
  if (verdict.level === "safe") return runCommand(cmd, btn);
  // caution/danger -> confirmation modal
  pendingConfirm = { cmd, btn, verdict };
  $("confirm-title").textContent = verdict.level === "danger" ? "⚠ Destructive command" : "⚠ Disruptive command";
  $("confirm-reason").textContent = verdict.reason;
  $("confirm-cmd").textContent = cmd;
  $("confirm-type-row").classList.toggle("hidden", verdict.level !== "danger");
  $("confirm-type").value = "";
  $("modal-confirm").classList.remove("hidden");
}
$("confirm-cancel").onclick = () => { $("modal-confirm").classList.add("hidden"); pendingConfirm = null; };
$("confirm-run").onclick = () => {
  if (!pendingConfirm) return;
  if (pendingConfirm.verdict.level === "danger" && $("confirm-type").value.trim() !== "YES") {
    $("confirm-reason").textContent = "Type YES exactly to confirm this destructive command.";
    return;
  }
  const { cmd, btn } = pendingConfirm;
  $("modal-confirm").classList.add("hidden");
  pendingConfirm = null;
  runCommand(cmd, btn);
};

async function runCommand(cmd, btn) {
  try {
    if (btn) { btn.textContent = "Running…"; btn.disabled = true; btn.classList.add("running"); }
    const mark = state.outputBuffer.length;
    await execWithPrep(cmd);
    if (btn) { btn.classList.remove("running"); btn.textContent = "Ran ✓"; btn.classList.add("ran"); }
    const out = stripAnsi(state.outputBuffer.slice(mark)).trim().slice(0, 3500);
    // feed live output back to the copilot so it can verify and plan the next step
    await sendChat(`[LIVE OUTPUT after running "${cmd}"]\n${out || "(no output captured)"}\n\nCheck this output for errors and tell me the next step.`);
  } catch (e) {
    if (btn) { btn.textContent = "Run ▸"; btn.disabled = false; }
    sysMsg("Could not run command: " + e.message, true);
  }
}



/* ---------------- login credential popup ---------------- */
function openLoginModal() {
  // Cancel the deferred consent timer — login takes priority.
  // openConsent() will be called by submitLogin() after auth succeeds.
  if (state._pendingConsentTimer) {
    clearTimeout(state._pendingConsentTimer);
    state._pendingConsentTimer = null;
  }
  state.loginModalOpen = true;
  const host = state.session.host || state.session.comPort || "device";
  const proto = (state.connType || "").toUpperCase();
  $("login-device-label").textContent = `${proto} · ${host}`;

  // show any WARNING banner text from the device
  const recent = stripAnsi(state.outputBuffer.slice(-800));
  const bannerMatch = recent.match(/\*+[\s\S]*?WARNING[\s\S]*?\*+/i);
  if (bannerMatch) {
    $("login-banner-text").textContent = bannerMatch[0].replace(/\*+/g,"").trim().replace(/\s+/g," ");
  }

  $("login-user").value = "";
  $("login-pass").value = "";
  $("login-submit").disabled = false;
  $("login-submit").textContent = "Login to device ▸";
  hideLoginError();
  $("modal-login").classList.remove("hidden");
  setTimeout(() => $("login-user").focus(), 100);
}

function closeLoginModal() {
  state.loginModalOpen = false;
  $("modal-login").classList.add("hidden");
}

function showLoginError(msg) {
  let el = $("login-error-msg");
  if (!el) {
    el = document.createElement("div");
    el.id = "login-error-msg";
    el.className = "login-error";
    $("modal-login").querySelector(".login-card").insertBefore(el, $("modal-login").querySelector(".modal-actions"));
  }
  el.textContent = msg;
  el.classList.add("visible");
}

function hideLoginError() {
  const el = $("login-error-msg");
  if (el) el.classList.remove("visible");
}

$("login-cancel").onclick = () => {
  closeLoginModal();
  window.ahuva.disconnect();
  setConnected(false);
  sysMsg("Login cancelled — disconnected.");
};

$("login-submit").onclick = () => submitLogin();

$("login-pass").addEventListener("keydown", e => { if (e.key === "Enter") submitLogin(); });
$("login-user").addEventListener("keydown", e => { if (e.key === "Enter") $("login-pass").focus(); });

async function submitLogin() {
  const user = $("login-user").value.trim();
  const pass = $("login-pass").value;
  if (!user && !pass) { showLoginError("Enter your username and password."); return; }

  $("login-submit").disabled = true;
  $("login-submit").textContent = "Logging in…";
  hideLoginError();

  // decide from the CURRENT last line only what the device is asking for
  const lines = stripAnsi(state.outputBuffer.slice(-300)).split("\n").map(l => l.trimEnd()).filter(l => l.trim());
  const lastLine = lines[lines.length - 1] || "";
  const askingForUser = /(login|username|user\s*name)\s*[:：]\s*$/i.test(lastLine);
  const askingForPass = /password\s*[:：]?\s*$/i.test(lastLine);

  try {
    const mark = state.outputBuffer.length;   // only judge output from THIS attempt
    if (askingForUser || (!askingForPass && user)) {
      // send username, wait for password prompt
      state.lastDataAt = Date.now();
      await window.ahuva.write(user + "\r");
      await waitForQuiet(1200, 5000);
    }
    // send password
    state.lastDataAt = Date.now();
    await window.ahuva.write(pass + "\r");
    await waitForQuiet(1500, 7000);

    // SUCCESS = the live prompt is now a real CLI mode (>, #, (config)#).
    // Old failure text earlier in the buffer can no longer cause a false error.
    let mode = await window.ahuva.detectMode(state.outputBuffer.slice(-2000));
    if (mode.mode === "unknown") {            // banner may still be printing
      await waitForQuiet(1200, 4000);
      mode = await window.ahuva.detectMode(state.outputBuffer.slice(-2000));
    }
    const thisAttempt = stripAnsi(state.outputBuffer.slice(mark));
    if (mode.mode === "auth") {
      const why = /incorrect|authentication failed|access denied|invalid/i.test(thisAttempt)
        ? "Login incorrect — check credentials and try again."
        : "Device is still asking for credentials — try again.";
      showLoginError(why);
      $("login-submit").disabled = false;
      $("login-submit").textContent = "Login to device ▸";
      return;
    }

    // login worked — prompt is live
    closeLoginModal();
    state.authCompleted = true;
    sysMsg("Logged in. Starting device detection…");
    state.probingAborted = false;
    // now safe to probe
    await autoDetectDevice();
    openConsent();   // safe — guarded by consentShown flag
  } catch (e) {
    showLoginError("Error: " + e.message);
    $("login-submit").disabled = false;
    $("login-submit").textContent = "Login to device ▸";
  }
}

/* ---------------- session consent + auto-backup restore point ---------------- */
function openConsent() {
  if (state.consentShown) return;   // never show twice per session
  state.consentShown = true;
  const d = state.detected;
  $("consent-detect").textContent = d
    ? `Device: ${d.vendor} ${d.type}${d.model ? " · " + d.model : ""}`
    : `Device: ${state.session.brand || "unknown"} ${state.session.devtype || ""}`.trim();
  $("modal-consent").classList.remove("hidden");
}
$("consent-cancel").onclick = () => {
  $("modal-consent").classList.add("hidden");
  sysMsg("Session not started — I'll only answer questions. Commands will need manual approval and no restore point is saved.");
};
$("consent-ok").onclick = async () => {
  $("modal-consent").classList.add("hidden");
  await captureRestorePoint();
  state.sessionApproved = true;
  $("btn-restore").disabled = !state.getRestoreReady;
  sysMsg("Session started. Restore point saved. Standard commands will now run smoothly; destructive ones still confirm. Tell me the task.");
};

async function captureRestorePoint() {
  sysMsg("Saving current configuration as restore point…");
  const brand = (state.session.brand || "").toLowerCase();
  const showCfg = brand.includes("fortinet") ? "show full-configuration"
                : brand.includes("mikrotik") ? "/export"
                : "show running-config";
  try {
    await execWithPrep(brand.includes("fortinet") || brand.includes("mikrotik") ? showCfg : "terminal length 0");
    const cfgMark = state.outputBuffer.length;
    if (!(brand.includes("fortinet") || brand.includes("mikrotik"))) {
      state.lastDataAt = Date.now();
      await window.ahuva.sendCommand(showCfg);
      await waitForQuiet(2000, 30000);
    }
    const text = cleanPaged(stripAnsi(state.outputBuffer.slice(cfgMark)));
    const res = await window.ahuva.storeRestorePoint({ text, device: `${state.session.brand} ${state.session.model}`.trim() });
    state.getRestoreReady = res.ok && text.length > 40;
    $("btn-restore").disabled = !state.getRestoreReady;
    sysMsg(state.getRestoreReady ? `Restore point saved (${res.chars} chars).` : "Restore point capture looked empty — verify manually before changes.");
  } catch (e) {
    sysMsg("Could not capture restore point: " + e.message + " — proceed with caution.", true);
  }
}

/* ---------------- restore last config ---------------- */
$("btn-restore").onclick = async () => {
  const rp = await window.ahuva.getRestorePoint();
  if (!rp || !rp.text) return sysMsg("No restore point saved this session.", true);
  if (!confirm(`Restore the configuration saved at ${rp.capturedAt.replace("T"," ").slice(0,16)}? The assistant will re-apply it using the safest method for this device.`)) return;
  addMsg("msg-user", "Restore the device to the configuration saved at session start.");
  // hand the saved config to the copilot; it picks native rollback vs paste-back per vendor
  state.history.push({ role: "user", content:
    `Restore this device to the following saved configuration. Use the SAFEST native method for ${state.session.brand || "this device"} (e.g. 'configure replace' / revision restore / rollback) if available; otherwise re-apply the settings in config mode. Warn me before anything that reboots or drops my session. Saved config:\n\n${rp.text.slice(0, 12000)}` });
  await runAiTurn();
};

/* ---------------- config backup ---------------- */
$("btn-backup").onclick = async () => {
  if (!state.connected) return;
  sysMsg("Capturing running-config…");
  const brand = (state.session.brand || "").toLowerCase();
  const mark = state.outputBuffer.length;
  try {
    await execWithPrep("terminal length 0");     // auto-enables first if still in user mode
    const cfgMark = state.outputBuffer.length;
    state.lastDataAt = Date.now();
    await window.ahuva.sendCommand("show running-config");
    await waitForQuiet(2000, 30000);
    const out = cleanPaged(stripAnsi(state.outputBuffer.slice(cfgMark)));
    if (out.includes("% Invalid input")) { sysMsg("Backup failed — switch rejected the command. Check the console.", true); return; }
    const p = await window.ahuva.saveBackup({ text: out, model: state.session.model || brand });
    sysMsg(p ? "Backup saved: " + p : "Backup cancelled.");
  } catch (e) {
    sysMsg("Backup failed: " + e.message, true);
  }
};
$("btn-clear-term").onclick = () => term.clear();

/* ---------------- settings ---------------- */
async function loadSettingsIntoUI() {
  const s = await window.ahuva.getSettings();
  $("s-provider").value = s.provider || "anthropic";
  $("s-model").value = s.model || "";
  $("s-key").value = s.apiKey || "";
  $("s-base").value = s.baseUrl || "";
  $("s-autopilot").checked = s.autopilot !== false;
  $("s-engineer").value = s.engineerName || "";
  $("s-dash").value = s.dashboardUrl || "";
  $("s-token").value = s.teamToken || "";
  state.autopilot = s.autopilot !== false;
  toggleKeyField();
  loadModelPresets(s.provider || "anthropic", true);
}
function providerLabel(s) {
  const names = { anthropic: "Anthropic", openai: "OpenAI", "openai-compatible": "Custom endpoint", ollama: "Ollama (local)" };
  return `${names[s.provider] || s.provider || "?"}${s.model ? " · " + s.model : ""}`;
}
function toggleKeyField() {
  $("s-key-field").classList.toggle("hidden", $("s-provider").value === "ollama");
}
$("s-provider").onchange = () => { toggleKeyField(); loadModelPresets($("s-provider").value, false); };
$("btn-settings").onclick = () => { loadSettingsIntoUI(); $("modal-settings").classList.remove("hidden"); };
$("s-cancel").onclick = () => $("modal-settings").classList.add("hidden");
$("s-save").onclick = async () => {
  const s = {
    provider: $("s-provider").value,
    model: $("s-model").value.trim(),
    apiKey: $("s-key").value.trim(),
    baseUrl: $("s-base").value.trim(),
    autopilot: $("s-autopilot").checked,
    engineerName: $("s-engineer").value.trim(),
    dashboardUrl: $("s-dash").value.trim(),
    teamToken: $("s-token").value.trim()
  };
  state.autopilot = s.autopilot;
  await window.ahuva.saveSettings(s);
  $("modal-settings").classList.add("hidden");
  sysMsg("AI settings saved — active from the next message.");
};
$("s-test").onclick = async () => {
  $("s-test-result").textContent = "Testing…";
  // save first so the test uses what's on screen
  await window.ahuva.saveSettings({
    provider: $("s-provider").value,
    model: $("s-model").value.trim(),
    apiKey: $("s-key").value.trim(),
    baseUrl: $("s-base").value.trim(),
    autopilot: $("s-autopilot").checked,
    engineerName: $("s-engineer").value.trim(),
    dashboardUrl: $("s-dash").value.trim(),
    teamToken: $("s-token").value.trim()
  });
  try {
    const r = await window.ahuva.testAI();
    $("s-test-result").textContent = "✓ Provider reachable: " + r;
    $("s-test-result").style.color = "#3fd68f";
  } catch (e) {
    $("s-test-result").textContent = "✗ " + e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
    $("s-test-result").style.color = "#ef5350";
  }
};

/* ---------------- knowledge base ---------------- */
async function refreshKb() {
  const info = await window.ahuva.kbInfo();
  $("kb-summary").innerHTML =
    `<b style="color:var(--text-2)">${info.docCount}</b> reference documents loaded` +
    `<div style="margin-top:4px;font-size:11px;color:var(--faint);line-height:1.45">${info.files.map(f => f.replace(/\.md$/, "")).join(" · ")}</div>`;
}
$("btn-kb-import").onclick = async () => { await window.ahuva.kbImport(); refreshKb(); sysMsg("Reference documents imported."); };

/* ---------------- field guide ---------------- */
$("btn-guide").onclick = () => $("drawer-guide").classList.toggle("hidden");
$("guide-close").onclick = () => $("drawer-guide").classList.add("hidden");


/* ================= Side panel tabs ================= */
$("tab-copilot").onclick = () => switchPane("copilot");
$("tab-packets").onclick = () => { switchPane("packets"); initPackets(); };
$("tab-swcfg").onclick   = () => { switchPane("swcfg");   initSwcfg();   };
$("tab-scanner").onclick = () => { switchPane("scanner");  initScanner();  };
function switchPane(which) {
  ["copilot", "packets", "swcfg", "scanner"].forEach(p => {
    $("tab-"  + p).classList.toggle("active", p === which);
    $("pane-" + p).classList.toggle("hidden", p !== which);
  });
}

/* ================= Theme (EV dark — permanent) ================= */
term.options.theme = {
  background: "#04090f", foreground: "#d8e8f0", cursor: "#00bceb",
  cursorAccent: "#07111f", selectionBackground: "rgba(0,188,235,.25)",
  black: "#0d1929", red: "#f54141", green: "#26d98d", yellow: "#f0b843",
  blue: "#00bceb", magenta: "#9b7bf7", cyan: "#26c4d4", white: "#d8e8f0",
  brightBlack: "#253e55", brightRed: "#ff6b6b", brightGreen: "#3dffa0",
  brightYellow: "#ffd060", brightBlue: "#40d4ff", brightMagenta: "#b39dff",
  brightCyan: "#4ae0ee", brightWhite: "#e8f4fc"
};

/* ================= Network Scanner ================= */
let scannerReady = false;
let scanAbortFlag = false;

function initScanner() {
  if (scannerReady) return;
  scannerReady = true;

  // Register progress listener
  window.ahuva.onScanProgress(({ result, done, total }) => {
    updateScanProgress(done, total);
    if (result.status !== "offline") appendScanHost(result);
  });

  $("scan-start").onclick = startScan;
  $("scan-stop").onclick  = () => { scanAbortFlag = true; };
  $("scan-wol-send").onclick = async () => {
    const mac = $("scan-wol-mac").value.trim();
    if (!mac) return;
    try { await window.ahuva.scannerWoL(mac, "255.255.255.255"); sysMsg("WoL packet sent to " + mac); }
    catch (e) { sysMsg("WoL error: " + e.message, true); }
  };
}

async function startScan() {
  const target = $("scan-target").value.trim();
  if (!target) return;
  scanAbortFlag = false;
  $("scan-results").innerHTML  = "";
  $("scan-summary").classList.add("hidden");
  $("scan-wol-row").classList.add("hidden");
  $("scan-start").classList.add("hidden");
  $("scan-stop").classList.remove("hidden");
  $("scan-progress-wrap").classList.remove("hidden");
  updateScanProgress(0, 1);

  try {
    const opts = {
      fullScan:     $("scan-full").checked,
      useNmap:      $("scan-nmap").checked,
      portFallback: $("scan-port-fallback").checked,
      concurrency:  50,
    };
    const results = await window.ahuva.scannerStart(target, opts);
    renderScanSummary(results);
  } catch (e) {
    sysMsg("Scan error: " + e.message, true);
  } finally {
    $("scan-start").classList.remove("hidden");
    $("scan-stop").classList.add("hidden");
    $("scan-progress-wrap").classList.add("hidden");
  }
}

function updateScanProgress(done, total) {
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  $("scan-progress-fill").style.width = pct + "%";
  $("scan-progress-text").textContent = `${done} / ${total}`;
}

function appendScanHost(r) {
  const el = document.createElement("div");
  el.className = "scan-host " + (r.status || "offline");
  el.dataset.ip  = r.ip;
  el.dataset.mac = r.mac || "";

  // Escape user-visible strings (no onclick attributes — CSP blocks inline scripts)
  const safeIp       = r.ip.replace(/[<>"&]/g, "");
  const safeHostname = (r.hostname || "").replace(/[<>"&]/g, "");
  const safeVendor   = (r.vendor   || "").replace(/[<>"&]/g, "");
  const safeMac      = (r.mac      || "").replace(/[<>"&]/g, "");

  const portChips = (r.openPorts || []).slice(0, 12).map(p =>
    `<span class="scan-port-chip" title="${p.service}">${p.port}/${p.service}</span>`).join("");

  const hasSSH     = (r.openPorts || []).some(p => p.port === 22);
  const hasTelnet  = (r.openPorts || []).some(p => p.port === 23);
  const hasHTTP    = (r.openPorts || []).some(p => p.port === 80 || p.port === 443 || p.port === 8080);
  const hasRDP     = (r.openPorts || []).some(p => p.port === 3389);

  el.innerHTML =
    `<div class="scan-host-row1">
       <span class="scan-status-dot ${r.status === "online" ? "dot-online" : "dot-offline"}"></span>
       <span class="scan-ip">${safeIp}</span>
       <span class="scan-hostname">${safeHostname}</span>
       <span class="scan-vendor">${safeVendor}</span>
     </div>` +
    (safeMac ? `<div class="scan-mac">${safeMac}</div>` : "") +
    (portChips ? `<div class="scan-ports">${portChips}</div>` : "") +
    `<div class="scan-host-actions">
       <button class="ghost small scan-btn" data-action="ssh"     title="Connect via SSH (port 22)">SSH${hasSSH ? " ●" : ""}</button>
       <button class="ghost small scan-btn" data-action="telnet"  title="Connect via Telnet (port 23)">Telnet${hasTelnet ? " ●" : ""}</button>
       <button class="ghost small scan-btn" data-action="http"    title="Open in browser" ${hasHTTP ? "" : "disabled"}>Web</button>
       <button class="ghost small scan-btn" data-action="rdp"     title="Remote Desktop"  ${hasRDP  ? "" : "disabled"}>RDP</button>
       ${safeMac ? `<button class="ghost small scan-btn" data-action="wol" title="Send Wake-on-LAN magic packet">WoL</button>` : ""}
       <button class="ghost small scan-btn" data-action="ping"    title="Ping host">Ping</button>
       <button class="ghost small scan-btn" data-action="trace"   title="Traceroute">Trace</button>
       <button class="ghost small scan-btn scan-copy-btn" data-action="copy" title="Copy IP">⎘</button>
     </div>`;

  $("scan-results").appendChild(el);
}

// Event delegation for scanner host buttons — no inline onclick (blocked by CSP)
$("scan-results").addEventListener("click", async e => {
  const btn = e.target.closest(".scan-btn");
  if (!btn) return;
  const host = btn.closest(".scan-host");
  const ip   = host?.dataset.ip  || "";
  const mac  = host?.dataset.mac || "";
  const action = btn.dataset.action;

  switch (action) {
    case "ssh":
      $("f-host").value = ip;
      setConnType("ssh");
      switchPane("copilot");
      sysMsg(`IP ${ip} loaded — set credentials and click Connect.`);
      break;

    case "telnet":
      $("f-host").value = ip;
      setConnType("telnet");
      switchPane("copilot");
      sysMsg(`IP ${ip} loaded — click Connect for Telnet.`);
      break;

    case "http": {
      const port = host.querySelector(".scan-port-chip") ? "" : "";
      const scheme = (host.dataset.ip && Array.from(host.querySelectorAll(".scan-port-chip"))
        .some(c => c.textContent.startsWith("443"))) ? "https" : "http";
      window.ahuva.openExternal(`${scheme}://${ip}`);
      break;
    }

    case "rdp":
      window.ahuva.openExternal(`rdp://full%20address=s:${ip}`);
      break;

    case "wol":
      if (!mac) { sysMsg("No MAC address recorded for this host.", true); break; }
      $("scan-wol-mac").value = mac;
      $("scan-wol-row").classList.remove("hidden");
      try {
        await window.ahuva.scannerWoL(mac, "255.255.255.255");
        btn.textContent = "Sent ✓"; btn.disabled = true;
        setTimeout(() => { btn.textContent = "WoL"; btn.disabled = false; }, 3000);
      } catch (err) { sysMsg("WoL error: " + err.message, true); }
      break;

    case "ping": {
      btn.disabled = true; btn.textContent = "…";
      try {
        const res = await window.ahuva.scannerStart(ip, { concurrency: 1, fullScan: false });
        const alive = res[0]?.status === "online";
        showScanToast(host, alive ? `${ip} is reachable` : `${ip} did not respond`, alive ? "ok" : "err");
      } catch (err) { showScanToast(host, "Ping failed: " + err.message, "err"); }
      finally { btn.disabled = false; btn.textContent = "Ping"; }
      break;
    }

    case "trace": {
      btn.disabled = true; btn.textContent = "…";
      showScanToast(host, "Running traceroute…", "info");
      try {
        const res = await window.ahuva.scannerTraceroute(ip);
        showScanModal(`Traceroute — ${ip}`, res.output || "No output");
      } catch (err) { showScanToast(host, "Traceroute error: " + err.message, "err"); }
      finally { btn.disabled = false; btn.textContent = "Trace"; }
      break;
    }

    case "copy":
      navigator.clipboard.writeText(ip).catch(() => {});
      btn.textContent = "✓";
      setTimeout(() => { btn.textContent = "⎘"; }, 1500);
      break;
  }
});

function showScanToast(hostEl, msg, type) {
  let t = hostEl.querySelector(".scan-toast");
  if (!t) { t = document.createElement("div"); t.className = "scan-toast"; hostEl.appendChild(t); }
  t.textContent = msg;
  t.className = `scan-toast scan-toast-${type}`;
  clearTimeout(t._tid);
  if (type !== "info") t._tid = setTimeout(() => t.remove(), 4000);
}

function showScanModal(title, content) {
  let m = $("scan-modal");
  if (!m) {
    m = document.createElement("div");
    m.id = "scan-modal";
    m.innerHTML =
      `<div class="scan-modal-backdrop"></div>
       <div class="scan-modal-card">
         <div class="scan-modal-header">
           <span id="scan-modal-title" class="scan-modal-title"></span>
           <button id="scan-modal-close" class="ghost small">✕</button>
         </div>
         <pre id="scan-modal-body" class="scan-modal-body"></pre>
       </div>`;
    document.body.appendChild(m);
    m.querySelector(".scan-modal-backdrop").addEventListener("click", () => m.classList.add("hidden"));
    $("scan-modal-close").addEventListener("click", () => m.classList.add("hidden"));
  }
  $("scan-modal-title").textContent = title;
  $("scan-modal-body").textContent  = content;
  m.classList.remove("hidden");
}

function renderScanSummary(results) {
  const online    = results.filter(r => r.status === "online").length;
  const withPorts = results.filter(r => r.openPorts && r.openPorts.length).length;
  $("scan-summary").innerHTML =
    `<div class="scan-stat"><span>Total</span><span class="scan-stat-val">${results.length}</span></div>` +
    `<div class="scan-stat"><span>Online</span><span class="scan-stat-val" style="color:var(--ok)">${online}</span></div>` +
    `<div class="scan-stat"><span>Offline</span><span class="scan-stat-val" style="color:var(--muted)">${results.length - online}</span></div>` +
    `<div class="scan-stat"><span>Open ports</span><span class="scan-stat-val">${withPorts}</span></div>`;
  $("scan-summary").classList.remove("hidden");
  $("scan-wol-row").classList.remove("hidden");
}

/* ================= Packet analysis ================= */
let pktReady = false;
async function initPackets() {
  if (pktReady) return;
  pktReady = true;
  const chk = await window.ahuva.pktCheck();
  const badge = $("pkt-tshark");
  if (chk.available) {
    badge.textContent = "installed"; badge.className = "pill pill-ok";
    const ifaces = await window.ahuva.pktIfaces();
    const sel = $("pkt-iface"); sel.innerHTML = "";
    if (!ifaces.length) sel.innerHTML = '<option value="">no interfaces</option>';
    for (const i of ifaces) {
      const o = document.createElement("option");
      o.value = i.id; o.textContent = i.name.slice(0, 34);
      sel.appendChild(o);
    }
  } else {
    badge.textContent = "not installed"; badge.className = "pill pill-no";
    $("pkt-capture").disabled = true;
    $("pkt-output").textContent = chk.reason || "Wireshark is not installed on this laptop.\n\nInstall it from wireshark.org to enable local capture (this app uses tshark, Wireshark's own capture engine, and saves a .pcapng you can open in the Wireshark GUI).\n\nYou can still use \"On-device capture\" — that runs the switch/firewall's own built-in packet sniffer over your existing session, which is usually the better tool on a switched network anyway.";
  }
}

$("pkt-capture").onclick = async () => {
  const iface = $("pkt-iface").value;
  if (!iface) return;
  const btn = $("pkt-capture");
  btn.disabled = true; btn.textContent = "Capturing…";
  $("pkt-output").textContent = "Capturing packets…";
  $("pkt-severity-header").className = "hidden";
  $("pkt-severity-header").innerHTML = "";
  try {
    const res = await window.ahuva.pktCapture({
      iface, seconds: Number($("pkt-secs").value), filter: $("pkt-filter").value, maxPackets: 500
    });
    if (res.structured) renderPcapAnalysis(res.structured);
    $("pkt-output").textContent =
      `${res.packets} packets captured\nSaved: ${res.pcap}\n\n── AI ANALYSIS ──\n${res.analysis}\n\n── CONVERSATIONS ──\n${res.conversations.slice(0, 2000)}`;
  } catch (e) {
    $("pkt-output").textContent = "Capture failed: " + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  } finally {
    btn.disabled = false; btn.textContent = "Capture & analyse";
  }
};

function renderPcapAnalysis(s) {
  const hdr = $("pkt-severity-header");
  const sevClass = { normal: "sev-normal", high: "sev-high", critical: "sev-critical" }[s.severity] || "sev-normal";
  const sevLabel = (s.severity || "normal").toUpperCase();
  let html = `<span class="pkt-severity-badge ${sevClass}">${sevLabel}</span>`;
  html += `<span style="font-size:12px;color:var(--text-2);margin-left:9px">${s.trafficProfile.totalPackets} packets analysed</span>`;
  if (s.anomalies && s.anomalies.length) {
    html += `<div class="pkt-anomaly-list">`;
    for (const a of s.anomalies) {
      const ac = { normal: "sev-normal", high: "sev-high", critical: "sev-critical" }[a.severity] || "sev-high";
      html += `<div class="pkt-anomaly ${ac}">
        <div class="pkt-anomaly-title">${a.title}</div>
        <div class="pkt-anomaly-detail">${a.detail}</div>
        <div class="pkt-anomaly-rec">${a.recommendation}</div>
      </div>`;
    }
    html += `</div>`;
  }
  hdr.innerHTML = html;
  hdr.classList.remove("hidden");
}

$("pkt-device").onclick = async () => {
  if (!state.connected) { $("pkt-output").textContent = "Connect to a device first — on-device capture runs through the live session."; return; }
  const target = ($("pkt-filter").value.match(/(\d{1,3}(?:\.\d{1,3}){3})/) || [])[1] || "";
  const d = await window.ahuva.pktDeviceCmds({ brand: state.session.brand, target });
  $("pkt-output").textContent = `${d.label}\n\n` +
    d.commands.map(c => `${c.cmd}\n    → ${c.why}`).join("\n\n") +
    (d.note ? `\n\nNote: ${d.note}` : "") +
    "\n\nSending these to the Copilot so it can run and interpret them…";
  switchPane("copilot");
  sendChat(`Run an on-device packet capture using this device's built-in sniffer${target ? " for host " + target : ""}, then interpret the output. Suggested approach: ${d.label}. Propose the commands one step at a time and read the results.`);
};

/* ================= Switch Config Module ================= */
let swcfgReady = false;
function initSwcfg() {
  if (swcfgReady) return;
  swcfgReady = true;

  $("swcfg-generate").onclick = async () => {
    const vlansRaw = ($("swcfg-vlans").value || "").trim();
    const vlans = vlansRaw
      ? vlansRaw.split("\n").filter(l => l.trim()).map(l => {
          const [id, ...rest] = l.split(":");
          return { id: id.trim(), name: rest.join(":").trim() || undefined };
        })
      : [];

    const params = {
      vendor:      $("swcfg-vendor").value,
      hostname:    $("swcfg-hostname").value.trim(),
      mgmtIp:      $("swcfg-ip").value.trim(),
      mgmtMask:    $("swcfg-mask").value.trim(),
      mgmtVlan:    $("swcfg-mgmt-vlan").value.trim() || "1",
      gateway:     $("swcfg-gw").value.trim(),
      ntpServer:   $("swcfg-ntp").value.trim(),
      adminUser:   $("swcfg-user").value.trim(),
      adminPass:   $("swcfg-pass").value,
      enableSecret:$("swcfg-enable").value,
      vlans
    };

    const btn = $("swcfg-generate");
    btn.disabled = true; btn.textContent = "Generating…";
    $("swcfg-output").classList.add("hidden");
    $("swcfg-notes").classList.add("hidden");
    $("swcfg-copy").style.display = "none";
    $("swcfg-push").disabled = true;

    try {
      const result = await window.ahuva.swcfgGenerate(params);
      $("swcfg-output").textContent = result.config;
      $("swcfg-output").classList.remove("hidden");
      if (result.notes && result.notes.length) {
        $("swcfg-notes").innerHTML = "<b>Notes:</b><ul>" + result.notes.map(n => `<li>${n}</li>`).join("") + "</ul>";
        $("swcfg-notes").classList.remove("hidden");
      }
      $("swcfg-copy").style.display = "";
      if (state.connected) $("swcfg-push").disabled = false;
    } catch (e) {
      $("swcfg-output").textContent = "Error: " + (e.message || String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
      $("swcfg-output").classList.remove("hidden");
    } finally {
      btn.disabled = false; btn.textContent = "Generate config";
    }
  };

  $("swcfg-push").onclick = async () => {
    const cfg = $("swcfg-output").textContent;
    if (!cfg || !state.connected) return;
    const cmds = cfg.split("\n").filter(l => l.trim() && !l.startsWith("!") && !l.startsWith("#"));
    if (!confirm(`Push ${cmds.length} commands to ${state.session.host || state.session.comPort}?\n\nThis will modify the device. Ensure you have a restore point.`)) return;
    const btn = $("swcfg-push");
    btn.disabled = true; btn.textContent = "Pushing…";
    try {
      const r = await window.ahuva.swcfgPush(cmds);
      sysMsg(`Switch config pushed — ${r.pushed} commands sent.`);
      $("swcfg-notes").innerHTML = `<b>Pushed:</b> ${r.pushed} commands sent to device.`;
      $("swcfg-notes").classList.remove("hidden");
    } catch (e) {
      sysMsg("Push failed: " + (e.message || e), true);
    } finally {
      btn.disabled = false; btn.textContent = "Push ▸";
    }
  };

  $("swcfg-copy").onclick = () => {
    const txt = $("swcfg-output").textContent;
    if (txt) navigator.clipboard.writeText(txt).then(() => {
      $("swcfg-copy").textContent = "Copied!";
      setTimeout(() => { $("swcfg-copy").textContent = "Copy"; }, 1800);
    });
  };
}

/* ================= Status bar ================= */
let sessionStart = null;
function fmtDur(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}
function updateStatusBar() {
  const sb = (id, v, cls) => { const el = $(id); if (el) { el.textContent = v; el.className = "sb-val" + (cls ? " " + cls : ""); } };
  sb("sb-device", state.connected
    ? (state.detected ? `${state.detected.vendor} ${state.detected.type}` : (state.session.brand || "device"))
    : "—", state.connected ? "good" : "");
  sb("sb-mode", state.connected ? (state.cliMode.label || "—") : "—",
     state.cliMode.mode === "auth" ? "warn" : "");
  sb("sb-uptime", sessionStart ? fmtDur(Date.now() - sessionStart) : "—");
  sb("sb-cmds", String(state.cmdCount || 0));
  sb("sb-errors", String(state.sessionErrors.length), state.sessionErrors.length ? "warn" : "");
}
setInterval(updateStatusBar, 1000);

/* ================= Model presets in settings ================= */
async function loadModelPresets(provider, keepCurrent) {
  const freeOnly = $("s-free-only") ? $("s-free-only").checked : false;
  const info = await window.ahuva.modelPresets({ provider, freeOnly });
  const presets = info.presets || [];

  const dl = $("model-presets");
  if (dl) {
    dl.innerHTML = "";
    for (const m of presets) {
      const o = document.createElement("option");
      o.value = m.id;
      o.label = `${m.label}${m.free ? " [FREE]" : ""} · ${m.cost} · ${m.speed}`;
      dl.appendChild(o);
    }
  }

  const hint = $("model-hint");
  if (hint) {
    hint.innerHTML = presets.slice(0, 12).map(m =>
      `<div class="model-hint-row">` +
        `<span class="model-hint-label">${m.label}</span>` +
        `<span class="model-hint-speed muted">${m.speed}</span>` +
        `<span class="model-hint-cost pill${m.free ? " free" : ""}">${m.free ? "FREE" : m.cost}</span>` +
      `</div>`
    ).join("");
  }

  // Update base-url hint
  const baseHint = $("s-base-hint");
  if (baseHint && info.baseUrl) {
    baseHint.textContent = `Default: ${info.baseUrl}`;
    baseHint.classList.remove("hidden");
  }

  if (!keepCurrent) {
    if (info.model) $("s-model").value = info.model;
    if (info.baseUrl && !$("s-base").value) $("s-base").value = info.baseUrl;
  }
}

// Re-load presets when free-only toggle changes
if ($("s-free-only")) {
  $("s-free-only").onchange = () => loadModelPresets($("s-provider").value, true);
}

/* ---------------- init ---------------- */
(async function init() {
  await loadSettingsIntoUI();
  await refreshKb();
  const s = await window.ahuva.getSettings();
  if (!s.apiKey && s.provider !== "ollama") {
    sysMsg("Welcome. Open AI settings (top-right) and add your provider + API key to activate the copilot.");
  }
  addMsg("msg-ai",
    "Hi, I'm your on-site copilot for switches, routers and firewalls.\n\n" +
    "Enter the device IP, pick a connection type (SSH / Telnet / Serial), leave device type on Auto-detect, and press Connect. I'll identify the device and guide the rest.");
})();

/* ================= Research Center ================= */
$("btn-research").onclick = () => { refreshResearch(); $("drawer-research").classList.remove("hidden"); };
$("research-close").onclick = () => $("drawer-research").classList.add("hidden");
$("digest-close").onclick = () => $("modal-digest").classList.add("hidden");
$("research-open-folder").onclick = () => window.ahuva.researchOpenFolder();

$("research-enabled").onchange = async e => {
  await window.ahuva.researchSetEnabled(e.target.checked);
  sysMsg(e.target.checked ? "Weekly auto-research enabled." : "Weekly auto-research disabled.");
};

let researchSources = [];
async function refreshResearch() {
  const info = await window.ahuva.researchInfo();
  $("research-enabled").checked = info.enabled;
  $("research-last").textContent = info.lastResearch ? new Date(info.lastResearch).toLocaleString() : "never";
  const badge = $("research-due-badge");
  badge.textContent = info.due ? "Research due" : "Up to date";
  badge.className = "due-badge " + (info.due ? "due" : "fresh");
  researchSources = info.sources.slice();
  renderSources();
  renderDigestFiles(info.files);
}

function renderSources() {
  const box = $("research-sources");
  box.innerHTML = "";
  researchSources.forEach((s, i) => {
    const el = document.createElement("div");
    el.className = "research-src";
    el.innerHTML = `<span class="research-src-label" title="${s.url}">${s.label || s.url}</span><button class="research-src-del" data-i="${i}">✕</button>`;
    el.querySelector(".research-src-del").onclick = async () => {
      researchSources.splice(i, 1);
      await window.ahuva.researchSetSources(researchSources);
      renderSources();
    };
    box.appendChild(el);
  });
}

$("research-add-src").onclick = async () => {
  const url = $("research-new-url").value.trim();
  if (!/^https?:\/\//i.test(url)) return sysMsg("Enter a valid http(s) URL.", true);
  let label = url.replace(/^https?:\/\//, "").split("/")[0];
  researchSources.push({ label, url });
  await window.ahuva.researchSetSources(researchSources);
  $("research-new-url").value = "";
  renderSources();
};

function renderDigestFiles(files) {
  const box = $("research-files");
  if (!files || !files.length) { box.innerHTML = '<span class="muted">No digests yet.</span>'; return; }
  box.innerHTML = "";
  files.forEach(f => {
    const el = document.createElement("div");
    el.className = "research-file";
    el.innerHTML = `<span class="research-file-icon">📄</span><span>${f.replace("research-digest-", "").replace(".md", "")}</span>`;
    el.onclick = async () => {
      const content = await window.ahuva.researchRead(f);
      $("digest-title").textContent = f;
      $("digest-content").textContent = content;
      $("modal-digest").classList.remove("hidden");
    };
    box.appendChild(el);
  });
}

$("research-run").onclick = runResearchNow;
async function runResearchNow() {
  $("research-run").disabled = true;
  $("research-progress").classList.remove("hidden");
  $("research-progress-text").textContent = "Fetching sources and researching… (up to a minute)";
  try {
    // focus on vendors we actually work with, plus detected one
    const vendors = [...new Set([state.session.brand, state.detected && state.detected.vendor].filter(Boolean))];
    const res = await window.ahuva.researchRun({ vendors });
    sysMsg(`Research complete: ${res.file} saved and added to the knowledge base (${res.sourcesOk}/${res.sourcesTotal} sources reached, ${res.kbDocs} KB docs now).`);
    await refreshResearch();
    // show the fresh digest
    $("digest-title").textContent = res.file;
    $("digest-content").textContent = res.digest;
    $("modal-digest").classList.remove("hidden");
  } catch (e) {
    sysMsg("Research failed: " + e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true);
  } finally {
    $("research-run").disabled = false;
    $("research-progress").classList.add("hidden");
  }
}

// weekly due notification (non-intrusive toast)
window.ahuva.onResearchDue(() => {
  const toast = document.createElement("div");
  toast.className = "research-toast";
  toast.innerHTML = `<b>Weekly research is due.</b><br>Open the Research panel to update the knowledge base.`;
  document.body.appendChild(toast);
  toast.onclick = () => { toast.remove(); $("btn-research").click(); };
  setTimeout(() => toast.remove(), 12000);
});

// ── auto-update banner ────────────────────────────────────────
if (window.ahuva.onUpdateAvailable) {
  window.ahuva.onUpdateAvailable((info) => {
    const banner = $("update-banner");
    const ver    = $("update-version");
    if (!banner || !ver) return;
    ver.textContent = `v${info.latestVersion}`;
    banner.classList.remove("hidden");
    $("update-download").onclick = () => {
      window.ahuva.openExternal && window.ahuva.openExternal(info.downloadUrl);
    };
    $("update-dismiss").onclick = () => banner.classList.add("hidden");
  });
}
