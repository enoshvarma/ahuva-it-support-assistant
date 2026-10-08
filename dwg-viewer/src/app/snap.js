// Uniform grid over snap points (endpoints, midpoints, centres...) for fast nearest queries.
export class SnapIndex {
  constructor(snaps, extents) {
    this.s = snaps;
    const n = snaps.length / 3;
    let [x0, y0, x1, y1] = extents || [0, 0, 1, 1];
    if (!(x1 > x0)) x1 = x0 + 1;
    if (!(y1 > y0)) y1 = y0 + 1;
    const cells = Math.max(1, Math.min(512, Math.round(Math.sqrt(n / 2))));
    this.x0 = x0; this.y0 = y0;
    this.cw = (x1 - x0) / cells || 1;
    this.ch = (y1 - y0) / cells || 1;
    this.n = cells;
    const counts = new Uint32Array(cells * cells + 1);
    const cellOf = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const c = this.cell(snaps[i * 3], snaps[i * 3 + 1]);
      cellOf[i] = c;
      counts[c + 1]++;
    }
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
    this.start = counts;
    this.items = new Uint32Array(n);
    const fill = counts.slice();
    for (let i = 0; i < n; i++) this.items[fill[cellOf[i]]++] = i;
  }

  cell(x, y) {
    const cx = Math.min(this.n - 1, Math.max(0, Math.floor((x - this.x0) / this.cw)));
    const cy = Math.min(this.n - 1, Math.max(0, Math.floor((y - this.y0) / this.ch)));
    return cy * this.n + cx;
  }

  nearest(x, y, r) {
    const s = this.s;
    const cx0 = Math.max(0, Math.floor((x - r - this.x0) / this.cw)), cx1 = Math.min(this.n - 1, Math.floor((x + r - this.x0) / this.cw));
    const cy0 = Math.max(0, Math.floor((y - r - this.y0) / this.ch)), cy1 = Math.min(this.n - 1, Math.floor((y + r - this.y0) / this.ch));
    let best = -1, bd = r * r;
    if (cx1 < cx0 || cy1 < cy0) return null;
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 4096) return null; // zoomed far out: snapping is meaningless
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cy * this.n + cx;
        for (let k = this.start[c]; k < this.start[c + 1]; k++) {
          const i = this.items[k];
          const dx = s[i * 3] - x, dy = s[i * 3 + 1] - y;
          // prefer endpoints/centres slightly over midpoints
          const d = dx * dx + dy * dy * 1 + (s[i * 3 + 2] === 1 ? bd * 0.05 : 0);
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    return best < 0 ? null : { x: s[best * 3], y: s[best * 3 + 1], kind: s[best * 3 + 2] };
  }
}
