import { Renderer, rgbCss, luminance } from './renderer.js';
import * as store from './storage.js';
import { canvasToPdf } from './pdf.js';
import { saveBlob, onExternalOpen, isNative, platform, exitApp } from './platform.js';
import { SnapIndex } from './snap.js';

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const $ = (id) => document.getElementById(id);
const UNITS = { 0: '', 1: 'in', 2: 'ft', 3: 'mi', 4: 'mm', 5: 'cm', 6: 'm', 7: 'km', 8: 'µin', 9: 'mil', 10: 'yd', 11: 'Å', 12: 'nm', 13: 'µm', 14: 'dm', 15: 'dam', 16: 'hm', 17: 'Gm', 18: 'AU', 19: 'ly', 20: 'pc' };
const BACKGROUNDS = [0x000000, 0xffffff, 0x212830];
const MARK_COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0ab4ff', '#ff2d92', '#ffffff', '#000000'];

const state = {
  dl: null,
  file: null, // { id, name, size }
  mode: 'view', // view | measure | markup
  measureTool: 'distance',
  markTool: 'pen',
  markColor: MARK_COLORS[0],
  measures: [], // finished: { tool, pts, space }
  current: [], // points in progress
  hover: null, // snapped hover point
  markups: { items: [] },
  draft: null,
  highlight: null,
  snap: true,
  snapIndex: new Map(),
  panel: null,
  worker: null,
};

const canvas = $('cad');
const renderer = new Renderer(canvas);
const prefs = store.prefs();
renderer.bg = BACKGROUNDS.includes(prefs.bg) ? prefs.bg : 0x000000;
renderer.showLineweight = !!prefs.lineweight;
renderer.overlay = drawOverlay;
$('app-version').textContent = 'v' + VERSION;

// ---------------------------------------------------------------------------
// helpers

let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function dialog(html) {
  $('dialog-body').innerHTML = html;
  $('dialog').hidden = false;
}
$('dialog-ok').onclick = () => { $('dialog').hidden = true; };
$('dialog').addEventListener('click', (e) => { if (e.target === $('dialog')) $('dialog').hidden = true; });

// Chromium major version of the WebView / browser (0 when not Chromium).
function chromeMajor() {
  const m = /Chrom(?:e|ium)\/(\d+)/.exec(navigator.userAgent);
  return m ? +m[1] : 0;
}
const OLD_ENGINE = chromeMajor() > 0 && chromeMajor() < 100;
const UPDATE_HINT = /Android/.test(navigator.userAgent)
  ? 'Your “Android System WebView” is out of date. Update “Android System WebView” and “Chrome” in the Play Store, then try again.'
  : 'Your browser is out of date. Please update it and try again.';

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function fmtDate(t) {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString();
}

function unitLabel() { return state.dl ? UNITS[state.dl.header.INSUNITS] || '' : ''; }

function fmtLen(v) {
  const a = Math.abs(v);
  let d = a >= 1000 ? 2 : a >= 1 ? 3 : 5;
  const prec = state.dl && typeof state.dl.header.LUPREC === 'number' ? state.dl.header.LUPREC : null;
  if (prec !== null && prec >= 0 && prec <= 8) d = Math.max(prec, 2);
  return Number(v.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d });
}

function currentSpace() { return renderer.space; }
function spaceKey() { return renderer.isLayout ? 'L' + renderer.layoutIndex : 'M'; }
function origin() { return currentSpace() ? currentSpace().origin : [0, 0]; }

// ---------------------------------------------------------------------------
// home screen

async function refreshRecent() {
  const list = await store.listRecent();
  const ul = $('recent');
  ul.innerHTML = '';
  $('recent-empty').hidden = list.length > 0;
  $('btn-clear-recent').hidden = list.length === 0;
  for (const f of list) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="thumb"></div><div class="meta"><div class="name"></div><div class="sub"></div></div>
      <button class="del" title="Remove from list" aria-label="Remove"><svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    li.querySelector('.name').textContent = f.name;
    li.querySelector('.sub').textContent = `${fmtSize(f.size)} · ${fmtDate(f.opened)}`;
    if (f.thumb) li.querySelector('.thumb').style.backgroundImage = `url(${f.thumb})`;
    li.onclick = async () => {
      try {
        const data = await store.loadRecentData(f.id);
        if (!data) { toast('This drawing is no longer stored. Please open it again.'); return; }
        openBuffer(f.name, data);
      } catch (e) { toast('Could not open: ' + e.message); }
    };
    li.querySelector('.del').onclick = async (e) => {
      e.stopPropagation();
      await store.removeRecent(f.id);
      refreshRecent();
    };
    ul.appendChild(li);
  }
}

$('btn-clear-recent').onclick = async () => { await store.clearRecent(); refreshRecent(); };

const fileInput = $('file-input');
// Android pickers grey out files whose MIME type they do not know, so only filter on desktop
if (!isNative) fileInput.accept = '.dwg,.dxf,.DWG,.DXF,application/acad,image/vnd.dwg,image/x-dwg,application/dxf,image/vnd.dxf';
function pickFile() { fileInput.value = ''; fileInput.click(); }
$('btn-open').onclick = pickFile;
fileInput.onchange = async () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  openBuffer(f.name, await f.arrayBuffer());
};
$('btn-sample').onclick = async () => {
  try {
    const r = await fetch('sample-house.dxf');
    openBuffer('sample-house.dxf', await r.arrayBuffer(), { noRecent: false });
  } catch (e) { toast('Could not load the sample: ' + e.message); }
};
$('btn-about').onclick = (e) => { e.preventDefault(); showAbout(); };

// drag & drop (desktop / web)
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) openBuffer(f.name, await f.arrayBuffer());
});

// PWA file handling (desktop Chrome "Open with")
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    const h = params.files && params.files[0];
    if (!h) return;
    const f = await h.getFile();
    openBuffer(f.name, await f.arrayBuffer());
  });
}

onExternalOpen((name, buf) => openBuffer(name, buf), (e) => toast(e.message || String(e)));

