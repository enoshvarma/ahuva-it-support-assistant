// Error learning: every command error the app sees is recorded.
// 1) A short human-readable report file (error-report.md) grows in userData —
//    what failed, on which device, with which command.
// 2) Recurring patterns per vendor are counted (errors.json) and fed back to
//    the copilot as "lessons" so it stops repeating the same mistakes.

const fs = require("fs");
const path = require("path");

// Error lines worth learning from, across vendors
const ERROR_PATTERNS = [
  /%\s*Invalid input.*$/im,
  /%\s*Ambiguous command.*$/im,
  /%\s*Incomplete command.*$/im,
  /%\s*Unknown command.*$/im,
  /%\s*Authorization failed.*$/im,
  /^ERROR: .*$/im,
  /command parse error.*$/im,          // FortiOS
  /syntax error.*$/im,                  // JunOS / RouterOS
  /bad command name.*$/im,              // RouterOS
  /Login incorrect.*$/im,
  /Access denied.*$/im,
  /Connection (refused|timed out).*$/im
];

function extractErrors(outputText) {
  const found = [];
  for (const re of ERROR_PATTERNS) {
    const m = String(outputText || "").match(re);
    if (m) found.push(m[0].trim());
  }
  return [...new Set(found)];
}

class ErrorLog {
  constructor(dir) {
    this.dir = dir;
    this.reportFile = path.join(dir, "error-report.md");
    this.statsFile = path.join(dir, "errors.json");
    fs.mkdirSync(dir, { recursive: true });
    this.stats = this._loadStats();
  }

  _loadStats() {
    try { return JSON.parse(fs.readFileSync(this.statsFile, "utf8")); }
    catch { return { patterns: {} }; }
  }

  record({ cmd, error, brand, model, resolution }) {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    // append to short report (newest at top of each day is overkill; simple append)
    if (!fs.existsSync(this.reportFile)) {
      fs.writeFileSync(this.reportFile,
        "# Ahuva IT Support Assistant — Error Report\n\nAutomatic log of command/device errors seen in the field. Newest at the bottom.\n\n| Time | Device | Command | Error | Status |\n|---|---|---|---|---|\n", "utf8");
    }
    const esc = s => String(s || "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 90);
    fs.appendFileSync(this.reportFile,
      `| ${ts} | ${esc(brand + " " + (model || ""))} | \`${esc(cmd)}\` | ${esc(error)} | ${esc(resolution || "seen")} |\n`, "utf8");

    // update recurring-pattern stats per vendor
    const key = ((brand || "any") + " :: " + String(error || "").slice(0, 60)).toLowerCase();
    const p = this.stats.patterns[key] = this.stats.patterns[key] || { brand: brand || "any", error: String(error || "").slice(0, 120), count: 0, lastCmd: "" };
    p.count++;
    p.lastCmd = String(cmd || "").slice(0, 120);
    try { fs.writeFileSync(this.statsFile, JSON.stringify(this.stats, null, 2), "utf8"); } catch { }
    return { reportFile: this.reportFile };
  }

  // "Lessons" for the AI prompt: this vendor's most recurring errors
  lessonsFor(brand, limit = 4) {
    const b = (brand || "").toLowerCase();
    return Object.values(this.stats.patterns)
      .filter(p => p.count >= 2 && (p.brand.toLowerCase() === b || p.brand === "any"))
      .sort((a, z) => z.count - a.count)
      .slice(0, limit)
      .map(p => `- Seen ${p.count}x on ${p.brand}: "${p.error}" (last from: ${p.lastCmd}) — avoid the syntax/mode that causes this.`);
  }
}

module.exports = { ErrorLog, extractErrors, ERROR_PATTERNS };
