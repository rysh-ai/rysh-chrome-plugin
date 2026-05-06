#!/usr/bin/env node
// generate-icons.js — Pure Node.js PNG icon generator (no external deps).
// Uses built-in zlib and fs to write valid PNG files.
// Draws a simple "R" lettermark on an indigo (#4f46e5) background.
// Run: node generate-icons.js

import zlib from 'node:zlib';
import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Rysh brand colours ─────────────────────────────────────────────────────
const BG_R = 0x4f, BG_G = 0x46, BG_B = 0xe5; // #4f46e5 indigo
const FG_R = 0xff, FG_G = 0xff, FG_B = 0xff; // white

// ── PNG helpers ────────────────────────────────────────────────────────────
function uint32BE(n) {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const crcInput  = Buffer.concat([typeBytes, data]);
  return Buffer.concat([
    uint32BE(data.length),
    typeBytes,
    data,
    uint32BE(crc32(crcInput)),
  ]);
}

function makePNG(width, height, pixels) {
  // pixels: Uint8Array of length width*height*4 (RGBA)
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.concat([
    uint32BE(width), uint32BE(height),
    Buffer.from([8, 2, 0, 0, 0]), // 8-bit depth, RGB colour type, no interlace
  ]);

  // Build raw scanlines (filter byte 0 per row, then RGB triples)
  const rowBytes = 1 + width * 3;
  const raw = Buffer.allocUnsafe(height * rowBytes);
  for (let y = 0; y < height; y++) {
    raw[y * rowBytes] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = y * rowBytes + 1 + x * 3;
      raw[dst]     = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      // alpha ignored (we use opaque colours)
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    PNG_SIG,
    makeChunk('IHDR', ihdrData),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Pixel renderer ─────────────────────────────────────────────────────────
function renderIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  // Fill background with rounded-rect indigo
  const radius = Math.round(size * 0.22);

  function roundedRect(x, y) {
    const dx = Math.max(radius - x, 0, x - (size - 1 - radius));
    const dy = Math.max(radius - y, 0, y - (size - 1 - radius));
    return dx * dx + dy * dy <= radius * radius;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      if (roundedRect(x, y)) {
        pixels[idx]     = BG_R;
        pixels[idx + 1] = BG_G;
        pixels[idx + 2] = BG_B;
        pixels[idx + 3] = 255;
      } else {
        pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = 0;
        pixels[idx + 3] = 0; // transparent
      }
    }
  }

  // Draw the "R" lettermark using a simple pixel-stroke approach
  // scaled proportionally to the icon size
  drawR(pixels, size);

  return pixels;
}

function setPixel(pixels, size, x, y, r, g, b) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const idx = (y * size + x) * 4;
  pixels[idx]     = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
  pixels[idx + 3] = 255;
}

function drawThickLine(pixels, size, x0, y0, x1, y1, thickness, r, g, b) {
  // Bresenham with thickness via perpendicular fill
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len, ny = dx / len; // normal
  const half = thickness / 2;
  const steps = Math.ceil(len) * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x0 + dx * t;
    const cy = y0 + dy * t;
    for (let w = -half; w <= half; w += 0.5) {
      setPixel(pixels, size, cx + nx * w, cy + ny * w, r, g, b);
    }
  }
}

function drawArc(pixels, size, cx, cy, rx, ry, startAngle, endAngle, thickness, r, g, b) {
  const steps = Math.ceil((endAngle - startAngle) * Math.max(rx, ry) * 2);
  const half = thickness / 2;
  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + (endAngle - startAngle) * (i / steps);
    const px = cx + Math.cos(angle) * rx;
    const py = cy + Math.sin(angle) * ry;
    // Draw a small disc at this point for thickness
    for (let dy = -half; dy <= half; dy += 0.5) {
      for (let dx = -half; dx <= half; dx += 0.5) {
        if (dx * dx + dy * dy <= half * half) {
          setPixel(pixels, size, px + dx, py + dy, r, g, b);
        }
      }
    }
  }
}

function drawR(pixels, size) {
  // All coordinates are normalised to a 0–1 grid, then scaled.
  const s = size;
  const t = Math.max(1.5, s * 0.115); // stroke thickness

  // "R" geometry (in normalised coords, origin top-left of the letter bounding box)
  // Letter occupies roughly 25%–75% horizontally, 20%–82% vertically of the icon.
  const lx = s * 0.27;  // left edge of vertical stem
  const rx = s * 0.68;  // right extent of bowl / leg
  const ty = s * 0.20;  // top of letter
  const by = s * 0.82;  // bottom of letter
  const midY = ty + (by - ty) * 0.45; // midpoint where bowl ends

  // Vertical stem (left): top to bottom
  drawThickLine(pixels, s, lx, ty, lx, by, t, FG_R, FG_G, FG_B);

  // Bowl — semicircle on the right side of the top half
  const bowlCX = lx;
  const bowlCY = ty + (midY - ty) / 2;
  const bowlRX = (rx - lx) * 0.52;
  const bowlRY = (midY - ty) / 2;
  drawArc(pixels, s, bowlCX, bowlCY, bowlRX, bowlRY, -Math.PI / 2, Math.PI / 2, t, FG_R, FG_G, FG_B);

  // Top horizontal bar (connecting stem to bowl top)
  drawThickLine(pixels, s, lx, ty, lx + bowlRX * 0.05, ty, t, FG_R, FG_G, FG_B);

  // Mid horizontal bar (connecting stem to bowl bottom)
  drawThickLine(pixels, s, lx, midY, lx + bowlRX * 0.05, midY, t, FG_R, FG_G, FG_B);

  // Diagonal leg: from mid-right down to bottom-right
  const legStartX = lx + bowlRX * 0.95;
  const legStartY = midY;
  drawThickLine(pixels, s, legStartX, legStartY, rx, by, t, FG_R, FG_G, FG_B);
}

// ── Generate and write icons ──────────────────────────────────────────────
const SIZES = [16, 48, 128];
const outDir = fileURLToPath(new URL('.', import.meta.url));

for (const size of SIZES) {
  const pixels = renderIcon(size);
  const png    = makePNG(size, size, pixels);
  const outPath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${size}x${size})`);
}

console.log('Done.');
