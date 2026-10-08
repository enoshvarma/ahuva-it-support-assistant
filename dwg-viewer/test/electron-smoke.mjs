// Launches the desktop (Electron) app, opens a drawing passed on the command line
// and saves a screenshot. Usage: xvfb-run node test/electron-smoke.mjs <file> <out.png> [electronExecutable]
import { _electron as electron } from 'playwright';
import path from 'path';

const [file, out, exe] = process.argv.slice(2);
const args = exe ? [path.resolve(file)] : ['.', path.resolve(file)];
const app = await electron.launch({ args: [...(process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []), ...args], executablePath: exe || undefined, env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForFunction((name) => window.__dwgViewer && window.__dwgViewer.state.file && window.__dwgViewer.state.file.name === name && document.getElementById('loading').hidden, path.basename(file), { timeout: 60000 });
await win.waitForTimeout(500);
const info = await win.evaluate(() => ({ title: document.title, batches: window.__dwgViewer.state.dl.model.batches.length, desktop: !!window.dwgDesktop }));
await win.screenshot({ path: out });
console.log(JSON.stringify(info), errors.length ? 'ERRORS ' + errors.join('; ') : 'no errors');
await app.close();
if (!info.desktop || !info.batches || errors.length) process.exit(1);
