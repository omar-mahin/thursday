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
  /** A written page: the thing you hand to somebody else. From report.svg. */
  report: [
    'M8 17H16',
    'M8 13H12',
    'M13 2.5V3C13 5.82843 13 7.24264 13.8787 8.12132C14.7574 9 16.1716 9 19 9H19.5M20 10.6569V14C20 17.7712 20 19.6569 18.8284 20.8284C17.6569 22 15.7712 22 12 22C8.22876 22 6.34315 22 5.17157 20.8284C4 19.6569 4 17.7712 4 14V9.45584C4 6.21082 4 4.58831 4.88607 3.48933C5.06508 3.26731 5.26731 3.06508 5.48933 2.88607C6.58831 2 8.21082 2 11.4558 2C12.1614 2 12.5141 2 12.8372 2.11401C12.9044 2.13772 12.9702 2.165 13.0345 2.19575C13.3436 2.34355 13.593 2.593 14.0919 3.09188L18.8284 7.82843C19.4065 8.40649 19.6955 8.69552 19.8478 9.06306C20 9.4306 20 9.83935 20 10.6569Z',
  ],
  /** A gear. From settings.svg. */
  settings: [
    'M21.3175 7.14139L20.8239 6.28479C20.4506 5.63696 20.264 5.31305 19.9464 5.18388C19.6288 5.05472 19.2696 5.15664 18.5513 5.36048L17.3311 5.70418C16.8725 5.80994 16.3913 5.74994 15.9726 5.53479L15.6357 5.34042C15.2766 5.11043 15.0004 4.77133 14.8475 4.37274L14.5136 3.37536C14.294 2.71534 14.1842 2.38533 13.9228 2.19657C13.6615 2.00781 13.3143 2.00781 12.6199 2.00781H11.5051C10.8108 2.00781 10.4636 2.00781 10.2022 2.19657C9.94085 2.38533 9.83106 2.71534 9.61149 3.37536L9.27753 4.37274C9.12465 4.77133 8.84845 5.11043 8.48937 5.34042L8.15249 5.53479C7.73374 5.74994 7.25259 5.80994 6.79398 5.70418L5.57375 5.36048C4.85541 5.15664 4.49625 5.05472 4.17867 5.18388C3.86109 5.31305 3.67445 5.63696 3.30115 6.28479L2.80757 7.14139C2.45766 7.74864 2.2827 8.05227 2.31666 8.37549C2.35061 8.69871 2.58483 8.95918 3.05326 9.48012L4.0843 10.6328C4.3363 10.9518 4.51521 11.5078 4.51521 12.0077C4.51521 12.5078 4.33636 13.0636 4.08433 13.3827L3.05326 14.5354C2.58483 15.0564 2.35062 15.3168 2.31666 15.6401C2.2827 15.9633 2.45766 16.2669 2.80757 16.8741L3.30114 17.7307C3.67443 18.3785 3.86109 18.7025 4.17867 18.8316C4.49625 18.9608 4.85542 18.8589 5.57377 18.655L6.79394 18.3113C7.25263 18.2055 7.73387 18.2656 8.15267 18.4808L8.4895 18.6752C8.84851 18.9052 9.12464 19.2442 9.2775 19.6428L9.61149 20.6403C9.83106 21.3003 9.94085 21.6303 10.2022 21.8191C10.4636 22.0078 10.8108 22.0078 11.5051 22.0078H12.6199C13.3143 22.0078 13.6615 22.0078 13.9228 21.8191C14.1842 21.6303 14.294 21.3003 14.5136 20.6403L14.8476 19.6428C15.0004 19.2442 15.2765 18.9052 15.6356 18.6752L15.9724 18.4808C16.3912 18.2656 16.8724 18.2055 17.3311 18.3113L18.5513 18.655C19.2696 18.8589 19.6288 18.9608 19.9464 18.8316C20.264 18.7025 20.4506 18.3785 20.8239 17.7307L21.3175 16.8741C21.6674 16.2669 21.8423 15.9633 21.8084 15.6401C21.7744 15.3168 21.5402 15.0564 21.0718 14.5354L20.0407 13.3827C19.7887 13.0636 19.6098 12.5078 19.6098 12.0077C19.6098 11.5078 19.7888 10.9518 20.0407 10.6328L21.0718 9.48012C21.5402 8.95918 21.7744 8.69871 21.8084 8.37549C21.8423 8.05227 21.6674 7.74864 21.3175 7.14139Z',
    'M15.5195 12C15.5195 13.933 13.9525 15.5 12.0195 15.5C10.0865 15.5 8.51953 13.933 8.51953 12C8.51953 10.067 10.0865 8.5 12.0195 8.5C13.9525 8.5 15.5195 10.067 15.5195 12Z',
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
