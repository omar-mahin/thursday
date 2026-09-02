/**
 * Generates the extension icons as PNGs with zero dependencies.
 * Run: npm run icons
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [17, 18, 23, 255]; // near-black
const FG = [242, 243, 245, 255]; // near-white
const ACCENT = [122, 162, 247, 255]; // the "lens" dot

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const px = pixels[y * size + x];
      raw.set(px, rowStart + 1 + x * 4);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Mark: a "T" over a dark rounded square, with an accent dot for the lens. */
function draw(size) {
  const s = (v) => Math.round(v * size);
  const radius = s(0.22);
  const px = new Array(size * size);
  const inRounded = (x, y) => {
    const nx = Math.min(x, size - 1 - x);
    const ny = Math.min(y, size - 1 - y);
    if (nx >= radius || ny >= radius) return true;
    const dx = radius - nx;
    const dy = radius - ny;
    return dx * dx + dy * dy <= radius * radius;
  };
  const barTop = s(0.26);
  const barBottom = barTop + Math.max(1, s(0.13));
  const barLeft = s(0.22);
  const barRight = size - barLeft;
  const stemHalf = Math.max(1, Math.round(s(0.065)));
  const mid = Math.round(size / 2);
  const stemBottom = s(0.74);
  const dotR = Math.max(1, s(0.085));
  const dotCx = size - s(0.26);
  const dotCy = size - s(0.26);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = [0, 0, 0, 0];
      if (inRounded(x, y)) color = BG;
      const onBar = y >= barTop && y < barBottom && x >= barLeft && x < barRight;
      const onStem = y >= barTop && y < stemBottom && x >= mid - stemHalf && x < mid + stemHalf;
      if (onBar || onStem) color = FG;
      const ddx = x - dotCx;
      const ddy = y - dotCy;
      if (size >= 32 && ddx * ddx + ddy * ddy <= dotR * dotR) color = ACCENT;
      px[y * size + x] = color;
    }
  }
  return px;
}

mkdirSync('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`public/icons/icon${size}.png`, encodePng(size, draw(size)));
  process.stdout.write(`icon${size}.png `);
}
console.log('written');
