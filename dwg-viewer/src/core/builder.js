// Builds a render-ready display list from a normalised document.
//
// Everything is flattened to world-space polylines, filled polygons, text
// runs, points and infinite lines, grouped into batches that share layer,
// colour, lineweight, line pattern and draw-order stage.

import { aciToRgb } from './aci.js';
import {
  IDENTITY, mul, translate, scale, rotateZ, withOcs, apply, xyScale, isMirrored,
  arcPoints, ellipsePoints, bulgePoints, nurbsPoints, fitPoints, cubicFitPoints, normAngle, setTolerance, setScale, segCount,
} from './geom.js';
import { plainText, mtextLines, mtextRuns, runsArePlain, repairByteSwapped } from './text.js';

const MAX_DEPTH = 24;
const MAX_STAGES = 48;
const MAX_HATCH_SEGMENTS = 250000;
const MAX_SNAPS = 1500000;

const KIND_LINE = 0;
const KIND_FILL = 1;
const KIND_MASK = 2;
const KIND_WIDE = 3;

export const SNAP = { END: 0, MID: 1, CENTER: 2, NODE: 3, QUAD: 4, INSERT: 5 };

function pt(p) { return p || { x: 0, y: 0, z: 0 }; }

class Space {
  constructor(name) {
    this.name = name;
    this.batches = new Map();
    this.texts = [];
    this.points = [];
    this.rays = [];
    this.snaps = [];
    this.viewports = [];
    this.stage = 0;
    this.stageDirty = false;
    this.minX = Infinity; this.minY = Infinity; this.maxX = -Infinity; this.maxY = -Infinity;
    this.count = 0;
  }

  grow(x, y) {
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }

  batch(kind, st, extra = '') {
    const stage = kind === KIND_MASK ? this.stage : this.stage;
    const key = `${stage}|${kind}|${st.layer}|${st.gate}|${st.color}|${st.lw}|${st.dashKey}|${extra}`;
    let b = this.batches.get(key);
    if (!b) {
      b = { kind, stage, layer: st.layer, gate: st.gate, color: st.color, lw: st.lw, dash: kind === KIND_LINE ? st.dash : null, width: 0, alpha: 1, data: [] };
      this.batches.set(key, b);
    }
    if (kind !== KIND_MASK) this.stageDirty = true;
    return b;
  }

  newMaskStage() {
    if (this.stageDirty && this.stage < MAX_STAGES) { this.stage++; this.stageDirty = false; }
  }

  snap(x, y, kind) {
    if (this.snaps.length < MAX_SNAPS * 3) this.snaps.push(x, y, kind);
  }
}

export class Builder {
  constructor(doc, opts = {}) {
    this.doc = doc;
    this.opts = opts;
    this.warnings = new Map();
    this.counts = {};
    this.layerIndex = new Map();
    this.layers = doc.layers.map((l, i) => { this.layerIndex.set(l.name, i); return { ...l }; });
    if (!this.layerIndex.has('0')) this.addLayer('0');
    const h = doc.header || {};
    this.ltscale = num(h.LTSCALE, 1) || 1;
    this.celtscale = 1;
    this.pdmode = num(h.PDMODE, 0);
    this.pdsize = num(h.PDSIZE, 0);
    const dimscale = num(h.DIMSCALE, 1) || 1;
    this.dimasz = (num(h.DIMASZ, 2.5) || 2.5) * dimscale;
    this.dimtxt = (num(h.DIMTXT, 2.5) || 2.5) * dimscale;
  }

  addLayer(name) {
    const idx = this.layers.length;
    this.layers.push({ name, color: -1, aci: 7, frozen: false, off: false, ltype: 'Continuous', lw: -3, plot: true });
    this.layerIndex.set(name, idx);
    return idx;
  }

  warn(type) { this.warnings.set(type, (this.warnings.get(type) || 0) + 1); }

  // ---- style resolution --------------------------------------------------

  style(e, ctx) {
    let lname = e.layer ?? '0';
    if (lname === '0' && ctx.layerName != null) lname = ctx.layerName;
    let layer = this.layerIndex.get(lname);
    if (layer === undefined) layer = this.addLayer(lname);
    const L = this.layers[layer];

    let color;
    const ci = e.colorIndex;
    if (typeof e.color === 'number' && e.color >= 0 && ci !== 256 && ci !== 0) color = e.color & 0xffffff;
    else if (ci === 0) color = ctx.color;
    else if (ci === undefined || ci === null || ci === 256 || ci > 256 || ci < 0) color = L.color;
    else color = aciToRgb(ci);
    if (color === undefined || color === null) color = -1;

    let lt = e.lineType;
    if (!lt || /^bylayer$/i.test(lt)) lt = L.ltype;
    else if (/^byblock$/i.test(lt)) lt = ctx.ltype || 'Continuous';

    let lw = e.lineweight;
    if (lw === undefined || lw === null || lw === -1) lw = L.lw;
    else if (lw === -2) lw = ctx.lw;
    if (lw === undefined || lw === null || lw < 0) lw = -3;

    const ltScale = (e.lineTypeScale || 1) * ctx.ltScale;
    let dash = null;
    let dashKey = '';
    const def = lt ? this.doc.ltypes.get(String(lt).toLowerCase()) : null;
    if (def && def.pattern.length >= 2) {
      const s = this.ltscale * ltScale * xyScale(ctx.M);
      dash = canvasDash(def.pattern, s);
      if (dash) dashKey = dash.map((v) => v.toPrecision(6)).join(',');
    }
    return { layer, layerName: lname, gate: ctx.gate, color, lw, dash, dashKey, ltypeName: lt, ltScale };
  }

  // ---- emitters ------------------------------------------------------------

  emitPolyline(space, st, M, pts, closed) {
    const n = pts.length / 3;
    if (n < 2) return;
    if (!finitePts(pts)) { this.warn('invalid geometry'); return; }
    const b = space.batch(KIND_LINE, st);
    const d = b.data;
    d.push(closed ? n + 1 : n);
    for (let i = 0; i < pts.length; i += 3) {
      const [x, y] = apply(M, pts[i], pts[i + 1], pts[i + 2]);
      d.push(x, y);
      space.grow(x, y);
    }
    if (closed) { d.push(d[d.length - 2 * n], d[d.length - 2 * n + 1]); }
    space.count++;
  }

  emitWide(space, st, M, pts, closed, width) {
    const n = pts.length / 3;
    if (n < 2) return;
    if (!finitePts(pts) || !(width < 1e12)) { this.warn('invalid geometry'); return; }
    const w = width * xyScale(M);
    const b = space.batch(KIND_WIDE, { ...st, dashKey: '' }, w.toPrecision(6));
    b.width = w;
    const d = b.data;
    d.push(closed ? n + 1 : n);
    for (let i = 0; i < pts.length; i += 3) {
      const [x, y] = apply(M, pts[i], pts[i + 1], pts[i + 2]);
      d.push(x, y);
      space.grow(x, y);
    }
    if (closed) { d.push(d[d.length - 2 * n], d[d.length - 2 * n + 1]); }
  }

  emitFill(space, st, M, rings, kind = KIND_FILL, alpha = 1) {
    const good = rings.filter((r) => r.length >= 9 && finitePts(r));
    if (!good.length) return;
    const b = space.batch(kind, { ...st, dashKey: '' }, alpha === 1 ? '' : 'a' + alpha);
    b.alpha = alpha;
    const d = b.data;
    d.push(good.length);
    for (const r of good) {
      d.push(r.length / 3);
      for (let i = 0; i < r.length; i += 3) {
        const [x, y] = apply(M, r[i], r[i + 1], r[i + 2]);
        d.push(x, y);
        space.grow(x, y);
      }
    }
    space.count++;
  }

  emitSegments(space, st, M, segs) {
    // segs: flat local [x0,y0,x1,y1,...] (z=0)
    if (!segs.length) return;
    const b = space.batch(KIND_LINE, { ...st, dash: null, dashKey: '' });
    const d = b.data;
    for (let i = 0; i < segs.length; i += 4) {
      const [x0, y0] = apply(M, segs[i], segs[i + 1], 0);
      const [x1, y1] = apply(M, segs[i + 2], segs[i + 3], 0);
      d.push(2, x0, y0, x1, y1);
      space.grow(x0, y0); space.grow(x1, y1);
    }
  }

