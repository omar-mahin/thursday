import type { Rect, StyleSnapshot } from '../../shared/types';

/**
 * All layout reads happen here, in two batched passes over the whole candidate
 * set. Never interleave a rect read with a style read per element: that forces
 * a synchronous layout every iteration and turns 400ms into 4s.
 */

export type Measured = {
  element: Element;
  rect: Rect;
  style: CSSStyleDeclaration;
};

const round = (value: number): number => Math.round(value * 10) / 10;

export const toRect = (rect: DOMRect | { x: number; y: number; width: number; height: number }): Rect => ({
  x: round(rect.x),
  y: round(rect.y),
  width: round(rect.width),
  height: round(rect.height),
});

export function measureAll(elements: readonly Element[]): Measured[] {
  // Pass 1: geometry. This flushes pending layout exactly once.
  const rects: Rect[] = new Array(elements.length);
  for (let index = 0; index < elements.length; index += 1) {
    rects[index] = toRect(elements[index]!.getBoundingClientRect());
  }

  // Pass 2: computed styles, now that layout is clean.
  const measured: Measured[] = new Array(elements.length);
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    measured[index] = {
      element,
      rect: rects[index]!,
      style: getComputedStyle(element),
    };
  }
  return measured;
}

const px = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? round(parsed) : 0;
};

const has = (value: string): boolean => value !== '' && value !== 'none' && value !== 'normal';

export function toStyleSnapshot(style: CSSStyleDeclaration): StyleSnapshot {
  return {
    display: style.display,
    position: style.position,
    visibility: style.visibility,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    zIndex: style.zIndex,
    cursor: style.cursor,
    opacity: Number.parseFloat(style.opacity) || 0,

    color: style.color,
    backgroundColor: style.backgroundColor,
    hasBackgroundImage: has(style.backgroundImage),
    hasBackdropFilter: has(style.backdropFilter),
    mixBlendMode: style.mixBlendMode,
    borderColor: style.borderTopColor,
    borderRadius: style.borderRadius,
    borderWidths: [
      px(style.borderTopWidth),
      px(style.borderRightWidth),
      px(style.borderBottomWidth),
      px(style.borderLeftWidth),
    ],
    hasBoxShadow: has(style.boxShadow),

    fontFamily: style.fontFamily,
    fontSize: px(style.fontSize),
    fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textTransform: style.textTransform,
    textAlign: style.textAlign,
    textDecorationLine: style.textDecorationLine,

    margin: [px(style.marginTop), px(style.marginRight), px(style.marginBottom), px(style.marginLeft)],
    padding: [px(style.paddingTop), px(style.paddingRight), px(style.paddingBottom), px(style.paddingLeft)],
    boxSizing: style.boxSizing,
  };
}
