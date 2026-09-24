/* compat.js — ES5 only. Loads first: small polyfills for older Android WebViews,
   and a readable message instead of a blank screen when the WebView is too old. */
(function () {
  "use strict";

  // Collect errors from the very first script so library load failures reach the health report.
  var errors = window.__ahuvaErrors = [];
  window.addEventListener("error", function (e) { errors.push(String(e.message || e.error || "error")); });
  window.addEventListener("unhandledrejection", function (e) {
    errors.push("unhandled: " + String((e.reason && e.reason.message) || e.reason));
  });

  var m = /Chrome\/(\d+)/.exec(navigator.userAgent || "");
  var chrome = m ? parseInt(m[1], 10) : 0;
  var missing = typeof Promise === "undefined" || typeof fetch === "undefined" || typeof Map === "undefined";
  if ((chrome && chrome < 60) || missing) {
    window.__ahuvaUnsupported = true;
    document.addEventListener("DOMContentLoaded", function () {
      document.body.innerHTML =
        '<div style="font-family:sans-serif;color:#dde8f0;background:#07111f;padding:28px;line-height:1.5;min-height:100vh">' +
        "<h2 style=\"color:#00bceb\">Update required</h2>" +
        "<p>This phone's <b>Android System WebView</b> is too old (version " + (chrome || "unknown") + ").</p>" +
        "<p>Open the <b>Play Store</b>, search for <b>Android System WebView</b> (and <b>Google Chrome</b>), tap <b>Update</b>, then reopen Ahuva IT Support.</p>" +
        "</div>";
    });
    return;
  }

  // xterm 5 references globalThis and queueMicrotask (Chrome 71+); Android 9's stock WebView is Chrome 69.
  if (typeof globalThis === "undefined") window.globalThis = window;
  if (typeof queueMicrotask !== "function") {
    window.queueMicrotask = function (cb) {
      Promise.resolve().then(cb).catch(function (e) { setTimeout(function () { throw e; }, 0); });
    };
  }
  if (!String.prototype.trimEnd) {
    String.prototype.trimEnd = function () { return this.replace(/\s+$/, ""); };
  }
  if (!String.prototype.trimStart) {
    String.prototype.trimStart = function () { return this.replace(/^\s+/, ""); };
  }
  if (!Array.prototype.flat) {
    Object.defineProperty(Array.prototype, "flat", {
      configurable: true, writable: true,
      value: function (depth) {
        var d = depth === undefined ? 1 : Number(depth);
        var out = [];
        (function walk(arr, level) {
          for (var i = 0; i < arr.length; i++) {
            if (Array.isArray(arr[i]) && level > 0) walk(arr[i], level - 1); else out.push(arr[i]);
          }
        })(this, d);
        return out;
      }
    });
  }
  if (!Array.prototype.flatMap) {
    Object.defineProperty(Array.prototype, "flatMap", {
      configurable: true, writable: true,
      value: function (fn, thisArg) { return Array.prototype.map.call(this, fn, thisArg).flat(1); }
    });
  }
  if (!Object.fromEntries) {
    Object.fromEntries = function (entries) {
      var o = {};
      var it = entries[Symbol.iterator] ? Array.from(entries) : entries;
      for (var i = 0; i < it.length; i++) o[it[i][0]] = it[i][1];
      return o;
    };
  }
  if (!Promise.allSettled) {
    Promise.allSettled = function (ps) {
      return Promise.all(Array.from(ps).map(function (p) {
        return Promise.resolve(p).then(
          function (value) { return { status: "fulfilled", value: value }; },
          function (reason) { return { status: "rejected", reason: reason }; });
      }));
    };
  }
  if (typeof AbortController === "undefined") {
    window.AbortController = function () {
      var listeners = [];
      this.signal = {
        aborted: false,
        addEventListener: function (t, cb) { if (t === "abort") listeners.push(cb); },
        removeEventListener: function () {}
      };
      var signal = this.signal;
      this.abort = function () {
        if (signal.aborted) return;
        signal.aborted = true;
        for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} }
      };
    };
  }
  if (typeof AbortSignal === "undefined") window.AbortSignal = function () {};
  if (!AbortSignal.timeout) {
    AbortSignal.timeout = function (ms) {
      var c = new AbortController();
      setTimeout(function () { c.abort(); }, ms);
      return c.signal;
    };
  }
  if (!navigator.clipboard) {
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: function (text) {
            return new Promise(function (resolve, reject) {
              var ta = document.createElement("textarea");
              ta.value = text;
              ta.style.position = "fixed";
              ta.style.opacity = "0";
              document.body.appendChild(ta);
              ta.select();
              var ok = false;
              try { ok = document.execCommand("copy"); } catch (e) {}
              document.body.removeChild(ta);
              if (ok) resolve(); else reject(new Error("Copy failed"));
            });
          }
        }
      });
    } catch (e) {}
  }
})();
