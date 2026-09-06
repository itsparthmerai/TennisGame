// Generates retro pixel-art app icons (PNG) with zero dependencies, using
// only Node's built-in zlib deflate. Run: node scripts/gen-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

function encodePNG(width, height, rgbaPixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = chunk('IHDR', ihdrData);

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgbaPixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

// --- Pixel-art design: retro tennis ball on a court-green background ---
// Designed on a 16x16 grid, then nearest-neighbor scaled up to target size.
const G = 16;
const BG1 = [0x0e, 0x3a, 0x2b, 255]; // dark retro court green
const BG2 = [0x14, 0x53, 0x3d, 255]; // lighter green (checker)
const LINE = [0xf4, 0xf1, 0xe6, 255]; // chalk white
const BALL = [0xd8, 0xe6, 0x3a, 255]; // tennis ball yellow-green
const BALL_SHADE = [0xaf, 0xbd, 0x1e, 255];
const SEAM = [0xf4, 0xf1, 0xe6, 255];
const OUTLINE = [0x08, 0x22, 0x18, 255];

function buildGrid() {
  const grid = [];
  for (let y = 0; y < G; y++) {
    const row = [];
    for (let x = 0; x < G; x++) {
      row.push(((x >> 1) + (y >> 1)) % 2 === 0 ? BG1 : BG2);
    }
    grid.push(row);
  }
  // court line border
  for (let x = 1; x < G - 1; x++) {
    grid[1][x] = LINE;
    grid[G - 2][x] = LINE;
  }
  for (let y = 1; y < G - 1; y++) {
    grid[y][1] = LINE;
    grid[y][G - 2] = LINE;
  }
  // ball circle (radius ~5.5 centered at 8,8.5) with outline + seam + shade
  const cx = 7.5, cy = 8;
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= 5.6) {
        if (d > 4.9) grid[y][x] = OUTLINE;
        else grid[y][x] = dx + dy > 2 ? BALL_SHADE : BALL;
      }
    }
  }
  // seam curves (two simple arcs) drawn as pixels
  const seamPts = [
    [3, 5], [4, 4], [5, 4], [6, 5], [7, 6], [7, 7],
    [3, 11], [4, 12], [5, 12], [6, 11], [7, 10], [7, 9],
    [11, 5], [10, 5], [12, 6], [11, 7],
    [11, 11], [10, 11], [12, 10], [11, 9],
  ];
  for (const [x, y] of seamPts) {
    const dx = x - cx, dy = y - cy;
    if (Math.sqrt(dx * dx + dy * dy) <= 5.4) grid[y][x] = SEAM;
  }
  return grid;
}

function renderIcon(size, { maskable = false } = {}) {
  const grid = buildGrid();
  const pad = maskable ? Math.round(size * 0.12) : 0; // safe zone for maskable icons
  const inner = size - pad * 2;
  const pixels = Buffer.alloc(size * size * 4, 0);
  // background fill for padded maskable canvas
  if (maskable) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        pixels[i] = BG1[0]; pixels[i + 1] = BG1[1]; pixels[i + 2] = BG1[2]; pixels[i + 3] = 255;
      }
    }
  }
  const scale = inner / G;
  for (let y = 0; y < inner; y++) {
    const gy = Math.min(G - 1, Math.floor(y / scale));
    for (let x = 0; x < inner; x++) {
      const gx = Math.min(G - 1, Math.floor(x / scale));
      const c = grid[gy][gx];
      const px = x + pad, py = y + pad;
      const i = (py * size + px) * 4;
      pixels[i] = c[0]; pixels[i + 1] = c[1]; pixels[i + 2] = c[2]; pixels[i + 3] = c[3];
    }
  }
  return encodePNG(size, size, pixels);
}

const outDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { name: 'icon-32.png', size: 32 },
  { name: 'icon-180.png', size: 180 }, // apple-touch-icon
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-maskable-192.png', size: 192, maskable: true },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
];

for (const t of targets) {
  const buf = renderIcon(t.size, { maskable: t.maskable });
  fs.writeFileSync(path.join(outDir, t.name), buf);
  console.log('wrote', t.name, buf.length, 'bytes');
}
