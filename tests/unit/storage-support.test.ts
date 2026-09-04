import { beforeEach, describe, expect, it } from 'vitest';
import { element, resetIndexes, snapshot } from './helpers/snapshot';
import { digestFor, locationIndex } from '../../src/audit/engine/digest';
import { cropScale } from '../../src/sidepanel/capture/crop';
import { CONTEXT_PADDING, cropWindow, MIN_CROP } from '../../src/sidepanel/capture/compose';
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

describe('the crop window', () => {
  /*
   * The framing arithmetic, which replaced cropRegion.
   *
   * Same class of bug, moved: get this wrong and the report carries a
   * confident photograph of the wrong part of the page, which is a worse
   * outcome than no photograph at all.
   */
  const viewport = { width: 1280, height: 800 };

  it('centres the window on the element', () => {
    const window = cropWindow({ x: 600, y: 380, width: 80, height: 40 }, viewport);
    expect(window.x + window.width / 2).toBeCloseTo(640);
    expect(window.y + window.height / 2).toBeCloseTo(400);
  });

  it('never goes below the minimum, however small the element', () => {
    // A 40x18 button with 8px of padding was the old behaviour, and a
    // photograph of a 56x34 grey rectangle is not a photograph of anything.
    const window = cropWindow({ x: 600, y: 380, width: 40, height: 18 }, viewport);
    expect(window.width).toBe(MIN_CROP.width);
    expect(window.height).toBe(MIN_CROP.height);
  });

  it('gives a large element real context on every side', () => {
    const window = cropWindow({ x: 400, y: 300, width: 500, height: 200 }, viewport);
    expect(window.width).toBe(500 + CONTEXT_PADDING * 2);
    expect(window.height).toBe(200 + CONTEXT_PADDING * 2);
  });

  it('slides back inside the viewport rather than hanging off it', () => {
    // A window past the edge would be padded with blank canvas, which reads as
    // empty page rather than as a crop that ran out of room.
    const topLeft = cropWindow({ x: 0, y: 0, width: 20, height: 20 }, viewport);
    expect(topLeft.x).toBe(0);
    expect(topLeft.y).toBe(0);

    const bottomRight = cropWindow({ x: 1270, y: 790, width: 10, height: 10 }, viewport);
    expect(bottomRight.x + bottomRight.width).toBe(viewport.width);
    expect(bottomRight.y + bottomRight.height).toBe(viewport.height);
  });

  it('never asks for more than the viewport has', () => {
    const narrow = { width: 300, height: 150 };
    const window = cropWindow({ x: 10, y: 10, width: 280, height: 130 }, narrow);
    expect(window).toEqual({ x: 0, y: 0, width: 300, height: 150 });
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