  snapAt(space, M, x, y, z, kind) {
    const [wx, wy] = apply(M, x, y, z || 0);
    space.snap(wx, wy, kind);
  }

  // Text run. origin/xdir/ydir are local; X/Y become world vectors per unit text height.
  emitText(space, st, M, t) {
    if (!(Math.abs(t.x) < LIMIT && Math.abs(t.y) < LIMIT && t.height < LIMIT)) { this.warn('invalid geometry'); return; }
    const lines = t.lines.filter((l, i) => l.length || i < t.lines.length - 1);
    if (!lines.length || !(t.height > 0)) return;
    if (lines.length === 1 && !lines[0].trim()) return;
    const [ox, oy] = apply(M, t.x, t.y, t.z || 0);
    const cos = Math.cos(t.rotation || 0), sin = Math.sin(t.rotation || 0);
    let ux = cos, uy = sin, vx = -sin, vy = cos;
    if (t.dir) { const l = Math.hypot(t.dir.x, t.dir.y) || 1; ux = t.dir.x / l; uy = t.dir.y / l; vx = -uy; vy = ux; }
    if (t.oblique) { const k = Math.tan(t.oblique); vx += ux * k; vy += uy * k; }
    const h = t.height, wf = t.widthFactor || 1;
    const lin = (a, b) => { // linear part of M applied to (a,b,0) with OCS already in M
      const p = apply(M, a, b, 0), o = apply(M, 0, 0, 0);
      return [p[0] - o[0], p[1] - o[1]];
    };
    let X = lin(ux * h * wf, uy * h * wf);
    let Y = lin(vx * h, vy * h);
    if (t.mirrorX) X = [-X[0], -X[1]];
    if (t.mirrorY) Y = [-Y[0], -Y[1]];
    const item = {
      stage: space.stage, layer: st.layer, gate: st.gate, color: st.color,
      o: [ox, oy], X, Y, lines,
      mode: t.mode, ha: t.ha || 0, va: t.va || 0, attach: t.attach || 7,
      wrap: t.wrap || 0, spacing: t.spacing || 5 / 3, font: t.font || '', bold: !!t.bold, italic: !!t.italic,
    };
    if (t.runs) {
      // resolve run colours now (ACI -> rgb); null keeps the entity colour
      item.runs = t.runs.map((line) => line.map((r) => ({
        t: r.t, h: r.h, b: r.b, i: r.i,
        c: r.c === null ? null : typeof r.c === 'number' ? aciToRgb(r.c) : parseInt(r.c.slice(1), 16),
      })));
    }
    if (t.p2) { const [x2, y2] = apply(M, t.p2.x, t.p2.y, t.z || 0); item.p2 = [x2, y2]; }
    // rough world bbox for culling and extents
    const maxLen = Math.max(...lines.map((l) => l.length), 1);
    const w = item.wrap > 0 ? Math.min(item.wrap, maxLen * 0.75) : maxLen * 0.75;
    const hh = lines.length * item.spacing + 1;
    const corners = [[-w, -hh], [w, -hh], [-w, hh], [w, hh]];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [a, b] of corners) {
      const x = ox + X[0] * a + Y[0] * b, y = oy + X[1] * a + Y[1] * b;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (item.p2) { x0 = Math.min(x0, item.p2[0]); x1 = Math.max(x1, item.p2[0]); y0 = Math.min(y0, item.p2[1]); y1 = Math.max(y1, item.p2[1]); }
    item.bbox = [x0, y0, x1, y1];
    space.grow(ox, oy);
    space.texts.push(item);
    space.snap(ox, oy, SNAP.INSERT);
    space.count++;
  }

  // ---- entities --------------------------------------------------------------

  entities(space, list, ctx) {
    for (const e of list) {
      try { this.entity(space, e, ctx); } catch (err) { this.warn('error:' + (e && e.type)); if (this.opts.debug) console.error(err); }
    }
  }

