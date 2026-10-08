// Core tests: geometry helpers, text parsing, and parsing + building every sample drawing.
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bulgePoints, nurbsPoints, cubicFitPoints, ocs, apply } from '../src/core/geom.js';
import { mtextLines, mtextRuns, plainText, repairByteSwapped } from '../src/core/text.js';
import { canvasDash, hatchPattern, buildDisplayList } from '../src/core/builder.js';
import { parseDrawing, detectFormat } from '../src/core/load.js';
import { aciToRgb } from '../src/core/aci.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.join(here, '../node_modules/@mlightcad/libredwg-web/wasm');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); } catch (e) { failed++; console.log('  FAIL', name, '\n       ', e.message); }
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

console.log('geometry');
await test('bulge 1 is a semicircle through (1,-1)', () => {
  const o = []; bulgePoints(o, 0, 0, 2, 0, 1);
  let minY = Infinity; for (let i = 1; i < o.length; i += 3) minY = Math.min(minY, o[i]);
  near(minY, -1, 1e-3); near(o[o.length - 3], 2); near(o[o.length - 2], 0);
});
await test('negative bulge bends the other way', () => {
  const o = []; bulgePoints(o, 0, 0, 2, 0, -1);
  let maxY = -Infinity; for (let i = 1; i < o.length; i += 3) maxY = Math.max(maxY, o[i]);
  near(maxY, 1, 1e-3);
});
await test('linear NURBS passes through control points', () => {
  const o = []; nurbsPoints(o, 1, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], null, null, 4);
  near(o[6], 1); near(o[7], 1); near(o[12], 2, 1e-6);
});
await test('fit-point spline interpolates its fit points', () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 1 }, { x: 4, y: 3 }];
  const o = []; cubicFitPoints(o, pts);
  for (const p of pts) {
    let best = Infinity; for (let i = 0; i < o.length; i += 3) best = Math.min(best, Math.hypot(o[i] - p.x, o[i + 1] - p.y));
    assert.ok(best < 1e-9, 'misses fit point');
  }
});
await test('OCS with -Z extrusion mirrors X', () => { const m = ocs({ x: 0, y: 0, z: -1 }); const p = apply(m, 1, 2, 0); near(p[0], -1); near(p[1], 2); });
await test('ACI colours', () => { assert.equal(aciToRgb(1), 0xff0000); assert.equal(aciToRgb(5), 0x0000ff); assert.equal(aciToRgb(7), -1); assert.equal(aciToRgb(250), 0x333333); });
await test('linetype pattern to canvas dash', () => {
  assert.deepEqual(canvasDash([10, -5, 0, -5], 2), [20, 10, 0, 10]);
  assert.deepEqual(canvasDash([-5, 10], 1), [0, 5, 10, 0]);
  assert.equal(canvasDash([5], 1), null);
});
await test('hatch pattern lines are clipped to the boundary', () => {
  const ring = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0];
  const segs = hatchPattern([ring], [{ angle: 0, base: { x: 0, y: 0 }, offset: { x: 0, y: 1 }, dashLengths: [] }]);
  assert.ok(segs.length / 4 >= 9 && segs.length / 4 <= 11);
  for (let i = 0; i < segs.length; i += 2) assert.ok(segs[i] >= -1e-9 && segs[i] <= 10 + 1e-9);
});
await test('hatch island is left empty (even-odd)', () => {
  const outer = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0];
  const inner = [4, 4, 0, 6, 4, 0, 6, 6, 0, 4, 6, 0];
  const segs = hatchPattern([outer, inner], [{ angle: 0, base: { x: 0, y: 0.5 }, offset: { x: 0, y: 1 }, dashLengths: [] }]);
  for (let i = 0; i < segs.length; i += 4) {
    const y = segs[i + 1];
    if (y > 4 && y < 6) { const x0 = Math.min(segs[i], segs[i + 2]), x1 = Math.max(segs[i], segs[i + 2]); assert.ok(x1 <= 4 + 1e-9 || x0 >= 6 - 1e-9, 'segment crosses the island'); }
  }
});

console.log('text');
await test('MTEXT paragraphs and codes', () => {
  assert.deepEqual(mtextLines('A\\PB{\\C1;red}\\P%%c50'), ['A', 'Bred', '\u230050']);
  assert.deepEqual(mtextLines('\\S1/2;'), ['1/2']);
});
await test('MTEXT runs keep colours and heights', () => {
  const r = mtextRuns('a{\\C1;b}{\\H2x;c}', 1);
  assert.equal(r[0].length, 3); assert.equal(r[0][1].c, 1); assert.equal(r[0][2].h, 2);
});
await test('special characters', () => { assert.equal(plainText('%%d %%p %%c'), '\u00b0 \u00b1 \u2300'); });
await test('byte-swapped strings are repaired', () => { assert.equal(repairByteSwapped('\u6548\u6c6c\u216f'), 'Hello!'); assert.equal(repairByteSwapped('Hello'), 'Hello'); });

console.log('drawings');
const samples = fs.readdirSync(path.join(here, 'samples')).map((f) => path.join(here, 'samples', f));
samples.push(path.join(here, '../assets/sample-house.dxf'));
for (const f of samples) {
  await test(`open ${path.basename(f)}`, async () => {
    const b = fs.readFileSync(f);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    const fmt = detectFormat(new Uint8Array(ab));
    assert.ok(fmt.format === 'dwg' || fmt.format === 'dxf', 'format not detected');
    const { doc } = await parseDrawing(ab, { wasmDir });
    const dl = buildDisplayList(doc);
    const m = dl.model;
    assert.ok(m.batches.length + m.texts.length > 0, 'nothing to draw');
    assert.ok(m.extents && m.extents.every(Number.isFinite), 'bad extents');
    for (const bt of m.batches) for (let i = 0; i < bt.data.length; i++) if (!Number.isFinite(bt.data[i])) throw new Error('non-finite coordinate');
    const errs = dl.warnings.filter((w) => w.type.startsWith('error:'));
    assert.equal(errs.length, 0, 'entity errors: ' + JSON.stringify(errs));
  });
}
await test('not a drawing is rejected', async () => {
  await assert.rejects(() => parseDrawing(new TextEncoder().encode('hello world').buffer, { wasmDir }), /not a DWG or DXF/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