// ---------------------------------------------------------------------------
// loading

function showViewer() {
  $('home').hidden = true;
  $('viewer').hidden = false;
  renderer.resize();
}

function showHome() {
  closePanel();
  setMode('view');
  $('viewer').hidden = true;
  $('home').hidden = false;
  refreshRecent();
}

function wasmDir() {
  return new URL('.', location.href).href.replace(/\/$/, '');
}

async function openBuffer(name, buffer, opts = {}) {
  if (!buffer || !buffer.byteLength) { toast('The file is empty.'); return; }
  showViewer();
  closePanel();
  setMode('view');
  $('loading').hidden = false;
  $('loading-text').textContent = `Opening ${name}…`;
  $('doc-name').textContent = name;
  $('doc-sub').textContent = fmtSize(buffer.byteLength);
  const copy = buffer.slice(0); // keep a copy for the recent list (worker takes ownership)
  const id = await store.fileId(name, copy);
  if (state.worker) state.worker.terminate();
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  state.worker = worker;
  const t0 = performance.now();
  // watchdog: a damaged file can make the decoder spin forever
  const limitMs = 90000 + (buffer.byteLength / 1048576) * 15000;
  const watchdog = setTimeout(() => {
    if (state.worker !== worker) return;
    worker.terminate();
    state.worker = null;
    $('loading').hidden = true;
    dialog(`<h3>Can't open this drawing</h3><p>Reading the file took too long — it may be damaged.</p><p class="muted">File: ${esc(name)}</p>`);
    if (!state.dl) showHome();
  }, limitMs);
  worker.onmessage = async (ev) => {
    const m = ev.data;
    if (m.type !== 'progress') clearTimeout(watchdog);
    if (m.type === 'progress') {
      $('loading-text').textContent = m.stage === 'parse' ? `Reading ${name}…` : 'Preparing drawing…';
      return;
    }
    worker.terminate();
    if (state.worker === worker) state.worker = null;
    if (m.type === 'error') {
      $('loading').hidden = true;
      dialog(`<h3>Can't open this drawing</h3><p>${esc(m.message)}</p>${OLD_ENGINE && m.format !== 'dxf' ? `<p><b>${esc(UPDATE_HINT)}</b></p>` : ''}<p class="muted">File: ${esc(name)}</p>`);
      if (!state.dl) showHome();
      return;
    }
    const dl = m.dl;
    state.dl = dl;
    state.file = { id, name, size: copy.byteLength };
    state.measures = [];
    state.current = [];
    state.highlight = null;
    state.snapIndex = new Map();
    renderer.setDocument(dl);
    buildLayoutTabs();
    const v = dl.info.version;
    $('doc-sub').textContent = `${v} · ${fmtSize(copy.byteLength)}${unitLabel() ? ' · ' + unitLabel() : ''}`;
    $('loading').hidden = true;
    state.markups = (await store.loadMarkups(id)) || { items: [] };
    renderer.requestRender();
    const empty = !dl.model.extents && !dl.layouts.some((l) => l.batches.length);
    if (empty) toast('This drawing has no visible 2D geometry.');
    else if (dl.model.batches.length === 0 && dl.model.texts.length === 0 && dl.layouts.length) {
      // nothing in model space: start on the first layout with content
      const idx = dl.layouts.findIndex((l) => l.batches.length || l.viewports.length);
      if (idx >= 0) selectSpace(idx);
    }
    const unsupported = dl.warnings.filter((w) => /^(3DSOLID|REGION|BODY|SURFACE|MESH|OLE|ACAD_PROXY)/.test(w.type));
    if (dl.info.partial) toast('This drawing is partly damaged — some objects may be missing.', 4000);
    else if (unsupported.length) toast('Some 3D solids / OLE objects can\'t be shown', 2400);
    if (!opts.noRecent) {
      store.saveRecent({ id, name, size: copy.byteLength }, copy).then(() => {
        setTimeout(() => makeThumb(id), 400);
      });
    }
  };
  worker.onerror = (e) => {
    clearTimeout(watchdog);
    $('loading').hidden = true;
    dialog(`<h3>Can't open this drawing</h3><p>${esc(e.message || 'The drawing reader stopped unexpectedly. The file may be damaged.')}</p><p class="muted">If this happens with every drawing, update your browser (on Android: update “Android System WebView” and “Chrome” from the Play Store).</p>`);
    worker.terminate();
  };
  worker.postMessage({ buffer, wasmDir: wasmDir() }, [buffer]);
}

function makeThumb(id) {
  try {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 200;
    const ctx = c.getContext('2d', { alpha: false });
    const savedView = { ...renderer.view };
    const savedOverlay = renderer.overlay;
    renderer.overlay = null;
    const w = renderer.width, h = renderer.height;
    renderer.width = 320; renderer.height = 200;
    renderer.zoomExtents();
    renderer.render({ ctx, width: 320, height: 200, dpr: 1, noOverlay: true });
    renderer.width = w; renderer.height = h;
    renderer.view = savedView;
    renderer.overlay = savedOverlay;
    renderer.requestRender();
    store.updateRecent(id, { thumb: c.toDataURL('image/jpeg', 0.7) });
  } catch (e) { console.warn('thumb', e); }
}

// ---------------------------------------------------------------------------
// layouts

function buildLayoutTabs() {
  const tabs = $('layout-tabs');
  tabs.innerHTML = '';
  const dl = state.dl;
  if (!dl.layouts.length) return;
  const mk = (label, idx) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.idx = idx;
    b.onclick = () => selectSpace(idx);
    tabs.appendChild(b);
  };
  mk('Model', -1);
  dl.layouts.forEach((l, i) => mk(l.name, i));
  markActiveTab();
}

function markActiveTab() {
  for (const b of $('layout-tabs').children) b.classList.toggle('active', +b.dataset.idx === (renderer.isLayout ? renderer.layoutIndex : -1));
}

function selectSpace(idx) {
  state.current = [];
  state.highlight = null;
  renderer.setSpace(idx);
  markActiveTab();
  if (state.panel === 'layouts') renderPanel();
  if (state.panel === 'find') renderPanel();
}

