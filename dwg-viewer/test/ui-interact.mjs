// Interactive UI test: layers, layouts, measuring with snapping, find, markup,
// export (PNG/PDF), recent files and the phone layout. Usage: node test/ui-interact.mjs <screensDir>
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import assert from 'assert/strict';

const outDir = process.argv[2] || 'test/screens';
fs.mkdirSync(outDir, { recursive: true });
const server = spawn(process.execPath, ['test/serve.mjs', 'www', '8767'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
let failed = 0;
const errors = [];
async function step(name, fn) {
  try { await fn(); console.log('  ok  ', name); } catch (e) { failed++; console.log('  FAIL', name, '\n       ', e.message.split('\n')[0]); }
}

async function openFile(page, file) {
  const name = path.basename(file);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => document.getElementById('file-input').click())]);
  await chooser.setFiles(file);
  await page.waitForFunction((n) => document.getElementById('loading').hidden && window.__dwgViewer.state.file && window.__dwgViewer.state.file.name === n, name, { timeout: 60000 });
  await page.waitForTimeout(200);
}

// world (drawing coordinates) -> page coordinates
async function screenOf(page, x, y) {
  return page.evaluate(([x, y]) => {
    const r = window.__dwgViewer.renderer;
    const o = r.space.origin;
    const [sx, sy] = r.toScreen(x - o[0], y - o[1]);
    const b = r.canvas.getBoundingClientRect();
    return [b.left + sx, b.top + sy];
  }, [x, y]);
}

// ---------------------------------------------------------------- desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:8767/');
  console.log('desktop');

  await step('open the bundled sample from the home screen', async () => {
    await page.click('#btn-sample');
    await page.waitForFunction(() => window.__dwgViewer.state.file && document.getElementById('loading').hidden, null, { timeout: 30000 });
    const n = await page.evaluate(() => window.__dwgViewer.state.dl.layers.length);
    assert.ok(n >= 10);
  });

  await step('frozen layer starts hidden, layer panel toggles visibility', async () => {
    await page.click('.tool[data-panel="layers"]');
    const rows = await page.locator('#panel-body .row').count();
    const layers = await page.evaluate(() => window.__dwgViewer.state.dl.layers.length);
    assert.equal(rows, layers);
    const frozen = await page.evaluate(() => { const s = window.__dwgViewer; const i = s.state.dl.layers.findIndex((l) => l.name === 'FROZEN-NOTES'); return s.renderer.layerVisible[i]; });
    assert.equal(frozen, false);
    await page.locator('#panel-body .row', { hasText: 'WALLS' }).click();
    const walls = await page.evaluate(() => { const s = window.__dwgViewer; const i = s.state.dl.layers.findIndex((l) => l.name === 'WALLS'); return s.renderer.layerVisible[i]; });
    assert.equal(walls, false);
    await page.screenshot({ path: path.join(outDir, 'ui-layers.png') });
    await page.click('#panel-body [data-a="reset"]');
    const all = await page.evaluate(() => window.__dwgViewer.renderer.layerVisible.filter(Boolean).length);
    assert.equal(all, layers - 1);
    await page.click('#panel-close');
  });

  await step('layout tabs switch to paper space and back', async () => {
    await page.click('#layout-tabs button:has-text("A3 Sheet")');
    assert.equal(await page.evaluate(() => window.__dwgViewer.renderer.isLayout), true);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, 'ui-layout.png') });
    await page.click('#layout-tabs button:has-text("Model")');
    assert.equal(await page.evaluate(() => window.__dwgViewer.renderer.isLayout), false);
  });

  await step('measure distance snaps to wall corners (5000)', async () => {
    await page.evaluate(() => { const r = window.__dwgViewer.renderer; const o = r.space.origin; r.zoomToBox(-1000 - o[0], -1500 - o[1], 13000 - o[0], 9000 - o[1]); });
    await page.waitForTimeout(100);
    await page.click('.tool[data-mode="measure"]');
    const a = await screenOf(page, 3, -4), b = await screenOf(page, 4996, 5);
    await page.mouse.click(a[0], a[1]);
    await page.waitForTimeout(400);
    await page.mouse.click(b[0], b[1]);
    const m = await page.evaluate(() => window.__dwgViewer.state.measures.at(-1));
    const d = Math.hypot(m.pts[1][0] - m.pts[0][0], m.pts[1][1] - m.pts[0][1]);
    assert.ok(Math.abs(d - 5000) < 1e-6, 'distance ' + d);
    const text = await page.textContent('#mode-bar .result');
    assert.match(text, /5,?000/);
  });

  await step('measure area of the house outline (96,000,000)', async () => {
    await page.click('#mode-bar .seg:has-text("Length / Area")');
    for (const [x, y] of [[2, 3], [11999, 1], [11999, 7999], [1, 7999]]) {
      const p = await screenOf(page, x, y);
      await page.mouse.click(p[0], p[1]);
      await page.waitForTimeout(350);
    }
    await page.click('#mode-bar .seg:has-text("Done")');
    const text = await page.textContent('#mode-bar .result');
    assert.match(text, /Area 96,000,000/, text);
    assert.match(text, /Perimeter 40,000\b/, text);
    await page.screenshot({ path: path.join(outDir, 'ui-measure.png') });
    await page.click('#mode-bar .seg:has-text("✕")');
  });

  await step('find text zooms to the match', async () => {
    await page.click('.tool[data-panel="find"]');
    await page.fill('#panel-body input', 'living');
    const n = await page.locator('#panel-body .result-row').count();
    assert.ok(n >= 1);
    await page.locator('#panel-body .result-row').first().click();
    assert.ok(await page.evaluate(() => !!window.__dwgViewer.state.highlight));
    await page.screenshot({ path: path.join(outDir, 'ui-find.png') });
    await page.click('#panel-close');
    await page.click('#btn-fit');
  });

  await step('markup pen stroke is saved and restored', async () => {
    await page.click('.tool[data-mode="markup"]');
    const c = await page.locator('#cad').boundingBox();
    await page.mouse.move(c.x + 300, c.y + 300);
    await page.mouse.down();
    for (let i = 0; i < 10; i++) await page.mouse.move(c.x + 300 + i * 20, c.y + 300 + (i % 2) * 30);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__dwgViewer.state.markups.items.length), 1);
    await page.click('#mode-bar .seg:has-text("☁ Cloud")');
    await page.mouse.move(c.x + 600, c.y + 200); await page.mouse.down(); await page.mouse.move(c.x + 760, c.y + 320, { steps: 5 }); await page.mouse.up();
    await page.screenshot({ path: path.join(outDir, 'ui-markup.png') });
    await page.click('#mode-bar .seg:has-text("✕")');
    await page.waitForTimeout(300);
  });

  await step('export PNG and PDF', async () => {
    await page.click('.tool[data-panel="export"]');
    const [png] = await Promise.all([page.waitForEvent('download'), page.click('#panel-body button:has-text("Save view as PNG")')]);
    const pngPath = path.join(outDir, 'export.png');
    await png.saveAs(pngPath);
    assert.deepEqual([...fs.readFileSync(pngPath).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('#panel-body button:has-text("A3 landscape")')]);
    const pdfPath = path.join(outDir, 'export.pdf');
    await pdf.saveAs(pdfPath);
    const head = fs.readFileSync(pdfPath).subarray(0, 8).toString('latin1');
    assert.ok(head.startsWith('%PDF-1.4'));
    assert.ok(fs.statSync(pdfPath).size > 20000);
    await page.click('#panel-close');
  });

  await step('drawing info lists entity counts', async () => {
    await page.click('#btn-more');
    await page.click('#menu button[data-act="info"]');
    const t = await page.textContent('#panel-body');
    assert.match(t, /DXF 2018/); assert.match(t, /HATCH/);
    await page.click('#panel-close');
  });

  await step('background cycles black → white', async () => {
    await page.click('#btn-bg');
    assert.equal(await page.evaluate(() => window.__dwgViewer.renderer.bg), 0xffffff);
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(outDir, 'ui-white.png') });
    await page.click('#btn-bg'); await page.click('#btn-bg');
  });

  await step('wheel zoom changes the scale around the cursor', async () => {
    const s0 = await page.evaluate(() => window.__dwgViewer.renderer.view.scale);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(250);
    const s1 = await page.evaluate(() => window.__dwgViewer.renderer.view.scale);
    assert.ok(s1 > s0 * 1.5);
  });

  await step('recent list keeps the drawing with a thumbnail and markups', async () => {
    await page.click('#btn-back');
    await page.waitForTimeout(800);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const items = await page.locator('#recent li').count();
    assert.ok(items >= 1);
    await page.screenshot({ path: path.join(outDir, 'ui-home-recent.png') });
    await page.locator('#recent li').first().click();
    await page.waitForFunction(() => window.__dwgViewer.state.file && document.getElementById('loading').hidden && !document.getElementById('viewer').hidden);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__dwgViewer.state.markups.items.length), 2);
  });

  await step('a corrupt file shows a friendly error', async () => {
    const bad = path.join(outDir, 'broken.dwg');
    fs.writeFileSync(bad, Buffer.concat([Buffer.from('AC1027'), Buffer.alloc(5000, 7)]));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => document.getElementById('file-input').click())]);
    await chooser.setFiles(bad);
    await page.waitForFunction(() => !document.getElementById('dialog').hidden, null, { timeout: 30000 });
    const t = await page.textContent('#dialog-body');
    assert.match(t, /Can't open/);
    await page.click('#dialog-ok');
  });
  await ctx.close();
}

