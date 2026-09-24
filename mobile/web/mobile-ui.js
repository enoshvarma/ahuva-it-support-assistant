/* mobile-ui.js — phone navigation around the unchanged desktop UI:
 * bottom tabs (Session / Terminal / Copilot), icon top-bar buttons, and a quick-key row
 * for keys phone keyboards lack (Tab, ?, Ctrl+C, arrows) that switch CLIs depend on. */
(function () {
  "use strict";
  if (window.__ahuvaUnsupported) return;
  const $ = id => document.getElementById(id);
  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    session: svg('<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>'),
    terminal: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>'),
    copilot: svg('<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/>'),
    research: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    guide: svg('<path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h6M14 4v4h4"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  };

  const VIEWS = [["session", "Session"], ["terminal", "Terminal"], ["copilot", "Copilot"]];
  const nav = document.createElement("nav");
  nav.id = "m-nav";
  nav.innerHTML = VIEWS.map(([k, label]) =>
    `<button type="button" data-view="${k}" aria-label="${label}">${ICONS[k]}<span>${label}</span><i class="m-dot"></i></button>`).join("");
  const statusbar = $("statusbar");
  statusbar.parentNode.insertBefore(nav, statusbar.nextSibling);

  function show(view) {
    document.body.dataset.mview = view;
    nav.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    if (view === "copilot") nav.querySelector('[data-view="copilot"]').classList.remove("unread");
    // xterm measures its container; refit once the terminal view is visible.
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }
  nav.addEventListener("click", e => {
    const b = e.target.closest("button[data-view]");
    if (b) show(b.dataset.view);
  });
  window.ahuvaMobileShow = show;
  show("session");

  for (const [id, icon] of [["btn-research", "research"], ["btn-guide", "guide"], ["btn-settings", "settings"]]) {
    const b = $(id);
    if (!b) continue;
    b.setAttribute("aria-label", b.textContent.trim());
    b.classList.add("m-icon-btn");
    b.innerHTML = ICONS[icon];
  }

  // Jump to the terminal when a session comes up; flag unseen copilot replies.
  const led = $("conn-led");
  let wasOn = false;
  new MutationObserver(() => {
    const on = led.classList.contains("led-on");
    if (on && !wasOn) show("terminal");
    wasOn = on;
  }).observe(led, { attributes: true, attributeFilter: ["class"] });

  new MutationObserver(records => {
    if (document.body.dataset.mview === "copilot") return;
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType === 1 && /\bmsg-ai\b|\bcmd-card\b|\bneeds\b/.test(n.className)) {
          nav.querySelector('[data-view="copilot"]').classList.add("unread");
          return;
        }
      }
    }
  }).observe($("chat"), { childList: true });

  // Quick keys under the terminal.
  const KEYS = [
    ["Tab", "\t"], ["?", "?"], ["Ctrl+C", "\x03"], ["Ctrl+Z", "\x1a"], ["Esc", "\x1b"],
    ["↑", "\x1b[A"], ["↓", "\x1b[B"], ["←", "\x1b[D"], ["→", "\x1b[C"], ["Space", " "], ["Enter", "\r"], ["q", "q"],
  ];
  const keys = document.createElement("div");
  keys.id = "m-keys";
  keys.innerHTML = KEYS.map(([label], i) => `<button type="button" data-k="${i}">${label}</button>`).join("");
  keys.addEventListener("mousedown", e => e.preventDefault());
  keys.addEventListener("click", e => {
    const b = e.target.closest("button[data-k]");
    if (!b) return;
    window.ahuva.write(KEYS[Number(b.dataset.k)][1]).catch(() => {});
  });
  const terminal = $("terminal");
  terminal.parentNode.insertBefore(keys, terminal.nextSibling);

  // Phone-friendly terminal: ~60 columns on a typical 412px screen instead of ~44.
  const phone = window.matchMedia("(max-width: 899px)");
  const applyFont = () => {
    try { if (typeof term !== "undefined") term.options.fontSize = phone.matches ? 11 : 14; } catch (e) {}
    window.dispatchEvent(new Event("resize"));
  };
  applyFont();
  if (phone.addEventListener) phone.addEventListener("change", applyFont);
  const shortLabels = { "btn-backup": "Backup", "btn-restore": "Restore", "btn-clear-term": "Clear" };
  for (const id in shortLabels) {
    const b = $(id);
    if (b) { b.title = b.title || b.textContent.trim(); b.textContent = shortLabels[id]; }
  }

  // Android back button: close an open modal/drawer, else step back to the Session view.
  const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (App && App.addListener) {
    App.addListener("backButton", () => {
      const open = Array.from(document.querySelectorAll(".modal:not(.hidden), .drawer:not(.hidden)"));
      if (open.length) {
        const top = open[open.length - 1];
        const cancel = top.querySelector('[id$="-cancel"], [id$="-close"]');
        if (cancel) cancel.click(); else top.classList.add("hidden");
        return;
      }
      if (document.body.dataset.mview !== "session") return show("session");
      App.minimizeApp ? App.minimizeApp() : App.exitApp();
    });
  }
})();
