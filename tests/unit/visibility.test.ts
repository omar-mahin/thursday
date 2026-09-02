import { describe, expect, it } from 'vitest';
import {
  isFarOffscreen,
  isFocusable,
  isHiddenByStyle,
  isInteractive,
  isInViewport,
  isScreenReaderOnly,
  isZeroArea,
} from '../../src/content/snapshot/visibility';

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('isHiddenByStyle', () => {
  it('catches every common way of hiding an element', () => {
    const base = { display: 'block', visibility: 'visible', opacity: 1 };
    expect(isHiddenByStyle(base)).toBe(false);
    expect(isHiddenByStyle({ ...base, display: 'none' })).toBe(true);
    expect(isHiddenByStyle({ ...base, visibility: 'hidden' })).toBe(true);
    expect(isHiddenByStyle({ ...base, visibility: 'collapse' })).toBe(true);
    expect(isHiddenByStyle({ ...base, opacity: 0 })).toBe(true);
    expect(isHiddenByStyle({ ...base, contentVisibility: 'hidden' })).toBe(true);
  });

  it('does not treat a nearly-transparent element as hidden', () => {
    expect(isHiddenByStyle({ display: 'block', visibility: 'visible', opacity: 0.02 })).toBe(false);
  });
});

describe('geometry predicates', () => {
  it('treats sub-pixel elements as zero area', () => {
    expect(isZeroArea(rect(0, 0, 0, 10))).toBe(true);
    expect(isZeroArea(rect(0, 0, 0.4, 10))).toBe(true);
    expect(isZeroArea(rect(0, 0, 10, 10))).toBe(false);
  });

  it('keeps content within three viewports and drops the rest', () => {
    expect(isFarOffscreen(rect(0, 1000, 100, 50), 800, 1200)).toBe(false);
    expect(isFarOffscreen(rect(0, 2500, 100, 50), 800, 1200)).toBe(true);
    expect(isFarOffscreen(rect(0, -3000, 100, 50), 800, 1200)).toBe(true);
  });

  it('drops elements parked far to the side', () => {
    expect(isFarOffscreen(rect(9999, 0, 100, 50), 800, 1200)).toBe(true);
    expect(isFarOffscreen(rect(-2000, 0, 100, 50), 800, 1200)).toBe(true);
  });

  it('reports viewport intersection, including partial', () => {
    expect(isInViewport(rect(10, 10, 100, 50), 1200, 800)).toBe(true);
    expect(isInViewport(rect(10, -20, 100, 50), 1200, 800)).toBe(true);
    expect(isInViewport(rect(10, 900, 100, 50), 1200, 800)).toBe(false);
  });

  it('recognises the visually-hidden 1px trick', () => {
    expect(isScreenReaderOnly(rect(0, 0, 1, 1))).toBe(true);
    expect(isScreenReaderOnly(rect(0, 0, 40, 40))).toBe(false);
  });
});

describe('isInteractive', () => {
  const base = { hasHref: false, hasClickAttribute: false, tabIndex: -1 };

  it('recognises natively interactive elements', () => {
    expect(isInteractive({ ...base, tagName: 'button' })).toBe(true);
    expect(isInteractive({ ...base, tagName: 'select' })).toBe(true);
    expect(isInteractive({ ...base, tagName: 'input', inputType: 'text' })).toBe(true);
    expect(isInteractive({ ...base, tagName: 'input', inputType: 'hidden' })).toBe(false);
  });

  it('requires an href before calling an anchor interactive', () => {
    expect(isInteractive({ ...base, tagName: 'a' })).toBe(false);
    expect(isInteractive({ ...base, tagName: 'a', hasHref: true })).toBe(true);
  });

  it('recognises ARIA widget roles and hand-rolled handlers', () => {
    expect(isInteractive({ ...base, tagName: 'div', role: 'button' })).toBe(true);
    expect(isInteractive({ ...base, tagName: 'div', role: 'presentation' })).toBe(false);
    expect(isInteractive({ ...base, tagName: 'div', hasClickAttribute: true })).toBe(true);
    expect(isInteractive({ ...base, tagName: 'div', tabIndex: 0 })).toBe(true);
  });

  it('does not call a plain container interactive', () => {
    expect(isInteractive({ ...base, tagName: 'div' })).toBe(false);
    expect(isInteractive({ ...base, tagName: 'p' })).toBe(false);
  });
});

describe('isFocusable', () => {
  const base = { hasHref: false, hasClickAttribute: false, tabIndex: -1, disabled: false };

  it('excludes disabled controls', () => {
    expect(isFocusable({ ...base, tagName: 'button' })).toBe(true);
    expect(isFocusable({ ...base, tagName: 'button', disabled: true })).toBe(false);
  });

  it('honours an explicit tabindex, including a negative one', () => {
    expect(isFocusable({ ...base, tagName: 'div', tabIndex: 0 })).toBe(true);
    expect(isFocusable({ ...base, tagName: 'div', tabIndex: -1 })).toBe(false);
  });
});
