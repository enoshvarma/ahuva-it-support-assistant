// Parses every sample drawing, builds the display list and prints a summary.
import { parseDrawing } from '../src/core/load.js';
import { buildDisplayList } from '../src/core/builder.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
const buf = fs.readFileSync(file);
const t0 = Date.now();
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
const { doc } = await parseDrawing(ab, { wasmDir: path.join(here, '../node_modules/@mlightcad/libredwg-web/wasm') });
const t1 = Date.now();
const dl = buildDisplayList(doc, { debug: true });
const sum = (s) => ({ batches: s.batches.length, segs: s.batches.reduce((a, b) => a + b.data.length, 0), texts: s.texts.length, points: s.points.length / 6, rays: s.rays.length, ext: s.extents && s.extents.map((v) => +v.toFixed(1)), origin: s.origin, vps: s.viewports?.length });
console.log(JSON.stringify({ file: path.basename(file), parseMs: t1 - t0, buildMs: dl.buildMs, layers: dl.layers.length, model: sum(dl.model), layouts: dl.layouts.map((l) => ({ name: l.name, ...sum(l) })), warnings: dl.warnings, counts: dl.counts }));
if (process.argv[3] === '--texts') for (const t of dl.model.texts.slice(0, 30)) console.log(JSON.stringify(t.lines), t.mode, t.ha, t.va, t.attach);