// ---------------------------------------------------------------------------
// gestures

const pointers = new Map();
let gesture = null;
let lastTap = { t: 0, x: 0, y: 0 };
let fastFrame = null;

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function beginFast() {
  // when full redraws are slow, transform a bitmap of the last frame while gesturing
  if (renderer.lastRenderMs < 28 || fastFrame) return;
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  c.getContext('2d').drawImage(canvas, 0, 0);
  fastFrame = { canvas: c, view: { ...renderer.view } };
  const real = renderer.render.bind(renderer);
  renderer.render = (target) => {
    if (target || !fastFrame) return real(target);
    const v = renderer.view, b = fastFrame.view;
    const k = v.scale / b.scale;
    const W = renderer.width, H = renderer.height, dpr = renderer.dpr;
    const ctx = renderer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgbCss(renderer.isLayout ? (luminance(renderer.bg) > 0.5 ? 0xd9dce1 : 0x3a3f47) : renderer.bg);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const tx = W / 2 + (b.cx - v.cx) * v.scale - k * W / 2;
    const ty = H / 2 - (b.cy - v.cy) * v.scale - k * H / 2;
    ctx.setTransform(k, 0, 0, k, tx * dpr, ty * dpr);
    ctx.drawImage(fastFrame.canvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (renderer.overlay) renderer.overlay(ctx, renderer);
  };
  fastFrame.restore = () => { renderer.render = real; };
}

let fastTimer = null;
function endFastSoon() {
  clearTimeout(fastTimer);
  fastTimer = setTimeout(() => {
    if (fastFrame) { fastFrame.restore(); fastFrame = null; }
    renderer.requestRender();
  }, 140);
}

canvas.addEventListener('pointerdown', (e) => {
  if (!state.dl) return;
  canvas.setPointerCapture(e.pointerId);
  const p = canvasPos(e);
  pointers.set(e.pointerId, { x: p[0], y: p[1], sx: p[0], sy: p[1], t: performance.now(), button: e.button });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    state.draft = null;
    beginFast();
  } else if (pointers.size === 1) {
    const toolDrag = state.mode === 'markup' && e.button === 0 && e.pointerType !== 'touch' || (state.mode === 'markup' && e.pointerType === 'touch');
    if (toolDrag && ['pen', 'rect', 'cloud', 'arrow'].includes(state.markTool)) {
      const w = renderer.toWorld(p[0], p[1]);
      state.draft = { tool: state.markTool, color: state.markColor, pts: [w], space: spaceKey(), width: 2.5 / renderer.view.scale };
      gesture = { type: 'draw' };
    } else {
      gesture = { type: 'pan', moved: false };
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = canvasPos(e);
  if (!pointers.has(e.pointerId)) {
    // hover (mouse): coordinates + snap preview
    if (state.dl && e.pointerType === 'mouse') updateHover(p);
    return;
  }
  const ptr = pointers.get(e.pointerId);
  const dx = p[0] - ptr.x, dy = p[1] - ptr.y;
  ptr.x = p[0]; ptr.y = p[1];
  if (!gesture) return;
  if (gesture.type === 'pinch' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    renderer.pan(cx - gesture.cx, cy - gesture.cy);
    if (gesture.d > 0 && d > 0) renderer.zoomAt(cx, cy, d / gesture.d);
    gesture.d = d; gesture.cx = cx; gesture.cy = cy;
  } else if (gesture.type === 'pan') {
    if (!gesture.moved && Math.hypot(p[0] - ptr.sx, p[1] - ptr.sy) < 6) return;
    if (!gesture.moved) { gesture.moved = true; canvas.classList.add('panning'); beginFast(); }
    renderer.pan(dx, dy);
  } else if (gesture.type === 'draw' && state.draft) {
    const w = renderer.toWorld(p[0], p[1]);
    if (state.draft.tool === 'pen') state.draft.pts.push(w);
    else state.draft.pts[1] = w;
    renderer.requestRender();
  }
  if (e.pointerType === 'mouse') updateHover(p, true);
});

function endPointer(e) {
  const ptr = pointers.get(e.pointerId);
  if (!ptr) return;
  pointers.delete(e.pointerId);
  const p = canvasPos(e);
  if (gesture && gesture.type === 'draw' && pointers.size === 0) {
    finishDraft();
  } else if (gesture && gesture.type === 'pan' && !gesture.moved && pointers.size === 0 && e.type === 'pointerup') {
    tap(p, e);
  }
  if (pointers.size === 0) {
    gesture = null;
    canvas.classList.remove('panning');
    endFastSoon();
  } else if (pointers.size === 1) {
    gesture = { type: 'pan', moved: true };
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (pointers.size === 0) { $('coords').textContent = ''; if (state.hover) { state.hover = null; renderer.requestRender(); } } });

canvas.addEventListener('wheel', (e) => {
  if (!state.dl) return;
  e.preventDefault();
  const p = canvasPos(e);
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 33;
  if (e.deltaMode === 2) dy *= 400;
  const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018));
  beginFast();
  renderer.zoomAt(p[0], p[1], factor);
  endFastSoon();
}, { passive: false });

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function tap(p, e) {
  const now = performance.now();
  const dbl = now - lastTap.t < 320 && Math.hypot(p[0] - lastTap.x, p[1] - lastTap.y) < 30;
  lastTap = { t: now, x: p[0], y: p[1] };
  if (state.mode === 'measure') { measureTap(p, dbl); return; }
  if (state.mode === 'markup') { markupTap(p); return; }
  if (dbl) {
    beginFast();
    renderer.zoomAt(p[0], p[1], e.shiftKey ? 0.5 : 2);
    endFastSoon();
    lastTap.t = 0;
  }
}

// ---------------------------------------------------------------------------
// snapping & coordinates

function snapIndexFor(space) {
  let idx = state.snapIndex.get(space);
  if (!idx) { idx = new SnapIndex(space.snaps, space.extents); state.snapIndex.set(space, idx); }
  return idx;
}

