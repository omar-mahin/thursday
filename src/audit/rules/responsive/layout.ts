import type { Rule } from '../../types';
import { describe, finding } from '../../types';

const OVERFLOW_TOLERANCE = 2;

/**
 * RESP-001 - the page scrolls sideways, and which element causes it.
 *
 * The document width alone tells you there is a problem; naming the widest
 * offending element is what makes it fixable.
 */
export const horizontalOverflow: Rule = {
  id: 'RESP-001',
  category: 'responsive',
  kind: 'rule',
  scope: 'page',
  description: 'The page should not scroll horizontally',
  run({ snapshot, candidates }) {
    const { width, documentWidth } = snapshot.viewport;
    const overflow = documentWidth - width;
    if (overflow <= OVERFLOW_TOLERANCE) return [];

    const offenders = candidates
      .filter((element) => element.documentRect.x + element.documentRect.width > width + OVERFLOW_TOLERANCE)
      .filter((element) => element.styles.position !== 'fixed')
      .sort(
        (a, b) =>
          b.documentRect.x + b.documentRect.width - (a.documentRect.x + a.documentRect.width),
      );
    const worst = offenders[0];

    return [
      finding(horizontalOverflow, {
        title: `Page scrolls ${Math.round(overflow)}px horizontally`,
        summary: worst
          ? `Content extends ${Math.round(overflow)}px past the viewport; the furthest element is ${describe(worst)}.`
          : `Content extends ${Math.round(overflow)}px past the ${width}px viewport.`,
        evidence: [
          `Viewport width ${width}px, document width ${Math.round(documentWidth)}px.`,
          ...(worst
            ? [
                `${describe(worst)} spans ${Math.round(worst.documentRect.x)}px to ${Math.round(worst.documentRect.x + worst.documentRect.width)}px.`,
                `Its width is ${Math.round(worst.documentRect.width)}px.`,
              ]
            : []),
          `${offenders.length} element(s) cross the right edge.`,
        ],
        impact: 'Horizontal scrolling on a page that does not expect it hides content and feels broken, especially on touch.',
        recommendation: worst
          ? `Constrain ${describe(worst)} with max-width: 100% or let it wrap.`
          : 'Find the element wider than the viewport and constrain it.',
        elementIndex: worst?.index,
        relatedIndexes: offenders.slice(0, 8).map((element) => element.index),
        severity: 'high',
        measurements: { overflow: Math.round(overflow), viewportWidth: width, documentWidth: Math.round(documentWidth) },
      }),
    ];
  },
};

/** Common phone widths this content would break at. */
const BREAKPOINTS = [390, 360, 320];

/**
 * RESP-002 - a fixed pixel width wider than a phone.
 *
 * Reported even when the current viewport is wide, because that is exactly when
 * the problem is invisible: it only shows up on a device the designer is not
 * looking at.
 */
export const fixedWidthBlocker: Rule = {
  id: 'RESP-002',
  category: 'responsive',
  kind: 'heuristic',
  scope: 'element',
  description: 'Fixed widths wider than a phone screen break small layouts',
  run({ snapshot, candidates }) {
    const results = [];
    for (const element of candidates) {
      const width = element.rect.width;
      if (width <= BREAKPOINTS[0]!) continue;
      if (element.tagName === 'img' || element.tagName === 'video' || element.tagName === 'iframe') continue;
      // Only flag elements that cannot shrink: a fixed or min width, not a
      // block element that happens to be wide because its container is.
      const rigid = element.styles.display === 'inline-block' || element.styles.position === 'absolute';
      if (!rigid) continue;
      if (width < snapshot.viewport.width * 0.9) continue;

      const breaksAt = BREAKPOINTS.filter((breakpoint) => width > breakpoint);
      results.push(
        finding(fixedWidthBlocker, {
          title: `Element is ${Math.round(width)}px wide and cannot shrink`,
          summary: `${describe(element)} renders ${Math.round(width)}px wide with a layout mode that will not reflow, so it overflows at ${breaksAt.join(', ')}px.`,
          evidence: [
            `Measured width ${Math.round(width)}px.`,
            `display: ${element.styles.display}; position: ${element.styles.position}.`,
            `Wider than these common screens: ${breaksAt.join(', ')}px.`,
          ],
          impact: 'On a phone this forces horizontal scrolling or clips the content.',
          recommendation: 'Use max-width: 100% and let the element reflow.',
          elementIndex: element.index,
          severity: 'medium',
          measurements: { width: Math.round(width), breaksAt: breaksAt.join(',') },
        }),
      );
    }
    return results;
  },
};

const MOBILE_VIEWPORT = 480;
const MIN_MOBILE_FONT = 12;

/** RESP-003 - text below 12px while the viewport is phone-sized. */
export const tinyMobileText: Rule = {
  id: 'RESP-003',
  category: 'responsive',
  kind: 'heuristic',
  scope: 'element',
  description: 'Body text should not drop below 12px on small screens',
  run({ snapshot, candidates }) {
    if (snapshot.viewport.width > MOBILE_VIEWPORT) return [];

    const results = [];
    for (const element of candidates) {
      const text = element.text?.trim();
      if (!text || text.length < 4) continue;
      if (element.styles.fontSize >= MIN_MOBILE_FONT) continue;

      results.push(
        finding(tinyMobileText, {
          title: `${element.styles.fontSize}px text on a ${snapshot.viewport.width}px screen`,
          summary: `${describe(element)} renders at ${element.styles.fontSize}px, below the 12px floor for comfortable reading on a phone.`,
          evidence: [
            `Font size ${element.styles.fontSize}px at viewport width ${snapshot.viewport.width}px.`,
            `Text: "${text.slice(0, 50)}".`,
          ],
          impact: 'Text this small is hard to read on a phone and triggers zooming.',
          recommendation: 'Raise it to at least 12px, ideally 16px for body copy.',
          elementIndex: element.index,
          severity: 'medium',
          measurements: { fontSize: element.styles.fontSize, viewportWidth: snapshot.viewport.width },
        }),
      );
    }
    return results;
  },
};