// ---------------------------------------------------------------- phone
{
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:8767/');
  console.log('phone');
  await page.screenshot({ path: path.join(outDir, 'phone-home.png') });
  await step('open a DWG on a phone-sized screen', async () => {
    await openFile(page, 'test/samples/example_2000.dwg');
    await page.evaluate(() => { const r = window.__dwgViewer.renderer; const o = r.space.origin; r.zoomToBox(-3500 - o[0], -2500 - o[1], 12500 - o[0], 13500 - o[1]); });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(outDir, 'phone-drawing.png') });
  });
  await step('tap-to-measure works with touch', async () => {
    await page.click('.tool[data-mode="measure"]');
    const c = await page.locator('#cad').boundingBox();
    await page.touchscreen.tap(c.x + 100, c.y + 200);
    await page.waitForTimeout(400);
    await page.touchscreen.tap(c.x + 250, c.y + 350);
    assert.equal(await page.evaluate(() => window.__dwgViewer.state.measures.length), 1);
    await page.screenshot({ path: path.join(outDir, 'phone-measure.png') });
    await page.click('#mode-bar .seg:has-text("✕")');
  });
  await step('layers open as a bottom sheet', async () => {
    await page.click('.tool[data-panel="layers"]');
    const box = await page.locator('#panel').boundingBox();
    assert.ok(box.y > 200 && Math.abs(box.width - 393) < 2);
    await page.screenshot({ path: path.join(outDir, 'phone-layers.png') });
    await page.click('#panel-close');
  });
  await ctx.close();
}

await browser.close();
server.kill();
if (errors.length) { console.log('page errors:\n' + errors.join('\n')); failed++; }
console.log(failed ? `${failed} failure(s)` : 'all UI checks passed');
process.exit(failed ? 1 : 0);
