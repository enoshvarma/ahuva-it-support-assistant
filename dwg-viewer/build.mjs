// Bundles the app into www/ (used by the web build, Electron and Capacitor).
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resvg } from '@resvg/resvg-js';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'www');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const watch = process.argv.includes('--watch');

function leb(buf, i) { let r = 0, s = 0, x; do { x = buf[i++]; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80); return [r, i]; }
function encLeb(n) { const o = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; o.push(b); } while (n); return o; }
export function patchWasmInitialMemory(buf, pages) {
  let i = 8;
  while (i < buf.length) {
    const id = buf[i];
    let [size, j] = leb(buf, i + 1);
    const end = j + size;
    if (id === 5) {
      let [count, k] = leb(buf, j);
      if (count !== 1) return buf;
      const flags = buf[k++];
      let [initial, k2] = leb(buf, k);
      const rest = buf.subarray(k2, end); // maximum (if any)
      if (initial <= pages) return buf;
      const body = Buffer.from([...encLeb(1), flags, ...encLeb(pages), ...rest]);
      return Buffer.concat([buf.subarray(0, i), Buffer.from([5, ...encLeb(body.length)]), body, buf.subarray(end)]);
    }
    i = end;
  }
  return buf;
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });

const common = {
  bundle: true,
  format: 'esm',
  target: ['chrome80', 'safari15', 'firefox90'],
  minify: !process.argv.includes('--dev'),
  sourcemap: false,
  external: ['module'],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info',
};

// app + worker (the worker is referenced as new URL('./worker.js', import.meta.url))
await esbuild.build({ ...common, entryPoints: { app: 'src/app.js', worker: 'src/app/worker.js' }, outdir: out, entryNames: '[name]' });

// fix the worker URL: bundles live side by side in www/
const appJs = path.join(out, 'app.js');
fs.writeFileSync(appJs, fs.readFileSync(appJs, 'utf8').replace(/new URL\("\.\/worker\.js",\s*import\.meta\.url\)/g, 'new URL("./worker.js",import.meta.url)'));

for (const f of ['index.html', 'app.css']) fs.copyFileSync(path.join(root, 'src', f), path.join(out, f));
// The decoder is compiled with a 1 GB initial memory, which older Android
// WebViews cannot reserve. Its static data and stack fit in the first 2 MB and
// memory grows on demand, so start it at 16 MB.
fs.writeFileSync(path.join(out, 'libredwg-web.wasm'), patchWasmInitialMemory(fs.readFileSync(path.join(root, 'node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm')), 256));
fs.copyFileSync(path.join(root, 'assets/sample-house.dxf'), path.join(out, 'sample-house.dxf'));
fs.copyFileSync(path.join(root, 'assets/logo.svg'), path.join(out, 'icons/logo.svg'));

const svg = fs.readFileSync(path.join(root, 'assets/logo.svg'));
for (const size of [48, 96, 180, 192, 512]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path.join(out, `icons/icon-${size}.png`), png);
}

fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
  name: 'DWG Viewer',
  short_name: 'DWG Viewer',
  description: 'Open, view and measure DWG and DXF drawings offline.',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#0b1220',
  theme_color: '#0b1220',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  file_handlers: [{ action: './', accept: { 'application/acad': ['.dwg'], 'image/vnd.dwg': ['.dwg'], 'application/dxf': ['.dxf'] } }],
}, null, 2));

// offline cache for the web/PWA build
const files = ['./', 'index.html', 'app.css', 'app.js', 'worker.js', 'libredwg-web.wasm', 'sample-house.dxf', 'manifest.webmanifest', 'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-180.png'];
fs.writeFileSync(path.join(out, 'sw.js'), `const CACHE = 'dwgv-${pkg.version}-${Date.now()}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
`);
console.log('built', out);
if (watch) console.log('(watch mode not implemented; re-run the build)');
