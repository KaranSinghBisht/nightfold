// Generate every image of the Nightfold mark from one grid.
//
//     npm run logo
//
// The nav mark, the favicon and the social card were three chances to drift
// apart, so they are all derived from ui/src/arcade/logo.json. Change the grid
// and rerun; nothing else needs touching.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const logo = JSON.parse(readFileSync(at('../ui/src/arcade/logo.json'), 'utf8'));

const { grid, spade, muck, ground } = logo;
const cols = grid[0].length;
const rows = grid.length;

/** One <rect> per lit cell, merged along each row so the file stays small. */
function rects(fill, mark, scale = 1, dx = 0, dy = 0) {
  const out = [];
  for (let y = 0; y < rows; y++) {
    let run = 0;
    for (let x = 0; x <= cols; x++) {
      const lit = x < cols && grid[y][x] === mark;
      if (lit) { run++; continue; }
      if (run) {
        const w = run * scale;
        out.push(
          `<rect x="${(x - run) * scale + dx}" y="${y * scale + dy}" width="${w}" height="${scale}" fill="${fill}"/>`,
        );
        run = 0;
      }
    }
  }
  return out.join('');
}

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols} ${rows}" ` +
  `width="${cols}" height="${rows}" shape-rendering="crispEdges">` +
  rects(spade, '#') +
  rects(muck, '=') +
  '</svg>\n';

writeFileSync(at('../ui/public/favicon.svg'), svg);

// A maskable icon needs an opaque ground and a little breathing room, so the
// same grid is inset into a rounded square rather than redrawn.
const PAD = 3;
const size = cols + PAD * 2;
const maskable =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
  `width="${size}" height="${size}" shape-rendering="crispEdges">` +
  `<rect width="${size}" height="${size}" rx="4" fill="${ground}"/>` +
  rects(spade, '#', 1, PAD, PAD) +
  rects(muck, '=', 1, PAD, PAD) +
  '</svg>\n';

writeFileSync(at('../ui/public/icon-maskable.svg'), maskable);

// ---- PNG, by hand ----------------------------------------------------------
//
// Safari will not take an SVG for apple-touch-icon, and pulling an image
// library in for one 180px square is not worth it. zlib is in the standard
// library and PNG is four chunks, so the encoder lives here.

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Render the grid at `scale`, on `bg` (null for transparent), as a PNG. */
function png(scale, bg, pad = 0) {
  const w = (cols + pad * 2) * scale;
  const h = (rows + pad * 2) * scale;
  const back = bg ? [...rgb(bg), 255] : [0, 0, 0, 0];
  const ink = { '#': [...rgb(spade), 255], '=': [...rgb(muck), 255] };

  // One filter byte, then RGBA per pixel, per scanline.
  const raw = Buffer.alloc(h * (1 + w * 4));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const gx = Math.floor(x / scale) - pad;
      const gy = Math.floor(y / scale) - pad;
      const cell = gy >= 0 && gy < rows && gx >= 0 && gx < cols ? grid[gy][gx] : '.';
      const px = ink[cell] ?? back;
      raw[o++] = px[0]; raw[o++] = px[1]; raw[o++] = px[2]; raw[o++] = px[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 180px: iOS squares and rounds it itself, so it gets an opaque ground.
writeFileSync(at('../ui/public/apple-touch-icon.png'), png(10, ground, 1));
writeFileSync(at('../ui/public/icon-512.png'), png(32, ground, 0));

console.log(`mark: ${cols}x${rows}`);
for (const row of grid) console.log('  ' + row.replace(/\./g, ' '));
console.log('\nwrote favicon.svg, icon-maskable.svg, apple-touch-icon.png, icon-512.png');
