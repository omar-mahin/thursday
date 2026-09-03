import { beforeEach, describe, expect, it } from 'vitest';
import { element, resetIndexes, snapshot } from './helpers/snapshot';
import { digestFor, locationIndex } from '../../src/audit/engine/digest';
import { cropRegion, cropScale, CROP_PADDING } from '../../src/sidepanel/capture/crop';
import { base64ToBytes, dataUrlToBlob, parseDataUrl } from '../../src/shared/utils/base64';
import { newId } from '../../src/shared/utils/id';
import type { Finding } from '../../src/shared/types';

beforeEach(resetIndexes);

const finding = (elementIndex?: number): Finding => ({
  id: `f${elementIndex ?? 'page'}`,
  auditId: 'a',
  ruleId: 'UI-001',
  category: 'ui',
  type: 'rule',
  title: 't',
  severity: 'low',
  confidence: 1,
  summary: '',
  evidence: [],
  impact: '',
  recommendation: '',
  status: 'open',
  createdAt: 0,
  updatedAt: 0,
  ...(elementIndex === undefined ? {} : { elementIndex }),
});

describe('snapshot digest', () => {
  const page = snapshot([
    element({ documentRect: { x: 0, y: 0, width: 10, height: 10 } }),
    element({ documentRect: { x: 1, y: 2, width: 3, height: 4 } }),
    element({ documentRect: { x: 5, y: 6, width: 7, height: 8 } }),
  ]);

  it('keeps only the elements a finding points at', () => {
    // Storing 1500 measured elements to reopen one audit would cost megabytes
    // for facts nothing reads back.
    const digest = digestFor(page, [finding(2), finding()]);
    expect(digest.locations).toEqual([{ index: 2, documentRect: { x: 5, y: 6, width: 7, height: 8 } }]);
    expect(digest.elementCount).toBe(3);
  });

  it('keeps one location per element even when several findings share it', () => {
    const digest = digestFor(page, [finding(1), { ...finding(1), id: 'other' }]);
    expect(digest.locations).toHaveLength(1);
  });

  it('carries the snapshot id, so pins can be checked against it', () => {
    expect(digestFor(page, []).snapshotId).toBe(page.id);
  });

  it('carries the page identity a reopened audit has to show', () => {
    const digest = digestFor(page, []);
    expect(digest.url).toBe(page.url);
    expect(digest.title).toBe(page.title);
    expect(digest.viewport).toEqual(page.viewport);
  });

  it('ignores an index the snapshot does not have', () => {
    expect(digestFor(page, [finding(99)]).locations).toEqual([]);
  });

  it('indexes locations for lookup, and tolerates no digest at all', () => {
    expect(locationIndex(digestFor(page, [finding(1)])).get(1)?.documentRect.x).toBe(1);
    expect(locationIndex(null).size).toBe(0);
  });
});

describe('crop scale', () => {
  it('measures the scale from the image rather than trusting devicePixelRatio', () => {
    // Browser zoom changes the ratio between CSS pixels and captured pixels,
    // and the captured area is the real content area rather than whatever the
    // page believes its viewport to be. Dividing is exact in both cases.
    expect(cropScale({ width: 2560, height: 1600 }, { width: 1280, height: 800 }, 1)).toBe(2);
    expect(cropScale({ width: 1280, height: 633 }, { width: 1280, height: 720 }, 2)).toBe(1);
  });

  it('falls back to devicePixelRatio when the viewport is unknown', () => {
    expect(cropScale({ width: 100, height: 100 }, { width: 0, height: 0 }, 3)).toBe(3);
    expect(cropScale({ width: 100, height: 100 }, { width: 0, height: 0 }, 0)).toBe(1);
  });

  it('refuses an image that cannot be of this page at all', () => {
    // A capture of another tab, cropped at plausible coordinates, is a wrong
    // screenshot rather than a failed one -- which is much worse.
    expect(cropScale({ width: 400, height: 300 }, { width: 1280, height: 720 }, 1)).toBeNull();
    expect(cropScale({ width: 9000, height: 300 }, { width: 1280, height: 720 }, 1)).toBeNull();
  });
});

describe('crop geometry', () => {
  const image = { width: 2560, height: 1600 };

  it('scales a CSS rect by the measured scale', () => {
    expect(cropRegion({ x: 100, y: 50, width: 200, height: 40 }, image, 2, 0)).toEqual({
      x: 200,
      y: 100,
      width: 400,
      height: 80,
    });
  });

  it('adds padding so the element is not cut flush to its edge', () => {
    expect(cropRegion({ x: 100, y: 50, width: 200, height: 40 }, image, 1)).toEqual({
      x: 100 - CROP_PADDING,
      y: 50 - CROP_PADDING,
      width: 200 + CROP_PADDING * 2,
      height: 40 + CROP_PADDING * 2,
    });
  });

  it('clamps to the image instead of asking for pixels it does not have', () => {
    // Canvas pads a region beyond the image with transparency, which looks
    // like empty space around the element rather than a clipped crop.
    expect(cropRegion({ x: -20, y: -20, width: 100, height: 100 }, image, 1, 0)).toEqual({
      x: 0,
      y: 0,
      width: 80,
      height: 80,
    });
  });

  it('clamps at the bottom-right corner too', () => {
    expect(cropRegion({ x: 2500, y: 1580, width: 400, height: 400 }, image, 1, 0)).toEqual({
      x: 2500,
      y: 1580,
      width: 60,
      height: 20,
    });
  });

  it('refuses an element that is entirely outside the captured area', () => {
    expect(cropRegion({ x: 4000, y: 0, width: 100, height: 100 }, image, 1, 0)).toBeNull();
    expect(cropRegion({ x: 0, y: -500, width: 100, height: 100 }, image, 1, 0)).toBeNull();
  });

  it('refuses a collapsed element', () => {
    expect(cropRegion({ x: 10, y: 10, width: 0, height: 0 }, image, 1, 0)).toBeNull();
  });

  it('treats a nonsense scale as 1', () => {
    expect(cropRegion({ x: 0, y: 0, width: 10, height: 10 }, image, 0, 0)).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
  });
});

describe('base64 without the network', () => {
  it('decodes base64 to the right bytes', () => {
    expect([...base64ToBytes('AAECAw==')]).toEqual([0, 1, 2, 3]);
  });

  it('splits a data URL into mime and payload', () => {
    expect(parseDataUrl('data:image/png;base64,AAEC')).toEqual({ mime: 'image/png', base64: 'AAEC' });
  });

  it('refuses a data URL that is not base64', () => {
    expect(parseDataUrl('data:text/plain,hello')).toBeNull();
    expect(parseDataUrl('https://example.test/a.png')).toBeNull();
  });

  it('builds a Blob of the right type and size, with no fetch anywhere', () => {
    const blob = dataUrlToBlob('data:image/png;base64,AAECAw==');
    expect(blob?.type).toBe('image/png');
    expect(blob?.size).toBe(4);
  });

  it('returns nothing for a data URL it cannot decode', () => {
    expect(dataUrlToBlob('data:image/png,raw')).toBeNull();
  });
});

describe('ids', () => {
  it('produces distinct ids', () => {
    const ids = new Set(Array.from({ length: 500 }, newId));
    expect(ids.size).toBe(500);
  });

  it('produces an id even where crypto.randomUUID is unavailable', () => {
    // Thursday runs on plain http pages, where randomUUID does not exist.
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      expect(newId()).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});
