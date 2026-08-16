/**
 * Generates To-Do's icon assets as PNGs with no image dependencies.
 *
 *   node scripts/make-icon.mjs
 *
 * Produces:
 *   src-tauri/icons/source.png  1024²  full-colour squircle → feed to `tauri icon`
 *   src-tauri/icons/tray.png      88²  monochrome glyph for the menu bar
 *
 * Everything is drawn analytically and supersampled 3×3 for clean edges.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'icons');

// ── PNG encoding ──────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode straight-alpha RGBA bytes as an 8-bit PNG. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10-12: deflate / adaptive filtering / no interlace — all zero.

  // Filter type 0 (None) per scanline keeps the encoder trivial; zlib still
  // compresses these gradients well.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Geometry ──────────────────────────────────────────────────────────────────

/**
 * Superellipse coverage. Apple's continuous corner curve is closely
 * approximated by |x/a|ⁿ + |y/a|ⁿ = 1 with n ≈ 5.
 */
function squircle(x, y, cx, cy, radius, n = 5) {
  const dx = Math.abs(x - cx) / radius;
  const dy = Math.abs(y - cy) / radius;
  return dx ** n + dy ** n <= 1;
}

/** Distance from point p to segment ab — used to stroke the checkmark. */
function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + t * abx);
  const dy = py - (ay + t * aby);
  return Math.hypot(dx, dy);
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Sample a 3-stop gradient along the top-left → bottom-right diagonal. */
function gradientAt(t) {
  const stops = [
    { at: 0.0, rgb: [10, 132, 255] },   // systemBlue
    { at: 0.55, rgb: [94, 92, 230] },   // systemIndigo
    { at: 1.0, rgb: [191, 90, 242] },   // systemPurple
  ];
  const k = clamp01(t);
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    if (k <= b.at) {
      const local = (k - a.at) / (b.at - a.at);
      return a.rgb.map((v, j) => Math.round(lerp(v, b.rgb[j], local)));
    }
  }
  return stops.at(-1).rgb;
}

// ── Drawing ───────────────────────────────────────────────────────────────────

const SS = 3; // supersampling factor per axis

function drawAppIcon(size = 1024) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  // macOS icon grid: the shape occupies ~80% of the canvas, rest is padding.
  const radius = size * 0.402;

  // Checkmark control points, expressed as fractions of the canvas.
  const p = (fx, fy) => [size * fx, size * fy];
  const [ax, ay] = p(0.345, 0.508);
  const [bx, by] = p(0.452, 0.618);
  const [ex, ey] = p(0.668, 0.392);
  const strokeHalf = size * 0.0345;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let shapeHits = 0;
      let markHits = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          if (!squircle(px, py, cx, cy, radius)) continue;
          shapeHits += 1;

          const d = Math.min(
            distToSegment(px, py, ax, ay, bx, by),
            distToSegment(px, py, bx, by, ex, ey),
          );
          if (d <= strokeHalf) markHits += 1;
        }
      }

      const total = SS * SS;
      const alpha = shapeHits / total;
      if (alpha === 0) continue;

      // Diagonal gradient position, plus a soft top gloss for depth.
      const t = clamp01((x / size) * 0.5 + (y / size) * 0.5);
      let [r, g, b] = gradientAt(t);

      const gloss = clamp01(1 - y / (size * 0.62)) ** 2 * 0.16;
      r = Math.round(lerp(r, 255, gloss));
      g = Math.round(lerp(g, 255, gloss));
      b = Math.round(lerp(b, 255, gloss));

      const mark = markHits / total;
      if (mark > 0) {
        r = Math.round(lerp(r, 255, mark));
        g = Math.round(lerp(g, 255, mark));
        b = Math.round(lerp(b, 255, mark));
      }

      const i = (y * size + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }

  return encodePng(size, size, rgba);
}

/**
 * Menu bar glyph: a checkmark inside a rounded outline, drawn in pure black
 * with alpha. macOS recolours template images to match the menu bar.
 */
function drawTrayIcon(size = 88) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const outer = size * 0.40;
  const ringWidth = size * 0.075;

  const p = (fx, fy) => [size * fx, size * fy];
  const [ax, ay] = p(0.335, 0.505);
  const [bx, by] = p(0.452, 0.625);
  const [ex, ey] = p(0.678, 0.372);
  const strokeHalf = size * 0.052;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          const inOuter = squircle(px, py, cx, cy, outer);
          const inInner = squircle(px, py, cx, cy, outer - ringWidth);
          const onRing = inOuter && !inInner;

          const d = Math.min(
            distToSegment(px, py, ax, ay, bx, by),
            distToSegment(px, py, bx, by, ex, ey),
          );
          if (onRing || d <= strokeHalf) hits += 1;
        }
      }

      const alpha = hits / (SS * SS);
      if (alpha === 0) continue;
      const i = (y * size + x) * 4;
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(ICON_DIR, { recursive: true });
writeFileSync(join(ICON_DIR, 'source.png'), drawAppIcon(1024));
writeFileSync(join(ICON_DIR, 'tray.png'), drawTrayIcon(88));
process.stdout.write(`✓ wrote source.png (1024²) and tray.png (88²) to ${ICON_DIR}\n`);
