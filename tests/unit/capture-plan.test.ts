import { describe, expect, it } from 'vitest';
import { BAND_MARGIN, planCapture } from '../../src/sidepanel/capture/plan';
import type { ElementSnapshot, Finding, PageSnapshot, Rect } from '../../src/shared/types';

/**
 * Which findings share a screenful.
 *
 * This is the arithmetic that decides where the page is scrolled to before each
 * capture, and getting it wrong does not produce a missing screenshot -- it
 * produces a confident photograph of the wrong part of the page, filed against
 * a finding, in a report somebody sends to a client. So it is worth more tests
 * than its size suggests.
 */

const VIEWPORT = { width: 1280, height: 800 };

function snapshot(rects: (Rect & { redacted?: boolean })[], documentHeight = 6000, scrollY = 0): PageSnapshot {
  return {
    id: 'snap-1',
    url: 'https://example.test/',
    title: 'Example',
    capturedAt: 0,
    viewport: {
      ...VIEWPORT,
      devicePixelRatio: 2,
      scrollX: 0,
      scrollY,
      documentWidth: VIEWPORT.width,
      documentHeight,
    },
    elements: rects.map((rect, index) => ({
      index,
      documentRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      redacted: rect.redacted ?? false,
    })) as unknown as ElementSnapshot[],
  } as unknown as PageSnapshot;
}

let counter = 0;
function finding(elementIndex: number | undefined, extra: Partial<Finding> = {}): Finding {
  counter += 1;
  return {
    id: `f${counter}`,
    ruleId: 'A11Y-001',
    category: 'a11y',
    severity: 'medium',
    type: 'rule',
    title: 'A finding',
    detail: '',
    status: 'open',
    createdAt: 0,
    updatedAt: 0,
    elementIndex,
    ...extra,
  } as unknown as Finding;
}

const at = (y: number, height = 40): Rect => ({ x: 100, y, width: 200, height });

describe('planning a capture sweep', () => {
  it('puts findings on the same screenful in one band', () => {
    // Three findings within 800px of each other is one capture, not three. The
    // saving is not theoretical: tab capture allows two calls a second.
    const plan = planCapture(
      [finding(0), finding(1), finding(2)],
      snapshot([at(200), at(400), at(600)]),
    );
    expect(plan.bands).toHaveLength(1);
    expect(plan.bands[0]!.indices).toEqual([0, 1, 2]);
  });

  it('starts a new band for a finding that will not fit in the current one', () => {
    const plan = planCapture([finding(0), finding(1)], snapshot([at(200), at(2000)]));
    expect(plan.bands).toHaveLength(2);
    expect(plan.bands[0]!.indices).toEqual([0]);
    expect(plan.bands[1]!.indices).toEqual([1]);
  });

  it('leaves context above the first finding in a band', () => {
    // Flush against the top of the screenful, a finding has nothing above it --
    // and context above is most of what tells you where you are on a page.
    const plan = planCapture([finding(0)], snapshot([at(500)]));
    expect(plan.bands[0]!.scrollY).toBe(500 - BAND_MARGIN);
  });

  it('anchors each band on its first finding rather than on a grid', () => {
    /*
     * A fixed grid of screenfuls wastes captures: a finding sitting just below
     * a boundary gets a band of its own with nothing else in it, and the band
     * above is mostly blank. Anchoring on the finding packs them.
     */
    const plan = planCapture(
      [finding(0), finding(1)],
      snapshot([at(790), at(1200)]),
    );
    expect(plan.bands).toHaveLength(1);
    expect(plan.bands[0]!.indices).toEqual([0, 1]);
  });

  it('orders bands down the page whatever order the findings arrive in', () => {
    const plan = planCapture(
      [finding(2), finding(0), finding(1)],
      snapshot([at(100), at(1500), at(3000)]),
    );
    expect(plan.bands.map((band) => band.indices)).toEqual([[0], [1], [2]]);
    const positions = plan.bands.map((band) => band.scrollY);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('photographs one element once however many rules it failed', () => {
    // A button can fail contrast, target size and accessible name at once.
    // Three findings, one element, one picture.
    const plan = planCapture(
      [finding(0), finding(0), finding(0)],
      snapshot([at(300)]),
    );
    expect(plan.bands).toHaveLength(1);
    expect(plan.bands[0]!.indices).toEqual([0]);
  });

  it('never scrolls past the end of the document', () => {
    const plan = planCapture([finding(0)], snapshot([at(5900)], 6000));
    // 6000 tall document, 800 tall viewport: 5200 is as far as it goes, and
    // asking for more would leave every rect off by the difference.
    expect(plan.bands[0]!.scrollY).toBe(5200);
  });

  it('never scrolls to a negative position', () => {
    const plan = planCapture([finding(0)], snapshot([at(10)]));
    expect(plan.bands[0]!.scrollY).toBe(0);
  });

  it('photographs an element taller than the screen from its top', () => {
    // Clipped is not useless: the top of a too-tall element still shows where
    // it starts and what is around it.
    const plan = planCapture([finding(0)], snapshot([at(400, 2000)]));
    expect(plan.bands).toHaveLength(1);
    expect(plan.bands[0]!.indices).toEqual([0]);
  });

  it('does not sweep a too-tall element into a band it starts below', () => {
    const plan = planCapture(
      [finding(0), finding(1)],
      snapshot([at(100), at(3000, 2000)]),
    );
    expect(plan.bands).toHaveLength(2);
    expect(plan.bands[1]!.indices).toEqual([1]);
  });

  it('says why each skipped finding was skipped', () => {
    const plan = planCapture(
      [
        finding(0),
        finding(1),
        finding(2),
        finding(undefined),
        finding(99),
      ],
      snapshot([at(100), { ...at(200), redacted: true }, { x: 0, y: 300, width: 200, height: 0 }]),
    );
    expect(plan.bands[0]!.indices).toEqual([0]);
    expect(plan.skipped.map((entry) => entry.reason)).toEqual(['redacted', 'no-size', 'no-element']);
  });

  it('says nothing about a finding that was never about an element', () => {
    // A page with no h1 has nothing to photograph, and that is not a failure
    // worth reporting to anybody.
    const plan = planCapture([finding(undefined)], snapshot([at(100)]));
    expect(plan.skipped).toEqual([]);
    expect(plan.bands).toEqual([]);
  });

  it('remembers where the user had the page', () => {
    const plan = planCapture([finding(0)], snapshot([at(3000)], 6000, 1234));
    expect(plan.restoreY).toBe(1234);
  });

  it('clamps a restore position the document cannot honour', () => {
    const plan = planCapture([finding(0)], snapshot([at(300)], 900, 800));
    expect(plan.restoreY).toBe(100);
  });

  it('plans nothing at all when no finding has an element', () => {
    expect(planCapture([], snapshot([at(100)])).bands).toEqual([]);
  });
});