function snapped(p) {
  const w = renderer.toWorld(p[0], p[1]);
  if (!state.snap || !currentSpace()) return { x: w[0], y: w[1], kind: -1 };
  const r = (state.mode === 'measure' && matchMedia('(pointer: coarse)').matches ? 26 : 14) / renderer.view.scale;
  const hit = snapIndexFor(currentSpace()).nearest(w[0], w[1], r);
  return hit || { x: w[0], y: w[1], kind: -1 };
}

function updateHover(p, dragging = false) {
  const w = renderer.toWorld(p[0], p[1]);
  const o = origin();
  $('coords').textContent = `X ${fmtLen(w[0] + o[0])}   Y ${fmtLen(w[1] + o[1])}`;
  if (state.mode === 'measure' && !dragging) {
    state.hover = snapped(p);
    renderer.requestRender();
  }
}

// ---------------------------------------------------------------------------
// measure

const MEASURE_TOOLS = [
  ['distance', 'Distance'], ['polyline', 'Length / Area'], ['angle', 'Angle'], ['point', 'Coordinate'],
];

function measureTap(p, dbl) {
  const s = snapped(p);
  const pt = [s.x, s.y];
  const tool = state.measureTool;
  if (tool === 'point') {
    state.measures.push({ tool, pts: [pt], space: spaceKey() });
  } else if (tool === 'distance') {
    state.current.push(pt);
    if (state.current.length === 2) { state.measures.push({ tool, pts: state.current, space: spaceKey() }); state.current = []; }
  } else if (tool === 'angle') {
    state.current.push(pt);
    if (state.current.length === 3) { state.measures.push({ tool, pts: state.current, space: spaceKey() }); state.current = []; }
  } else if (tool === 'polyline') {
    if (dbl && state.current.length >= 2) { finishPolyMeasure(); }
    else state.current.push(pt);
  }
  updateModeResult();
  renderer.requestRender();
}

function finishPolyMeasure() {
  if (state.current.length >= 2) state.measures.push({ tool: 'polyline', pts: state.current, space: spaceKey() });
  state.current = [];
  updateModeResult();
  renderer.requestRender();
}

function measureText(m) {
  const u = unitLabel();
  const o = origin();
  const P = m.pts;
  if (m.tool === 'point') return `X ${fmtLen(P[0][0] + o[0])}  Y ${fmtLen(P[0][1] + o[1])}`;
  if (m.tool === 'distance' && P.length === 2) {
    const dx = P[1][0] - P[0][0], dy = P[1][1] - P[0][1];
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    return `${fmtLen(Math.hypot(dx, dy))} ${u}\nΔX ${fmtLen(dx)}  ΔY ${fmtLen(dy)}  ∠ ${(ang < 0 ? ang + 360 : ang).toFixed(2)}°`;
  }
  if (m.tool === 'angle' && P.length === 3) {
    const a1 = Math.atan2(P[0][1] - P[1][1], P[0][0] - P[1][0]);
    const a2 = Math.atan2(P[2][1] - P[1][1], P[2][0] - P[1][0]);
    let d = Math.abs(a2 - a1) * 180 / Math.PI;
    if (d > 180) d = 360 - d;
    return `Angle ${d.toFixed(3)}°`;
  }
  if (m.tool === 'polyline') {
    let len = 0, area = 0;
    for (let i = 1; i < P.length; i++) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; area += P[i][0] * P[j][1] - P[j][0] * P[i][1]; }
    area = Math.abs(area) / 2;
    const closing = P.length > 2 ? Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) : 0;
    return `Length ${fmtLen(len)} ${u}` + (P.length > 2 ? `\nPerimeter ${fmtLen(len + closing)}\nArea ${fmtLen(area)} ${u ? u + '²' : ''}` : '');
  }
  return '';
}

function updateModeResult() {
  const el = document.querySelector('#mode-bar .result');
  if (!el) return;
  const tool = state.measureTool;
  if (state.current.length && tool === 'polyline') el.textContent = measureText({ tool, pts: state.current }) + '\n(double-tap or ✓ to finish)';
  else if (state.current.length) el.textContent = tool === 'angle' ? (state.current.length === 1 ? 'Pick the vertex' : 'Pick the second point') : 'Pick the second point';
  else {
    const last = state.measures.filter((m) => m.space === spaceKey()).pop();
    el.textContent = last ? measureText(last) : tool === 'point' ? 'Tap a point' : tool === 'angle' ? 'Pick the first point' : 'Pick the first point';
  }
}

// ---------------------------------------------------------------------------
// markup

function finishDraft() {
  const d = state.draft;
  state.draft = null;
  if (!d) return;
  if (d.tool === 'pen' ? d.pts.length < 2 : !d.pts[1]) { renderer.requestRender(); return; }
  state.markups.items.push(d);
  saveMarkups();
  renderer.requestRender();
}

function markupTap(p) {
  if (state.markTool !== 'text') return;
  const w = renderer.toWorld(p[0], p[1]);
  const text = window.prompt('Note text');
  if (!text) return;
  state.markups.items.push({ tool: 'text', color: state.markColor, pts: [w], text, size: 18 / renderer.view.scale, space: spaceKey() });
  saveMarkups();
  renderer.requestRender();
}

function saveMarkups() { if (state.file) store.saveMarkups(state.file.id, state.markups); }

// ---------------------------------------------------------------------------
// overlay drawing

function drawOverlay(ctx, r) {
  const key = spaceKey();
  const S = (w) => r.toScreen(w[0], w[1]);
  // markups
  const all = state.markups.items.filter((m) => m.space === key);
  if (state.draft) all.push(state.draft);
  for (const m of all) drawMarkup(ctx, m, S, r);
  // find highlight
  if (state.highlight && state.highlight.space === key) {
    const b = state.highlight.bbox;
    const [x0, y0] = S([b[0], b[3]]), [x1, y1] = S([b[2], b[1]]);
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12);
    ctx.setLineDash([]);
  }
  // measurements
  ctx.font = '600 13px system-ui, sans-serif';
  for (const m of state.measures) if (m.space === key) drawMeasure(ctx, m, S, true);
  if (state.mode === 'measure') {
    if (state.current.length) {
      const pts = state.current.slice();
      if (state.hover) pts.push([state.hover.x, state.hover.y]);
      drawMeasure(ctx, { tool: state.measureTool, pts }, S, false);
    }
    if (state.hover) drawSnapMarker(ctx, state.hover, S);
  }
}