  entity(space, e, ctx) {
    if (!e || e.isVisible === false) return;
    const type = e.type;
    this.counts[type] = (this.counts[type] || 0) + 1;
    const M = ctx.M;
    setScale(xyScale(M));
    switch (type) {
      case 'LINE': {
        const st = this.style(e, ctx);
        const a = pt(e.startPoint), b = pt(e.endPoint);
        const Mo = withOcs(M, null);
        this.emitPolyline(space, st, Mo, [a.x, a.y, a.z || 0, b.x, b.y, b.z || 0], false);
        this.snapAt(space, Mo, a.x, a.y, a.z, SNAP.END);
        this.snapAt(space, Mo, b.x, b.y, b.z, SNAP.END);
        this.snapAt(space, Mo, (a.x + b.x) / 2, (a.y + b.y) / 2, ((a.z || 0) + (b.z || 0)) / 2, SNAP.MID);
        break;
      }
      case 'CIRCLE':
      case 'ARC': {
        const st = this.style(e, ctx);
        const Mo = withOcs(M, e.extrusionDirection);
        const c = pt(e.center), r = e.radius || 0;
        if (!(r > 0)) break;
        const full = type === 'CIRCLE';
        const a0 = full ? 0 : e.startAngle || 0, a1 = full ? Math.PI * 2 : e.endAngle || 0;
        const pts = arcPoints([], c.x, c.y, r, a0, full ? a0 + Math.PI * 2 - 1e-12 : a1, c.z || 0);
        this.emitPolyline(space, st, Mo, pts, full);
        this.snapAt(space, Mo, c.x, c.y, c.z, SNAP.CENTER);
        if (full) {
          for (let q = 0; q < 4; q++) this.snapAt(space, Mo, c.x + r * Math.cos(q * Math.PI / 2), c.y + r * Math.sin(q * Math.PI / 2), c.z, SNAP.QUAD);
        } else {
          this.snapAt(space, Mo, pts[0], pts[1], pts[2], SNAP.END);
          this.snapAt(space, Mo, pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1], SNAP.END);
          const am = a0 + normAngle(a1 - a0) / 2;
          this.snapAt(space, Mo, c.x + r * Math.cos(am), c.y + r * Math.sin(am), c.z, SNAP.MID);
        }
        if (e.thickness) this.warn('thickness');
        break;
      }
      case 'ELLIPSE': {
        const st = this.style(e, ctx);
        // ellipses are defined in WCS: minor axis = (N x major) * ratio
        const c = pt(e.center), m = pt(e.majorAxisEndPoint);
        const ratio = e.axisRatio || 1;
        let n = e.extrusionDirection || { x: 0, y: 0, z: 1 };
        let nl = Math.hypot(n.x || 0, n.y || 0, n.z ?? 1);
        if (nl < 1e-12) { n = { x: 0, y: 0, z: 1 }; nl = 1; }
        const nx = (n.x || 0) / nl, ny = (n.y || 0) / nl, nz = (n.z ?? 1) / nl;
        const mx = m.x, my = m.y, mz = m.z || 0;
        const ix = (ny * mz - nz * my) * ratio, iy = (nz * mx - nx * mz) * ratio, iz = (nx * my - ny * mx) * ratio;
        const p0 = e.startAngle || 0;
        let sweep = (e.endAngle ?? Math.PI * 2) - p0;
        const full = Math.abs(sweep) < 1e-9 || Math.abs(Math.abs(sweep) - Math.PI * 2) < 1e-9;
        sweep = full ? Math.PI * 2 : normAngle(sweep);
        const cnt = segCount(sweep, 16, Math.hypot(mx, my, mz));
        const pts = [];
        for (let i = 0; i <= cnt; i++) {
          const t = p0 + (sweep * i) / cnt, ct = Math.cos(t), sn = Math.sin(t);
          pts.push(c.x + mx * ct + ix * sn, c.y + my * ct + iy * sn, (c.z || 0) + mz * ct + iz * sn);
        }
        this.emitPolyline(space, st, M, pts, false);
        this.snapAt(space, M, c.x, c.y, c.z, SNAP.CENTER);
        if (!full) {
          this.snapAt(space, M, pts[0], pts[1], pts[2], SNAP.END);
          this.snapAt(space, M, pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1], SNAP.END);
        } else {
          for (const k of [1, -1]) {
            this.snapAt(space, M, c.x + k * mx, c.y + k * my, (c.z || 0) + k * mz, SNAP.QUAD);
            this.snapAt(space, M, c.x + k * ix, c.y + k * iy, (c.z || 0) + k * iz, SNAP.QUAD);
          }
        }
        break;
      }
      case 'LWPOLYLINE':
        this.lwpolyline(space, e, ctx);
        break;
      case 'POLYLINE':
      case 'POLYLINE2D':
      case 'POLYLINE3D':
        this.polyline(space, e, ctx);
        break;
      case 'SPLINE': {
        const st = this.style(e, ctx);
        const pts = [];
        const cps = e.controlPoints || [];
        const fps = e.fitPoints || [];
        const same = (a, b) => a && b && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 && Math.abs((a.z || 0) - (b.z || 0)) < 1e-9;
        if (cps.length >= 2) {
          nurbsPoints(pts, e.degree || 3, cps, e.knots, e.weights);
        } else if (fps.length >= 2) {
          // closed fit-point splines repeat their first point
          if (same(fps[0], fps[fps.length - 1]) && fps.length > 3) fitPoints(pts, fps.slice(0, -1), true), pts.push(pts[0], pts[1], pts[2]);
          else cubicFitPoints(pts, fps, e.startTangent, e.endTangent);
        }
        if (pts.length >= 6) {
          this.emitPolyline(space, st, M, pts, false);
          this.snapAt(space, M, pts[0], pts[1], pts[2], SNAP.END);
          this.snapAt(space, M, pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1], SNAP.END);
        }
        break;
      }
      case 'POINT': {
        const st = this.style(e, ctx);
        const p = pt(e.position);
        const [x, y] = apply(withOcs(M, null), p.x, p.y, p.z || 0);
        if (!(Math.abs(x) < LIMIT && Math.abs(y) < LIMIT)) break;
        space.points.push(x, y, st.layer, st.gate, st.color, space.stage);
        space.grow(x, y);
        space.snap(x, y, SNAP.NODE);
        break;
      }
      case 'SOLID':
      case 'TRACE': {
        const st = this.style(e, ctx);
        const Mo = withOcs(M, e.extrusionDirection);
        const c1 = pt(e.corner1), c2 = pt(e.corner2), c3 = pt(e.corner3), c4 = e.corner4 || e.corner3;
        const ring = [c1.x, c1.y, 0, c2.x, c2.y, 0, c4.x, c4.y, 0, c3.x, c3.y, 0];
        this.emitFill(space, st, Mo, [ring]);
        break;
      }
      case '3DFACE': {
        const st = this.style(e, ctx);
        const c = [pt(e.corner1), pt(e.corner2), pt(e.corner3), pt(e.corner4 || e.corner3)];
        const flags = e.flag || 0;
        for (let i = 0; i < 4; i++) {
          if (flags & (1 << i)) continue;
          const a = c[i], b = c[(i + 1) % 4];
          if (a.x === b.x && a.y === b.y && (a.z || 0) === (b.z || 0)) continue;
          this.emitPolyline(space, st, M, [a.x, a.y, a.z || 0, b.x, b.y, b.z || 0], false);
        }
        break;
      }
      case 'XLINE':
      case 'RAY': {
        const st = this.style(e, ctx);
        const p = pt(e.firstPoint), d = pt(e.unitDirection);
        const [x, y] = apply(M, p.x, p.y, p.z || 0);
        const [x2, y2] = apply(M, p.x + d.x, p.y + d.y, (p.z || 0) + (d.z || 0));
        if (!(Math.abs(x) < LIMIT && Math.abs(y) < LIMIT && isFinite(x2) && isFinite(y2))) break;
        space.rays.push({ stage: space.stage, layer: st.layer, gate: st.gate, color: st.color, x, y, dx: x2 - x, dy: y2 - y, ray: type === 'RAY', dash: st.dash });
        break;
      }
      case 'TEXT':
        this.text(space, e, ctx);
        break;
      case 'ATTDEF':
        // attribute definitions are only displayed outside of block definitions
        if (ctx.depth === 0 || ((e.flags || 0) & 2)) this.attribText(space, e, ctx, true);
        break;
      case 'ATTRIB':
        if (!((e.flags || 0) & 1)) this.attribText(space, e, ctx, false);
        break;
      case 'MTEXT':
        this.mtext(space, e, ctx);
        break;
      case 'INSERT':
        this.insert(space, e, ctx);
        break;
      case 'DIMENSION':
      case 'ARC_DIMENSION':
      case 'LARGE_RADIAL_DIMENSION':
        this.dimension(space, e, ctx);
        break;
      case 'ACAD_TABLE':
      case 'TABLE':
        this.table(space, e, ctx);
        break;
      case 'HATCH':
        this.hatch(space, e, ctx);
        break;
      case 'LEADER':
        this.leader(space, e, ctx);
        break;
      case 'MULTILEADER':
      case 'MLEADER':
        this.mleader(space, e, ctx);
        break;
      case 'MLINE':
        this.mline(space, e, ctx);
        break;
      case 'WIPEOUT':
        this.wipeout(space, e, ctx, true);
        break;
      case 'IMAGE':
        this.wipeout(space, e, ctx, false);
        break;
      case 'TOLERANCE': {
        const st = this.style(e, ctx);
        const p = pt(e.insertionPoint);
        const dir = e.xAxisDirection || { x: 1, y: 0 };
        const raw = String(e.text || '').replace(/%%v/gi, ' | ').replace(/\{\\F[^;]*;[^}]*\}/g, '');
        this.emitText(space, st, withOcs(M, e.extrusionDirection), { x: p.x, y: p.y, z: p.z, height: this.dimtxt, lines: mtextLines(raw), dir, mode: 'mtext', attach: 4 });
        break;
      }
      case 'VIEWPORT':
        this.viewport(space, e, ctx);
        break;
      case 'SHAPE':
      case 'ARCALIGNEDTEXT':
        this.warn(type);
        break;
      case '3DSOLID':
      case 'REGION':
      case 'BODY':
      case 'SURFACE':
      case 'MESH':
      case 'OLE2FRAME':
      case 'OLEFRAME':
      case 'ACAD_PROXY_ENTITY':
      case 'LIGHT':
      case 'SECTION':
      case 'SUN':
        this.warn(type);
        break;
      default:
        this.warn(type);
    }
  }

  lwpolyline(space, e, ctx) {
    const st = this.style(e, ctx);
    const M = withOcs(ctx.M, e.extrusionDirection);
    const v = e.vertices || [];
    if (!v.length) return;
    const z = e.elevation || 0;
    const closed = !!((e.flag || 0) & 1);
    const cw = e.constantWidth || 0;
    let varying = false;
    for (const p of v) if ((p.startWidth || 0) > 0 || (p.endWidth || 0) > 0) { varying = true; break; }
    const nseg = closed ? v.length : v.length - 1;

    if (!varying) {
      const pts = [v[0].x, v[0].y, z];
      for (let i = 0; i < nseg; i++) {
        const a = v[i], b = v[(i + 1) % v.length];
        bulgePoints(pts, a.x, a.y, b.x, b.y, a.bulge || 0, z);
      }
      if (v.length === 1) pts.push(v[0].x, v[0].y, z);
      if (cw > 0) this.emitWide(space, st, M, pts, false, cw);
      else this.emitPolyline(space, st, M, pts, false);
    } else {
      for (let i = 0; i < nseg; i++) {
        const a = v[i], b = v[(i + 1) % v.length];
        const w0 = a.startWidth || 0, w1 = a.endWidth || 0;
        const pts = [a.x, a.y, z];
        bulgePoints(pts, a.x, a.y, b.x, b.y, a.bulge || 0, z);
        if (Math.abs(w0 - w1) < 1e-12) {
          if (w0 > 0) this.emitWide(space, st, M, pts, false, w0);
          else this.emitPolyline(space, st, M, pts, false);
        } else {
          this.taperedFill(space, st, M, pts, w0, w1);
        }
      }
    }
    for (let i = 0; i < v.length; i++) {
      this.snapAt(space, M, v[i].x, v[i].y, z, SNAP.END);
      if (i < nseg && !(v[i].bulge)) {
        const b = v[(i + 1) % v.length];
        this.snapAt(space, M, (v[i].x + b.x) / 2, (v[i].y + b.y) / 2, z, SNAP.MID);
      }
    }
  }

  // Polygon for a polyline segment whose width changes along its length (arrows).
  taperedFill(space, st, M, pts, w0, w1) {
    const n = pts.length / 3;
    let total = 0;
    const len = [0];
    for (let i = 1; i < n; i++) { total += Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2]); len.push(total); }
    if (total <= 0) return;
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      const j0 = Math.max(0, i - 1), j1 = Math.min(n - 1, i + 1);
      let dx = pts[j1 * 3] - pts[j0 * 3], dy = pts[j1 * 3 + 1] - pts[j0 * 3 + 1];
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const w = (w0 + ((w1 - w0) * len[i]) / total) / 2;
      left.push(pts[i * 3] - dy * w, pts[i * 3 + 1] + dx * w, pts[i * 3 + 2]);
      right.push(pts[i * 3] + dy * w, pts[i * 3 + 1] - dx * w, pts[i * 3 + 2]);
    }
    const ring = left.slice();
    for (let i = n - 1; i >= 0; i--) ring.push(right[i * 3], right[i * 3 + 1], right[i * 3 + 2]);
    this.emitFill(space, st, M, [ring]);
  }

  polyline(space, e, ctx) {
    const st = this.style(e, ctx);
    const flag = e.flag || 0;
    const is3d = e.type === 'POLYLINE3D' || !!(flag & 8);
    const M = is3d ? ctx.M : withOcs(ctx.M, e.extrusionDirection);
    let verts = (e.vertices || []).filter((v) => v);
    if (flag & 64) { // polyface mesh
      const pv = verts.filter((v) => (v.flag & 64) || !(v.flag & 128) && v.polyfaceIndex0 === undefined && !v.faces);
      const faces = verts.filter((v) => (v.flag & 128) && !(v.flag & 64) || v.faces);
      const pos = pv.length ? pv : verts.filter((v) => !(v.flag & 128));
      for (const f of faces) {
        const idx = f.faces || [f.polyfaceIndex0, f.polyfaceIndex1, f.polyfaceIndex2, f.polyfaceIndex3];
        const ids = idx.filter((k) => k);
        for (let i = 0; i < ids.length; i++) {
          const a = ids[i], b = ids[(i + 1) % ids.length];
          if (a < 0) continue; // invisible edge
          const A = pos[Math.abs(a) - 1], B = pos[Math.abs(b) - 1];
          if (!A || !B) continue;
          this.emitPolyline(space, st, M, [A.x, A.y, A.z || 0, B.x, B.y, B.z || 0], false);
        }
      }
      return;
    }
    if (flag & 16) { // polygon mesh M x N
      const m = e.meshMVertexCount || 0, n = e.meshNVertexCount || 0;
      if (m * n === verts.length && m > 0) {
        for (let i = 0; i < m; i++) {
          const row = [];
          for (let j = 0; j < n; j++) { const p = verts[i * n + j]; row.push(p.x, p.y, p.z || 0); }
          this.emitPolyline(space, st, M, row, !!(flag & 32));
        }
        for (let j = 0; j < n; j++) {
          const col = [];
          for (let i = 0; i < m; i++) { const p = verts[i * n + j]; col.push(p.x, p.y, p.z || 0); }
          this.emitPolyline(space, st, M, col, !!(flag & 1));
        }
        return;
      }
    }
    // spline/curve fit: drop the frame control points when fitted vertices exist
    if (verts.some((v) => v.flag & 8)) verts = verts.filter((v) => !(v.flag & 16));
    if (!verts.length) return;
    const closed = !!(flag & 1);
    const z = is3d ? 0 : (e.elevation || verts[0].z || 0);
    const pts = [verts[0].x, verts[0].y, is3d ? verts[0].z || 0 : z];
    const nseg = closed ? verts.length : verts.length - 1;
    let varying = false;
    for (const v of verts) if ((v.startWidth || 0) !== (v.endWidth || 0)) { varying = true; break; }
    const cw = (!varying && (verts[0].startWidth || e.startWidth || 0)) || 0;
    for (let i = 0; i < nseg; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      if (is3d) pts.push(b.x, b.y, b.z || 0);
      else bulgePoints(pts, a.x, a.y, b.x, b.y, a.bulge || 0, z);
    }
    if (varying && !is3d) {
      for (let i = 0; i < nseg; i++) {
        const a = verts[i], b = verts[(i + 1) % verts.length];
        const seg = [a.x, a.y, z];
        bulgePoints(seg, a.x, a.y, b.x, b.y, a.bulge || 0, z);
        const w0 = a.startWidth || 0, w1 = a.endWidth || 0;
        if (w0 === w1) { if (w0 > 0) this.emitWide(space, st, M, seg, false, w0); else this.emitPolyline(space, st, M, seg, false); }
        else this.taperedFill(space, st, M, seg, w0, w1);
      }
    } else if (cw > 0) this.emitWide(space, st, M, pts, false, cw);
    else this.emitPolyline(space, st, M, pts, false);
    for (const v of verts) this.snapAt(space, M, v.x, v.y, is3d ? v.z : z, SNAP.END);
  }

  textFont(styleName) {
    const s = this.doc.styles.get(String(styleName || 'standard').toLowerCase());
    if (!s) return { font: '', widthFactor: 1, oblique: 0, fixedHeight: 0 };
    return { font: s.extendedFont || s.font || '', widthFactor: s.widthFactor || 1, oblique: s.oblique || 0, fixedHeight: s.fixedHeight || 0 };
  }

  textCommon(space, st, M, t, raw) {
    const style = this.textFont(t.styleName);
    let height = t.textHeight || style.fixedHeight || 2.5;
    const ha = t.halign || 0, va = t.valign || 0;
    const sp = pt(t.startPoint);
    const ap = t.endPoint && (ha !== 0 || va !== 0) ? t.endPoint : null;
    const anchor = ap || sp;
    const flags = t.generationFlag || 0;
    const item = {
      x: anchor.x, y: anchor.y, z: anchor.z || 0,
      height, rotation: t.rotation || 0, widthFactor: (t.xScale || style.widthFactor || 1),
      oblique: t.obliqueAngle || style.oblique || 0,
      lines: [plainText(raw)], mode: 'text', ha, va, font: style.font,
      mirrorX: !!(flags & 2), mirrorY: !!(flags & 4),
    };
    if ((ha === 3 || ha === 5) && ap) {
      item.x = sp.x; item.y = sp.y; item.p2 = ap; item.va = 0;
    }
    this.emitText(space, st, M, item);
  }

  text(space, e, ctx) {
    const st = this.style(e, ctx);
    const M = withOcs(ctx.M, e.extrusionDirection);
    this.textCommon(space, st, M, e, e.text);
  }

  attribText(space, e, ctx, isDef) {
    const st = this.style(e, ctx);
    const t = e.text && typeof e.text === 'object' ? e.text : e;
    if (e.mtext && e.mtext.text && (e.mtextFlag & 2)) {
      this.mtext(space, { ...e.mtext, layer: e.layer, colorIndex: e.colorIndex, color: e.color }, ctx);
      return;
    }
    const raw = isDef ? (e.tag || t.text || '') : (t.text ?? '');
    const M = withOcs(ctx.M, t.extrusionDirection);
    this.textCommon(space, st, M, t, raw);
  }

  mtext(space, e, ctx) {
    const st = this.style(e, ctx);
    const style = this.textFont(e.styleName);
    const ip = pt(e.insertionPoint);
    const h = e.textHeight || style.fixedHeight || 2.5;
    let dir = e.direction;
    if (dir && Math.hypot(dir.x || 0, dir.y || 0) < 1e-9) dir = null;
    // direction vector is in WCS, the rest in OCS
    const M = dir ? ctx.M : withOcs(ctx.M, e.extrusionDirection);
    const lines = mtextLines(e.text);
    const runs = mtextRuns(e.text, h);
    const bold = /\\f[^;|]*\|b1/i.test(e.text || '');
    const item = {
      x: ip.x, y: ip.y, z: ip.z || 0, height: h, rotation: dir ? 0 : e.rotation || 0, dir,
      widthFactor: 1, lines, mode: 'mtext', attach: e.attachmentPoint || 1,
      wrap: e.rectWidth > 0 ? e.rectWidth / h : 0, spacing: (5 / 3) * (e.lineSpacing || 1),
      font: style.font, bold, runs: runsArePlain(runs) ? null : runs,
    };
    if (e.backgroundFill & 1 || e.backgroundFill & 2) {
      // background mask: emitted as a filled box behind the text
      space.newMaskStage();
      const w = (e.extentsWidth || e.rectWidth || h * 10) * (e.fillBoxScale || 1.5);
      const hh = (e.extentsHeight || h * lines.length * item.spacing) * (e.fillBoxScale || 1.5);
      const [ax, ay] = attachOffset(item.attach, w, hh);
      const cos = Math.cos(item.rotation), sin = Math.sin(item.rotation);
      const box = [];
      const mx = (w - (e.extentsWidth || e.rectWidth || h * 10)) / 2, my = (hh - (e.extentsHeight || h * lines.length * item.spacing)) / 2;
      for (const [a, b] of [[0, 0], [w, 0], [w, hh], [0, hh]]) {
        const lx = a + ax - mx, ly = b + ay - my;
        box.push(ip.x + lx * cos - ly * sin, ip.y + lx * sin + ly * cos, ip.z || 0);
      }
      const maskColor = (e.backgroundFill & 2) ? -2 : (typeof e.backgroundFillColor === 'number' && e.backgroundFillColor > 0 && e.backgroundFillColor < 256 ? aciToRgb(e.backgroundFillColor) : -2);
      this.emitFill(space, { ...st, color: maskColor }, M, [box], KIND_MASK);
    }
    this.emitText(space, st, M, item);
  }

  blockByName(name) {
    if (!name) return null;
    return this.doc.blocks.get(name) || this.doc.blocks.get(String(name).toUpperCase()) || null;
  }

  insert(space, e, ctx) {
    const st = this.style(e, ctx);
    const blk = this.blockByName(e.name);
    if (blk && !(blk.flags & 4) && ctx.depth < MAX_DEPTH && !ctx.stack.has(blk)) {
      const sx = e.xScale ?? 1, sy = e.yScale ?? 1, sz = e.zScale ?? 1;
      const base = pt(blk.base);
      const ip = pt(e.insertionPoint);
      const cols = Math.max(1, e.columnCount || 1), rows = Math.max(1, e.rowCount || 1);
      const Mo = withOcs(ctx.M, e.extrusionDirection);
      const layerFrozen = this.layers[st.layer].frozen;
      const gate = layerFrozen ? (ctx.gate ? ctx.gate + ',' + st.layer : String(st.layer)) : ctx.gate;
      const stack = new Set(ctx.stack); stack.add(blk);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let B = mul(Mo, translate(ip.x, ip.y, ip.z || 0));
          B = mul(B, rotateZ(e.rotation || 0));
          if (cols > 1 || rows > 1) B = mul(B, translate(c * (e.columnSpacing || 0), r * (e.rowSpacing || 0), 0));
          B = mul(B, scale(sx, sy, sz));
          B = mul(B, translate(-base.x, -base.y, -(base.z || 0)));
          const child = {
            M: B, depth: ctx.depth + 1, stack, gate,
            layerName: st.layerName, color: st.color, ltype: st.ltypeName, lw: st.lw,
            ltScale: ctx.ltScale * (e.lineTypeScale || 1),
          };
          this.entities(space, blk.entities, child);
        }
      }
      space.snap(...apply(Mo, ip.x, ip.y, ip.z || 0), SNAP.INSERT);
    } else if (!blk) {
      this.warn('missing block');
    } else if (blk.flags & 4) {
      this.warn('xref');
    }
    if (Array.isArray(e.attribs)) {
      for (const a of e.attribs) {
        try { this.entity(space, { ...a, colorIndex: a.colorIndex }, { ...ctx, layerName: ctx.layerName, color: st.color, ltype: st.ltypeName, lw: st.lw }); } catch { this.warn('attrib'); }
      }
    }
  }

  dimension(space, e, ctx) {
    const st = this.style(e, ctx);
    const blk = this.blockByName(e.name);
    if (blk && ctx.depth < MAX_DEPTH) {
      const base = pt(blk.base);
      const child = {
        M: mul(ctx.M, translate(-base.x, -base.y, -(base.z || 0))), depth: ctx.depth + 1, stack: ctx.stack, gate: ctx.gate,
        layerName: st.layerName, color: st.color, ltype: st.ltypeName, lw: st.lw, ltScale: ctx.ltScale,
      };
      this.entities(space, blk.entities, child);
    } else {
      // no geometry block: draw definition line and measurement
      this.warn('dimension without block');
      const p1 = e.subDefinitionPoint1, p2 = e.subDefinitionPoint2;
      if (p1 && p2) this.emitPolyline(space, st, ctx.M, [p1.x, p1.y, 0, p2.x, p2.y, 0], false);
      const tp = e.textPoint;
      if (tp && (e.measurement || e.text)) {
        const txt = e.text && e.text !== '<>' ? e.text.replace('<>', fmtNum(e.measurement)) : fmtNum(e.measurement);
        this.emitText(space, st, withOcs(ctx.M, e.extrusionDirection), { x: tp.x, y: tp.y, height: this.dimtxt, lines: mtextLines(txt), mode: 'mtext', attach: 5, rotation: e.textRotation || 0 });
      }
    }
  }

  table(space, e, ctx) {
    const st = this.style(e, ctx);
    const blk = (e.blockRecordHandle && this.doc.blockByHandle.get(e.blockRecordHandle)) || this.blockByName(e.name || e.blockName);
    const p = pt(e.startPoint || e.insertionPoint);
    if (!blk || (!e.blockRecordHandle && !p.x && !p.y && !e.name)) { this.warn('table (not readable in this DWG version)'); return; }
    let d = e.directionVector || { x: 1, y: 0 };
    // some DWG versions store garbage here; only trust a unit vector
    if (Math.abs(Math.hypot(d.x || 0, d.y || 0) - 1) > 1e-3) d = { x: 1, y: 0 };
    const rot = Math.atan2(d.y || 0, d.x || 1);
    const child = {
      M: mul(mul(withOcs(ctx.M, e.extrusionDirection), translate(p.x, p.y, p.z || 0)), rotateZ(rot)),
      depth: ctx.depth + 1, stack: ctx.stack, gate: ctx.gate,
      layerName: st.layerName, color: st.color, ltype: st.ltypeName, lw: st.lw, ltScale: ctx.ltScale,
    };
    this.entities(space, blk.entities, child);
  }

  hatchRings(e) {
    const rings = [];
    for (const bp of e.boundaryPaths || []) {
      const r = [];
      if (Array.isArray(bp.vertices) && !bp.edges) {
        const v = bp.vertices;
        if (!v.length) continue;
        r.push(v[0].x, v[0].y, 0);
        const n = v.length;
        const segs = n; // hatch polyline boundaries are always closed
        for (let i = 0; i < segs; i++) {
          const a = v[i], b = v[(i + 1) % n];
          bulgePoints(r, a.x, a.y, b.x, b.y, bp.hasBulge === false ? 0 : a.bulge || 0, 0);
        }
      } else {
        for (const ed of bp.edges || []) {
          const seg = [];
          switch (ed.type) {
            case 1: seg.push(ed.start.x, ed.start.y, 0, ed.end.x, ed.end.y, 0); break;
            case 2: {
              const ccw = ed.isCCW === undefined ? true : !!ed.isCCW;
              let a0 = ed.startAngle || 0, a1 = ed.endAngle || 0;
              if (Math.abs(a1 - a0) >= Math.PI * 2 - 1e-9) { a1 = a0 + Math.PI * 2 - 1e-9; }
              if (ccw) arcPoints(seg, ed.center.x, ed.center.y, ed.radius, a0, a1, 0, true);
              else {
                arcPoints(seg, ed.center.x, ed.center.y, ed.radius, -a1, -a0, 0, true);
                reversePts(seg);
              }
              break;
            }
            case 3: {
              const ccw = ed.isCCW === undefined ? true : !!ed.isCCW;
              const ratio = ed.lengthOfMinorAxis || 1;
              const toParam = (a) => Math.atan2(Math.sin(a) / ratio, Math.cos(a));
              let a0 = ed.startAngle || 0, a1 = ed.endAngle || 0;
              if (!ccw) { [a0, a1] = [-a1, -a0]; }
              const p0 = toParam(a0); let p1 = toParam(a1);
              if (Math.abs(a1 - a0) >= Math.PI * 2 - 1e-9) p1 = p0 + Math.PI * 2;
              ellipsePoints(seg, ed.center.x, ed.center.y, ed.end.x, ed.end.y, ratio, p0, p1, 0);
              if (!ccw) reversePts(seg);
              break;
            }
            case 4: {
              const cps = ed.controlPoints || [];
              if (cps.length >= 2) nurbsPoints(seg, ed.degree || 3, cps, ed.knots, cps.map((c) => c.weight ?? 1));
              else if ((ed.fitDatum || []).length >= 2) fitPoints(seg, ed.fitDatum, false);
              break;
            }
            default:
          }
          if (!seg.length) continue;
          // join edges, dropping duplicated vertices
          if (r.length >= 3 && Math.abs(r[r.length - 3] - seg[0]) < 1e-9 && Math.abs(r[r.length - 2] - seg[1]) < 1e-9) seg.splice(0, 3);
          r.push(...seg);
        }
      }
      if (r.length >= 9) rings.push(r);
    }
    return rings;
  }

  hatch(space, e, ctx) {
    const st = this.style(e, ctx);
    const M = withOcs(ctx.M, e.extrusionDirection);
    const rings = this.hatchRings(e);
    if (!rings.length) return;
    const solid = e.solidFill === 1 || /^solid$/i.test(e.patternName || '');
    if (solid || e.gradientFlag === 1) {
      let color = st.color;
      if (e.gradientFlag === 1 && Array.isArray(e.gradientColors) && e.gradientColors.length) {
        const g = e.gradientColors[0];
        if (typeof g.rgb === 'number' && g.rgb >= 0) color = g.rgb & 0xffffff;
      }
      this.emitFill(space, { ...st, color }, M, rings);
      return;
    }
    const defs = e.definitionLines || [];
    if (!defs.length) {
      // pattern definition missing: show a light tint so the area is still visible
      this.emitFill(space, st, M, rings, KIND_FILL, 0.25);
      return;
    }
    const segs = hatchPattern(rings, defs);
    if (segs === null) {
      this.emitFill(space, st, M, rings, KIND_FILL, 0.35);
      this.warn('dense hatch');
      return;
    }
    this.emitSegments(space, st, M, segs);
  }

  arrow(space, st, M, tip, from, size) {
    const dx = from.x - tip.x, dy = from.y - tip.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-12 || !(size > 0)) return;
    const ux = dx / l, uy = dy / l;
    const bx = tip.x + ux * size, by = tip.y + uy * size;
    const w = size / 6;
    const ring = [tip.x, tip.y, 0, bx - uy * w, by + ux * w, 0, bx + uy * w, by - ux * w, 0];
    this.emitFill(space, st, M, [ring]);
  }

  leader(space, e, ctx) {
    const st = this.style(e, ctx);
    const v = e.vertices || [];
    if (v.length < 2) return;
    const M = ctx.M;
    const pts = [];
    if (e.isSpline && v.length > 2) fitPoints(pts, v, false);
    else for (const p of v) pts.push(p.x, p.y, p.z || 0);
    this.emitPolyline(space, st, M, pts, false);
    if (e.isArrowheadEnabled !== false) this.arrow(space, st, M, v[0], v[1], this.dimasz);
  }

  mleader(space, e, ctx) {
    const st = this.style(e, ctx);
    const M = ctx.M;
    const lc = mleaderColor(e.leaderLineColor, st.color);
    const lst = { ...st, color: lc };
    const size = e.arrowheadSize || this.dimasz;
    for (const sec of e.leaderSections || []) {
      for (const ln of sec.leaderLines || []) {
        const v = (ln.vertices || []).slice();
        if (sec.lastLeaderLinePoint) v.push(sec.lastLeaderLinePoint);
        if (v.length >= 2) {
          const pts = [];
          for (const p of v) pts.push(p.x, p.y, p.z || 0);
          this.emitPolyline(space, lst, M, pts, false);
          this.arrow(space, lst, M, v[0], v[1], size);
        }
      }
      if (e.doglegEnabled !== false && sec.lastLeaderLinePoint && sec.doglegVector) {
        const p = sec.lastLeaderLinePoint, d = sec.doglegVector, len = sec.doglegLength || e.doglegLength || 0;
        if (len > 0) this.emitPolyline(space, lst, M, [p.x, p.y, p.z || 0, p.x + d.x * len, p.y + d.y * len, (p.z || 0)], false);
      }
    }
    if (e.hasMText !== false && e.textContent && e.textAnchor) {
      const tc = mleaderColor(e.textColor, st.color);
      const p = e.textAnchor;
      this.emitText(space, { ...st, color: tc }, M, {
        x: p.x, y: p.y, z: p.z || 0, height: e.textHeight || this.dimtxt,
        dir: e.textDirection, lines: mtextLines(repairByteSwapped(e.textContent)), mode: 'mtext',
        attach: e.textAttachmentPoint || 1, wrap: e.textWidth > 0 ? e.textWidth / (e.textHeight || 1) : 0,
        spacing: (5 / 3) * (e.textLineSpacingFactor || 1),
      });
    }
    if (e.hasBlock && e.blockContentId) {
      const blk = this.doc.blockByHandle.get(e.blockContentId);
      const T = e.blockContent && e.blockContent.transformationMatrix;
      if (blk && T && T.length === 16 && ctx.depth < MAX_DEPTH) {
        const B = mul(M, [T[0], T[1], T[2], T[3], T[4], T[5], T[6], T[7], T[8], T[9], T[10], T[11]]);
        this.entities(space, blk.entities, { ...ctx, M: B, depth: ctx.depth + 1, layerName: st.layerName, color: st.color });
      }
    }
  }

  mline(space, e, ctx) {
    const st = this.style(e, ctx);
    const M = withOcs(ctx.M, e.extrusionDirection);
    const verts = e.vertices || [];
    if (verts.length < 2) return;
    const nl = e.numberOfLines || (verts[0].lines || []).length;
    const closed = !!((e.flags || 0) & 2);
    const lines = [];
    for (let k = 0; k < nl; k++) {
      const pts = [];
      for (const v of verts) {
        const off = v.lines && v.lines[k] && v.lines[k].segmentParams ? v.lines[k].segmentParams[0] || 0 : 0;
        const p = v.vertex, m = v.miterDirection || { x: 0, y: 0 };
        pts.push(p.x + m.x * off, p.y + m.y * off, p.z || 0);
      }
      lines.push(pts);
      this.emitPolyline(space, st, M, pts, closed);
    }
    if (!closed && lines.length >= 2) {
      const a = lines[0], b = lines[lines.length - 1];
      if (!((e.flags || 0) & 4)) this.emitPolyline(space, st, M, [a[0], a[1], a[2], b[0], b[1], b[2]], false);
      if (!((e.flags || 0) & 8)) {
        const n = a.length;
        this.emitPolyline(space, st, M, [a[n - 3], a[n - 2], a[n - 1], b[n - 3], b[n - 2], b[n - 1]], false);
      }
    }
  }

  wipeout(space, e, ctx, isWipeout) {
    const st = this.style(e, ctx);
    const o = pt(e.position), u = pt(e.uPixel), v = pt(e.vPixel);
    const size = e.imageSize || { x: 1, y: 1 };
    let bp = e.clippingBoundaryPath || [];
    if (bp.length === 2) bp = [bp[0], { x: bp[1].x, y: bp[0].y }, bp[1], { x: bp[0].x, y: bp[1].y }];
    if (bp.length < 3) {
      bp = [{ x: -0.5, y: -0.5 }, { x: size.x - 0.5, y: -0.5 }, { x: size.x - 0.5, y: size.y - 0.5 }, { x: -0.5, y: size.y - 0.5 }];
    }
    const ring = [];
    for (const p of bp) {
      const px = p.x + 0.5, py = size.y - 0.5 - p.y;
      ring.push(o.x + u.x * px + v.x * py, o.y + u.y * px + v.y * py, (o.z || 0) + (u.z || 0) * px + (v.z || 0) * py);
    }
    if (isWipeout) {
      space.newMaskStage();
      this.emitFill(space, { ...st, color: -2 }, ctx.M, [ring], KIND_MASK);
      if (((e.flags || 0) & 8) === 0 && this.opts.wipeoutFrames) this.emitPolyline(space, st, ctx.M, ring, true);
    } else {
      this.emitPolyline(space, st, ctx.M, ring, true);
      this.warn('IMAGE');
    }
  }

  viewport(space, e, ctx) {
    if (ctx.depth > 0) return;
    space.viewports.push(e);
  }
}

