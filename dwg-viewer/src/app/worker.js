// Web worker: parses a drawing and builds its display list off the UI thread.
// A fresh worker is used for every file because the DWG decoder keeps global state.
import { parseDrawing } from '../core/load.js';
import { buildDisplayList, displayListTransfers } from '../core/builder.js';

self.onmessage = async (ev) => {
  const { buffer, wasmDir } = ev.data;
  const t0 = Date.now();
  try {
    self.postMessage({ type: 'progress', stage: 'parse' });
    const { doc, format, version, partial } = await parseDrawing(buffer, { wasmDir });
    const t1 = Date.now();
    self.postMessage({ type: 'progress', stage: 'build' });
    const dl = buildDisplayList(doc);
    dl.info = {
      format, version, parseMs: t1 - t0, buildMs: Date.now() - t1,
      units: doc.header.INSUNITS, blocks: doc.blocks.size, partial: !!partial,
    };
    self.postMessage({ type: 'done', dl }, displayListTransfers(dl));
  } catch (e) {
    self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
  }
};