function drawSnapMarker(ctx, h, S) {
  const [x, y] = S([h.x, h.y]);
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const k = 7;
  if (h.kind === 0) ctx.rect(x - k, y - k, 2 * k, 2 * k);
  else if (h.kind === 1) { ctx.moveTo(x, y - k); ctx.lineTo(x + k, y + k); ctx.lineTo(x - k, y + k); ctx.closePath(); }
  else if (h.kind === 2) ctx.arc(x, y, k, 0, Math.PI * 2);
  else if (h.kind === 4) { ctx.moveTo(x, y - k); ctx.lineTo(x + k, y); ctx.lineTo(x, y + k); ctx.lineTo(x - k, y); ctx.closePath(); }
  else if (h.kind >= 0) { ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); }
  else { ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y); ctx.moveTo(x, y - 12); ctx.lineTo(x, y + 12); }
  ctx.stroke();
}

function label(ctx, text, x, y) {
  const lines = text.split('\n');
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12;
  const h = lines.length * 17 + 6;
  ctx.fillStyle = 'rgba(10,16,30,0.88)';
  ctx.strokeStyle = '#00b4ff';
  ctx.lineWidth = 1;
  let bx = x + 10, by = y - h - 6;
  const W = ctx.canvas.width / (window.devicePixelRatio || 1);
  if (bx + w > W - 4) bx = Math.max(4, x - 10 - w);
  if (by < 4) by = y + 10;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 6); else ctx.rect(bx, by, w, h);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffffff';
  lines.forEach((l, i) => ctx.fillText(l, bx + 6, by + 17 + i * 17));
}

function drawMeasure(ctx, m, S, done) {
  const P = m.pts.map(S);
  ctx.strokeStyle = '#00b4ff';
  ctx.fillStyle = 'rgba(0,180,255,0.15)';
  ctx.lineWidth = 2;
  if (P.length > 1) {
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
    if (m.tool === 'polyline' && P.length > 2) { ctx.closePath(); ctx.fill(); }
    ctx.stroke();
  }
  for (const p of P) { ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.fillStyle = '#00b4ff'; ctx.fill(); }
  if (done || P.length > 1) {
    const t = measureText(m);
    const anchor = m.tool === 'angle' ? P[1] : P[P.length - 1];
    if (t && anchor) label(ctx, done ? t : t.split('\n')[0], anchor[0], anchor[1]);
  }
}

function drawMarkup(ctx, m, S, r) {
  ctx.strokeStyle = m.color;
  ctx.fillStyle = m.color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const P = m.pts.map(S);
  if (m.tool === 'pen') {
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
    ctx.stroke();
  } else if (m.tool === 'rect' && P[1]) {
    ctx.strokeRect(Math.min(P[0][0], P[1][0]), Math.min(P[0][1], P[1][1]), Math.abs(P[1][0] - P[0][0]), Math.abs(P[1][1] - P[0][1]));
  } else if (m.tool === 'cloud' && P[1]) {
    const x0 = Math.min(P[0][0], P[1][0]), x1 = Math.max(P[0][0], P[1][0]);
    const y0 = Math.min(P[0][1], P[1][1]), y1 = Math.max(P[0][1], P[1][1]);
    const per = 2 * (x1 - x0 + y1 - y0);
    const n = Math.max(8, Math.round(per / 22));
    const pts = [];
    const along = (t) => {
      let d = t * per;
      const w = x1 - x0, h = y1 - y0;
      if (d < w) return [x0 + d, y0]; d -= w;
      if (d < h) return [x1, y0 + d]; d -= h;
      if (d < w) return [x1 - d, y1]; d -= w;
      return [x0, y1 - d];
    };
    for (let i = 0; i <= n; i++) pts.push(along(i / n));
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[i + 1];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const rad = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      ctx.moveTo(a[0], a[1]);
      ctx.arc(mx, my, rad, ang + Math.PI, ang + 2 * Math.PI);
    }
    ctx.stroke();
  } else if (m.tool === 'arrow' && P[1]) {
    const [a, b] = P;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - 14 * Math.cos(ang - 0.4), b[1] - 14 * Math.sin(ang - 0.4));
    ctx.lineTo(b[0] - 14 * Math.cos(ang + 0.4), b[1] - 14 * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  } else if (m.tool === 'text') {
    const px = Math.max(8, Math.min(200, m.size * r.view.scale));
    ctx.font = `600 ${px}px system-ui, sans-serif`;
    ctx.fillText(m.text, P[0][0], P[0][1]);
  }
}

// ---------------------------------------------------------------------------
// modes (measure / markup)

function setMode(mode) {
  if (state.mode === mode) mode = 'view';
  if (state.mode === 'measure' && state.measureTool === 'polyline' && state.current.length >= 2) finishPolyMeasure();
  state.mode = mode;
  state.current = [];
  state.hover = null;
  state.draft = null;
  canvas.classList.toggle('crosshair', mode !== 'view');
  for (const b of document.querySelectorAll('.tool[data-mode]')) b.classList.toggle('active', b.dataset.mode === mode);
  renderModeBar();
  renderer.requestRender();
}

