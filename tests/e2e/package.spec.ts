import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { chromium, expect, extensionPage, test } from './fixtures';

/**
 * The artifact users install.
 *
 * Every other test runs `dist/`. This one packages it, opens the zip back up,
 * checks the bytes survived, and loads the *extracted* copy in Chromium. The
 * packaging step is hand-written (see scripts/package.mjs), so "the zip is
 * valid" is a claim that needs testing rather than assuming, and a store upload
 * that unpacks into something Chrome refuses is the worst possible time to find
 * out.
 */

/** Entry names, sizes and CRCs, read out of the zip's central directory. */
function readCentralDirectory(zip: Buffer): Array<{ name: string; crc: number; size: number }> {
  // Find the end-of-central-directory record, scanning back from the tail.
  let end = -1;
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (zip.readUInt32LE(i) === 0x0605_4b50) {
      end = i;
      break;
    }
  }
  expect(end, 'no end-of-central-directory record: this is not a zip').toBeGreaterThanOrEqual(0);

  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries: Array<{ name: string; crc: number; size: number }> = [];

  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(offset)).toBe(0x0201_4b50);
    const crc = zip.readUInt32LE(offset + 16);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    entries.push({
      name: zip.toString('utf8', offset + 46, offset + 46 + nameLength),
      crc,
      size,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Buffer): number => {
  let crc = 0xffff_ffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffff_ffff) >>> 0;
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

test('the packaged zip contains exactly the build, byte for byte', async () => {
  execFileSync('node', ['scripts/package.mjs'], { stdio: 'pipe' });

  const version = (JSON.parse(readFileSync('dist/manifest.json', 'utf8')) as { version: string }).version;
  const zipPath = resolve('release', `thursday-${version}.zip`);
  const entries = readCentralDirectory(readFileSync(zipPath));

  const onDisk = walk('dist').map((path) => ({
    name: relative('dist', path).split('\\').join('/'),
    data: readFileSync(path),
  }));

  expect(entries.map((entry) => entry.name).sort()).toEqual(onDisk.map((file) => file.name).sort());

  for (const file of onDisk) {
    const entry = entries.find((item) => item.name === file.name);
    expect(entry, `${file.name} is missing from the zip`).toBeDefined();
    expect(entry!.size, `${file.name} size`).toBe(file.data.length);
    // The CRC is the actual integrity check: a truncated or reordered write
    // would still produce plausible sizes.
    expect(entry!.crc, `${file.name} checksum`).toBe(crc32(file.data));
  }

  // The manifest is in there, and it is the one that was reviewed.
  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json');
  expect(manifestEntry).toBeDefined();
});

test('the extracted zip loads and runs in Chrome', async () => {
  execFileSync('node', ['scripts/package.mjs'], { stdio: 'pipe' });
  const version = (JSON.parse(readFileSync('dist/manifest.json', 'utf8')) as { version: string }).version;
  const zipPath = resolve('release', `thursday-${version}.zip`);

  // Unpacked with the system tool, so this exercises a real unzip rather than
  // the same code that wrote the file.
  const unpacked = mkdtempSync(join(tmpdir(), 'thursday-zip-'));
  execFileSync('unzip', ['-q', zipPath, '-d', unpacked], { stdio: 'pipe' });

  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'thursday-pkg-')), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;

    // The three surfaces a user can open, from the extracted artifact.
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/panel.html`);
    await expect(panel.locator('.panel-head')).toBeVisible();

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('button', { name: /Activate|Open audit panel/ })).toBeVisible();

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.getByRole('heading', { name: /settings/i })).toBeVisible();

    // And the permission set survived packaging unchanged.
    const permissions = await (await extensionPage(context, extensionId)).evaluate(() => chrome.runtime.getManifest().permissions);
    expect(permissions).toEqual(['storage', 'activeTab', 'scripting', 'sidePanel']);
    const shipped = await (await extensionPage(context, extensionId)).evaluate(() => chrome.runtime.getManifest() as Record<string, unknown>);
    expect(shipped['host_permissions']).toBeUndefined();
    expect(shipped['content_scripts']).toBeUndefined();
  } finally {
    await context.close();
  }
});
