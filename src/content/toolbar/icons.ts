import type { ToolbarAction } from '../../shared/messaging/protocol';

/**
 * The toolbar's icons, as path data rather than as markup.
 *
 * The drawings come from the SVG set in design/icons/, which is the source of
 * truth for the artwork; this file is the same geometry in a form the content
 * script can mount. Three things are dropped on the way in, and all three
 * matter:
 *
 *  - The hard-coded `stroke="#16181E"`. It would survive into somebody else's
 *    page and paint the icons near-black on the dark toolbar, and it would not
 *    turn white when a mode is switched on. Colour is currentColor's job.
 *  - `stroke-width`, `stroke-linecap`, `stroke-linejoin`. One declaration in
 *    styles.ts sets these for every icon, so a whole set cannot end up half a
 *    weight apart.
 *  - The `<svg>` wrapper, since createIcon writes it.
 *
 * Built with createElementNS rather than by assigning a string to innerHTML.
 * The reason is narrower than it first looks, and worth writing down because
 * the obvious justification is wrong: a page sending
 * `require-trusted-types-for 'script'` does *not* block innerHTML in a content
 * script, because Chrome exempts the isolated world from the page's Trusted
 * Types policy. That was measured, not assumed -- the same assignment throws
 * in the page's own world and is allowed in ours. What is left is a smaller
 * but real reason: path data as typed data is unit-testable without a browser,
 * and there is no HTML string being parsed at all, which is the habit worth
 * keeping in code that runs inside other people's pages.
 *
 * Every icon is drawn on a 24x24 grid and stroked, so the existing colour,
 * hover, disabled and focus rules keep working without any of them having to
 * know an icon is there. Nothing here is filled: a filled shape holds its
 * width while a stroked one scales with stroke-width, so mixing the two makes
 * a set that cannot be re-weighted in one place.
 */
export const TOOLBAR_ICONS: Record<ToolbarAction, readonly string[]> = {
  /** A magnifier: examine the page. From audit.svg. */
  audit: [
    'M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z',
    /*
     * The handle. In audit.svg this is a filled outline of a 1.5-wide line --
     * correct on its own, and the one shape in the set that would not follow
     * stroke-width, so the handle would stay put while the rest of the toolbar
     * got heavier or lighter. Same line, drawn as a stroke.
     */
    'M15 15 21 21',
  ],
  /** A pointer inside a broken marquee: pick something out of the page. From select.svg. */
  select: [
    'M14.5352 11.0865L18.5575 12.6605C20.8775 13.5683 22.0375 14.0222 21.9991 14.7422C21.9606 15.4622 20.75 15.7924 18.3288 16.4527C17.6079 16.6493 17.2475 16.7476 16.9976 16.9976C16.7476 17.2475 16.6493 17.6079 16.4527 18.3288C15.7924 20.75 15.4622 21.9606 14.7422 21.9991C14.0222 22.0375 13.5683 20.8775 12.6605 18.5575L11.0865 14.5352C10.136 12.1062 9.6608 10.8918 10.2763 10.2763C10.8918 9.6608 12.1062 10.136 14.5352 11.0865Z',
    'M2 8.5V11.5M11.5 2H8.5M8.5 18H9M18 9V8.5M4.5 18C3.11929 18 2 16.8807 2 15.5M2 4.5C2 3.11929 3.11929 2 4.5 2M18 4.5C18 3.11929 16.8807 2 15.5 2',
  ],
  /** A speech bubble: somebody said something about this. From comment.svg. */
  comment: [
    'M21.5 12C21.5 17.2467 17.2467 21.5 12 21.5C10.3719 21.5 8.8394 21.0904 7.5 20.3687C5.63177 19.362 4.37462 20.2979 3.26592 20.4658C3.09774 20.4913 2.93024 20.4302 2.80997 20.31C2.62741 20.1274 2.59266 19.8451 2.6935 19.6074C3.12865 18.5818 3.5282 16.6382 2.98341 15C2.6698 14.057 2.5 13.0483 2.5 12C2.5 6.75329 6.75329 2.5 12 2.5C17.2467 2.5 21.5 6.75329 21.5 12Z',
  ],
  /** A panel down the side: the findings, beside the page rather than over it. From inspect.svg. */
  inspect: [
    'M13 3H11C7.22876 3 5.34315 3 4.17157 4.17157C3 5.34315 3 7.22876 3 11V13C3 16.7712 3 18.6569 4.17157 19.8284C5.34315 21 7.22876 21 11 21H13C16.7712 21 18.6569 21 19.8284 19.8284C21 18.6569 21 16.7712 21 13V11C21 7.22876 21 5.34315 19.8284 4.17157C18.6569 3 16.7712 3 13 3Z',
    'M15 3V4M15 7V8M15 11.5V12.5M15 16V17M15 21V20',
  ],
  /** From cancel.svg -- the action is "close", the drawing is a cross. */
  close: ['M18 6L6.00081 17.9992M17.9992 18L6 6.00085'],
};

/**
 * Builds one icon.
 *
 * Hidden from assistive technology because the button already has a name: the
 * icon is a picture of the label, not a second label, and exposing both would
 * read the action out twice.
 */
export function createIcon(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tb-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  // Keeps the icon out of the tab order in the browsers that still put SVG
  // there, without needing a tabindex on it.
  svg.setAttribute('focusable', 'false');
  for (const d of paths) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    node.setAttribute('d', d);
    svg.append(node);
  }
  return svg;
}
