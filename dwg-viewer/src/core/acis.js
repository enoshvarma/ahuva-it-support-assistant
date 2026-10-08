// Minimal ACIS SAT reader: extracts the edges of REGION / 3DSOLID / BODY entities
// as wireframe polylines (what AutoCAD shows in 2D wireframe view).

function decrypt(line) {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const k = line.charCodeAt(i);
    out += k > 32 && k < 127 ? String.fromCharCode(159 - k) : line[i];
  }
  return out;
}

// text: SAT text (plain or AutoCAD-encrypted). Returns array of flat [x,y,z,...] polylines.
export function satEdges(text, maxEdges = 20000) {
  if (!text) return [];
  let src = String(text);
  if (!/^\s*\d+\s+\d+/.test(src)) src = src.split(/\r?\n/).map(decrypt).join('\n');
  const lines = src.split(/\r?\n/);
  // skip the 3 header lines; records end with '#'
  const body = lines.slice(3).join(' ');
  const recs = [];
  for (const raw of body.split('#')) {
    const t = raw.trim();
    if (!t) continue;
    const tok = t.split(/\s+/);
    if (/^-\d+$/.test(tok[0])) tok.shift(); // "-0 body ..." numbered records
    recs.push({ type: tok[0], tok: tok.slice(1) });
  }
  const refs = (r) => r.tok.filter((x) => x[0] === '$').map((x) => +x.slice(1));
  const nums = (r) => r.tok.filter((x) => x[0] !== '$' && /^-?[\d.]+(e[-+]?\d+)?$/i.test(x)).map(Number);
  const pointOf = (vi) => {
    const v = recs[vi];
    if (!v || v.type !== 'vertex') return null;
    for (const ri of refs(v)) {
      const p = recs[ri];
      if (p && p.type === 'point') { const n = nums(p); return n.length >= 3 ? n.slice(-3) : null; }
    }
    return null;
  };
  // optional body transform
  let T = null;
  const b = recs.find((r) => r.type === 'body');
  if (b) for (const ri of refs(b)) { const r = recs[ri]; if (r && r.type === 'transform') { const n = nums(r); if (n.length >= 12) T = n; } }
  const xf = (p) => {
    if (!T) return p;
    const s = T.length > 12 ? T[12] || 1 : 1;
    return [(p[0] * T[0] + p[1] * T[3] + p[2] * T[6]) * s + T[9], (p[0] * T[1] + p[1] * T[4] + p[2] * T[7]) * s + T[10], (p[0] * T[2] + p[1] * T[5] + p[2] * T[8]) * s + T[11]];
  };
  const out = [];
  for (const r of recs) {
    if (r.type !== 'edge') continue;
    if (out.length >= maxEdges) break;
    const rs = refs(r);
    const verts = rs.filter((i) => recs[i] && recs[i].type === 'vertex');
    const curveIdx = rs.find((i) => recs[i] && /-curve$/.test(recs[i].type));
    if (verts.length < 1) continue;
    const p0 = pointOf(verts[0]), p1 = pointOf(verts[1] ?? verts[0]);
    if (!p0 || !p1) continue;
    const reversed = r.tok.includes('reversed');
    const curve = curveIdx !== undefined ? recs[curveIdx] : null;
    if (curve && curve.type === 'ellipse-curve') {
      const n = nums(curve);
      if (n.length >= 10) {
        const c = n.slice(0, 3), nn = n.slice(3, 6), M = n.slice(6, 9), ratio = n[9] || 1;
        const ml = Math.hypot(...M) || 1;
        const mu = M.map((v) => v / ml);
        const nl = Math.hypot(...nn) || 1;
        const nu = nn.map((v) => v / nl);
        const minor = [nu[1] * mu[2] - nu[2] * mu[1], nu[2] * mu[0] - nu[0] * mu[2], nu[0] * mu[1] - nu[1] * mu[0]];
        const param = (p) => {
          const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
          return Math.atan2((d[0] * minor[0] + d[1] * minor[1] + d[2] * minor[2]) / ratio, d[0] * mu[0] + d[1] * mu[1] + d[2] * mu[2]);
        };
        let t0 = param(p0), t1 = param(p1);
        if (reversed) [t0, t1] = [t1, t0];
        let sweep = t1 - t0;
        while (sweep <= 1e-9) sweep += Math.PI * 2;
        if (verts.length < 2 || verts[0] === verts[1]) sweep = Math.PI * 2;
        const steps = Math.max(8, Math.ceil(sweep / (Math.PI / 36)));
        const pts = [];
        for (let i = 0; i <= steps; i++) {
          const t = t0 + (sweep * i) / steps, ct = Math.cos(t), st = Math.sin(t);
          const p = [0, 1, 2].map((k) => c[k] + M[k] * ct + minor[k] * ml * ratio * st);
          pts.push(...xf(p));
        }
        out.push(pts);
        continue;
      }
    }
    out.push([...xf(p0), ...xf(p1)]);
  }
  return out;
}