function renderModeBar() {
  const bar = $('mode-bar');
  bar.innerHTML = '';
  if (state.mode === 'view') { bar.hidden = true; return; }
  bar.hidden = false;
  const seg = (label, active, fn, title) => {
    const b = document.createElement('button');
    b.className = 'seg' + (active ? ' active' : '');
    b.innerHTML = label;
    if (title) b.title = title;
    b.onclick = fn;
    bar.appendChild(b);
    return b;
  };
  const sep = () => { const s = document.createElement('span'); s.className = 'sep'; bar.appendChild(s); };
  if (state.mode === 'measure') {
    for (const [k, l] of MEASURE_TOOLS) seg(l, state.measureTool === k, () => { if (state.current.length >= 2 && state.measureTool === 'polyline') finishPolyMeasure(); state.measureTool = k; state.current = []; renderModeBar(); renderer.requestRender(); });
    sep();
    if (state.measureTool === 'polyline') seg('✓ Done', false, finishPolyMeasure, 'Finish the measurement');
    seg(state.snap ? '🧲 Snap' : 'Snap off', state.snap, () => { state.snap = !state.snap; renderModeBar(); }, 'Snap to endpoints, midpoints and centres');
    seg('Clear', false, () => { state.measures = state.measures.filter((m) => m.space !== spaceKey()); state.current = []; renderModeBar(); renderer.requestRender(); });
    seg('✕', false, () => setMode('view'), 'Close');
    const res = document.createElement('div');
    res.className = 'result';
    res.style.flexBasis = '100%';
    res.style.textAlign = 'center';
    bar.appendChild(res);
    updateModeResult();
  } else if (state.mode === 'markup') {
    for (const [k, l] of [['pen', '✎ Pen'], ['arrow', '↗ Arrow'], ['rect', '▭ Box'], ['cloud', '☁ Cloud'], ['text', 'T Text']]) {
      seg(l, state.markTool === k, () => { state.markTool = k; renderModeBar(); });
    }
    sep();
    for (const c of MARK_COLORS) {
      const b = document.createElement('button');
      b.className = 'swatch' + (state.markColor === c ? ' active' : '');
      b.style.background = c;
      b.title = 'Colour';
      b.onclick = () => { state.markColor = c; renderModeBar(); };
      bar.appendChild(b);
    }
    sep();
    seg('↶ Undo', false, () => {
      const items = state.markups.items;
      for (let i = items.length - 1; i >= 0; i--) if (items[i].space === spaceKey()) { items.splice(i, 1); break; }
      saveMarkups(); renderer.requestRender();
    });
    seg('Clear', false, () => {
      if (!confirm('Remove all markups on this sheet?')) return;
      state.markups.items = state.markups.items.filter((m) => m.space !== spaceKey());
      saveMarkups(); renderer.requestRender();
    });
    seg('✕', false, () => setMode('view'), 'Close');
  }
}

for (const b of document.querySelectorAll('.tool[data-mode]')) b.onclick = () => { closePanel(); setMode(b.dataset.mode); };

// ---------------------------------------------------------------------------
// panels

for (const b of document.querySelectorAll('.tool[data-panel]')) b.onclick = () => togglePanel(b.dataset.panel);
$('panel-close').onclick = closePanel;

function togglePanel(name) {
  if (state.panel === name) { closePanel(); return; }
  state.panel = name;
  $('panel').hidden = false;
  for (const b of document.querySelectorAll('.tool[data-panel]')) b.classList.toggle('active', b.dataset.panel === name);
  renderPanel();
}

function closePanel() {
  state.panel = null;
  $('panel').hidden = true;
  for (const b of document.querySelectorAll('.tool[data-panel]')) b.classList.remove('active');
}

function renderPanel() {
  const body = $('panel-body');
  const title = $('panel-title');
  body.innerHTML = '';
  if (!state.dl) return;
  if (state.panel === 'layers') { title.textContent = 'Layers'; layersPanel(body); }
  else if (state.panel === 'layouts') { title.textContent = 'Layouts'; layoutsPanel(body); }
  else if (state.panel === 'find') { title.textContent = 'Find text'; findPanel(body); }
  else if (state.panel === 'export') { title.textContent = 'Export & share'; exportPanel(body); }
  else if (state.panel === 'info') { title.textContent = 'Drawing information'; infoPanel(body); }
}

let layerFilter = '';
function layersPanel(body) {
  const layers = state.dl.layers;
  const tools = document.createElement('div');
  tools.className = 'tools';
  tools.innerHTML = `<input type="search" placeholder="Filter ${layers.length} layers" value="${esc(layerFilter)}">`;
  body.appendChild(tools);
  const bar = document.createElement('div');
  bar.className = 'tools';
  bar.innerHTML = '<button class="btn small" data-a="on">All on</button><button class="btn small" data-a="off">All off</button><button class="btn small" data-a="reset">Reset</button>';
  body.appendChild(bar);
  const list = document.createElement('div');
  body.appendChild(list);
  const order = layers.map((l, i) => i).sort((a, b) => layers[a].name.localeCompare(layers[b].name, undefined, { numeric: true }));
  const draw = () => {
    list.innerHTML = '';
    const f = layerFilter.toLowerCase();
    for (const i of order) {
      const l = layers[i];
      if (f && !l.name.toLowerCase().includes(f)) continue;
      const on = renderer.layerVisible[i];
      const row = document.createElement('div');
      row.className = 'row' + (on ? '' : ' off');
      const col = l.color === -1 ? (luminance(renderer.bg) > 0.5 ? '#000' : '#fff') : rgbCss(l.color);
      row.innerHTML = `<span class="color-dot" style="background:${col}"></span><span class="name"></span>${l.frozen ? '<small class="muted">frozen</small>' : ''}<span class="toggle ${on ? 'on' : ''}"></span>`;
      row.querySelector('.name').textContent = l.name || '(unnamed)';
      row.onclick = () => { renderer.layerVisible[i] = !renderer.layerVisible[i]; renderer.requestRender(); draw(); };
      list.appendChild(row);
    }
  };
  tools.querySelector('input').oninput = (e) => { layerFilter = e.target.value; draw(); };
  bar.onclick = (e) => {
    const a = e.target.dataset.a;
    if (!a) return;
    const f = layerFilter.toLowerCase();
    layers.forEach((l, i) => {
      if (f && !l.name.toLowerCase().includes(f)) return;
      renderer.layerVisible[i] = a === 'on' ? true : a === 'off' ? false : !l.frozen && !l.off;
    });
    renderer.requestRender();
    draw();
  };
  draw();
}

