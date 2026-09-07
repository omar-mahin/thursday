import type { Rect } from '../../shared/types';
import { formatPx, formatRatio, type Measurement } from './measure';

/**
 * The ruler: what the highlight shows once it has something measured.
 *
 * Four parts, built once and moved rather than rebuilt per hover -- this runs
 * on pointer movement, and creating a dozen elements per frame is the sort of
 * thing that makes a page feel broken while you are auditing it for feeling
 * broken.
 *
 *   - a row of chips: size, font, weight, line height, letter spacing, colour,
 *     and the two contrast verdicts;
 *   - the dashed outline around the element itself;
 *   - a spacing pill above and below, when there is a gap to a neighbour;
 *   - four hairline guides extending the element's edges across the viewport,
 *     which is what turns "these look misaligned" into a fact.
 *
 * Built with createElement rather than an HTML string. Same reason as the
 * toolbar icons: nothing here parses markup, and the chips are the only place
 * page-derived text (a font family, a colour) reaches the DOM.
 */

/**
 * Where Thursday's own toolbar is, in viewport coordinates.
 *
 * The ruler needs this because both want the same place. The toolbar sits at
 * the top of the page by default and the chips go above whatever is being
 * measured, so anything in the upper part of a page -- a heading, a nav, a
 * hero -- puts the two on top of each other. Measured every time rather than
 * remembered, since the toolbar can be dragged anywhere.
 */
export type Obstacle = () => Rect | null;

export type Ruler = {
  show(measurement: Measurement): void;
  hide(): void;
  destroy(): void;
};

/** Chips are placed above the element when there is room for them. */
const HUD_HEIGHT = 34;
const HUD_GAP = 8;
const PILL_HEIGHT = 20;

type Chip = { root: HTMLElement; text: HTMLElement };

function chip(className: string): Chip {
  const root = document.createElement('span');
  root.className = `rl-chip ${className}`;
  const text = document.createElement('span');
  root.append(text);
  return { root, text };
}

function divider(): HTMLElement {
  const node = document.createElement('span');
  node.className = 'rl-div';
  return node;
}

