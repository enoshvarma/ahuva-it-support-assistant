// Canvas 2D renderer for the display list produced by core/builder.js.

const KIND_LINE = 0, KIND_FILL = 1, KIND_MASK = 2, KIND_WIDE = 3;
const CAP_HEIGHT = 0.716; // cap height of the UI sans-serif font relative to its em size
const FONT_PX = 64;

function rgbCss(c) {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
}

function luminance(c) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

const FONT_MAP = [
  [/arial|helvet/i, 'Arial, Helvetica, sans-serif'],
  [/times|roman(?!s)|serif/i, '"Times New Roman", Times, serif'],
  [/courier|mono|consol/i, '"Courier New", Courier, monospace'],
  [/simsun|song|gbcbig|chineset|hztxt/i, '"SimSun", "Songti SC", "Noto Sans CJK SC", sans-serif'],
  [/msgothic|gothic|meiryo|extfont/i, '"MS Gothic", "Hiragino Sans", "Noto Sans CJK JP", sans-serif'],
  [/calibri/i, 'Calibri, Carlito, Arial, sans-serif'],
  [/isocp|iso|romans|simplex|txt|monotxt|gdt/i, '"Arial Narrow", "Roboto Condensed", Arial, sans-serif'],
];

function fontFamily(name) {
  if (name) for (const [re, fam] of FONT_MAP) if (re.test(name)) return fam;
  return 'Arial, Helvetica, sans-serif';
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dl = null;
    this.space = null; // current space (model or layout)
    this.isLayout = false;
    this.bg = 0x000000;
    this.showLineweight = false;
    this.layerVisible = [];
    this.view = { cx: 0, cy: 0, scale: 1 };
    this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    this.pathCache = new WeakMap();
    this.textCache = new WeakMap();
    this.overlay = null; // function(ctx, renderer) for measurements/markup
    this.lastRenderMs = 0;
    this.measureCtx = document.createElement('canvas').getContext('2d');
    this.pending = false;
    this.resize();
  }

  setDocument(dl) {
    this.dl = dl;
    this.pathCache = new WeakMap();
    this.textCache = new WeakMap();
    this.layerVisible = dl.layers.map((l) => !l.frozen && !l.off);
    this.setSpace(-1);
  }

  setSpace(index) {
    this.layoutIndex = index;
    this.isLayout = index >= 0;
    this.space = index >= 0 ? this.dl.layouts[index] : this.dl.model;
    this.zoomExtents();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.requestRender();
  }

  // ---- view -------------------------------------------------------------------------

  extents() {
    const s = this.space;
    if (!s) return null;
    if (this.isLayout && s.paper) return s.paper;
    return s.extents;
  }

  zoomExtents() {
    const e = this.extents();
    if (!e) { this.view = { cx: 0, cy: 0, scale: 1 }; this.requestRender(); return; }
    this.zoomToBox(e[0], e[1], e[2], e[3], 0.04);
  }

  zoomToBox(x0, y0, x1, y1, margin = 0.08) {
    const w = Math.max(x1 - x0, 1e-9), h = Math.max(y1 - y0, 1e-9);
    const sx = this.width / w, sy = this.height / h;
    let s = Math.min(sx, sy) * (1 - 2 * margin);
    if (!isFinite(s) || s <= 0) s = 1;
    if (x1 - x0 < 1e-9 && y1 - y0 < 1e-9) s = 1;
    this.view = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: s };
    this.requestRender();
  }

  toScreen(x, y) {
    const v = this.view;
    return [(x - v.cx) * v.scale + this.width / 2, this.height / 2 - (y - v.cy) * v.scale];
  }

  toWorld(sx, sy) {
    const v = this.view;
    return [(sx - this.width / 2) / v.scale + v.cx, (this.height / 2 - sy) / v.scale + v.cy];
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    const v = this.view;
    const ns = Math.min(1e12, Math.max(1e-12, v.scale * factor));
    v.cx = wx - (sx - this.width / 2) / ns;
    v.cy = wy + (sy - this.height / 2) / ns;
    v.scale = ns;
    this.requestRender();
  }

  pan(dx, dy) {
    this.view.cx -= dx / this.view.scale;
    this.view.cy += dy / this.view.scale;
    this.requestRender();
  }

  visibleWorld() {
    const [x0, y1] = this.toWorld(0, 0);
    const [x1, y0] = this.toWorld(this.width, this.height);
    return [x0, y0, x1, y1];
  }

  // ---- colours ----------------------------------------------------------------------

  paperColor() { return this.isLayout ? 0xffffff : this.bg; }

  resolveColor(c, bg) {
    if (c === -1) return luminance(bg) > 0.5 ? 0x000000 : 0xffffff;
    if (c === -2) return bg;
    // keep near-background colours visible
    if (Math.abs(luminance(c) - luminance(bg)) < 0.08 && c !== bg) return luminance(bg) > 0.5 ? 0x000000 : 0xffffff;
    return c;
  }

  visible(item) {
    if (!this.layerVisible[item.layer]) return false;
    if (item.gate) {
      for (const g of String(item.gate).split(',')) if (!this.layerVisible[+g]) return false;
    }
    return true;
  }

  // ---- paths --------------------------------------------------------------------------

  path(batch) {
    let p = this.pathCache.get(batch);
    if (p) return p;
    const d = batch.data;
    if (batch.kind === KIND_LINE || batch.kind === KIND_WIDE) {
      p = new Path2D();
      for (let i = 0; i < d.length;) {
        const n = d[i++];
        p.moveTo(d[i], d[i + 1]);
        for (let k = 1; k < n; k++) p.lineTo(d[i + 2 * k], d[i + 2 * k + 1]);
        if (n === 1) p.lineTo(d[i], d[i + 1]);
        i += 2 * n;
      }
    } else {
      p = [];
      for (let i = 0; i < d.length;) {
        const nr = d[i++];
        const path = new Path2D();
        for (let r = 0; r < nr; r++) {
          const n = d[i++];
          path.moveTo(d[i], d[i + 1]);
          for (let k = 1; k < n; k++) path.lineTo(d[i + 2 * k], d[i + 2 * k + 1]);
          path.closePath();
          i += 2 * n;
        }
        p.push(path);
      }
    }
    this.pathCache.set(batch, p);
    return p;
  }

  // ---- render -------------------------------------------------------------------------

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.render(); });
  }

  render(target) {
    const t0 = performance.now();
    const ctx = target ? target.ctx : this.ctx;
    const W = target ? target.width : this.width, H = target ? target.height : this.height;
    const dpr = target ? target.dpr : this.dpr;
    const savedW = this.width, savedH = this.height;
    this.width = W; this.height = H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const outerBg = this.isLayout ? (luminance(this.bg) > 0.5 ? 0xd9dce1 : 0x3a3f47) : this.bg;
    ctx.fillStyle = rgbCss(outerBg);
    ctx.fillRect(0, 0, W * dpr, H * dpr);
    if (this.space) {
      if (this.isLayout) this.renderLayout(ctx, dpr);
      else this.renderSpace(ctx, dpr, this.space, this.view, this.bg, null);
    }
    if (this.overlay && !target?.noOverlay) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.overlay(ctx, this);
    }
    this.width = savedW; this.height = savedH;
    this.lastRenderMs = performance.now() - t0;
  }

  renderLayout(ctx, dpr) {
    const s = this.space;
    const paper = s.paper || s.extents;
    const bg = 0xffffff;
    if (paper) {
      const [ax, ay] = this.toScreen(paper[0], paper[3]);
      const [bx, by] = this.toScreen(paper[2], paper[1]);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(ax + 4, ay + 4, bx - ax, by - ay);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ax, ay, bx - ax, by - ay);
    }
    // model space through each viewport
    for (const vp of s.viewports || []) {
      if (!this.layerVisible[vp.layer]) continue;
      const k = vp.h / vp.viewHeight;
      if (!(k > 0) || !isFinite(k)) continue;
      const m = this.dl.model;
      const mOrigin = m.origin;
      // model point (relative to model origin) -> paper (relative to layout origin)
      const vx = vp.viewX - mOrigin[0], vy = vp.viewY - mOrigin[1];
      const [sx0, sy0] = this.toScreen(vp.cx - vp.w / 2, vp.cy + vp.h / 2);
      const [sx1, sy1] = this.toScreen(vp.cx + vp.w / 2, vp.cy - vp.h / 2);
      if (sx1 < 0 || sy1 < 0 || sx0 > this.width || sy0 > this.height) continue;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      ctx.rect(sx0, sy0, sx1 - sx0, sy1 - sy0);
      ctx.clip();
      const scale = this.view.scale * k;
      // screen position of the viewport centre
      const [scx, scy] = this.toScreen(vp.cx, vp.cy);
      const mv = {
        cx: vx - (scx - this.width / 2) / scale,
        cy: vy + (scy - this.height / 2) / scale,
        scale,
        twist: vp.twist,
        pivot: [vx, vy],
      };
      this.renderSpace(ctx, dpr, m, mv, bg, [sx0, sy0, sx1, sy1]);
      ctx.restore();
    }
    this.renderSpace(ctx, dpr, s, this.view, bg, null);
  }

  renderSpace(ctx, dpr, space, view, bg, clipRect) {
    const W = this.width, H = this.height;
    const s = view.scale;
    const a = s * dpr, e = (W / 2 - view.cx * s) * dpr, f = (H / 2 + view.cy * s) * dpr;
    let world;
    const twist = view.twist || 0;
    const setT = () => {
      if (twist) {
        const [px, py] = view.pivot;
        ctx.setTransform(a, 0, 0, -a, e, f);
        ctx.translate(px, py);
        ctx.rotate(twist);
        ctx.translate(-px, -py);
      } else ctx.setTransform(a, 0, 0, -a, e, f);
    };
    {
      const [x0, y1] = [(0 - W / 2) / s + view.cx, (H / 2 - 0) / s + view.cy];
      const [x1, y0] = [(W - W / 2) / s + view.cx, (H / 2 - H) / s + view.cy];
      world = twist ? null : [x0, y0, x1, y1];
      if (clipRect && !twist) {
        world = [(clipRect[0] - W / 2) / s + view.cx, (H / 2 - clipRect[3]) / s + view.cy, (clipRect[2] - W / 2) / s + view.cx, (H / 2 - clipRect[1]) / s + view.cy];
      }
    }
    const inView = (b) => !world || !(b[2] < world[0] || b[0] > world[2] || b[3] < world[1] || b[1] > world[3]);
    const px = 1 / s; // one CSS pixel in world units

    setT();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const batches = space.batches;
    const texts = space.texts;
    let ti = 0;
    let currentStage = batches.length ? batches[0].stage : 0;
    const flushTexts = (stage) => {
      while (ti < texts.length && texts[ti].stage <= stage) {
        const t = texts[ti++];
        if (this.visible(t) && inView(t.bbox)) this.drawText(ctx, t, bg, s, dpr, view, setT);
      }
    };
    for (const b of batches) {
      if (b.stage !== currentStage) {
        flushTexts(currentStage);
        currentStage = b.stage;
        setT();
      }
      if (!this.visible(b) || !inView(b.bbox)) continue;
      // skip batches that collapse to (well) below a pixel
      const color = b.kind === KIND_MASK ? (b.color === -2 ? bg : b.color) : this.resolveColor(b.color, bg);
      const css = rgbCss(color);
      if (b.kind === KIND_LINE) {
        ctx.strokeStyle = css;
        let lw = px;
        if (this.showLineweight && b.lw > 0) lw = Math.max(px, (b.lw / 100) * (96 / 25.4) * px);
        ctx.lineWidth = lw;
        if (b.dash) {
          const total = b.dash.reduce((p, q) => p + q, 0);
          if (total * s > 3) {
            ctx.setLineDash(b.dash.map((v, i) => (i % 2 === 0 && v === 0 ? px * 0.5 : v)));
          } else ctx.setLineDash([]);
        } else ctx.setLineDash([]);
        ctx.stroke(this.path(b));
      } else if (b.kind === KIND_WIDE) {
        ctx.setLineDash([]);
        ctx.strokeStyle = css;
        ctx.lineWidth = Math.max(px, b.width);
        ctx.lineJoin = 'miter';
        ctx.lineCap = 'butt';
        ctx.stroke(this.path(b));
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
      } else {
        ctx.fillStyle = css;
        ctx.globalAlpha = b.alpha || 1;
        for (const p of this.path(b)) ctx.fill(p, 'evenodd');
        ctx.globalAlpha = 1;
      }
    }
    ctx.setLineDash([]);
    flushTexts(Infinity);

    // points
    const pts = space.points;
    if (pts && pts.length) {
      setT();
      const pdmode = this.dl.header.PDMODE || 0;
      if ((pdmode & 31) !== 1) {
        let size = this.dl.header.PDSIZE || 0;
        let sizePx = size > 0 ? size * s : size < 0 ? (-size / 100) * this.height : 0.05 * this.height;
        if (pdmode === 0) sizePx = 2;
        sizePx = Math.min(Math.max(sizePx, 2), 40);
        const r = sizePx * px / 2;
        let last = null;
        for (let i = 0; i < pts.length; i += 6) {
          const x = pts[i], y = pts[i + 1];
          if (world && (x < world[0] || x > world[2] || y < world[1] || y > world[3])) continue;
          if (!this.visible({ layer: pts[i + 2], gate: pts[i + 3] || '' })) continue;
          const c = rgbCss(this.resolveColor(pts[i + 4], bg));
          if (c !== last) { ctx.fillStyle = c; ctx.strokeStyle = c; last = c; }
          ctx.lineWidth = px;
          const shape = pdmode & 7;
          if (pdmode === 0 || shape === 0) {
            ctx.fillRect(x - px, y - px, 2 * px, 2 * px);
          } else {
            ctx.beginPath();
            if (shape === 2) { ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); }
            if (shape === 3) { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x - r, y + r); ctx.lineTo(x + r, y - r); }
            if (shape === 4) { ctx.moveTo(x, y); ctx.lineTo(x, y + r); }
            if (pdmode & 32) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
            if (pdmode & 64) ctx.rect(x - r, y - r, 2 * r, 2 * r);
            ctx.stroke();
          }
        }
      }
    }

    // infinite lines
    if (space.rays && space.rays.length) {
      setT();
      ctx.lineWidth = px;
      const span = (Math.hypot(W, H) / s) * 2 + Math.hypot(view.cx, view.cy) * 2;
      for (const r of space.rays) {
        if (!this.visible(r)) continue;
        const l = Math.hypot(r.dx, r.dy) || 1;
        const dx = r.dx / l, dy = r.dy / l;
        const far = span + Math.hypot(r.x - view.cx, r.y - view.cy);
        ctx.strokeStyle = rgbCss(this.resolveColor(r.color, bg));
        ctx.setLineDash(r.dash && r.dash.reduce((p, q) => p + q, 0) * s > 3 ? r.dash : []);
        ctx.beginPath();
        ctx.moveTo(r.ray ? r.x : r.x - dx * far, r.ray ? r.y : r.y - dy * far);
        ctx.lineTo(r.x + dx * far, r.y + dy * far);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  // Wraps/measures text once per item. Units are text heights.
  // Result: { lines: [{ pieces: [{ t, x, w, font, c, h }], w, h }], widths, maxW, ys }
  textLayout(t) {
    let L = this.textCache.get(t);
    if (L) return L;
    const mc = this.measureCtx;
    const fam = fontFamily(t.font);
    const unit = 1 / (CAP_HEIGHT * FONT_PX);
    const fontOf = (b, i, h) => `${i || t.italic ? 'italic ' : ''}${b || t.bold ? 'bold ' : ''}${Math.max(1, Math.round(FONT_PX * h))}px ${fam}`;
    const measure = (str, font) => { mc.font = font; return mc.measureText(str).width * unit; };
    const paragraphs = t.runs ? t.runs : t.lines.map((l) => [{ t: l, c: null, h: 1, b: false, i: false }]);
    const lines = [];
    for (const para of paragraphs) {
      // tokens keep their run style so wrapping works across style changes
      const tokens = [];
      for (const r of para) {
        const font = fontOf(r.b, r.i, r.h || 1);
        for (const part of t.wrap > 0 ? r.t.split(/(\s+)/) : [r.t]) if (part) tokens.push({ t: part, font, c: r.c, h: r.h || 1 });
      }
      let line = { pieces: [], w: 0, h: 1 };
      for (const tok of tokens) {
        const w = measure(tok.t, tok.font);
        if (t.wrap > 0 && line.pieces.length && line.w + w > t.wrap * 1.001 && tok.t.trim()) {
          lines.push(line);
          line = { pieces: [], w: 0, h: 1 };
        }
        if (!line.pieces.length && !tok.t.trim() && t.wrap > 0) continue;
        line.pieces.push({ ...tok, x: line.w, w });
        line.w += w;
        line.h = Math.max(line.h, tok.h);
      }
      lines.push(line);
    }
    // strip trailing spaces from wrapped lines
    for (const l of lines) {
      while (l.pieces.length > 1 && !l.pieces[l.pieces.length - 1].t.trim()) { const p = l.pieces.pop(); l.w -= p.w; }
    }
    const widths = lines.map((l) => l.w);
    // baselines (y, in height units, downwards from the first one)
    const ys = [0];
    for (let i = 1; i < lines.length; i++) ys.push(ys[i - 1] + t.spacing * Math.max(lines[i].h, 1));
    L = { lines, widths, maxW: Math.max(0, ...widths), ys, total: (ys[ys.length - 1] || 0) + Math.max(lines[0] ? lines[0].h : 1, 1) };
    this.textCache.set(t, L);
    return L;
  }

  drawText(ctx, t, bg, s, dpr, view, setT) {
    const hpx = Math.hypot(t.Y[0], t.Y[1]) * s;
    if (hpx < 1.2) {
      // too small to read: draw a faint bar so dense text areas keep their shape
      if (hpx > 0.25) {
        const L = this.textLayout(t);
        ctx.save();
        setT();
        ctx.transform(t.X[0], t.X[1], t.Y[0], t.Y[1], t.o[0], t.o[1]);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = rgbCss(this.resolveColor(t.color, bg));
        const [ox, oy] = this.textOrigin(t, L);
        ctx.fillRect(ox, oy - L.ys[L.ys.length - 1], L.maxW, 0.7 + L.ys[L.ys.length - 1]);
        ctx.restore();
      }
      return;
    }
    const L = this.textLayout(t);
    ctx.save();
    setT();
    let X = t.X, Y = t.Y, o = t.o;
    if (t.p2 && (t.ha === 3 || t.ha === 5)) {
      // aligned / fit text between two points
      const dx = t.p2[0] - o[0], dy = t.p2[1] - o[1];
      const dist = Math.hypot(dx, dy);
      const xl = Math.hypot(X[0], X[1]);
      const w = L.widths[0] || 1;
      if (dist > 0 && xl > 0) {
        const k = dist / (w * xl);
        X = [(dx / dist) * xl * k, (dy / dist) * xl * k];
        const yl = Math.hypot(Y[0], Y[1]);
        const yk = t.ha === 3 ? k : 1;
        Y = [(-dy / dist) * yl * yk, (dx / dist) * yl * yk];
      }
    }
    ctx.transform(X[0], X[1], Y[0], Y[1], o[0], o[1]);
    // canvas text is drawn y-down: flip, and scale font px to height units
    const k = 1 / (CAP_HEIGHT * FONT_PX);
    ctx.scale(k, -k);
    const base = rgbCss(this.resolveColor(t.color, bg));
    ctx.textBaseline = 'alphabetic';
    const [ox, oy] = this.textOrigin(t, L);
    let lastFont = '', lastFill = '';
    for (let i = 0; i < L.lines.length; i++) {
      const line = L.lines[i];
      const lx = ox + this.lineShift(t, L, i);
      const ly = oy - L.ys[i];
      for (const p of line.pieces) {
        if (p.font !== lastFont) { ctx.font = p.font; lastFont = p.font; }
        const fill = p.c === null || p.c === undefined ? base : rgbCss(this.resolveColor(p.c, bg));
        if (fill !== lastFill) { ctx.fillStyle = fill; lastFill = fill; }
        ctx.fillText(p.t, (lx + p.x) / k, -ly / k);
      }
    }
    ctx.restore();
  }

  // Origin (left end of first baseline) in text-height units, relative to the anchor.
  textOrigin(t, L) {
    if (t.mode === 'mtext') {
      const att = t.attach || 1;
      const col = (att - 1) % 3, row = Math.floor((att - 1) / 3);
      const first = Math.max(L.lines[0] ? L.lines[0].h : 1, 1);
      const height = L.total;
      let y;
      if (row === 0) y = -first;
      else if (row === 1) y = height / 2 - first;
      else y = L.ys[L.ys.length - 1];
      // horizontal alignment handled per line by lineShift
      void col;
      return [0, y];
    }
    if (t.ha === 3 || t.ha === 5) return [0, 0];
    const w = L.widths[0] || 0;
    let x = 0;
    if (t.ha === 1 || t.ha === 4) x = -w / 2;
    else if (t.ha === 2) x = -w;
    let y = 0;
    if (t.ha === 4 && t.va === 0) y = -0.5;
    else if (t.va === 1) y = 0.3;
    else if (t.va === 2) y = -0.5;
    else if (t.va === 3) y = -1;
    return [x, y];
  }

  lineShift(t, L, i) {
    if (t.mode !== 'mtext') return 0;
    const col = ((t.attach || 1) - 1) % 3;
    const w = L.widths[i] || 0;
    if (col === 1) return -w / 2;
    if (col === 2) return -w;
    return 0;
  }

  // Render the current view into an offscreen canvas (for PNG / PDF export).
  snapshot(scaleFactor = 2, withOverlay = true) {
    const c = document.createElement('canvas');
    c.width = Math.round(this.width * scaleFactor);
    c.height = Math.round(this.height * scaleFactor);
    const ctx = c.getContext('2d', { alpha: false });
    const savedOverlay = this.overlay;
    if (!withOverlay) this.overlay = null;
    this.render({ ctx, width: this.width, height: this.height, dpr: scaleFactor });
    this.overlay = savedOverlay;
    return c;
  }
}

export { rgbCss, luminance };
