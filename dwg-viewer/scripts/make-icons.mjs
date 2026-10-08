// Renders assets/logo.svg into every icon size needed by the desktop, Android and iOS builds.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import png2icons from 'png2icons';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(root, 'assets/logo.svg'));
const render = (size, src = svg) => new Resvg(src, { fitTo: { mode: 'width', value: size } }).render().asPng();
const write = (rel, buf) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); };

// desktop
write('build/icon.png', render(1024));
for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) write(`build/icons/${s}x${s}.png`, render(s));
write('build/icon.ico', await pngToIco([16, 24, 32, 48, 64, 128, 256].map((s) => render(s))));
write('build/icon.icns', png2icons.createICNS(render(1024), png2icons.BILINEAR, 0));

// Android launcher icons (legacy + adaptive foreground on a full-bleed background)
const svgText = svg.toString();
const fullBleed = Buffer.from(svgText.replace(/rx="112"/, 'rx="0"'));
// adaptive foreground: the artwork scaled into the 66% safe zone, transparent background
const inner = svgText.replace(/^[\s\S]*?<\/defs>/, '').replace(/<\/svg>\s*$/, '').replace(/<rect x="0" y="0" width="512" height="512" rx="112" fill="url\(#bg\)"\/>/, '');
const defs = (svgText.match(/<defs>[\s\S]*?<\/defs>/) || [''])[0];
const fg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs}<g transform="translate(256 256) scale(0.62) translate(-256 -256)">${inner.replace(/<g stroke="#FFFFFF" stroke-opacity="0.13"[\s\S]*?<\/g>/, '')}</g></svg>`);
const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs}<rect width="512" height="512" fill="url(#bg)"/><g stroke="#FFFFFF" stroke-opacity="0.13" stroke-width="3"><path d="M64 0V512M128 0V512M192 0V512M256 0V512M320 0V512M384 0V512M448 0V512"/><path d="M0 64H512M0 128H512M0 192H512M0 256H512M0 320H512M0 384H512M0 448H512"/></g></svg>`);
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
if (fs.existsSync(path.join(root, 'android/app/src/main/res'))) {
  for (const [d, k] of Object.entries(densities)) {
    const res = `android/app/src/main/res/mipmap-${d}`;
    write(`${res}/ic_launcher.png`, render(Math.round(48 * k)));
    write(`${res}/ic_launcher_round.png`, render(Math.round(48 * k)));
    write(`${res}/ic_launcher_foreground.png`, render(Math.round(108 * k), fg));
    write(`${res}/ic_launcher_background.png`, render(Math.round(108 * k), bg));
  }
  write('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`);
  write('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml', fs.readFileSync(path.join(root, 'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml')));
  // splash screens: logo centred on the app background colour
  const resDir = path.join(root, 'android/app/src/main/res');
  for (const dir of fs.readdirSync(resDir)) {
    const f = path.join(resDir, dir, 'splash.png');
    if (!dir.startsWith('drawable') || !fs.existsSync(f)) continue;
    const { width, height } = new Resvg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')).render();
    void width; void height;
    const buf = fs.readFileSync(f);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const logo = Math.round(Math.min(w, h) * 0.28);
    const splashSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#0b1220"/><g transform="translate(${(w - logo) / 2} ${(h - logo) / 2}) scale(${logo / 512})">${svgText.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</g></svg>`;
    fs.writeFileSync(f, new Resvg(Buffer.from(splashSvg), { fitTo: { mode: 'original' } }).render().asPng());
  }
}

// iOS app icon (single 1024 image, Xcode 14+)
const iosSet = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
if (fs.existsSync(path.join(root, 'ios/App'))) {
  write(`${iosSet}/AppIcon-512@2x.png`, render(1024, fullBleed));
  write(`${iosSet}/Contents.json`, JSON.stringify({ images: [{ filename: 'AppIcon-512@2x.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } }, null, 2));
}
const iosSplash = path.join(root, 'ios/App/App/Assets.xcassets/Splash.imageset');
if (fs.existsSync(iosSplash)) {
  for (const f of fs.readdirSync(iosSplash).filter((n) => n.endsWith('.png'))) {
    const p = path.join(iosSplash, f);
    const buf = fs.readFileSync(p);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const logo = Math.round(Math.min(w, h) * 0.18);
    const s2 = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#0b1220"/><g transform="translate(${(w - logo) / 2} ${(h - logo) / 2}) scale(${logo / 512})">${svgText.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</g></svg>`;
    fs.writeFileSync(p, new Resvg(Buffer.from(s2), { fitTo: { mode: 'original' } }).render().asPng());
  }
}
console.log('icons written');
