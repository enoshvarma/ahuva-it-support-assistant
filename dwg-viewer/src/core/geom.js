// Geometry helpers: 3D affine matrices, OCS, and curve tessellation.
// Matrices are 12-element arrays [a b c tx, d e f ty, g h i tz] (row-major 3x4).

export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

export function mul(A, B) {
  const r = new Array(12);
  for (let i = 0; i < 3; i++) {
    const a0 = A[i * 4], a1 = A[i * 4 + 1], a2 = A[i * 4 + 2], a3 = A[i * 4 + 3];
    r[i * 4] = a0 * B[0] + a1 * B[4] + a2 * B[8];
    r[i * 4 + 1] = a0 * B[1] + a1 * B[5] + a2 * B[9];
    r[i * 4 + 2] = a0 * B[2] + a1 * B[6] + a2 * B[10];
    r[i * 4 + 3] = a0 * B[3] + a1 * B[7] + a2 * B[11] + a3;
  }
  return r;
}

export function translate(x, y, z = 0) { return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]; }
export function scale(x, y, z = 1) { return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0]; }
export function rotateZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0];
}

// Arbitrary axis algorithm (DXF reference): OCS -> WCS matrix for extrusion n.
export function ocs(n) {
  if (!n) return null;
  let nx = n.x || 0, ny = n.y || 0, nz = n.z;
  if (nz === undefined || nz === null) nz = 1;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return null;
  nx /= len; ny /= len; nz /= len;
  if (Math.abs(nx) < 1e-9 && Math.abs(ny) < 1e-9 && nz > 0) return null; // identity
  let ax, ay, az;
  if (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) {
    // Wy x N
    ax = nz; ay = 0; az = -nx;
  } else {
    // Wz x N
    ax = -ny; ay = nx; az = 0;
  }
  let l = Math.hypot(ax, ay, az);
  ax /= l; ay /= l; az /= l;
  // Ay = N x Ax
  const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;
  return [ax, bx, nx, 0, ay, by, ny, 0, az, bz, nz, 0];
}

export function withOcs(M, n) {
  const o = ocs(n);
  return o ? mul(M, o) : M;
}

export function apply(M, x, y, z = 0) {
  return [
    M[0] * x + M[1] * y + M[2] * z + M[3],
    M[4] * x + M[5] * y + M[6] * z + M[7],
  ];
}

// Approximate uniform scale of a matrix in the XY plane (for dash / text sizes).
export function xyScale(M) {
  const sx = Math.hypot(M[0], M[4]);
  const sy = Math.hypot(M[1], M[5]);
  return Math.sqrt(Math.abs(sx * sy)) || sx || 1;
}

export function isMirrored(M) {
  return M[0] * M[5] - M[1] * M[4] < 0;
}

const TAU = Math.PI * 2;

export function normAngle(a) {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

// Tessellation tolerance. Arcs use at most 2.5 degrees per segment, but small
// arcs (relative to the drawing size) use fewer segments.
const TESS = { absTol: 0, scale: 1 };
export function setTolerance(absTol) { TESS.absTol = absTol > 0 && isFinite(absTol) ? absTol : 0; }
export function setScale(s) { TESS.scale = s > 0 && isFinite(s) ? s : 1; }

export function segCount(sweep, min = 4, r = 0) {
  let step = Math.PI / 72;
  const rw = r * TESS.scale;
  if (rw > 0 && TESS.absTol > 0) {
    const k = 1 - TESS.absTol / rw;
    const a = k <= -1 ? Math.PI : 2 * Math.acos(k);
    if (a > step) step = Math.min(a, Math.PI / 4);
  }
  return Math.max(min, Math.min(1024, Math.ceil(Math.abs(sweep) / step)));
}

// Push arc points (local 2D) into out (flat x,y,z). Includes both endpoints.
export function arcPoints(out, cx, cy, r, a0, a1, z = 0, ccw = true) {
  let sweep;
  if (ccw) { sweep = normAngle(a1 - a0); if (sweep < 1e-12) sweep = TAU; }
  else { sweep = -normAngle(a0 - a1); if (sweep > -1e-12) sweep = -TAU; }
  const n = segCount(sweep, 4, r);
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a), z);
  }
  return out;
}