const LIMIT = 1e13;
function finitePts(a) {
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (!(v > -LIMIT && v < LIMIT)) return false; }
  return true;
}

function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

function fmtNum(v) {
  if (typeof v !== 'number') return '';
  return String(Math.round(v * 100) / 100);
}

function reversePts(a) {
  const n = a.length / 3;
  for (let i = 0; i < n / 2; i++) {
    const j = n - 1 - i;
    for (let k = 0; k < 3; k++) { const t = a[i * 3 + k]; a[i * 3 + k] = a[j * 3 + k]; a[j * 3 + k] = t; }
  }
}

function mleaderColor(raw, fallback) {
  if (typeof raw !== 'number') return fallback;
  const method = (raw >>> 24) & 0xff;
  if (method === 0xc2) return raw & 0xffffff;
  if (method === 0xc3) return aciToRgb(raw & 0xff);
  return fallback;
}

export function attachOffset(attach, w, h) {
  const col = (attach - 1) % 3, row = Math.floor((attach - 1) / 3);
  return [-(col * w) / 2, row === 0 ? -h : row === 1 ? -h / 2 : 0];
}

// AutoCAD line pattern -> canvas dash array (all positive, starts with a dash).
export function canvasDash(pattern, s) {
  const out = [];
  let total = 0;
  for (const raw of pattern) {
    const v = raw * s;
    total += Math.abs(v);
    const isGap = v < 0;
    const len = Math.abs(v);
    const wantDash = out.length % 2 === 0;
    if (wantDash === !isGap) out.push(len);
    else if (out.length) out[out.length - 1] += len;
    else { out.push(0, len); }
  }
  if (!(total > 0) || out.length < 2) return null;
  if (out.length % 2) out.push(0);
  return out;
}

