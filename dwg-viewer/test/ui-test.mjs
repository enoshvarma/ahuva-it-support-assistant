// End-to-end UI test: opens every sample drawing in Chromium, checks the result
// and saves screenshots. Usage: node test/ui-test.mjs <outDir> [mobile]
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || 'test/screens';
const mobile = process.argv.includes('mobile');
fs.mkdirSync(outDir, { recursive: true });
const server = spawn(process.execPath, ['test/serve.mjs', 'www', '8765'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const exe = fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined;
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext(mobile ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('http://localhost:8765/');
await page.screenshot({ path: path.join(outDir, '00-home.png') });

const files = process.argv.filter((a) => /\.(dwg|dxf)$/i.test(a));
const list = files.length ? files : ['assets/sample-house.dxf', ...fs.readdirSync('test/samples').map((f) => 'test/samples/' + f)];
let failed = 0;
for (const f of list) {
  const name = path.basename(f);
  await page.evaluate(() => { window.__done = false; });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => document.getElementById('file-input').click())]);
  await chooser.setFiles(f);
  try {
    await page.waitForFunction((n) => (document.getElementById('loading').hidden === true && window.__dwgViewer.state.file && window.__dwgViewer.state.file.name === n) || !document.getElementById('dialog').hidden, name, { timeout: 60000 });
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => {
      const s = window.__dwgViewer.state;
      return { name: s.file && s.file.name, batches: s.dl.model.batches.length, texts: s.dl.model.texts.length, layouts: s.dl.layouts.length, ms: s.dl.info.parseMs + s.dl.info.buildMs, dialog: !document.getElementById('dialog').hidden && document.getElementById('dialog-body').innerText };
    });
    if (info.dialog || info.name !== name) { failed++; console.log('FAIL', name, info.dialog || 'wrong file'); }
    else console.log('OK  ', name, JSON.stringify(info));
    await page.screenshot({ path: path.join(outDir, name + '.png') });
  } catch (e) {
    failed++;
    const d = await page.evaluate(() => document.getElementById('dialog-body').innerText).catch(() => '');
    console.log('FAIL', name, e.message.split('\n')[0], d);
    await page.screenshot({ path: path.join(outDir, name + '-fail.png') });
    await page.evaluate(() => { document.getElementById('dialog').hidden = true; });
  }
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
server.kill();
process.exit(failed || errors.length ? 1 : 0);
