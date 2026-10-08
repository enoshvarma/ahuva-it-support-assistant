// Opens a drawing in Chromium, zooms to a region and saves a screenshot.
// Usage: node test/render-region.mjs <file> <out.png> <x0|ext> <y0> <x1> <y1> [layoutIndex|M] [bgColor]
import { chromium } from 'playwright';
import { spawn } from 'child_process';
const [file, out, x0, y0, x1, y1, space, bg] = process.argv.slice(2);
const server = spawn(process.execPath, ['test/serve.mjs', 'www', '8766'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:8766/');
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => document.getElementById('file-input').click())]);
await chooser.setFiles(file);
await page.waitForFunction(() => document.getElementById('loading').hidden && window.__dwgViewer.state.dl);
await page.evaluate(([x0, y0, x1, y1, space, bg]) => {
  const v = window.__dwgViewer;
  if (space && space !== 'M') v.selectSpace(+space);
  if (bg) v.renderer.bg = +bg;
  if (x0 !== 'ext') { const o = v.renderer.space.origin; v.renderer.zoomToBox(+x0 - o[0], +y0 - o[1], +x1 - o[0], +y1 - o[1], 0.02); }
}, [x0, y0, x1, y1, space, bg]);
await page.waitForTimeout(400);
await page.screenshot({ path: out });
await browser.close(); server.kill();