// Generates clipped hatch pattern line segments in local coordinates.
export function hatchPattern(rings, defs) {
  const edges = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) {
    const n = r.length / 3;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      edges.push(r[i * 3], r[i * 3 + 1], r[j * 3], r[j * 3 + 1]);
      minX = Math.min(minX, r[i * 3]); maxX = Math.max(maxX, r[i * 3]);
      minY = Math.min(minY, r[i * 3 + 1]); maxY = Math.max(maxY, r[i * 3 + 1]);
    }
  }
  const segs = [];
  const corners = [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]];
  for (const d of defs) {
    const a = d.angle || 0;
    const dx = Math.cos(a), dy = Math.sin(a);
    const nx = -dy, ny = dx;
    const bx = d.base?.x || 0, by = d.base?.y || 0;
    const ox = d.offset?.x || 0, oy = d.offset?.y || 0;
    const spacing = ox * nx + oy * ny;
    const shift = ox * dx + oy * dy;
    if (Math.abs(spacing) < 1e-12) continue;
    let nmin = Infinity, nmax = -Infinity;
    for (const [cx, cy] of corners) {
      const t = (cx - bx) * nx + (cy - by) * ny;
      nmin = Math.min(nmin, t); nmax = Math.max(nmax, t);
    }
    let k0 = Math.ceil(nmin / spacing), k1 = Math.floor(nmax / spacing);
    if (k0 > k1) [k0, k1] = [k1, k0];
    if (k1 - k0 > 20000) return null;
    const dashes = (d.dashLengths || []).filter((v) => typeof v === 'number');
    const plen = dashes.reduce((s, v) => s + Math.abs(v), 0);
    for (let k = k0; k <= k1; k++) {
      const px = bx + ox * k, py = by + oy * k; // a point on this line (pattern origin)
      const off = k * spacing;
      const hits = [];
      for (let i = 0; i < edges.length; i += 4) {
        const ax = edges[i], ay = edges[i + 1], cx = edges[i + 2], cy = edges[i + 3];
        const da = (ax - bx) * nx + (ay - by) * ny - off;
        const dc = (cx - bx) * nx + (cy - by) * ny - off;
        if ((da > 0) !== (dc > 0)) {
          const t = da / (da - dc);
          const ix = ax + (cx - ax) * t, iy = ay + (cy - ay) * t;
          hits.push((ix - px) * dx + (iy - py) * dy);
        }
      }
      if (hits.length < 2) continue;
      hits.sort((p, q) => p - q);
      for (let h = 0; h + 1 < hits.length; h += 2) {
        const u0 = hits[h], u1 = hits[h + 1];
        if (!dashes.length || !(plen > 0)) {
          segs.push(px + dx * u0, py + dy * u0, px + dx * u1, py + dy * u1);
        } else {
          let u = Math.floor(u0 / plen) * plen;
          let guard = 0;
          while (u < u1 && guard++ < 100000) {
            for (const dl of dashes) {
              const len = Math.abs(dl);
              if (dl >= 0) {
                const s0 = Math.max(u, u0), s1 = Math.min(u + (len || plen * 0.002), u1);
                if (s1 > s0) segs.push(px + dx * s0, py + dy * s0, px + dx * s1, py + dy * s1);
              }
              u += len;
              if (u >= u1) break;
            }
          }
        }
        if (segs.length > MAX_HATCH_SEGMENTS * 4) return null;
      }
    }
    void shift;
  }
  return segs;
}

