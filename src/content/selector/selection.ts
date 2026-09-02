import { HOST_TAG_NAME } from '../../shared/constants/product';
import type { ElementPreview } from '../../shared/types';
import { computeAccessibleName } from '../../audit/accessibility/accname';
import { effectiveRole } from '../../audit/accessibility/roles';
import { toRect } from '../snapshot/measure';
import { describeForLabel, type Highlight } from '../overlay/highlight';

/**
 * Element selection (spec section 9).
 *
 * States: idle -> hovering -> picked. While hovering, the page must not react
 * to the pointer at all, so pointer and mouse events are swallowed in the
 * capture phase before the page's own listeners see them.
 *
 * Hover feedback is driven by elementFromPoint on a rAF tick rather than
 * listeners on every element: one hit test per frame, no DOM instrumentation,
 * and it keeps the spec's sub-100ms target trivially (PLAN.md section 5).
 */

export type SelectionCallbacks = {
  onHover(preview: ElementPreview | null): void;
  onPick(element: Element): void;
  onStateChange(active: boolean): void;
};

export type Selection = {
  start(): void;
  cancel(): void;
  isActive(): boolean;
  destroy(): void;
};

/** Events the page must not receive while the user is picking an element. */
const SWALLOWED = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
] as const;

const NEVER_SELECTABLE = new Set(['html', 'body', HOST_TAG_NAME]);

/**
 * A pointerdown is followed by mouseup and click. Picking on pointerdown means
 * the session's listeners are gone by the time the click arrives, so the page
 * would receive it -- navigating away from the element just selected. This guard
 * outlives the session just long enough to eat that trailing click.
 */
const CLICK_GUARD_MS = 600;
const TRAILING_EVENTS = ['pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'] as const;

export function createSelection(highlight: Highlight, callbacks: SelectionCallbacks): Selection {
  let session: AbortController | null = null;
  let pointer: { x: number; y: number } | null = null;
  let current: Element | null = null;
  let frame = 0;
  let previousCursor: string | null = null;
  let guard: AbortController | null = null;
  let guardTimer = 0;

  const isOurs = (element: Element): boolean =>
    element.tagName.toLowerCase() === HOST_TAG_NAME || element.closest(HOST_TAG_NAME) !== null;

  /** True when the event happened inside our own UI, which must stay usable:
   *  the user has to be able to click Cancel while selection is running. */
  const isOwnUi = (event: Event): boolean =>
    event
      .composedPath()
      .some((node) => node instanceof Element && node.tagName.toLowerCase() === HOST_TAG_NAME);

  const clearGuard = (): void => {
    if (guardTimer) {
      clearTimeout(guardTimer);
      guardTimer = 0;
    }
    guard?.abort();
    guard = null;
  };

  const installClickGuard = (): void => {
    clearGuard();
    guard = new AbortController();
    const swallowTrailing = (event: Event): void => {
      if (isOwnUi(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'click') clearGuard();
    };
    for (const type of TRAILING_EVENTS) {
      window.addEventListener(type, swallowTrailing, { capture: true, signal: guard.signal });
    }
    guardTimer = window.setTimeout(clearGuard, CLICK_GUARD_MS);
  };

  const previewOf = (element: Element): ElementPreview => {
    const rect = toRect(element.getBoundingClientRect());
    const { role } = effectiveRole(element);
    const name = computeAccessibleName(element);
    const text = element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60);
    const preview: ElementPreview = {
      tagName: element.tagName.toLowerCase(),
      classNames: [...element.classList].slice(0, 6),
      rect,
    };
    const id = element.getAttribute('id');
    if (id) preview.id = id;
    if (role) preview.role = role;
    if (name.name) preview.accessibleName = name.name;
    if (text) preview.textSnippet = text;
    return preview;
  };

  const evaluate = (): void => {
    frame = 0;
    if (!pointer || !session) return;
    const found = document.elementFromPoint(pointer.x, pointer.y);
    if (!found || isOurs(found) || NEVER_SELECTABLE.has(found.tagName.toLowerCase())) {
      current = null;
      highlight.hide();
      callbacks.onHover(null);
      return;
    }
    if (found === current) return; // nothing changed; skip the work
    current = found;
    const preview = previewOf(found);
    highlight.show(preview.rect, describeForLabel(found), 'hover');
    callbacks.onHover(preview);
  };

  const schedule = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(evaluate);
  };

  const onPointerMove = (event: PointerEvent): void => {
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  };

  const swallow = (event: Event): void => {
    // Our own toolbar keeps working: Cancel has to be reachable.
    if (isOwnUi(event)) return;
    // Right-click and middle-click cancel instead of selecting.
    const mouse = event as MouseEvent;
    const cancelling = event.type === 'contextmenu' || mouse.button > 0;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== 'pointerdown' && event.type !== 'contextmenu') return;
    if (cancelling) {
      cancel();
      return;
    }
    const target = current;
    if (!target) return;
    pick(target);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();
  };

  const onScrollOrResize = (): void => {
    current = null; // geometry moved: force a re-evaluate at the same point
    schedule();
  };

  function pick(element: Element): void {
    const rect = toRect(element.getBoundingClientRect());
    highlight.show(rect, describeForLabel(element), 'selected');
    installClickGuard();
    stop();
    callbacks.onPick(element);
  }

  function stop(): void {
    if (!session) return;
    session.abort();
    session = null;
    current = null;
    pointer = null;
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    // Restore the page's own cursor exactly as we found it.
    if (previousCursor === null || previousCursor === '') {
      document.documentElement.style.removeProperty('cursor');
    } else {
      document.documentElement.style.setProperty('cursor', previousCursor);
    }
    previousCursor = null;
    callbacks.onStateChange(false);
  }

  function cancel(): void {
    highlight.hide();
    installClickGuard();
    stop();
  }

  return {
    start() {
      if (session) return;
      session = new AbortController();
      const options = { capture: true, signal: session.signal };
      previousCursor = document.documentElement.style.getPropertyValue('cursor');
      document.documentElement.style.setProperty('cursor', 'crosshair', 'important');

      window.addEventListener('pointermove', onPointerMove, { ...options, passive: true });
      for (const type of SWALLOWED) window.addEventListener(type, swallow, options);
      window.addEventListener('keydown', onKeyDown, options);
      window.addEventListener('scroll', onScrollOrResize, { ...options, passive: true });
      window.addEventListener('resize', onScrollOrResize, { ...options, passive: true });
      callbacks.onStateChange(true);
    },
    cancel,
    isActive: () => session !== null,
    destroy() {
      clearGuard();
      stop();
    },
  };
}