// Ellipse given centre, major axis vector (mx,my), ratio, start/end parameters.
export function ellipsePoints(out, cx, cy, mx, my, ratio, p0, p1, z = 0) {
  let sweep = p1 - p0;
  if (Math.abs(sweep) < 1e-12 || Math.abs(Math.abs(sweep) - TAU) < 1e-9) sweep = TAU;
  else sweep = normAngle(sweep);
  const nx = -my * ratio, ny = mx * ratio;
  const n = segCount(sweep, 8, Math.hypot(mx, my));
  for (let i = 0; i <= n; i++) {
    const t = p0 + (sweep * i) / n;
    const c = Math.cos(t), s = Math.sin(t);
    out.push(cx + mx * c + nx * s, cy + my * c + ny * s, z);
  }
  return out;
}

// Bulge segment from (x0,y0) to (x1,y1); pushes intermediate points + end point.
export function bulgePoints(out, x0, y0, x1, y1, bulge, z = 0) {
  if (!bulge || Math.abs(bulge) < 1e-10) { out.push(x1, y1, z); return; }
  const dx = x1 - x0, dy = y1 - y0;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) { out.push(x1, y1, z); return; }
  const theta = 4 * Math.atan(bulge);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  // centre lies on the left normal of the chord, at chord*(1-b^2)/(4b) from its midpoint
  const nx = -dy / chord, ny = dx / chord;
  const h = (chord * (1 - bulge * bulge)) / (4 * bulge);
  const cx = mx + nx * h, cy = my + ny * h;
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  const rad = Math.hypot(x0 - cx, y0 - cy);
  const n = segCount(theta, 2, rad);
  for (let i = 1; i < n; i++) {
    const a = a0 + (theta * i) / n;
    out.push(cx + rad * Math.cos(a), cy + rad * Math.sin(a), z);
  }
  out.push(x1, y1, z);
}

// Non-uniform rational B-spline evaluation (de Boor). ctrl: [{x,y,z}], knots, weights
export function nurbsPoints(out, degree, ctrl, knots, weights, samples) {
  const n = ctrl.length;
  if (n < 2) return out;
  const p = Math.max(1, Math.min(degree || 3, n - 1));
  let U = knots && knots.length === n + p + 1 ? knots.slice() : null;
  if (!U) {
    U = [];
    for (let i = 0; i <= p; i++) U.push(0);
    for (let i = 1; i < n - p; i++) U.push(i / (n - p));
    for (let i = 0; i <= p; i++) U.push(1);
  }
  const w = weights && weights.length === n ? weights : null;
  const u0 = U[p], u1 = U[n];
  const count = samples || Math.min(2000, Math.max(24, n * 10));
  const dx = new Float64Array(p + 1), dy = new Float64Array(p + 1), dz = new Float64Array(p + 1), dw = new Float64Array(p + 1);
  for (let s = 0; s <= count; s++) {
    let u = u0 + ((u1 - u0) * s) / count;
    if (s === count) u = u1 - 1e-12 * Math.max(1, Math.abs(u1));
    let k = p;
    while (k < n - 1 && U[k + 1] <= u) k++;
    for (let j = 0; j <= p; j++) {
      const c = ctrl[k - p + j];
      const wt = w ? w[k - p + j] || 1 : 1;
      dx[j] = c.x * wt; dy[j] = c.y * wt; dz[j] = (c.z || 0) * wt; dw[j] = wt;
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = k - p + j;
        const den = U[i + p - r + 1] - U[i];
        const a = den === 0 ? 0 : (u - U[i]) / den;
        dx[j] = (1 - a) * dx[j - 1] + a * dx[j];
        dy[j] = (1 - a) * dy[j - 1] + a * dy[j];
        dz[j] = (1 - a) * dz[j - 1] + a * dz[j];
        dw[j] = (1 - a) * dw[j - 1] + a * dw[j];
      }
    }
    const W = dw[p] || 1;
    out.push(dx[p] / W, dy[p] / W, dz[p] / W);
  }
  return out;
}