function layoutsPanel(body) {
  const dl = state.dl;
  const mk = (label, idx, sub) => {
    const row = document.createElement('div');
    const cur = (renderer.isLayout ? renderer.layoutIndex : -1) === idx;
    row.className = 'row' + (cur ? ' current' : '');
    row.innerHTML = `<svg viewBox="0 0 24 24" class="ic"><path d="${idx < 0 ? 'M3 12l9-8 9 8M5 10v10h14V10' : 'M4 5h16v14H4z'}"/></svg><span class="name"></span><small class="muted"></small>`;
    row.querySelector('.name').textContent = label;
    row.querySelector('small').textContent = sub;
    row.onclick = () => { selectSpace(idx); };
    body.appendChild(row);
  };
  mk('Model', -1, `${dl.model.count} objects`);
  dl.layouts.forEach((l, i) => mk(l.name, i, `${l.viewports.length} viewport${l.viewports.length === 1 ? '' : 's'}`));
  if (!dl.layouts.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'This drawing has no paper-space layouts.';
    body.appendChild(p);
  }
}

let findQuery = '';
function findPanel(body) {
  const box = document.createElement('div');
  box.className = 'tools';
  box.innerHTML = '<input type="search" placeholder="Search text in this sheet" autofocus>';
  body.appendChild(box);
  const count = document.createElement('div');
  count.className = 'count';
  body.appendChild(count);
  const list = document.createElement('div');
  body.appendChild(list);
  const input = box.querySelector('input');
  input.value = findQuery;
  const run = () => {
    findQuery = input.value;
    list.innerHTML = '';
    const q = findQuery.trim().toLowerCase();
    if (!q) { count.textContent = ''; return; }
    const space = currentSpace();
    const hits = [];
    for (const t of space.texts) {
      const s = t.lines.join(' ');
      if (s.toLowerCase().includes(q)) hits.push({ t, s });
      if (hits.length >= 500) break;
    }
    count.textContent = hits.length >= 500 ? '500+ matches' : `${hits.length} match${hits.length === 1 ? '' : 'es'}`;
    for (const h of hits) {
      const row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML = '<div></div><small></small>';
      row.firstChild.textContent = h.s.length > 120 ? h.s.slice(0, 120) + '…' : h.s;
      row.lastChild.textContent = state.dl.layers[h.t.layer]?.name || '';
      row.onclick = () => {
        const b = h.t.bbox;
        state.highlight = { bbox: b, space: spaceKey() };
        const w = b[2] - b[0], hh = b[3] - b[1];
        renderer.zoomToBox(b[0] - w * 1.5, b[1] - hh * 3, b[2] + w * 1.5, b[3] + hh * 3, 0.05);
        if (matchMedia('(max-width: 640px)').matches) closePanel();
        setTimeout(() => { state.highlight = null; renderer.requestRender(); }, 4000);
      };
      list.appendChild(row);
    }
  };
  input.oninput = run;
  run();
  setTimeout(() => input.focus(), 50);
}

const exportOpts = { white: true, markups: true };
function exportPanel(body) {
  const opt = (key, label) => {
    const l = document.createElement('label');
    l.className = 'opt' + (exportOpts[key] ? ' on' : '');
    l.innerHTML = `<span class="toggle"></span><span>${label}</span>`;
    l.onclick = () => { exportOpts[key] = !exportOpts[key]; l.classList.toggle('on', exportOpts[key]); };
    body.appendChild(l);
  };
  const sec = (t) => { const d = document.createElement('div'); d.className = 'section'; d.textContent = t; body.appendChild(d); };
  const btn = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.style.width = '100%';
    b.style.margin = '4px 0';
    b.textContent = label;
    b.onclick = async () => {
      b.disabled = true;
      try { await fn(); } catch (e) { toast('Export failed: ' + (e.message || e)); } finally { b.disabled = false; }
    };
    body.appendChild(b);
  };
  sec('Options');
  opt('white', 'White background (print style)');
  opt('markups', 'Include markups & measurements');
  sec('Current view');
  btn('Save view as PNG image', () => exportImage('png', false));
  btn('Save view as PDF', () => exportImage('pdf', false));
  sec('Whole sheet');
  btn('PDF — A4 landscape', () => exportImage('pdf', true, [842, 595]));
  btn('PDF — A3 landscape', () => exportImage('pdf', true, [1191, 842]));
  btn('PNG — high resolution', () => exportImage('png', true));
}

async function exportImage(kind, whole, page) {
  const savedBg = renderer.bg;
  const savedView = { ...renderer.view };
  const savedOverlay = renderer.overlay;
  const w = renderer.width, h = renderer.height;
  let scale = 2.5;
  try {
    if (exportOpts.white) renderer.bg = 0xffffff;
    if (!exportOpts.markups) renderer.overlay = null;
    if (whole) {
      const aspect = page ? page[0] / page[1] : 1.414;
      renderer.width = 1600; renderer.height = Math.round(1600 / aspect);
      renderer.zoomExtents();
      scale = 2;
    }
    const prevHover = state.hover; state.hover = null;
    const c = renderer.snapshot(scale, true);
    state.hover = prevHover;
    const base = (state.file?.name || 'drawing').replace(/\.(dwg|dxf)$/i, '');
    if (kind === 'png') {
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      const r = await saveBlob(blob, `${base}.png`);
      if (r !== 'cancelled') toast(r === 'shared' ? 'Image ready to share' : 'Image saved');
    } else {
      let [pw, ph] = page || [842, 595];
      if (!page && c.height > c.width) [pw, ph] = [ph, pw];
      const blob = canvasToPdf(c, { pageW: pw, pageH: ph, title: base });
      const r = await saveBlob(blob, `${base}.pdf`);
      if (r !== 'cancelled') toast(r === 'shared' ? 'PDF ready to share' : 'PDF saved');
    }
  } finally {
    renderer.bg = savedBg;
    renderer.overlay = savedOverlay;
    renderer.width = w; renderer.height = h;
    renderer.view = savedView;
    renderer.requestRender();
  }
}

