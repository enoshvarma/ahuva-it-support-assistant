#!/usr/bin/env node
// Build script: bundles modules, copies web assets & KB files to www/
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT   = path.resolve(__dirname, "..");
const MOBILE = __dirname;
const WWW    = path.join(MOBILE, "www");
const LIB    = path.join(WWW, "lib");
const KB     = path.join(WWW, "kb");

function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }
function cp(src, dst) {
  if (fs.existsSync(src)) { fs.copyFileSync(src, dst); console.log("  copy", path.relative(MOBILE, dst)); }
  else console.warn("  WARN: missing", src);
}

console.log("Building web assets for Android…\n");

// 1. Bundle pure-logic modules with esbuild
ensure(WWW); ensure(LIB); ensure(KB);
console.log("[1/5] Bundling modules…");
execSync(`npx esbuild bundle-entry.js --bundle --format=iife --outfile=www/modules.js --log-level=warning`, { cwd: MOBILE, stdio: "inherit" });

// 2. Copy renderer files
console.log("[2/5] Copying renderer…");
cp(path.join(ROOT, "renderer/styles.css"), path.join(WWW, "styles.css"));
cp(path.join(ROOT, "renderer/app.js"),     path.join(WWW, "app.js"));

// 3. Copy xterm libraries
console.log("[3/5] Copying xterm…");
const xtermBase = path.join(ROOT, "node_modules/@xterm");
cp(path.join(xtermBase, "xterm/lib/xterm.js"),       path.join(LIB, "xterm.js"));
cp(path.join(xtermBase, "xterm/css/xterm.css"),       path.join(LIB, "xterm.css"));
cp(path.join(xtermBase, "addon-fit/lib/addon-fit.js"),path.join(LIB, "addon-fit.js"));

// 4. Copy knowledge base
console.log("[4/5] Copying knowledge base…");
const kbSrc = path.join(ROOT, "kb");
if (fs.existsSync(kbSrc)) {
  for (const f of fs.readdirSync(kbSrc)) {
    if (f.endsWith(".md") || f.endsWith(".txt")) cp(path.join(kbSrc, f), path.join(KB, f));
  }
}

// 5. Copy icon
console.log("[5/5] Copying assets…");
ensure(path.join(WWW, "assets"));
cp(path.join(ROOT, "assets/icon.png"), path.join(WWW, "assets/icon.png"));
cp(path.join(ROOT, "assets/icon.svg"), path.join(WWW, "assets/icon.svg"));

console.log("\nWeb build complete → mobile/www/");
