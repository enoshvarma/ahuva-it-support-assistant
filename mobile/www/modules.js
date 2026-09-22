(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // ../src/safety.js
  var require_safety = __commonJS({
    "../src/safety.js"(exports, module) {
      var DANGER_PATTERNS = [
        /\berase\b/i,
        /\bwrite\s+erase\b/i,
        /\bformat\b/i,
        /\bdelete\b/i,
        /\bfactory[- ]?(default|reset)\b/i,
        /\bboot\s+system\b/i,
        /\brm\s+-rf\b/i,
        /\bwipe\b/i,
        /\bzeroize\s+(all|key-pair|rsa|ecdsa)\b/i,
        /\bno\s+startup-config\b/i,
        /\bformat\s+flash\b/i
      ];
      var CAUTION_PATTERNS = [
        /\breload\b/i,
        /\breboot\b/i,
        /\bshutdown\b/i,
        /^\s*no\s+interface\b/i,
        /^\s*no\s+vlan\b/i,
        /\bspanning-tree\s+mode\b/i,
        /\benable\s+(secret|password)\b/i,
        /\busername\b.*\bpassword\b/i,
        /\bip\s+address\b/i,
        /\bno\s+ip\s+address\b/i,
        /\bcrypto\s+key\s+zeroize\b/i,
        /\bvtp\s+mode\b/i,
        /\bno\s+access-list\b/i,
        /\bno\s+ip\s+access-group\b/i,
        /\bno\s+firewall\b/i,
        /\bno\s+crypto\b/i,
        /\bservice\s+password-encryption\b/i,
        /\bno\s+spanning-tree\b/i,
        /\bredistribute\b/i,
        /\bno\s+router\b/i,
        /\bclear\s+ip\s+route\b/i,
        /\bclear\s+arp\b/i,
        /\bsystem\s+(restart|shutdown)\b/i,
        /\bdiagnose\s+sys\s+kill\b/i,
        /execute\s+factoryreset\b/i
      ];
      function classifyCommand(cmd) {
        const c = String(cmd || "").trim();
        if (!c) return { level: "safe", reason: "" };
        for (const p of DANGER_PATTERNS) {
          if (p.test(c)) {
            return {
              level: "danger",
              reason: "Destructive command \u2014 can permanently wipe config or files. Back up the running config first and confirm this is intentional."
            };
          }
        }
        for (const p of CAUTION_PATTERNS) {
          if (p.test(c)) {
            return {
              level: "caution",
              reason: "Disruptive command \u2014 may reboot the device, take down links, or cut your management session. Confirm a maintenance window before running."
            };
          }
        }
        return { level: "safe", reason: "" };
      }
      module.exports = { classifyCommand, DANGER_PATTERNS, CAUTION_PATTERNS };
    }
  });

  // ../src/mode.js
  var require_mode = __commonJS({
    "../src/mode.js"(exports, module) {
      function detectCliMode(buffer) {
        const clean = String(buffer || "").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "");
        const lines = clean.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length);
        const last = lines[lines.length - 1] || "";
        if (/(password|passcode)\s*[:：]?\s*$/i.test(last)) return { mode: "auth", prompt: last, label: "Login required" };
        if (/(login|username|user name)\s*[:：]?\s*$/i.test(last)) return { mode: "auth", prompt: last, label: "Login required" };
        if (/--\s*more\s*--/i.test(last) || /press any key to continue/i.test(last) || /<--- more --->/i.test(last) || /lines \d+-\d+/.test(last) && /more/i.test(last))
          return { mode: "paging", prompt: last, label: "Paged output" };
        if (/\(config-if[^)]*\)#\s*$/.test(last)) return { mode: "config-if", prompt: last, label: "Interface config" };
        if (/\(config[^)]*\)#\s*$/.test(last)) return { mode: "config", prompt: last, label: "Global config" };
        if (/#\s*$/.test(last)) return { mode: "priv", prompt: last, label: "Privileged (#)" };
        if (/>\s*$/.test(last)) return { mode: "user", prompt: last, label: "User exec (>)" };
        return { mode: "unknown", prompt: last, label: "Unknown" };
      }
      var CONFIG_STARTERS = /^(vlan\b|interface\b|hostname\b|ip route\b|spanning-tree\b|username\b|line\b|banner\b|snmp-server\b|ntp\b|no\s+(vlan|interface)\b|errdisable\b|power-inline\b)/i;
      var PRIV_ONLY = /^(show\s+running-config|show\s+startup-config|copy\b|write\b|configure\b|reload\b|terminal\s+length\b|erase\b|delete\b|dir\b|ping\b|traceroute\b|clear\b)/i;
      function prepCommandsFor(mode, cmd) {
        const c = String(cmd || "").trim();
        const prep = [];
        if (mode === "user") {
          if (PRIV_ONLY.test(c) || CONFIG_STARTERS.test(c)) prep.push("enable");
          if (CONFIG_STARTERS.test(c)) prep.push("configure terminal");
        } else if (mode === "priv") {
          if (CONFIG_STARTERS.test(c)) prep.push("configure terminal");
        } else if (mode === "config" || mode === "config-if") {
          if (/^(show|copy|write|ping)\b/i.test(c) && !/^do\s/i.test(c)) prep.push("__DO_PREFIX__");
        }
        return prep;
      }
      function cleanPagedOutput(text) {
        return String(text || "").replace(/[^\S\n]*--\s*more\s*--[^\S\n]*/gi, "").replace(/<--- more --->/gi, "").replace(/press any key to continue.*$/gim, "").replace(/[^\x08\n]\x08/g, "").replace(/\x08+/g, "").replace(/\n{3,}/g, "\n\n");
      }
      module.exports = { detectCliMode, prepCommandsFor, cleanPagedOutput };
    }
  });

  // ../src/detect.js
  var require_detect = __commonJS({
    "../src/detect.js"(exports, module) {
      var SIGNATURES = [
        {
          vendor: "Allied Telesis",
          type: "Switch",
          kb: "allied-telesis",
          match: [/alliedware\s*plus/i, /^awplus/im, /Allied\s*Telesis/i, /^AT-\w+/im],
          modelPatterns: [/\b(AT-[A-Za-z0-9\-]+)\b/i],
          discovery: ["show system", "show version"]
        },
        {
          vendor: "Cisco ASA",
          type: "Firewall",
          kb: "cisco-asa",
          match: [/adaptive security appliance/i, /\bASA\b.*Version/i, /^ciscoasa/im, /Cisco Adaptive Security/i],
          modelPatterns: [/\b(ASA\d{3,4}[A-Za-z0-9\-]*)\b/i],
          discovery: ["show version"]
        },
        {
          vendor: "Cisco",
          type: "Router",
          kb: "cisco-ios",
          match: [/cisco ios.*router/i, /\bISR\b/i, /\bIOS-XE\b.*Router/i, /Cisco IOS XE/i],
          modelPatterns: [/(ISR\d{4}[A-Za-z0-9\-]*)/i, /(C\d{4}[A-Za-z0-9\-]*)/i],
          discovery: ["show version"]
        },
        {
          vendor: "Cisco",
          type: "Switch",
          kb: "cisco-ios",
          match: [/cisco ios/i, /catalyst/i, /\bC9\d{3}\b/i, /WS-C\d/i, /Cisco Catalyst/i],
          modelPatterns: [/(C9\d{3}[A-Za-z0-9\-]*)/i, /(WS-C[A-Za-z0-9\-]+)/i, /(CBS\d{3}[A-Za-z0-9\-]*)/i],
          discovery: ["show version"]
        },
        {
          vendor: "Fortinet",
          type: "Firewall",
          kb: "fortigate",
          match: [/fortigate/i, /fortios/i, /forticarrier/i, /Fortinet/i],
          modelPatterns: [/(FGT[A-Za-z0-9\-]+)/i, /(FortiGate-[A-Za-z0-9\-]+)/i, /(FG[0-9]+[A-Za-z0-9\-]*)/i],
          discovery: ["get system status"]
        },
        {
          vendor: "Palo Alto",
          type: "Firewall",
          kb: "generic-firewall",
          match: [/pan-os/i, /palo alto/i, /PA-[0-9]/i],
          modelPatterns: [/(PA-[0-9A-Za-z\-]+)/i],
          discovery: ["show system info"]
        },
        {
          vendor: "MikroTik",
          type: "Router",
          kb: "mikrotik",
          match: [/mikrotik/i, /routeros/i, /RouterOS/i],
          modelPatterns: [/(CCR[0-9A-Za-z\-]+)/i, /(RB[0-9A-Za-z\-]+)/i, /(hAP|hEX|cRS)\b/i],
          discovery: ["/system resource print"]
        },
        {
          vendor: "Juniper",
          type: "Router",
          kb: "juniper",
          match: [/junos/i, /juniper/i, /JUNOS/i],
          modelPatterns: [/(MX[0-9]+)/i, /(EX[0-9]+)/i, /(QFX[0-9]+)/i, /(SRX[0-9]+)/i],
          discovery: ["show version"]
        },
        {
          vendor: "Quantum",
          type: "Switch",
          kb: "quantum",
          match: [/\bQuantum\b/i],
          modelPatterns: [],
          discovery: ["show version"]
        },
        {
          vendor: "HPE/Aruba",
          type: "Switch",
          kb: "generic-switch",
          match: [/aruba/i, /procurve/i, /hewlett|hpe/i, /Aruba Networks/i],
          modelPatterns: [/(2930[MF][A-Za-z0-9\-]*)/i, /(2540[A-Za-z0-9\-]*)/i],
          discovery: ["show version"]
        }
      ];
      var PROBE_COMMANDS = [
        "show version",
        "show system",
        "get system status",
        "/system resource print",
        "show system info"
      ];
      function fingerprintDevice(outputText) {
        const text = String(outputText || "");
        for (const sig of SIGNATURES) {
          if (sig.match.some((re) => re.test(text))) {
            let model = "";
            for (const mp of sig.modelPatterns) {
              const m = text.match(mp);
              if (m) {
                model = m[1];
                break;
              }
            }
            return {
              vendor: sig.vendor,
              type: sig.type,
              kb: sig.kb,
              model,
              confidence: "high",
              matched: true
            };
          }
        }
        return { vendor: "", type: "", kb: "", model: "", confidence: "none", matched: false };
      }
      function arpDiscoveryCommands(brand) {
        const b = String(brand || "").toLowerCase();
        if (b.includes("cisco")) {
          return [
            { cmd: "show arp", why: "List all ARP entries \u2014 active hosts on local subnets" },
            { cmd: "show ip arp", why: "Detailed ARP with VLAN and interface mapping" },
            { cmd: "show mac address-table", why: "Layer-2 forwarding table \u2014 identifies which port each MAC is on" }
          ];
        }
        if (b.includes("allied")) {
          return [
            { cmd: "show arp", why: "ARP table" },
            { cmd: "show mac address-table", why: "MAC forwarding table" }
          ];
        }
        if (b.includes("fortinet") || b.includes("forti")) {
          return [
            { cmd: "get system arp", why: "ARP table for all interfaces" },
            { cmd: "diagnose ip arp list", why: "Detailed ARP with stale entries flagged" }
          ];
        }
        if (b.includes("mikrotik")) {
          return [
            { cmd: "/ip arp print", why: "ARP table" },
            { cmd: "/ip neighbor print", why: "CDP/LLDP-equivalent neighbour discovery" }
          ];
        }
        return [
          { cmd: "show arp", why: "ARP table (adjust for your vendor)" }
        ];
      }
      function parseArpTable(text) {
        const entries = [];
        const ciscoRe = /Internet\s+([\d.]+)\s+[\d\-]+\s+([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})\s+\w+\s+(\S+)/gi;
        let m;
        while ((m = ciscoRe.exec(text)) !== null) entries.push({ ip: m[1], mac: m[2], iface: m[3] });
        if (!entries.length) {
          const lines = text.split("\n");
          const genericRe = /((?:\d{1,3}\.){3}\d{1,3})\s.*?([0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2}[:\-][0-9a-f]{2})/i;
          for (const line of lines) {
            const gm = genericRe.exec(line);
            if (gm) entries.push({ ip: gm[1], mac: gm[2], iface: "" });
          }
        }
        return entries;
      }
      function parsePingOutput(text) {
        const result = { host: "", packetsSent: 0, packetsReceived: 0, packetLoss: null, minRtt: null, avgRtt: null, maxRtt: null, jitter: null };
        const ciscoStats = text.match(/Success rate is (\d+) percent \((\d+)\/(\d+)\)/i);
        if (ciscoStats) {
          result.packetsReceived = Number(ciscoStats[2]);
          result.packetsSent = Number(ciscoStats[3]);
          result.packetLoss = 100 - Number(ciscoStats[1]);
        }
        const ciscoRtt = text.match(/round-trip min\/avg\/max = (\d+)\/(\d+)\/(\d+) ms/i);
        if (ciscoRtt) {
          result.minRtt = Number(ciscoRtt[1]);
          result.avgRtt = Number(ciscoRtt[2]);
          result.maxRtt = Number(ciscoRtt[3]);
          result.jitter = result.maxRtt - result.minRtt;
        }
        const linuxStats = text.match(/(\d+) packets transmitted,\s*(\d+) received,\s*([\d.]+)% packet loss/i);
        if (linuxStats) {
          result.packetsSent = Number(linuxStats[1]);
          result.packetsReceived = Number(linuxStats[2]);
          result.packetLoss = parseFloat(linuxStats[3]);
        }
        const linuxRtt = text.match(/rtt min\/avg\/max\/mdev = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+) ms/i);
        if (linuxRtt) {
          result.minRtt = parseFloat(linuxRtt[1]);
          result.avgRtt = parseFloat(linuxRtt[2]);
          result.maxRtt = parseFloat(linuxRtt[3]);
          result.jitter = parseFloat(linuxRtt[4]);
        }
        const fortiStats = text.match(/(\d+) packets transmitted,\s*(\d+) packets received,\s*([\d.]+)% packet loss/i);
        if (fortiStats && !linuxStats) {
          result.packetsSent = Number(fortiStats[1]);
          result.packetsReceived = Number(fortiStats[2]);
          result.packetLoss = parseFloat(fortiStats[3]);
        }
        return result;
      }
      module.exports = { fingerprintDevice, PROBE_COMMANDS, SIGNATURES, arpDiscoveryCommands, parseArpTable, parsePingOutput };
    }
  });

  // ../src/validate.js
  var require_validate = __commonJS({
    "../src/validate.js"(exports, module) {
      var IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
      var HOSTNAME_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$/;
      function isValidHost(h) {
        const s = String(h || "").trim();
        if (!s || s.length > 253) return false;
        return IPV4_RE.test(s) || HOSTNAME_RE.test(s);
      }
      function isValidPort(p) {
        const n = Number(p);
        return Number.isInteger(n) && n >= 1 && n <= 65535;
      }
      function isValidSerialPort(p) {
        const s = String(p || "").trim();
        return /^COM\d{1,3}$/i.test(s) || /^\/dev\/tty[A-Za-z0-9]+$/.test(s);
      }
      var VALID_BAUDS = /* @__PURE__ */ new Set([300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400, 460800, 921600]);
      function isValidBaudRate(b) {
        return VALID_BAUDS.has(Number(b));
      }
      function isValidUsername(u) {
        const s = String(u || "");
        return s.length >= 1 && s.length <= 64 && /^[\x20-\x7E]+$/.test(s);
      }
      var SHELL_INJECT_RE = /[;&|`$(){}[\]<>\\]/;
      function sanitiseCommand(cmd) {
        const s = String(cmd || "").trimEnd();
        if (s.length > 512) throw new Error("Command too long (max 512 chars).");
        if (SHELL_INJECT_RE.test(s)) throw new Error("Command contains disallowed characters.");
        return s;
      }
      function sanitiseCaptureFilter(f) {
        const s = String(f || "").trim();
        if (s.length > 256) throw new Error("Capture filter too long (max 256 chars).");
        if (/[;&|`$()\\<>]/.test(s)) throw new Error("Capture filter contains disallowed characters.");
        return s;
      }
      var CIDR_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\/(?:[12]?\d|3[012]))?$/;
      function isValidCIDR(c) {
        return CIDR_RE.test(String(c || "").trim());
      }
      module.exports = {
        isValidHost,
        isValidPort,
        isValidSerialPort,
        isValidBaudRate,
        isValidUsername,
        sanitiseCommand,
        sanitiseCaptureFilter,
        isValidCIDR
      };
    }
  });

  // ../src/models.js
  var require_models = __commonJS({
    "../src/models.js"(exports, module) {
      var PRESETS = {
        // ── Anthropic ────────────────────────────────────────────────────────────
        anthropic: [
          { id: "claude-opus-4-5", label: "Claude Opus 4.5 \u2014 max capability", speed: "slower", cost: "$$$$", note: "Best for hard multi-device design.", free: false },
          { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 \u2014 balanced \u2605", speed: "fast", cost: "$$", note: "Recommended: best accuracy/price for live work.", free: false },
          { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 \u2014 fastest", speed: "fastest", cost: "$", note: "Routine VLAN/port changes; less strong on complex firewall logic.", free: false },
          { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet \u2014 extended thinking", speed: "fast", cost: "$$", note: "Extended thinking; strong step-by-step reasoning.", free: false },
          { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet (Oct 2024)", speed: "fast", cost: "$$", note: "Balanced; very capable.", free: false },
          { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku \u2014 lightweight", speed: "fastest", cost: "$", note: "Low-cost, high-speed variant.", free: false },
          { id: "claude-3-opus-20240229", label: "Claude 3 Opus \u2014 legacy top-tier", speed: "slower", cost: "$$$$", note: "Prior flagship Anthropic model.", free: false },
          { id: "claude-3-sonnet-20240229", label: "Claude 3 Sonnet", speed: "fast", cost: "$$", note: "Balanced mid-tier.", free: false },
          { id: "claude-3-haiku-20240307", label: "Claude 3 Haiku \u2014 fastest Claude 3", speed: "fastest", cost: "$", note: "Very fast, very cheap.", free: false }
        ],
        // ── OpenAI ────────────────────────────────────────────────────────────────
        openai: [
          { id: "gpt-4o", label: "GPT-4o \u2014 multimodal balanced", speed: "fast", cost: "$$$", note: "Strong reasoning + vision.", free: false },
          { id: "gpt-4o-mini", label: "GPT-4o mini \u2014 fast & cheap", speed: "fastest", cost: "$", note: "Good for routine questions.", free: false },
          { id: "o1", label: "o1 \u2014 deep reasoning", speed: "slower", cost: "$$$$", note: "Best for hard multi-step problems.", free: false },
          { id: "o1-mini", label: "o1-mini \u2014 compact reasoning", speed: "slow", cost: "$$", note: "Smaller o1-class reasoning model.", free: false },
          { id: "o3-mini", label: "o3-mini \u2014 efficient reasoning", speed: "fast", cost: "$$", note: "Latest efficient reasoning; strong code tasks.", free: false },
          { id: "gpt-4-turbo", label: "GPT-4 Turbo \u2014 128k context", speed: "fast", cost: "$$$", note: "Long-context tasks.", free: false },
          { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo \u2014 legacy fast & cheap", speed: "fastest", cost: "$", note: "Legacy; cheapest OpenAI.", free: false }
        ],
        // ── Google ───────────────────────────────────────────────────────────────
        google: [
          { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash \u2014 ultra-fast \u2605", speed: "fastest", cost: "$", note: "Fastest Gemini; multimodal.", free: true },
          { id: "gemini-2.0-flash-thinking-exp", label: "Gemini 2.0 Flash Thinking (exp)", speed: "fast", cost: "$", note: "Reasoning-mode Flash.", free: false },
          { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro \u2014 1M context", speed: "fast", cost: "$$", note: "1M-token window; strong.", free: false },
          { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash \u2014 fast & cheap", speed: "fastest", cost: "$", note: "Affordable, multimodal.", free: true },
          { id: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash-8B \u2014 free tier", speed: "fastest", cost: "free", note: "Google free quota; very lightweight.", free: true }
        ],
        // ── OpenRouter / OpenAI-compatible base URL ───────────────────────────────
        "openai-compatible": [
          // Anthropic via OpenRouter
          { id: "anthropic/claude-sonnet-4-6", label: "OpenRouter \xB7 Claude Sonnet 4.6 \u2605", speed: "fast", cost: "$$", note: "Recommended default via OpenRouter.", free: false, via: "openrouter" },
          { id: "anthropic/claude-3-7-sonnet-20250219", label: "OpenRouter \xB7 Claude 3.7 Sonnet", speed: "fast", cost: "$$", note: "Extended thinking via OpenRouter.", free: false, via: "openrouter" },
          { id: "anthropic/claude-3-5-haiku", label: "OpenRouter \xB7 Claude 3.5 Haiku", speed: "fastest", cost: "$", note: "Cheapest Claude via OpenRouter.", free: false, via: "openrouter" },
          // OpenAI via OpenRouter
          { id: "openai/gpt-4o", label: "OpenRouter \xB7 GPT-4o", speed: "fast", cost: "$$$", note: "OpenAI multimodal.", free: false, via: "openrouter" },
          { id: "openai/gpt-4o-mini", label: "OpenRouter \xB7 GPT-4o mini", speed: "fastest", cost: "$", note: "OpenAI cheap.", free: false, via: "openrouter" },
          { id: "openai/o3-mini", label: "OpenRouter \xB7 o3-mini", speed: "fast", cost: "$$", note: "OpenAI reasoning.", free: false, via: "openrouter" },
          // Google via OpenRouter
          { id: "google/gemini-2.0-flash-001", label: "OpenRouter \xB7 Gemini 2.0 Flash", speed: "fastest", cost: "$", note: "Very cheap; verify vendor syntax.", free: false, via: "openrouter" },
          { id: "google/gemini-flash-1.5-8b", label: "OpenRouter \xB7 Gemini Flash 1.5 8B \u2014 FREE", speed: "fastest", cost: "free", note: "Free tier via OpenRouter.", free: true, via: "openrouter" },
          { id: "google/gemini-pro-1.5", label: "OpenRouter \xB7 Gemini 1.5 Pro", speed: "fast", cost: "$$", note: "Long context.", free: false, via: "openrouter" },
          // DeepSeek
          { id: "deepseek/deepseek-chat", label: "OpenRouter \xB7 DeepSeek V3", speed: "fast", cost: "$", note: "Very low cost.", free: false, via: "openrouter" },
          { id: "deepseek/deepseek-r1", label: "OpenRouter \xB7 DeepSeek R1 \u2014 reasoning", speed: "slow", cost: "$$", note: "Chain-of-thought reasoning model.", free: false, via: "openrouter" },
          { id: "deepseek/deepseek-r1-distill-qwen-32b", label: "OpenRouter \xB7 DeepSeek R1 Distill 32B", speed: "fast", cost: "$", note: "Smaller, faster R1 distillation.", free: false, via: "openrouter" },
          // Meta Llama
          { id: "meta-llama/llama-3.3-70b-instruct", label: "OpenRouter \xB7 Llama 3.3 70B", speed: "fast", cost: "$", note: "Strong open-weights model.", free: false, via: "openrouter" },
          { id: "meta-llama/llama-3.1-405b-instruct", label: "OpenRouter \xB7 Llama 3.1 405B", speed: "slow", cost: "$$", note: "Largest open-weights.", free: false, via: "openrouter" },
          { id: "meta-llama/llama-3.1-8b-instruct:free", label: "OpenRouter \xB7 Llama 3.1 8B \u2014 FREE", speed: "fastest", cost: "free", note: "Free tier; fast small model.", free: true, via: "openrouter" },
          // Qwen
          { id: "qwen/qwen-2.5-72b-instruct", label: "OpenRouter \xB7 Qwen 2.5 72B", speed: "fast", cost: "$", note: "Strong Chinese + English.", free: false, via: "openrouter" },
          { id: "qwen/qwen-2.5-coder-32b-instruct", label: "OpenRouter \xB7 Qwen 2.5 Coder 32B", speed: "fast", cost: "$", note: "Excellent for config generation.", free: false, via: "openrouter" },
          // Mistral
          { id: "mistralai/mistral-large", label: "OpenRouter \xB7 Mistral Large", speed: "fast", cost: "$$", note: "Strong multilingual reasoning.", free: false, via: "openrouter" },
          { id: "mistralai/mistral-nemo", label: "OpenRouter \xB7 Mistral Nemo \u2014 FREE", speed: "fast", cost: "free", note: "Free tier via OpenRouter.", free: true, via: "openrouter" },
          { id: "mistralai/codestral-mamba", label: "OpenRouter \xB7 Codestral \u2014 code-focused", speed: "fast", cost: "$", note: "Best for CLI/config generation.", free: false, via: "openrouter" },
          // Groq (change base URL to https://api.groq.com/openai/v1)
          { id: "llama-3.3-70b-versatile", label: "Groq \xB7 Llama 3.3 70B \u2014 ultra-fast \u2605", speed: "fastest", cost: "free", note: "Free tier via Groq. Base URL: https://api.groq.com/openai/v1", free: true, via: "groq" },
          { id: "llama-3.1-8b-instant", label: "Groq \xB7 Llama 3.1 8B \u2014 instant", speed: "fastest", cost: "free", note: "Smallest, fastest. Base URL: https://api.groq.com/openai/v1", free: true, via: "groq" },
          { id: "mixtral-8x7b-32768", label: "Groq \xB7 Mixtral 8x7B", speed: "fastest", cost: "free", note: "Groq free tier. Base URL: https://api.groq.com/openai/v1", free: true, via: "groq" },
          { id: "gemma2-9b-it", label: "Groq \xB7 Gemma 2 9B", speed: "fastest", cost: "free", note: "Google Gemma on Groq. Base URL: https://api.groq.com/openai/v1", free: true, via: "groq" },
          // Together AI
          { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Together \xB7 Llama 3.3 70B Turbo", speed: "fast", cost: "$", note: "Together AI. Base URL: https://api.together.xyz/v1", free: false, via: "together" },
          { id: "deepseek-ai/DeepSeek-R1", label: "Together \xB7 DeepSeek R1", speed: "slow", cost: "$$", note: "Together AI. Base URL: https://api.together.xyz/v1", free: false, via: "together" }
        ],
        // ── Local: Ollama ─────────────────────────────────────────────────────────
        ollama: [
          { id: "llama3.3", label: "Llama 3.3 (local, free)", speed: "depends", cost: "free", note: "Best local general model. No data leaves the machine.", free: true },
          { id: "llama3.1", label: "Llama 3.1 (local, free)", speed: "depends", cost: "free", note: "Solid fallback.", free: true },
          { id: "qwen2.5", label: "Qwen 2.5 (local, free)", speed: "depends", cost: "free", note: "Strong code + reasoning.", free: true },
          { id: "qwen2.5-coder", label: "Qwen 2.5 Coder (local, free)", speed: "depends", cost: "free", note: "Specialized for config generation.", free: true },
          { id: "deepseek-r1", label: "DeepSeek R1 (local, free)", speed: "depends", cost: "free", note: "Local reasoning model.", free: true },
          { id: "mistral", label: "Mistral (local, free)", speed: "depends", cost: "free", note: "Good general purpose.", free: true },
          { id: "codestral", label: "Codestral (local, free)", speed: "depends", cost: "free", note: "Specialized for config tasks.", free: true },
          { id: "phi4", label: "Phi-4 (local, free)", speed: "fast", cost: "free", note: "Microsoft small model, fast on CPU.", free: true },
          { id: "gemma2", label: "Gemma 2 (local, free)", speed: "depends", cost: "free", note: "Google open model.", free: true },
          { id: "phi3.5", label: "Phi-3.5 mini (local, free)", speed: "fastest", cost: "free", note: "Tiny but capable.", free: true }
        ]
      };
      var BASE_URLS = {
        "openai-compatible": "https://openrouter.ai/api/v1",
        "google": "https://generativelanguage.googleapis.com/v1beta/openai",
        "ollama": "http://localhost:11434"
      };
      var PROVIDER_LABELS = {
        anthropic: "Anthropic (Claude)",
        openai: "OpenAI (GPT / o-series)",
        google: "Google (Gemini)",
        "openai-compatible": "OpenAI-compatible \u2014 OpenRouter / Groq / Together",
        ollama: "Ollama (local, offline)"
      };
      var FREE_NOTE = "\u{1F193} Free-tier models are highlighted. Actual limits depend on the provider.";
      var GROQ_NOTE = "\u26A1 Groq models need Base URL: https://api.groq.com/openai/v1";
      var OMNI_NOTE = "OmniRouter: use Base URL https://api.omnirouter.ai/v1 with your OmniRouter key.";
      function presetsFor(provider, freeOnly = false) {
        const list = PRESETS[provider] || [];
        return freeOnly ? list.filter((m) => m.free) : list;
      }
      function defaultBaseUrl(provider) {
        return BASE_URLS[provider] || "";
      }
      function defaultModel(provider) {
        const p = PRESETS[provider];
        if (!p || !p.length) return "";
        const rec = p.find((m) => /★/.test(m.label) || /recommended/i.test(m.note));
        return (rec || p[0]).id;
      }
      function allProviders() {
        return Object.keys(PRESETS);
      }
      module.exports = {
        PRESETS,
        BASE_URLS,
        PROVIDER_LABELS,
        FREE_NOTE,
        GROQ_NOTE,
        OMNI_NOTE,
        presetsFor,
        defaultBaseUrl,
        defaultModel,
        allProviders
      };
    }
  });

  // ../src/switch-config.js
  var require_switch_config = __commonJS({
    "../src/switch-config.js"(exports, module) {
      "use strict";
      var { isValidHost } = require_validate();
      var SUPPORTED_VENDORS = [
        "cisco-ios",
        "cisco-nxos",
        "allied-telesis",
        "mikrotik",
        "fortinet",
        "juniper",
        "generic"
      ];
      var SUBNET_MASK_RE = /^(255|254|252|248|240|224|192|128|0)(\.(255|254|252|248|240|224|192|128|0)){3}$/;
      function validateParams(params) {
        const errors = [];
        if (!params.hostname || !/^[A-Za-z0-9_-]{1,64}$/.test(params.hostname)) {
          errors.push("hostname: must be 1-64 chars (A-Z, 0-9, hyphen, underscore)");
        }
        if (params.vendor && !SUPPORTED_VENDORS.includes(String(params.vendor).toLowerCase())) {
          errors.push(`vendor: unknown vendor "${params.vendor}". Supported: ${SUPPORTED_VENDORS.join(", ")}`);
        }
        if (params.mgmtIp && !isValidHost(params.mgmtIp)) {
          errors.push("mgmtIp: must be a valid IPv4 address or hostname");
        }
        if (params.mgmtMask && !SUBNET_MASK_RE.test(params.mgmtMask) && !/^\d{1,2}$/.test(params.mgmtMask)) {
          errors.push("mgmtMask: must be a valid dotted-quad subnet mask (e.g. 255.255.255.0) or CIDR prefix (e.g. 24)");
        }
        if (params.gateway && !isValidHost(params.gateway)) {
          errors.push("gateway: must be a valid IPv4 address or hostname");
        }
        if (params.ntpServer && !isValidHost(params.ntpServer) && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(params.ntpServer)) {
          errors.push("ntpServer: must be a valid IP or FQDN");
        }
        if (params.vlans !== void 0 && !Array.isArray(params.vlans)) {
          errors.push("vlans: must be an array of { id, name? } objects");
        }
        for (const v of params.vlans || []) {
          const id = Number(v.id);
          if (!Number.isInteger(id) || id < 1 || id > 4094) {
            errors.push(`vlans: VLAN ID ${v.id} is out of range (1-4094)`);
          }
        }
        return errors;
      }
      function _cidr(mask) {
        if (!mask) return 24;
        if (/^\d{1,2}$/.test(mask)) return Number(mask);
        const parts = String(mask).split(".");
        let bits = 0;
        for (const p of parts) {
          let n = parseInt(p, 10);
          while (n > 0) {
            bits += n & 1;
            n >>>= 1;
          }
        }
        return bits || 24;
      }
      function _safeName(name) {
        return String(name || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
      }
      function generateCiscoIOS(p) {
        const vlans = p.vlans || [];
        const out = [
          "! \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
          "! Baseline \u2014 Cisco IOS / IOS-XE",
          `! Generated by Ahuva IT Support Assistant`,
          "! \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
          "configure terminal",
          `hostname ${p.hostname}`,
          "!",
          "no service pad",
          "service timestamps debug datetime msec localtime",
          "service timestamps log datetime msec localtime",
          "service password-encryption",
          "no ip domain-lookup",
          "!"
        ];
        if (p.enableSecret) {
          out.push(`enable secret ${p.enableSecret}`, "!");
        }
        if (p.adminUser && p.adminPass) {
          out.push(`username ${p.adminUser} privilege 15 secret ${p.adminPass}`, "!");
        }
        for (const v of vlans) {
          out.push(`vlan ${v.id}`);
          if (v.name) out.push(` name ${_safeName(v.name)}`);
          out.push("!");
        }
        if (p.mgmtVlan && p.mgmtIp && p.mgmtMask) {
          out.push(
            `interface Vlan${p.mgmtVlan}`,
            ` description Management`,
            ` ip address ${p.mgmtIp} ${p.mgmtMask}`,
            " no shutdown",
            "!"
          );
          if (p.gateway) out.push(`ip default-gateway ${p.gateway}`, "!");
        }
        if (p.sshDomain || p.adminUser) {
          out.push(
            `ip domain-name ${p.sshDomain || "corp.local"}`,
            "crypto key generate rsa modulus 2048",
            "ip ssh version 2",
            "ip ssh time-out 60",
            "ip ssh authentication-retries 3",
            "!",
            "line vty 0 4",
            " transport input ssh",
            p.adminUser ? " login local" : " login",
            " exec-timeout 10 0",
            "!"
          );
        }
        if (p.ntpServer) out.push(`ntp server ${p.ntpServer}`, "!");
        if (p.bannerMotd) {
          const msg = String(p.bannerMotd).replace(/\^/g, "");
          out.push(`banner motd ^${msg}^`, "!");
        }
        out.push(
          "logging buffered 16384 informational",
          "logging console critical",
          p.syslogServer ? `logging host ${p.syslogServer}` : null,
          p.snmpCommunity ? `snmp-server community ${p.snmpCommunity} RO` : null,
          "!",
          "end",
          "write memory",
          "! \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550"
        );
        const config = out.filter((l) => l !== null).join("\n");
        const commands = out.filter((l) => l !== null && !l.startsWith("!")).map((l) => l.trim()).filter(Boolean);
        return {
          vendor: "cisco-ios",
          config,
          commands,
          notes: [
            "Adjust management VLAN and SVI interface numbers to match your hardware.",
            "RSA key generation may require a few seconds and a reload on older IOS.",
            "Use a strong enable secret \u2014 minimum 12 characters, mixed case + digits."
          ]
        };
      }
      function generateCiscoNXOS(p) {
        const vlans = p.vlans || [];
        const out = [
          "! \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
          "! Baseline \u2014 Cisco NX-OS",
          "! \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
          "configure terminal",
          `hostname ${p.hostname}`,
          "feature ssh",
          "feature scp-server",
          "no feature telnet",
          "!"
        ];
        if (p.adminUser && p.adminPass) {
          out.push(`username ${p.adminUser} password ${p.adminPass} role network-admin`, "!");
        }
        for (const v of vlans) {
          out.push(`vlan ${v.id}`);
          if (v.name) out.push(`  name ${_safeName(v.name)}`);
          out.push("  exit");
        }
        if (p.mgmtIp) {
          const cidr = _cidr(p.mgmtMask);
          out.push(
            `interface mgmt0`,
            `  ip address ${p.mgmtIp}/${cidr}`,
            "  no shutdown",
            "!"
          );
        }
        if (p.gateway) out.push(`ip route 0.0.0.0/0 ${p.gateway}`, "!");
        if (p.ntpServer) out.push(`ntp server ${p.ntpServer}`, "!");
        out.push("end", "copy running-config startup-config");
        out.push("! \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        const config = out.join("\n");
        const commands = out.filter((l) => !l.startsWith("!")).map((l) => l.trim()).filter(Boolean);
        return {
          vendor: "cisco-nxos",
          config,
          commands,
          notes: [
            "NX-OS uses CIDR notation (/24) not dotted-quad masks.",
            "Feature activation may cause brief traffic interruption on first enable.",
            "Run 'feature nxapi' only if REST management is required."
          ]
        };
      }
      function generateAlliedTelesis(p) {
        const vlans = p.vlans || [];
        const out = [
          "! \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
          "! Baseline \u2014 Allied Telesis AW+",
          "! \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
          `set system name "${p.hostname}"`,
          "!"
        ];
        if (vlans.length) {
          out.push("vlan database");
          for (const v of vlans) {
            out.push(`  vlan ${v.id}${v.name ? " name " + _safeName(v.name) : ""}`);
          }
          out.push("exit", "!");
        }
        if (p.mgmtVlan && p.mgmtIp && p.mgmtMask) {
          const cidr = _cidr(p.mgmtMask);
          out.push(
            `interface vlan${p.mgmtVlan}`,
            ` ip address ${p.mgmtIp}/${cidr}`,
            " no shutdown",
            "exit",
            "!"
          );
        }
        if (p.gateway) out.push(`ip route 0.0.0.0/0 ${p.gateway}`, "!");
        if (p.adminUser && p.adminPass) {
          out.push(`username ${p.adminUser} privilege 15 password ${p.adminPass}`, "!");
        }
        out.push("service ssh");
        if (p.ntpServer) out.push(`ntp server ${p.ntpServer}`);
        out.push("write memory");
        out.push("! \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        const config = out.join("\n");
        const commands = out.filter((l) => !l.startsWith("!")).map((l) => l.trim()).filter(Boolean);
        return {
          vendor: "allied-telesis",
          config,
          commands,
          notes: [
            "Allied Telesis uses CIDR notation. Adjust interface names per hardware (e.g. port1.0.1).",
            "For patch releases, use 'awplus# install license' before deploying SSH keys."
          ]
        };
      }
      function generateMikroTik(p) {
        const vlans = p.vlans || [];
        const out = [
          "# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
          "# Baseline \u2014 MikroTik RouterOS",
          "# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
          `/system identity set name="${p.hostname}"`
        ];
        for (const v of vlans) {
          out.push(`/interface vlan add name=vlan${v.id} vlan-id=${v.id} interface=bridge comment="${v.name || ""}"`);
        }
        if (p.mgmtIp && p.mgmtMask) {
          const cidr = _cidr(p.mgmtMask);
          out.push(`/ip address add address=${p.mgmtIp}/${cidr} interface=bridge`);
        }
        if (p.gateway) out.push(`/ip route add gateway=${p.gateway}`);
        if (p.ntpServer) out.push(`/system ntp client set enabled=yes server-dns-names=${p.ntpServer}`);
        if (p.adminUser && p.adminPass) {
          out.push(`/user add name=${p.adminUser} password="${p.adminPass}" group=full`);
        }
        out.push(
          "/ip service disable telnet,ftp,www,api,api-ssl",
          "/ip service enable ssh"
        );
        out.push("# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        const config = out.join("\n");
        const commands = out.filter((l) => !l.startsWith("#")).map((l) => l.trim()).filter(Boolean);
        return {
          vendor: "mikrotik",
          config,
          commands,
          notes: [
            "Replace 'interface=bridge' with your actual bridge interface name.",
            "MikroTik commands use forward-slash path prefixes \u2014 do not omit them.",
            "Disable default admin account after creating your own: /user disable admin"
          ]
        };
      }
      function generateFortiGate(p) {
        const vlans = p.vlans || [];
        const out = [
          "# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
          "# Baseline \u2014 Fortinet FortiGate",
          "# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
          "config system global",
          `  set hostname ${p.hostname}`,
          "end"
        ];
        for (const v of vlans) {
          out.push(
            "config system interface",
            `  edit "vlan${v.id}"`,
            "    set vdom root",
            "    set type vlan",
            `    set vlanid ${v.id}`,
            v.name ? `    set alias "${v.name}"` : null,
            "  next",
            "end"
          );
        }
        if (p.adminUser && p.adminPass) {
          out.push(
            "config system admin",
            `  edit "${p.adminUser}"`,
            `    set password ${p.adminPass}`,
            '    set accprofile "super_admin"',
            "  next",
            "end"
          );
        }
        if (p.ntpServer) {
          out.push(
            "config system ntp",
            "  set ntpsync enable",
            `  set server "${p.ntpServer}"`,
            "end"
          );
        }
        out.push("# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        const config = out.filter((l) => l !== null).join("\n");
        const commands = out.filter((l) => l !== null && !l.startsWith("#")).map((l) => l.trim()).filter(Boolean);
        return {
          vendor: "fortinet",
          config,
          commands,
          notes: [
            "FortiGate VLANs need a parent physical interface. Add 'set interface <port>' inside the vlan block.",
            "Management IP is configured under 'config system interface' for the management port.",
            "Run 'execute backup config flash' after applying baseline."
          ]
        };
      }
      function generateJuniper(p) {
        const vlans = p.vlans || [];
        const out = [
          "# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
          "# Baseline \u2014 Juniper JunOS",
          "# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
          `set system host-name ${p.hostname}`,
          "set system services ssh protocol-version v2",
          "set system services ssh max-sessions-per-connection 2"
        ];
        if (p.adminUser && p.adminPass) {
          out.push(`set system login user ${p.adminUser} class super-user`);
          out.push(`set system login user ${p.adminUser} authentication plain-text-password "${p.adminPass}"`);
        }
        for (const v of vlans) {
          const vName = v.name ? _safeName(v.name) : `vlan${v.id}`;
          out.push(`set vlans ${vName} vlan-id ${v.id}`);
          if (p.mgmtVlan && String(v.id) === String(p.mgmtVlan) && p.mgmtIp && p.mgmtMask) {
            out.push(`set vlans ${vName} l3-interface irb.${v.id}`);
            out.push(`set interfaces irb unit ${v.id} family inet address ${p.mgmtIp}/${_cidr(p.mgmtMask)}`);
          }
        }
        if (p.gateway) out.push(`set routing-options static route 0.0.0.0/0 next-hop ${p.gateway}`);
        if (p.ntpServer) out.push(`set system ntp server ${p.ntpServer}`);
        out.push("commit check", "commit");
        out.push("# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        const config = out.join("\n");
        const commands = out.filter((l) => !l.startsWith("#")).map((l) => l.trim()).filter(Boolean);
        return {
          vendor: "juniper",
          config,
          commands,
          notes: [
            "JunOS uses 'commit check' to validate before committing \u2014 never skip it.",
            "IRB interface numbers must match VLAN IDs for consistent L3 addressing.",
            "Rollback is easy: 'rollback 1 && commit' to revert the last commit."
          ]
        };
      }
      function generateGeneric(p) {
        const vlans = p.vlans || [];
        const out = [
          `# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`,
          `# Generic Switch Baseline \u2014 review commands for your vendor`,
          `# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`,
          `# Step 1: Hostname`,
          `hostname ${p.hostname}`
        ];
        if (vlans.length) {
          out.push("# Step 2: VLANs");
          for (const v of vlans) {
            out.push(`vlan ${v.id}`);
            if (v.name) out.push(` name ${_safeName(v.name)}`);
          }
        }
        if (p.mgmtIp) {
          out.push(
            `# Step 3: Management IP`,
            `interface vlan ${p.mgmtVlan || 1}`,
            ` ip address ${p.mgmtIp} ${p.mgmtMask || "255.255.255.0"}`
          );
        }
        if (p.gateway) out.push(`# Step 4: Default gateway`, `ip default-gateway ${p.gateway}`);
        if (p.adminUser) out.push(`# Step 5: Admin user`, `username ${p.adminUser} password ${p.adminPass || "CHANGE_ME"}`);
        out.push("# Step 6: Save", "write memory");
        out.push("# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        const config = out.join("\n");
        const commands = out.filter((l) => !l.startsWith("#")).map((l) => l.trim()).filter(Boolean);
        return {
          vendor: "generic",
          config,
          commands,
          notes: [
            "This is a generic template. Review every command against your vendor's CLI reference.",
            "VLAN syntax varies: Cisco/AW+ use 'vlan <id>', MikroTik uses /interface vlan, FortiGate uses config system interface."
          ]
        };
      }
      var VENDOR_GENERATORS = {
        "cisco-ios": generateCiscoIOS,
        "cisco-nxos": generateCiscoNXOS,
        "allied-telesis": generateAlliedTelesis,
        "mikrotik": generateMikroTik,
        "fortinet": generateFortiGate,
        "juniper": generateJuniper,
        "generic": generateGeneric
      };
      function generateBaseline(params) {
        const errors = validateParams(params);
        if (errors.length) throw new Error("Validation failed:\n\u2022 " + errors.join("\n\u2022 "));
        const key = String(params.vendor || "generic").toLowerCase();
        const gen = VENDOR_GENERATORS[key] || VENDOR_GENERATORS.generic;
        return gen(params);
      }
      module.exports = { generateBaseline, validateParams, SUPPORTED_VENDORS };
    }
  });

  // ../src/prompt.js
  var require_prompt = __commonJS({
    "../src/prompt.js"(exports, module) {
      function buildSystemPrompt({ session, kbChunks, terminalTail, cliMode, autopilot, errorNotes }) {
        const s = session || {};
        const kbText = (kbChunks || []).map((c) => `--- From ${c.source} ---
${c.text}`).join("\n\n") || "(no matching reference found \u2014 rely on standard vendor CLI knowledge and say so)";
        return `You are the Ahuva IT Support Assistant, an on-site copilot for network engineers of Ahuva Electronic Technologies Pvt. Ltd. You guide a field engineer configuring/troubleshooting a switch over a LIVE terminal (SSH or serial console) at a production client site.

CURRENT SESSION
- Connection: ${s.connType || "not connected"} ${s.connType === "ssh" ? `to ${s.host}:${s.port}` : s.connType === "serial" ? `on ${s.comPort} @ ${s.baudRate} baud` : ""}
- Switch brand: ${s.brand || "unknown"} | model: ${s.model || "unknown"}
- Engineer's task: ${s.task || "not stated yet"}
- CLI MODE RIGHT NOW: ${cliMode ? `${cliMode.mode} \u2014 last prompt line: "${cliMode.prompt}"` : "unknown"}
- Execution mode: ${autopilot ? "AUTO-PILOT (safe commands run automatically after 5s; disruptive/destructive still need manual approval)" : "manual approval for every command"}

CLI MODE RULES \u2014 this is critical, mode mistakes caused real site failures:
- "user" mode (prompt ends ">"): show running-config / copy / configure will FAIL. First command must be "enable".
- "priv" mode (ends "#"): config commands need "configure terminal" first.
- "config"/"config-if" mode (ends "(config)#"): to run show/copy from here use "do show ..." / "do copy ...", or "end" first.
- ALWAYS sequence commands for the CURRENT mode shown above. Include the mode-entry commands (enable / configure terminal / end) as their own commands in your list, in the right order.
- If mode is "auth" (login/password prompt), do NOT propose commands \u2014 tell the engineer to type credentials directly in the terminal.

HOW YOU WORK
1. Be thorough and precise like a senior engineer. Give complete, useful replies \u2014 explain WHAT you're doing and WHY in 2-5 sentences, not one-liners. But no fluff.
2. If key details are missing (VLAN IDs, exact ports, access vs trunk, PoE), ask focused questions in "needs".
3. Use EXACT syntax for the stated brand: Allied Telesis = AlliedWare Plus; Cisco = IOS. Never mix vendors. For port ranges: AW+ uses "interface port1.0.1-port1.0.5"; Cisco uses "interface range Gi1/0/1 - 5".
4. Propose a complete logical block per turn (up to 6 commands): mode entry \u2192 changes \u2192 "end"/"exit" \u2192 verification (show ...). The app runs them in order.
5. After commands run you receive the live output. READ IT LINE BY LINE: check for "% Invalid input", "% Ambiguous", "% Incomplete", authorization failures, unexpected prompts, and confirm the change actually appears in verification output before declaring success.
6. Production safety: recommend config backup before first change of the session; call out anything disruptive; warn when a change could cut the engineer's own SSH session (mgmt IP, VLAN of the uplink, line vty). After successful changes, remind to save: "copy running-config startup-config".
7. Stacked switches: config syncs across members \u2014 reloads affect the whole stack; say so when relevant.
8. Never ask for passwords in chat; never echo credentials. If the terminal shows "% Default password needs to be changed", flag it for the handover doc.
9. Unsure of syntax on this exact model? Propose "?" help or a show command to discover \u2014 never guess config commands.

${errorNotes ? "ERROR LESSONS \u2014 mistakes already seen on this vendor / this session. Do NOT repeat them; adjust syntax or mode instead:\n" + errorNotes + "\n\n" : ""}REFERENCE EXCERPTS (Ahuva knowledge base)
${kbText}

RECENT LIVE TERMINAL OUTPUT (most recent last)
${terminalTail ? terminalTail : "(no output yet)"}

REPLY FORMAT \u2014 ONLY a JSON object, no markdown fences:
{
  "reply": "clear, complete guidance for the engineer (plain text, \\n allowed)",
  "commands": [ { "cmd": "exact CLI command", "why": "one-line reason" } ],
  "needs": [ "specific question you still need answered" ]
}
- Commands run top-to-bottom in the live console; order them exactly as they must execute given the CURRENT CLI MODE.
- "commands" may be empty when only answering/asking.`;
      }
      module.exports = { buildSystemPrompt };
    }
  });

  // ../src/pcap-analyser.js
  var require_pcap_analyser = __commonJS({
    "../src/pcap-analyser.js"(exports, module) {
      "use strict";
      var SEVERITY = Object.freeze({ NORMAL: "normal", HIGH: "high", CRITICAL: "critical" });
      var RETRANSMIT_RE = /\[TCP Retransmission\]|\[TCP Out-Of-Order\]|\[TCP Dup ACK\]|\[TCP Fast Retransmission\]/i;
      var RST_RE = /RST,\s*ACK|\[TCP RST\]/i;
      var ICMP_UNREACH = /unreachable|port unreachable|host unreachable/i;
      var DNS_FAIL_RE = /NXDOMAIN|No such name/i;
      var ARP_RE = /ARP.*who.has|ARP.*Reply/i;
      var BROADCAST_PROTOS = /* @__PURE__ */ new Set(["ARP", "LLDP", "STP", "CDP", "MDNS", "SSDP", "LLC", "LOOP"]);
      function analyseCapture({ packets, conversations, summary }) {
        const lines = String(summary || "").split("\n").filter(Boolean);
        const anomalies = [];
        const counts = {
          total: Number(packets) || lines.length,
          retransmits: 0,
          resets: 0,
          arpCount: 0,
          dnsFailures: 0,
          icmpUnreach: 0,
          protocols: {},
          sources: {},
          dests: {}
        };
        for (const line of lines) {
          const parts = line.split("	");
          const [, src, dst, proto, info, tcpRexmit, tcpOOO, tcpDupAck, tcpRst, icmpType, dnsRcode] = parts;
          if (proto) counts.protocols[proto] = (counts.protocols[proto] || 0) + 1;
          if (src) counts.sources[src] = (counts.sources[src] || 0) + 1;
          if (dst) counts.dests[dst] = (counts.dests[dst] || 0) + 1;
          if (tcpRexmit === "1" || tcpOOO === "1" || tcpDupAck === "1") {
            counts.retransmits++;
          } else {
            const i2 = String(info || "");
            if (RETRANSMIT_RE.test(i2)) counts.retransmits++;
          }
          if (tcpRst === "1") {
            counts.resets++;
          } else {
            const i2 = String(info || "");
            if (RST_RE.test(i2)) counts.resets++;
          }
          if (icmpType === "3") {
            counts.icmpUnreach++;
          } else {
            const i2 = String(info || "");
            if (ICMP_UNREACH.test(i2)) counts.icmpUnreach++;
          }
          if (dnsRcode && dnsRcode !== "0" && dnsRcode !== "") {
            counts.dnsFailures++;
          } else {
            const i2 = String(info || "");
            if (DNS_FAIL_RE.test(i2)) counts.dnsFailures++;
          }
          const i = String(info || "");
          if (ARP_RE.test(i)) counts.arpCount++;
        }
        const total = counts.total || 1;
        const rexmitPct = counts.retransmits / total * 100;
        if (rexmitPct >= 15) {
          anomalies.push({
            id: "tcp_retransmit_critical",
            severity: SEVERITY.CRITICAL,
            title: "Critical TCP Retransmission Rate",
            detail: `${counts.retransmits} retransmissions (${rexmitPct.toFixed(1)}%). Likely causes: congestion, link errors, duplex mismatch.`,
            recommendation: "Run 'show interfaces' \u2014 look for input/output errors and CRC counts. Check duplex/speed negotiation."
          });
        } else if (rexmitPct >= 5) {
          anomalies.push({
            id: "tcp_retransmit_high",
            severity: SEVERITY.HIGH,
            title: "Elevated TCP Retransmissions",
            detail: `${counts.retransmits} retransmissions (${rexmitPct.toFixed(1)}%). Possible intermittent congestion or marginal cable.`,
            recommendation: "Check interface error counters. Review QoS policies and buffer thresholds."
          });
        }
        if (counts.resets > 50) {
          anomalies.push({
            id: "tcp_rst_storm",
            severity: SEVERITY.HIGH,
            title: "High TCP Reset Volume",
            detail: `${counts.resets} TCP RST segments detected. Possible firewall ACL drops, port scans, or application crashes.`,
            recommendation: "Identify source IPs generating RSTs. Check ACLs and application health endpoints."
          });
        }
        const arpPct = counts.arpCount / total * 100;
        if (arpPct >= 20) {
          anomalies.push({
            id: "arp_storm",
            severity: SEVERITY.CRITICAL,
            title: "ARP Storm Detected",
            detail: `${counts.arpCount} ARP packets (${arpPct.toFixed(1)}% of capture). Indicates broadcast storm or IP conflict.`,
            recommendation: "Isolate the offending subnet. Check for duplicate IPs ('show arp'), rogue DHCP, and enable ARP inspection."
          });
        } else if (arpPct >= 10) {
          anomalies.push({
            id: "arp_elevated",
            severity: SEVERITY.HIGH,
            title: "Elevated ARP Traffic",
            detail: `${counts.arpCount} ARP packets (${arpPct.toFixed(1)}%). May indicate IP conflict or high host churn.`,
            recommendation: "Check for duplicate IPs on the subnet with 'show arp | count'."
          });
        }
        if (counts.dnsFailures >= 10) {
          anomalies.push({
            id: "dns_failures",
            severity: SEVERITY.HIGH,
            title: "Repeated DNS Failures (NXDOMAIN)",
            detail: `${counts.dnsFailures} DNS failures detected. Clients may have wrong DNS servers or misconfigured lookups.`,
            recommendation: "Verify DNS server reachability with 'dig @<server> <domain>'. Review split-DNS policy."
          });
        }
        if (counts.icmpUnreach >= 5) {
          anomalies.push({
            id: "icmp_unreach",
            severity: SEVERITY.HIGH,
            title: "ICMP Unreachable Bursts",
            detail: `${counts.icmpUnreach} ICMP Unreachable messages. Indicates routing black-holes or missing return paths.`,
            recommendation: "Check routing table for missing entries ('show ip route'). Verify destination hosts are up."
          });
        }
        const sortedSrc = Object.entries(counts.sources).sort((a, b) => b[1] - a[1]);
        if (sortedSrc.length && counts.total > 20) {
          const [topSrc, topCount] = sortedSrc[0];
          const domPct = topCount / total * 100;
          if (domPct > 70) {
            anomalies.push({
              id: "traffic_dominance",
              severity: SEVERITY.HIGH,
              title: "Single Source Dominating Traffic",
              detail: `${topSrc} generated ${topCount} packets (${domPct.toFixed(1)}%). Possible scan, flood, or misconfigured service.`,
              recommendation: `Investigate ${topSrc}. Check access-lists and rate-limiting policies on the ingress port.`
            });
          }
        }
        const broadcastCount = Array.from(BROADCAST_PROTOS).reduce((sum, p) => sum + (counts.protocols[p] || 0), 0);
        const broadcastPct = broadcastCount / total * 100;
        if (counts.total > 30 && broadcastPct > 40) {
          anomalies.push({
            id: "broadcast_dominance",
            severity: SEVERITY.HIGH,
            title: "High Broadcast/Multicast Ratio",
            detail: `${broadcastPct.toFixed(1)}% of traffic is broadcast/multicast. Healthy networks are typically below 20%.`,
            recommendation: "Enable storm-control on access ports. Verify STP topology is stable and not re-converging."
          });
        }
        const severity = anomalies.some((a) => a.severity === SEVERITY.CRITICAL) ? SEVERITY.CRITICAL : anomalies.some((a) => a.severity === SEVERITY.HIGH) ? SEVERITY.HIGH : SEVERITY.NORMAL;
        const topProtocols = Object.entries(counts.protocols).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([proto, count]) => ({ proto, count }));
        const topSources = sortedSrc.slice(0, 5).map(([ip, count]) => ({ ip, count }));
        return {
          severity,
          anomalies,
          trafficProfile: {
            totalPackets: counts.total,
            retransmits: counts.retransmits,
            resets: counts.resets,
            arpCount: counts.arpCount,
            dnsFailures: counts.dnsFailures,
            icmpUnreach: counts.icmpUnreach,
            topProtocols,
            topSources
          },
          humanSummary: _buildSummary(severity, anomalies, counts)
        };
      }
      function _buildSummary(severity, anomalies, counts) {
        const label = severity.toUpperCase();
        const out = [`Traffic Status: ${label} (${counts.total} packets analysed)`];
        if (!anomalies.length) {
          out.push("No anomalies detected. Traffic appears healthy.");
        } else {
          for (const a of anomalies) {
            out.push(`
[${a.severity.toUpperCase()}] ${a.title}`);
            out.push(`  ${a.detail}`);
            out.push(`  \u2192 ${a.recommendation}`);
          }
        }
        const topProtos = Object.entries(counts.protocols).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => p).join(", ");
        if (topProtos) out.push(`
Top protocols: ${topProtos}`);
        return out.join("\n");
      }
      module.exports = { analyseCapture, SEVERITY };
    }
  });

  // bundle-entry.js
  window.AhuvaModules = {
    safety: require_safety(),
    mode: require_mode(),
    detect: require_detect(),
    validate: require_validate(),
    models: require_models(),
    switchConfig: require_switch_config(),
    prompt: require_prompt(),
    pcapAnalyser: require_pcap_analyser()
  };
})();