function infoPanel(body) {
  const dl = state.dl;
  const u = unitLabel() || 'unitless';
  const ext = dl.model.extents;
  const o = dl.model.origin;
  const e = ext ? `${fmtLen(ext[0] + o[0])}, ${fmtLen(ext[1] + o[1])}  →  ${fmtLen(ext[2] + o[0])}, ${fmtLen(ext[3] + o[1])}` : '—';
  const total = Object.values(dl.counts).reduce((a, b) => a + b, 0);
  const counts = Object.entries(dl.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v.toLocaleString()}</dd>`).join('');
  const notShown = dl.warnings.map((w) => `<dt>${esc(w.type)}</dt><dd>${w.count}</dd>`).join('');
  body.innerHTML = `
    <dl>
      <dt>File</dt><dd>${esc(state.file.name)}</dd>
      <dt>Size</dt><dd>${fmtSize(state.file.size)}</dd>
      <dt>Format</dt><dd>${esc(dl.info.version)}</dd>
      <dt>Units</dt><dd>${esc(u)}</dd>
      <dt>Extents</dt><dd>${e}</dd>
      <dt>Layers</dt><dd>${dl.layers.length}</dd>
      <dt>Blocks</dt><dd>${dl.info.blocks}</dd>
      <dt>Layouts</dt><dd>${dl.layouts.length}</dd>
      <dt>Objects</dt><dd>${total.toLocaleString()} (incl. block contents)</dd>
      <dt>Load time</dt><dd>${dl.info.parseMs + dl.info.buildMs} ms</dd>
    </dl>
    <div class="section">Objects by type</div><dl>${counts}</dl>
    ${notShown ? `<div class="section">Not displayed / notes</div><dl>${notShown}</dl>` : ''}`;
}

// ---------------------------------------------------------------------------
// top bar & menu

$('btn-back').onclick = () => showHome();
$('btn-fit').onclick = () => renderer.zoomExtents();
$('btn-bg').onclick = cycleBackground;
function cycleBackground() {
  const i = BACKGROUNDS.indexOf(renderer.bg);
  renderer.bg = BACKGROUNDS[(i + 1) % BACKGROUNDS.length];
  store.setPref('bg', renderer.bg);
  renderer.requestRender();
  if (state.panel === 'layers') renderPanel();
}
$('btn-more').onclick = (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; $('chk-lw').classList.toggle('on', renderer.showLineweight); };
document.addEventListener('click', (e) => { if (!$('menu').hidden && !$('menu').contains(e.target)) $('menu').hidden = true; });
$('menu').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $('menu').hidden = true;
  const a = b.dataset.act;
  if (a === 'lineweight') { renderer.showLineweight = !renderer.showLineweight; store.setPref('lineweight', renderer.showLineweight); renderer.requestRender(); }
  else if (a === 'info') { state.panel = null; togglePanel('info'); }
  else if (a === 'open') pickFile();
  else if (a === 'about') showAbout();
};

function showAbout() {
  dialog(`<h3><img src="icons/logo.svg" width="28" height="28" style="vertical-align:middle;border-radius:7px;margin-right:8px">DWG Viewer ${esc(VERSION)}</h3>
  <p>A free viewer for AutoCAD® DWG and DXF drawings: layers, layouts, measuring, markups, text search and PDF/PNG export. Everything runs on your device — your drawings are never uploaded.</p>
  <p class="muted">DWG decoding uses <b>LibreDWG</b> (GNU) via <b>libredwg-web</b>; DXF parsing uses <b>dxf-json</b>. These are licensed under the GNU GPL v3, and so is DWG Viewer: you may use, share and modify it freely under the same licence.</p>
  <p class="muted">DWG Viewer is an independent project and is not affiliated with Autodesk, Inc. or any other CAD vendor. AutoCAD and DWG are trademarks of Autodesk, Inc.</p>
  <p class="muted">Platform: ${esc(platform)}${isNative ? ' (app)' : ''}</p>`);
}

// keyboard shortcuts (desktop)
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if ($('viewer').hidden) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); pickFile(); }
    return;
  }
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'o') { e.preventDefault(); pickFile(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'f') { e.preventDefault(); togglePanel('find'); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'z' && state.mode === 'markup') { e.preventDefault(); state.markups.items.pop(); saveMarkups(); renderer.requestRender(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'f') renderer.zoomExtents();
  else if (k === 'b') cycleBackground();
  else if (k === 'l') togglePanel('layers');
  else if (k === 'm') setMode('measure');
  else if (k === '+' || k === '=') renderer.zoomAt(renderer.width / 2, renderer.height / 2, 1.5);
  else if (k === '-') renderer.zoomAt(renderer.width / 2, renderer.height / 2, 1 / 1.5);
  else if (k === 'enter' && state.mode === 'measure') finishPolyMeasure();
  else if (k === 'escape') goBack();
});

function goBack() {
  if (!$('dialog').hidden) { $('dialog').hidden = true; return true; }
  if (!$('menu').hidden) { $('menu').hidden = true; return true; }
  if (state.panel) { closePanel(); return true; }
  if (state.mode !== 'view') {
    if (state.current.length) { state.current = []; updateModeResult(); renderer.requestRender(); return true; }
    setMode('view'); return true;
  }
  if (!$('viewer').hidden) { showHome(); return true; }
  return false;
}
window.addEventListener('app-back', () => { if (!goBack()) exitApp(); });

window.addEventListener('resize', () => { if (!$('viewer').hidden) renderer.resize(); });
new ResizeObserver(() => { if (!$('viewer').hidden) renderer.resize(); }).observe(canvas);

// service worker for offline use of the web version
if ('serviceWorker' in navigator && !isNative && !window.dwgDesktop && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

refreshRecent();
console.info('DWG Viewer', VERSION, navigator.userAgent);
if (OLD_ENGINE) setTimeout(() => toast(UPDATE_HINT, 7000), 800);

// testing hook
window.__dwgViewer = { state, renderer, openBuffer, selectSpace, setMode };