// ---- packing -----------------------------------------------------------------

function packSpace(space, origin) {
  const [ox, oy] = origin;
  const batches = [];
  const TILE_LIMIT = 60000;
  for (const b of space.batches.values()) {
    const d = b.data;
    if (!d.length) continue;
    const parts = [];
    if (b.kind === KIND_LINE || b.kind === KIND_WIDE) {
      if (d.length > TILE_LIMIT) {
        // spatial split so off-screen geometry can be culled
        const G = 8;
        const w = (space.maxX - space.minX) || 1, h = (space.maxY - space.minY) || 1;
        const tiles = new Map();
        for (let i = 0; i < d.length;) {
          const n = d[i];
          const x = d[i + 1], y = d[i + 2];
          const tx = Math.min(G - 1, Math.max(0, Math.floor(((x - space.minX) / w) * G)));
          const ty = Math.min(G - 1, Math.max(0, Math.floor(((y - space.minY) / h) * G)));
          const key = ty * G + tx;
          let t = tiles.get(key);
          if (!t) tiles.set(key, (t = []));
          for (let k = 0; k < 1 + 2 * n; k++) t.push(d[i + k]);
          i += 1 + 2 * n;
        }
        for (const t of tiles.values()) parts.push(t);
      } else parts.push(d);
    } else parts.push(d);

    for (const p of parts) {
      const arr = new Float64Array(p.length);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      if (b.kind === KIND_LINE || b.kind === KIND_WIDE) {
        for (let i = 0; i < p.length;) {
          const n = p[i]; arr[i] = n; i++;
          for (let k = 0; k < n; k++, i += 2) {
            const x = p[i] - ox, y = p[i + 1] - oy;
            arr[i] = x; arr[i + 1] = y;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      } else {
        for (let i = 0; i < p.length;) {
          const nr = p[i]; arr[i] = nr; i++;
          for (let r = 0; r < nr; r++) {
            const n = p[i]; arr[i] = n; i++;
            for (let k = 0; k < n; k++, i += 2) {
              const x = p[i] - ox, y = p[i + 1] - oy;
              arr[i] = x; arr[i + 1] = y;
              if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
        }
      }
      batches.push({ kind: b.kind, stage: b.stage, layer: b.layer, gate: b.gate, color: b.color, lw: b.lw, dash: b.dash, width: b.width, alpha: b.alpha, bbox: [x0, y0, x1, y1], data: arr });
    }
  }
  batches.sort((a, b) => a.stage - b.stage || order(a.kind) - order(b.kind));
  const texts = space.texts.map((t) => ({
    ...t,
    o: [t.o[0] - ox, t.o[1] - oy],
    p2: t.p2 ? [t.p2[0] - ox, t.p2[1] - oy] : undefined,
    bbox: [t.bbox[0] - ox, t.bbox[1] - oy, t.bbox[2] - ox, t.bbox[3] - oy],
  }));
  const points = new Float64Array(space.points);
  for (let i = 0; i < points.length; i += 6) { points[i] -= ox; points[i + 1] -= oy; }
  const snaps = new Float64Array(space.snaps);
  for (let i = 0; i < snaps.length; i += 3) { snaps[i] -= ox; snaps[i + 1] -= oy; }
  const rays = space.rays.map((r) => ({ ...r, x: r.x - ox, y: r.y - oy }));
  const ext = isFinite(space.minX) ? [space.minX - ox, space.minY - oy, space.maxX - ox, space.maxY - oy] : null;
  return { name: space.name, origin, extents: ext, batches, texts, points, rays, snaps, count: space.count };
}

function order(kind) { return kind === KIND_MASK ? 0 : kind === KIND_FILL ? 1 : kind === KIND_WIDE ? 2 : 3; }

function transferList(space) {
  const list = [];
  for (const b of space.batches) list.push(b.data.buffer);
  list.push(space.points.buffer, space.snaps.buffer);
  return list;
}

function chooseOrigin(space) {
  if (!isFinite(space.minX)) return [0, 0];
  const cx = (space.minX + space.maxX) / 2, cy = (space.minY + space.maxY) / 2;
  // round so that displayed coordinates stay exact
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(Math.abs(cx), Math.abs(cy), 1))) - 2));
  return [Math.round(cx / mag) * mag, Math.round(cy / mag) * mag];
}

