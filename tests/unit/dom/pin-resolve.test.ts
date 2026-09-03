import { beforeEach, describe, expect, it } from 'vitest';
import type { Pin } from '../../../src/shared/types';
import { resolvePinTargets } from '../../../src/content/pins/resolve';

const pin = (overrides: Partial<Pin> = {}): Pin => ({
  findingId: 'f1',
  snapshotId: 'snap-A',
  ordinal: 1,
  severity: 'high',
  elementIndex: 1,
  documentRect: { x: 0, y: 0, width: 10, height: 10 },
  ref: {
    tagName: 'button',
    structuralPath: '',
    ancestry: [],
    rect: { x: 0, y: 0, width: 10, height: 10 },
    centroid: { x: 5, y: 5 },
  },
  ...overrides,
});

let first: HTMLElement;
let second: HTMLElement;
let laddered: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  first = document.createElement('button');
  second = document.createElement('button');
  laddered = document.createElement('button');
  document.body.append(first, second, laddered);
});

describe('what a pin points at', () => {
  it('uses the measured element when the snapshot matches', () => {
    const [target] = resolvePinTargets([pin()], {
      snapshotId: 'snap-A',
      measured: [first, second],
      resolve: () => laddered,
    });
    expect(target?.element).toBe(second);
    expect(target?.approximate).toBe(false);
  });

  it('refuses an index from a different snapshot', () => {
    // This is the whole reason pins carry a snapshot id. Index 1 of one
    // snapshot is an unrelated element in another, and a confident pin on the
    // wrong element is worse than an honest approximate one.
    const [target] = resolvePinTargets([pin({ snapshotId: 'snap-B' })], {
      snapshotId: 'snap-A',
      measured: [first, second],
      resolve: () => laddered,
    });
    expect(target?.element).toBe(laddered);
    expect(target?.approximate).toBe(true);
  });

  it('refuses a measured element that has left the document', () => {
    second.remove();
    const [target] = resolvePinTargets([pin()], {
      snapshotId: 'snap-A',
      measured: [first, second],
      resolve: () => laddered,
    });
    expect(target?.element).toBe(laddered);
    expect(target?.approximate).toBe(true);
  });

  it('falls back to the ladder when nothing was measured at all', () => {
    // The case after a restart: a reopened audit with no snapshot behind it.
    const [target] = resolvePinTargets([pin()], {
      snapshotId: null,
      measured: [],
      resolve: () => laddered,
    });
    expect(target?.element).toBe(laddered);
    expect(target?.approximate).toBe(true);
  });

  it('still produces a target when the element cannot be found', () => {
    // The pin exists but is unplaced; the layer falls back to the stored rect.
    const [target] = resolvePinTargets([pin()], {
      snapshotId: null,
      measured: [],
      resolve: () => null,
    });
    expect(target?.element).toBeNull();
    expect(target?.approximate).toBe(true);
  });

  it('resolves each pin independently', () => {
    const targets = resolvePinTargets(
      [pin({ findingId: 'a', elementIndex: 0 }), pin({ findingId: 'b', elementIndex: 9 })],
      { snapshotId: 'snap-A', measured: [first, second], resolve: () => laddered },
    );
    expect(targets.map((target) => target.approximate)).toEqual([false, true]);
  });
});
