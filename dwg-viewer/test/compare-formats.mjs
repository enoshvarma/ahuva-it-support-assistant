// Renders every model-space entity of a DWG and its DXF twin separately and
// reports entities whose geometry differs (bbox or amount of geometry).
import { parseDrawing } from '../src/core/load.js';
import { buildDisplayList } from '../src/core/builder.js';
import fs from 'fs';
const load = async (f) => { const b = fs.readFileSync(f); return (await parseDrawing(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), { wasmDir: './node_modules/@mlightcad/libredwg-web/wasm' })).doc; };
const A = await load(process.argv[2]), B = await load(process.argv[3]);
const one = (doc, e) => {
  const dl = buildDisplayList({ ...doc, model: { ...doc.model, entities: [e] }, layouts: [] });
  const m = dl.model;
  const n = m.batches.reduce((s, b) => s + b.data.length, 0);
  const ext = m.extents ? m.extents.map((v, i) => v + m.origin[i % 2]) : null;
  return { n, t: m.texts.length, ext, txt: m.texts.map((t) => t.lines.join('|')).join(';') };
};
const byH = new Map(B.model.entities.map((e) => [e.handle, e]));
for (const e of A.model.entities) {
  const f = byH.get(e.handle);
  if (!f) { console.log('only in A', e.type, e.handle); continue; }
  const a = one(A, e), b = one(B, f);
  const close = (p, q) => (!p && !q) || (p && q && p.every((v, i) => Math.abs(v - q[i]) <= 1e-3 * Math.max(1, Math.abs(v))));
  const nOk = Math.abs(a.n - b.n) <= Math.max(8, 0.15 * Math.max(a.n, b.n));
  if (!close(a.ext, b.ext) || !nOk || a.t !== b.t || a.txt !== b.txt) console.log('DIFF', e.type, '/', f.type, e.handle, JSON.stringify({ a: { ...a, ext: a.ext && a.ext.map(Math.round) }, b: { ...b, ext: b.ext && b.ext.map(Math.round) } }));
}
for (const f of B.model.entities) if (!A.model.entities.some((e) => e.handle === f.handle)) console.log('only in B', f.type, f.handle);