export function createRuler(layer: HTMLElement, obstacle: Obstacle): Ruler {
  const hud = document.createElement('div');
  hud.className = 'rl-hud';
  hud.setAttribute('aria-hidden', 'true');

  const size = chip('rl-size');
  const family = chip('rl-family');
  const fontSize = chip('rl-fontsize');
  const weight = chip('rl-weight');
  const lineHeight = chip('rl-plain');
  const letterSpacing = chip('rl-plain');
  const colour = chip('rl-colour');
  const swatch = document.createElement('span');
  swatch.className = 'rl-swatch';
  colour.root.prepend(swatch);
  const aa = chip('rl-grade');
  const aaa = chip('rl-grade');

  const typographyDivider = divider();
  const colourDivider = divider();
  hud.append(
    size.root,
    divider(),
    family.root,
    fontSize.root,
    weight.root,
    typographyDivider,
    lineHeight.root,
    letterSpacing.root,
    colourDivider,
    colour.root,
    aa.root,
    aaa.root,
  );

  const outline = document.createElement('div');
  outline.className = 'rl-outline';
  outline.setAttribute('aria-hidden', 'true');

  const above = document.createElement('div');
  above.className = 'rl-gap';
  const below = document.createElement('div');
  below.className = 'rl-gap';

  const guide = (axis: 'h' | 'v'): HTMLElement => {
    const node = document.createElement('div');
    node.className = 'rl-guide';
    node.dataset['axis'] = axis;
    return node;
  };
  const guideTop = guide('h');
  const guideBottom = guide('h');
  const guideLeft = guide('v');
  const guideRight = guide('v');
  const guides = [guideTop, guideBottom, guideLeft, guideRight];

  layer.append(outline, ...guides, above, below, hud);

  /*
   * Visibility is an attribute, not an inline display value.
   *
   * Setting `style.display = ''` to show something *hides* it when the
   * stylesheet's own rule is `display: none` -- it clears the override and falls
   * back to the rule. That is exactly what the first version of this did, and
   * the ruler rendered nothing at all with no error anywhere. An attribute has
   * no such trap, and it keeps the display mode of each part in the stylesheet
   * where the rest of its appearance lives.
   */
  const setVisible = (node: HTMLElement, visible: boolean): void => {
    // Always written, never deleted: the stylesheet matches on both values, so
    // a missing attribute would leave a chip showing when it was asked to hide.
    node.dataset['on'] = visible ? 'true' : 'false';
  };
  const showAll = (visible: boolean): void => {
    for (const node of [hud, outline, ...guides]) setVisible(node, visible);
    if (!visible) {
      setVisible(above, false);
      setVisible(below, false);
    }
  };

  const placePill = (pill: HTMLElement, value: number | null, centreX: number, y: number): void => {
    if (value === null) {
      setVisible(pill, false);
      return;
    }
    setVisible(pill, true);
    pill.textContent = formatPx(value);
    // Measured after the text is set, so the pill is centred on its own width
    // rather than on a guess at it.
    const width = pill.offsetWidth;
    const left = Math.max(2, Math.min(centreX - width / 2, window.innerWidth - width - 2));
    pill.style.transform = `translate3d(${left}px, ${Math.max(2, y)}px, 0)`;
  };

  const grade = (target: Chip, label: string, passes: boolean | null, title: string): void => {
    target.text.textContent = passes === null ? `${label} —` : `${label}${passes ? ' ✓' : ' ✕'}`;
    target.root.dataset['state'] = passes === null ? 'unknown' : passes ? 'pass' : 'fail';
    target.root.title = title;
  };

  return {
    show(measurement) {
      const { rect, spacing } = measurement;
      showAll(true);

      size.text.textContent = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
      family.text.textContent = measurement.fontFamily;
      fontSize.text.textContent = formatPx(measurement.fontSizePx);
      weight.text.textContent = measurement.weight.label;
      weight.root.title = `font-weight: ${measurement.weight.numeric}`;

      // `normal` is not a number, so it is not reported as one.
      lineHeight.text.textContent =
        measurement.lineHeightPx === null ? 'normal LH' : `${formatPx(measurement.lineHeightPx)} LH`;
      letterSpacing.text.textContent = `${formatPx(measurement.letterSpacingPx)} LS`;
      colour.text.textContent = measurement.color;
      swatch.style.background = measurement.color;

      const { contrast } = measurement;
      if (contrast === null) {
        // No text of its own: a contrast verdict here would be about nothing.
        setVisible(aa.root, false);
        setVisible(aaa.root, false);
        setVisible(colourDivider, false);
      } else if (contrast.kind === 'indeterminate') {
        setVisible(aa.root, true);
        setVisible(aaa.root, false);
        setVisible(colourDivider, true);
        grade(aa, 'contrast', null, `Not measurable: ${contrast.because}.`);
      } else {
        setVisible(aa.root, true);
        setVisible(aaa.root, true);
        setVisible(colourDivider, true);
        const detail = `${formatRatio(contrast.ratio)}${contrast.large ? ', large text' : ''}`;
        grade(aa, 'AA', contrast.aa, `AA needs ${contrast.large ? '3' : '4.5'}:1 — measured ${detail}`);
        grade(aaa, 'AAA', contrast.aaa, `AAA needs ${contrast.large ? '4.5' : '7'}:1 — measured ${detail}`);
      }

      outline.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`;
      outline.style.width = `${rect.width}px`;
      outline.style.height = `${rect.height}px`;

      guideTop.style.transform = `translate3d(0, ${rect.y}px, 0)`;
      guideBottom.style.transform = `translate3d(0, ${rect.y + rect.height}px, 0)`;
      guideLeft.style.transform = `translate3d(${rect.x}px, 0, 0)`;
      guideRight.style.transform = `translate3d(${rect.x + rect.width}px, 0, 0)`;

      // Each pill sits in the middle of the gap it is describing, which is the
      // only position that says which gap it means.
      const centreX = rect.x + rect.width / 2;
      const aboveGap = spacing.above;
      const belowGap = spacing.below;
      placePill(above, aboveGap, centreX, aboveGap === null ? 0 : rect.y - aboveGap / 2 - PILL_HEIGHT / 2);
      placePill(
        below,
        belowGap,
        centreX,
        belowGap === null ? 0 : rect.y + rect.height + belowGap / 2 - PILL_HEIGHT / 2,
      );

      /*
       * The chips go above the element, and below it when there is no room --
       * which is most of the time for anything near the top of a page, so the
       * fallback is the common case rather than an edge one.
       *
       * Above the gap pill when there is one, not just above the element. The
       * pill sits in the middle of the gap, so for the ordinary 8-24px gap it
       * lands exactly where the bar wants to be and one covers the other.
       */
      const ceiling = aboveGap === null ? rect.y : rect.y - aboveGap / 2 - PILL_HEIGHT / 2;
      const width = hud.offsetWidth;
      const x = Math.max(2, Math.min(rect.x, window.innerWidth - width - 2));

      const blocked = obstacle();
      const clashes = (top: number): boolean => {
        if (top < 2 || top + HUD_HEIGHT > window.innerHeight - 2) return true;
        if (!blocked) return false;
        return (
          top < blocked.y + blocked.height &&
          blocked.y < top + HUD_HEIGHT &&
          x < blocked.x + blocked.width &&
          blocked.x < x + width
        );
      };

      // Above by preference, below when above is off screen or under the
      // toolbar, and above anyway when neither works -- being half covered
      // beats being off screen entirely.
      const over = ceiling - HUD_HEIGHT - HUD_GAP;
      const under = rect.y + rect.height + HUD_GAP + (belowGap === null ? 0 : PILL_HEIGHT);
      const y = !clashes(over) ? over : !clashes(under) ? under : over;
      hud.style.transform = `translate3d(${x}px, ${Math.max(2, Math.min(y, window.innerHeight - HUD_HEIGHT - 2))}px, 0)`;
    },
    hide() {
      showAll(false);
    },
    destroy() {
      for (const node of [hud, outline, above, below, ...guides]) node.remove();
    },
  };
}
