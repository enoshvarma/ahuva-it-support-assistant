#!/usr/bin/env node
// Builds mobile/www from the desktop renderer + mobile bridge. Output is fully generated.
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const ROOT   = path.resolve(__dirname, "..");
const MOBILE = __dirname;
const WEB    = path.join(MOBILE, "web");
const WWW    = path.join(MOBILE, "www");
// Capacitor 6 supports Android System WebView 60+; lower newer syntax so older phones still parse the app.
const TARGET = "chrome60";

function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }
function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { ensure(path.dirname(p)); fs.writeFileSync(p, s); console.log("  write", path.relative(MOBILE, p)); }
function copy(src, dst) {
  if (!fs.existsSync(src)) throw new Error("Missing build input: " + src);
  ensure(path.dirname(dst));
  fs.copyFileSync(src, dst);
  console.log("  copy ", path.relative(MOBILE, dst));
}
function lower(code, file) {
  return esbuild.transformSync(code, { target: TARGET, loader: "js", sourcefile: file, legalComments: "none" }).code;
}

const stubPlugin = {
  name: "node-stubs",
  setup(build) {
    const builtin = path.join(MOBILE, "stubs/node-builtin.js");
    build.onResolve({ filter: /^(fs|path|os|child_process|net|dgram|dns|https|http|events|crypto)$/ }, () => ({ path: builtin }));
    build.onResolve({ filter: /^\.\/logger$/ }, () => ({ path: path.join(MOBILE, "stubs/logger.js") }));
  }
};

function mobileIndexHtml(desktopHtml) {
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: https:; connect-src *; font-src 'self' data:";
  let html = desktopHtml;
  const swaps = [
    [/<meta http-equiv="Content-Security-Policy"[^>]*>/,
     `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />\n  <meta http-equiv="Content-Security-Policy" content="${csp}" />`],
    [`href="../node_modules/@xterm/xterm/css/xterm.css"`, `href="lib/xterm.css"`],
    [`<link rel="stylesheet" href="styles.css" />`, `<link rel="stylesheet" href="styles.css" />\n  <link rel="stylesheet" href="mobile.css" />`],
    [`<script src="../node_modules/@xterm/xterm/lib/xterm.js"></script>`, `<script src="compat.js"></script>\n  <script src="lib/xterm.js"></script>`],
    [`<script src="../node_modules/@xterm/addon-fit/lib/addon-fit.js"></script>`, `<script src="lib/addon-fit.js"></script>\n  <script src="modules.js"></script>\n  <script src="bridge.js"></script>`],
    [`<script src="app.js"></script>`, `<script src="app.js"></script>\n  <script src="mobile-ui.js"></script>\n  <script src="selftest.js"></script>`],
  ];
  for (const [from, to] of swaps) {
    const before = html;
    html = html.replace(from, to);
    if (html === before) throw new Error("renderer/index.html changed shape; could not apply mobile patch for: " + from);
  }
  return html;
}

async function main() {
  console.log("Building Android web assets…");
  fs.rmSync(WWW, { recursive: true, force: true });
  ensure(WWW);

  console.log("[1/6] Bundling shared modules");
  await esbuild.build({
    entryPoints: [path.join(MOBILE, "bundle-entry.js")],
    bundle: true, format: "iife", platform: "browser", target: TARGET,
    outfile: path.join(WWW, "modules.js"),
    plugins: [stubPlugin], logLevel: "warning", legalComments: "none",
  });

  console.log("[2/6] Renderer (same UI as desktop)");
  write(path.join(WWW, "index.html"), mobileIndexHtml(read(path.join(ROOT, "renderer/index.html"))));
  write(path.join(WWW, "app.js"), lower(read(path.join(ROOT, "renderer/app.js")), "app.js"));
  copy(path.join(ROOT, "renderer/styles.css"), path.join(WWW, "styles.css"));

  console.log("[3/6] Mobile bridge");
  for (const f of ["bridge.js", "mobile-ui.js", "selftest.js"]) write(path.join(WWW, f), lower(read(path.join(WEB, f)), f));
  copy(path.join(WEB, "compat.js"), path.join(WWW, "compat.js"));
  copy(path.join(WEB, "mobile.css"), path.join(WWW, "mobile.css"));

  console.log("[4/6] xterm");
  const xterm = path.join(ROOT, "node_modules/@xterm");
  write(path.join(WWW, "lib/xterm.js"), lower(read(path.join(xterm, "xterm/lib/xterm.js")), "xterm.js"));
  write(path.join(WWW, "lib/addon-fit.js"), lower(read(path.join(xterm, "addon-fit/lib/addon-fit.js")), "addon-fit.js"));
  copy(path.join(xterm, "xterm/css/xterm.css"), path.join(WWW, "lib/xterm.css"));

  console.log("[5/6] Knowledge base");
  const kbFiles = fs.readdirSync(path.join(ROOT, "kb")).filter(f => /\.(md|txt)$/i.test(f)).sort();
  for (const f of kbFiles) copy(path.join(ROOT, "kb", f), path.join(WWW, "kb", f));
  write(path.join(WWW, "kb/index.json"), JSON.stringify(kbFiles));

  console.log("[6/6] Assets");
  copy(path.join(ROOT, "assets/icon.png"), path.join(WWW, "assets/icon.png"));
  copy(path.join(ROOT, "assets/icon.svg"), path.join(WWW, "assets/icon.svg"));

  console.log("\nWeb build complete → mobile/www/");
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
