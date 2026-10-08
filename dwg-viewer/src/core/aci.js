// AutoCAD Color Index (ACI) palette, generated from the standard HSV layout.
// Index 7 is the "foreground" colour and is resolved by the renderer
// (white on dark backgrounds, black on light ones), so it is returned as -1.

const FIXED = {
  1: 0xff0000, 2: 0xffff00, 3: 0x00ff00, 4: 0x00ffff, 5: 0x0000ff, 6: 0xff00ff,
  8: 0x808080, 9: 0xc0c0c0,
  250: 0x333333, 251: 0x505050, 252: 0x696969, 253: 0x828282, 254: 0xbebebe, 255: 0xffffff,
};

const VALUES = [255, 165, 127, 76, 38];

function hsv(h, s, v) {
  const c = v * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  const R = Math.round(r + m), G = Math.round(g + m), B = Math.round(b + m);
  return (R << 16) | (G << 8) | B;
}

export const ACI = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  if (i === 7 || i === 0) ACI[i] = -1;
  else if (FIXED[i] !== undefined) ACI[i] = FIXED[i];
  else if (i >= 10 && i <= 249) {
    const hue = (Math.floor(i / 10) - 1) * 15;
    const sub = i % 10;
    const v = VALUES[sub >> 1];
    ACI[i] = hsv(hue, sub % 2 ? 0.5 : 1, v);
  } else ACI[i] = -1;
}

export function aciToRgb(index) {
  if (index < 0) index = -index;
  if (index >= 1 && index <= 255) return ACI[index];
  return -1;
}

// DWG lineweight enum index -> hundredths of a millimetre
export const DWG_LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
