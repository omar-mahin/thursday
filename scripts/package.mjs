/**
 * Builds the store upload: one zip of dist/, nothing else.
 *
 * Written by hand rather than with a zip library, for the same reason the icon
 * generator is: a packaging step is the last thing that touches the bytes users
 * install, and it should not be the thing that pulls in a dependency nobody has
 * read. Store zips need no compression to be accepted, so this writes stored
 * (uncompressed) entries -- about a hundred lines of the format, all of it here
 * to look at. The build is 368KB; the saving is not worth a supply chain.
 *
 * Run `npm run package` (which builds and checks the bundle first).
 */
import { createWriteStream } from 'node:fs';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const OUT_DIR = 'release';

/** CRC-32, as the zip format specifies it. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

/** MS-DOS date and time, which is what a zip entry stores. */
function dosStamp(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

// Read from the artifact, not from the source of truth that produced it: the
// zip is named after the version being shipped, whatever the build put there.
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
} catch {
  console.error('\ndist/manifest.json is missing. Run "npm run build" first.\n');
  process.exit(1);
}

const files = walk(DIST).map((path) => ({
  name: relative(DIST, path).split('\\').join('/'),
  data: readFileSync(path),
}));

if (files.length === 0) {
  console.error('\ndist/ is empty. Run "npm run build" first.\n');
  process.exit(1);
}

const stamp = dosStamp(new Date());
const chunks = [];
const central = [];
let offset = 0;

for (const file of files) {
  const name = Buffer.from(file.name, 'utf8');
  const crc = crc32(file.data);
  // Method 0 (stored). Version 2.0, no flags, no extra fields.
  const local = Buffer.concat([
    u32(0x04_03_4b_50),
    u16(20),
    u16(0),
    u16(0),
    u16(stamp.time),
    u16(stamp.day),
    u32(crc),
    u32(file.data.length),
    u32(file.data.length),
    u16(name.length),
    u16(0),
    name,
  ]);
  chunks.push(local, file.data);

  central.push(
    Buffer.concat([
      u32(0x02_01_4b_50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(stamp.time),
      u16(stamp.day),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]),
  );
  offset += local.length + file.data.length;
}

const directory = Buffer.concat(central);
const end = Buffer.concat([
  u32(0x06_05_4b_50),
  u16(0),
  u16(0),
  u16(files.length),
  u16(files.length),
  u32(directory.length),
  u32(offset),
  u16(0),
]);

mkdirSync(OUT_DIR, { recursive: true });
const target = join(OUT_DIR, `thursday-${manifest.version}.zip`);
rmSync(target, { force: true });

const stream = createWriteStream(target);
for (const chunk of chunks) stream.write(chunk);
stream.write(directory);
stream.write(end);
stream.end();

stream.on('finish', () => {
  const bytes = statSync(target).size;
  console.log(`packaged ${files.length} files into ${target} (${(bytes / 1024).toFixed(0)}KB)`);
  console.log(`version ${manifest.version}, permissions: ${manifest.permissions.join(', ')}`);
});
