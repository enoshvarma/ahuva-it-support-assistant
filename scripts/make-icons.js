#!/usr/bin/env node
/**
 * Generates assets/icon.png (512px), assets/icon.ico (256px multi-size),
 * and assets/icon.icns (macOS) from assets/icon.svg.
 *
 * Run once: node scripts/make-icons.js
 * Requires: npm install --save-dev sharp png-to-ico png2icons
 */

const path  = require("path");
const fs    = require("fs");

const ROOT   = path.resolve(__dirname, "..");
const ASSETS = path.join(ROOT, "assets");
const SVG    = path.join(ASSETS, "icon.svg");

async function main() {
  // ── install deps on the fly if missing ──────────────────────────────────
  const deps = ["sharp", "png-to-ico", "png2icons"];
  for (const dep of deps) {
    try { require.resolve(dep); }
    catch {
      console.log(`Installing ${dep}…`);
      require("child_process").execSync(`npm install --save-dev ${dep}`, { cwd: ROOT, stdio: "inherit" });
    }
  }

  const sharp     = require("sharp");
  const png2icons = require("png2icons");

  const svgBuf = fs.readFileSync(SVG);

  // ── PNG 512×512 (Linux / generic) ───────────────────────────────────────
  const png512 = await sharp(svgBuf).resize(512, 512).png().toBuffer();
  fs.writeFileSync(path.join(ASSETS, "icon.png"), png512);
  console.log("✓ icon.png (512×512)");

  // ── PNG 256×256 for ICO ──────────────────────────────────────────────────
  const png256 = await sharp(svgBuf).resize(256, 256).png().toBuffer();

  // ── ICO (Windows) — embed PNG data for each size ─────────────────────────
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const pngBufs  = await Promise.all(
    icoSizes.map(sz => sharp(svgBuf).resize(sz, sz).png().toBuffer())
  );
  const icoBuf   = buildIco(icoSizes, pngBufs);
  fs.writeFileSync(path.join(ASSETS, "icon.ico"), icoBuf);
  console.log("✓ icon.ico (16/32/48/64/128/256 px)");

  // ── ICNS (macOS) ─────────────────────────────────────────────────────────
  const icnsBuf = png2icons.createICNS(png512, png2icons.BILINEAR, 0);
  if (icnsBuf) {
    fs.writeFileSync(path.join(ASSETS, "icon.icns"), icnsBuf);
    console.log("✓ icon.icns (macOS)");
  } else {
    console.warn("⚠  ICNS generation returned null — skipping");
  }

  console.log("\nAll icons written to assets/");
}

main().catch(err => { console.error(err); process.exit(1); });

/** Build a valid ICO buffer that embeds raw PNG data for each size. */
function buildIco(sizes, pngBufs) {
  const count     = sizes.length;
  const dirBytes  = 6 + count * 16;
  let   offset    = dirBytes;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: ICO
  header.writeUInt16LE(count, 4);  // image count

  const dirs = [];
  for (let i = 0; i < count; i++) {
    const sz  = sizes[i];
    const buf = pngBufs[i];
    const dir = Buffer.alloc(16);
    dir.writeUInt8(sz === 256 ? 0 : sz, 0);   // width  (0 = 256)
    dir.writeUInt8(sz === 256 ? 0 : sz, 1);   // height
    dir.writeUInt8(0, 2);                      // color count (0 = truecolor)
    dir.writeUInt8(0, 3);                      // reserved
    dir.writeUInt16LE(1, 4);                   // color planes
    dir.writeUInt16LE(32, 6);                  // bits per pixel
    dir.writeUInt32LE(buf.length, 8);          // size of image data
    dir.writeUInt32LE(offset, 12);             // offset of image data
    dirs.push(dir);
    offset += buf.length;
  }

  return Buffer.concat([header, ...dirs, ...pngBufs]);
}