function viewportInfo(vp, origin) {
  const c = pt(vp.viewportCenter);
  const dc = vp.displayCenter || { x: 0, y: 0 };
  const tgt = vp.targetPoint || { x: 0, y: 0, z: 0 };
  return {
    cx: c.x - origin[0], cy: c.y - origin[1], w: vp.width || 0, h: vp.height || 0,
    viewX: (dc.x || 0) + (tgt.x || 0), viewY: (dc.y || 0) + (tgt.y || 0),
    viewHeight: vp.viewHeight || vp.height || 1,
    twist: vp.viewTwistAngle || 0,
    id: vp.viewportId,
    off: !!((vp.statusBitFlags || 0) & 131072) || vp.status === 0 && vp.viewportId === undefined,
    layer: vp.layer,
  };
}

export function buildDisplayList(doc, opts = {}) {
  const t0 = Date.now();
  const builder = new Builder(doc, opts);
  const rootCtx = { M: IDENTITY, depth: 0, stack: new Set(), gate: '', layerName: null, color: -1, ltype: 'Continuous', lw: -3, ltScale: 1 };

  setTolerance(estimateSize(doc.model.entities || []) * 1e-6);
  const model = new Space('Model');
  builder.entities(model, doc.model.entities || [], rootCtx);
  const modelOrigin = chooseOrigin(model);
  const packedModel = packSpace(model, modelOrigin);

  const layouts = [];
  for (const lo of doc.layouts || []) {
    const sp = new Space(lo.name);
    builder.entities(sp, lo.block.entities || [], rootCtx);
    const vps = sp.viewports.slice();
    // overall paper viewport has id 1 (or is the first one)
    let main = vps.find((v) => v.viewportId === 1);
    if (!main && vps.length) main = vps[0];
    const limOk = lo.limMin && lo.limMax && lo.limMax.x > lo.limMin.x && lo.limMax.y > lo.limMin.y;
    if (limOk) { sp.grow(lo.limMin.x, lo.limMin.y); sp.grow(lo.limMax.x, lo.limMax.y); }
    const userVps = vps.filter((v) => v !== main);
    for (const v of userVps) {
      const c = pt(v.viewportCenter);
      sp.grow(c.x - (v.width || 0) / 2, c.y - (v.height || 0) / 2);
      sp.grow(c.x + (v.width || 0) / 2, c.y + (v.height || 0) / 2);
    }
    const origin = chooseOrigin(sp);
    // viewport frames on their layer
    for (const v of userVps) {
      const c = pt(v.viewportCenter), w = (v.width || 0) / 2, h = (v.height || 0) / 2;
      const st = builder.style(v, rootCtx);
      builder.emitPolyline(sp, st, IDENTITY, [c.x - w, c.y - h, 0, c.x + w, c.y - h, 0, c.x + w, c.y + h, 0, c.x - w, c.y + h, 0], true);
    }
    const packed = packSpace(sp, origin);
    packed.paper = limOk ? [lo.limMin.x - origin[0], lo.limMin.y - origin[1], lo.limMax.x - origin[0], lo.limMax.y - origin[1]] : null;
    packed.viewports = userVps.map((v) => {
      const info = viewportInfo(v, origin);
      info.layer = builder.layerIndex.get(v.layer || '0') ?? 0;
      return info;
    }).filter((v) => v.w > 0 && v.h > 0 && !v.off);
    // empty layouts (never set up) are of little use but keep them like AutoCAD does
    layouts.push(packed);
  }

  const warnings = [...builder.warnings.entries()].map(([k, v]) => ({ type: k, count: v }));
  return {
    layers: builder.layers,
    model: packedModel,
    layouts,
    counts: builder.counts,
    warnings,
    header: {
      INSUNITS: doc.header.INSUNITS, LUNITS: doc.header.LUNITS, LUPREC: doc.header.LUPREC,
      PDMODE: builder.pdmode, PDSIZE: builder.pdsize, MEASUREMENT: doc.header.MEASUREMENT,
    },
    buildMs: Date.now() - t0,
  };
}

// Robust drawing size (2nd..98th percentile of entity anchor points).
function estimateSize(list) {
  const xs = [], ys = [];
  const add = (p) => { if (p && isFinite(p.x) && isFinite(p.y) && Math.abs(p.x) < LIMIT && Math.abs(p.y) < LIMIT) { xs.push(p.x); ys.push(p.y); } };
  for (const e of list) {
    if (xs.length > 200000) break;
    add(e.startPoint); add(e.endPoint); add(e.center); add(e.insertionPoint); add(e.position);
    if (Array.isArray(e.vertices) && e.vertices.length) { add(e.vertices[0]); add(e.vertices[e.vertices.length - 1]); }
  }
  if (xs.length < 2) return 0;
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(f * (arr.length - 1))))];
  return Math.hypot(q(xs, 0.98) - q(xs, 0.02), q(ys, 0.98) - q(ys, 0.02));
}

export function displayListTransfers(dl) {
  const list = transferList(dl.model);
  for (const l of dl.layouts) list.push(...transferList(l));
  return list;
}

void isMirrored;