// Smooth curve through fit points (centripetal Catmull-Rom) when no control points exist.
export function fitPoints(out, pts, closed) {
  const n = pts.length;
  if (n < 2) return out;
  if (n === 2) { out.push(pts[0].x, pts[0].y, pts[0].z || 0, pts[1].x, pts[1].y, pts[1].z || 0); return out; }
  const P = (i) => {
    if (closed) return pts[(i + n) % n];
    if (i < 0) return { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y, z: pts[0].z || 0 };
    if (i >= n) return { x: 2 * pts[n - 1].x - pts[n - 2].x, y: 2 * pts[n - 1].y - pts[n - 2].y, z: pts[n - 1].z || 0 };
    return pts[i];
  };
  const segs = closed ? n : n - 1;
  const steps = 16;
  out.push(pts[0].x, pts[0].y, pts[0].z || 0);
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const d = (a, b) => Math.pow(Math.hypot(b.x - a.x, b.y - a.y) || 1e-9, 0.5);
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let s = 1; s <= steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      const lerp = (a, b, ta, tb, k) => (tb - ta === 0 ? a[k] : ((tb - t) / (tb - ta)) * a[k] + ((t - ta) / (tb - ta)) * b[k]);
      const pt = {};
      for (const k of ['x', 'y']) {
        const A1 = lerp(p0, p1, t0, t1, k), A2 = lerp(p1, p2, t1, t2, k), A3 = lerp(p2, p3, t2, t3, k);
        const B1 = (t2 - t0 === 0) ? A1 : ((t2 - t) / (t2 - t0)) * A1 + ((t - t0) / (t2 - t0)) * A2;
        const B2 = (t3 - t1 === 0) ? A2 : ((t3 - t) / (t3 - t1)) * A2 + ((t - t1) / (t3 - t1)) * A3;
        pt[k] = (t2 - t1 === 0) ? B1 : ((t2 - t) / (t2 - t1)) * B1 + ((t - t1) / (t2 - t1)) * B2;
      }
      out.push(pt.x, pt.y, p2.z || 0);
    }
  }
  return out;
}

// Cubic spline through fit points with chord-length parameterisation
// (clamped by unit end tangents when given, natural otherwise) - close to
// what AutoCAD computes for fit-point splines.
export function cubicFitPoints(out, pts, startTan, endTan) {
  const n = pts.length;
  if (n < 2) return out;
  if (n === 2 && !startTan && !endTan) { out.push(pts[0].x, pts[0].y, pts[0].z || 0, pts[1].x, pts[1].y, pts[1].z || 0); return out; }
  const t = [0];
  for (let i = 1; i < n; i++) t.push(t[i - 1] + (Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, (pts[i].z || 0) - (pts[i - 1].z || 0)) || 1e-9));
  const unit = (v) => { if (!v) return null; const l = Math.hypot(v.x || 0, v.y || 0, v.z || 0); return l > 1e-12 ? { x: v.x / l, y: v.y / l, z: (v.z || 0) / l } : null; };
  const t0 = unit(startTan), t1 = unit(endTan);
  const solve = (key, d0, d1) => {
    // second derivatives M via tridiagonal system
    const y = pts.map((p) => p[key] || 0);
    const h = []; for (let i = 0; i < n - 1; i++) h.push(t[i + 1] - t[i]);
    const a = new Float64Array(n), b = new Float64Array(n), c = new Float64Array(n), r = new Float64Array(n);
    if (d0 === null) { b[0] = 1; r[0] = 0; } else { b[0] = 2 * h[0]; c[0] = h[0]; r[0] = 6 * ((y[1] - y[0]) / h[0] - d0); }
    for (let i = 1; i < n - 1; i++) {
      a[i] = h[i - 1]; b[i] = 2 * (h[i - 1] + h[i]); c[i] = h[i];
      r[i] = 6 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1]);
    }
    if (d1 === null) { b[n - 1] = 1; r[n - 1] = 0; } else { a[n - 1] = h[n - 2]; b[n - 1] = 2 * h[n - 2]; r[n - 1] = 6 * (d1 - (y[n - 1] - y[n - 2]) / h[n - 2]); }
    for (let i = 1; i < n; i++) { const m = a[i] / b[i - 1]; b[i] -= m * c[i - 1]; r[i] -= m * r[i - 1]; }
    const M = new Float64Array(n);
    M[n - 1] = r[n - 1] / b[n - 1];
    for (let i = n - 2; i >= 0; i--) M[i] = (r[i] - c[i] * M[i + 1]) / b[i];
    return { y, h, M };
  };
  const sx = solve('x', t0 ? t0.x : null, t1 ? t1.x : null);
  const sy = solve('y', t0 ? t0.y : null, t1 ? t1.y : null);
  const sz = solve('z', t0 ? t0.z : null, t1 ? t1.z : null);
  const ev = (S, i, u) => {
    const h = S.h[i], A = (t[i + 1] - u) / h, B = (u - t[i]) / h;
    return A * S.y[i] + B * S.y[i + 1] + ((A * A * A - A) * S.M[i] + (B * B * B - B) * S.M[i + 1]) * (h * h) / 6;
  };
  out.push(pts[0].x, pts[0].y, pts[0].z || 0);
  for (let i = 0; i < n - 1; i++) {
    const steps = 16;
    for (let k = 1; k <= steps; k++) {
      const u = t[i] + ((t[i + 1] - t[i]) * k) / steps;
      out.push(ev(sx, i, u), ev(sy, i, u), ev(sz, i, u));
    }
  }
  return out;
}
