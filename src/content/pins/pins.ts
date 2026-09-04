import { commentLabel } from '../../shared/utils/labels';
import type { Pin, PinKind, Rect, Severity } from '../../shared/types';

/**
 * Numbered pins over the audited elements (spec section 25).
 *
 * Requirements that shape the implementation:
 *  - pins must not modify page layout, so they live in the extension's shadow
 *    layer and are positioned with transforms only
 *  - pins move with scroll, which is a rAF-throttled recompute rather than a
 *    scroll listener that writes styles synchronously
 *  - pins off screen are hidden rather than positioned, so a 60-pin audit costs
 *    a handful of rect reads per frame instead of sixty style writes
 */

export const PIN_SIZE = 22;

export type PinTarget = {
  pin: Pin;
  /** Live element, when one could be found. */
  element: Element | null;
  approximate: boolean;
};

export type PinLayer = {
  render(targets: PinTarget[]): void;
  clear(): void;
  setActive(targetId: string | null): void;
  destroy(): void;
};

export type PinPlacement = {
  x: number;
  y: number;
  visible: boolean;
};

/**
 * Where a pin sits for a given element rect. Pure, so the awkward cases -- an
 * element at the very top of the page, one scrolled just out of view -- are
 * unit-testable without a browser.
 */
export function placePin(
  rect: Rect,
  viewport: { width: number; height: number },
  size = PIN_SIZE,
): PinPlacement {
  const outside =
    rect.y + rect.height < -size ||
    rect.y > viewport.height + size ||
    rect.x + rect.width < -size ||
    rect.x > viewport.width + size;
  if (outside) return { x: 0, y: 0, visible: false };

  // Top-left of the element, nudged out so the pin does not cover its content,
  // then clamped so a pin never leaves the viewport.
  const x = Math.min(Math.max(rect.x - size / 2, 2), Math.max(viewport.width - size - 2, 2));
  const y = Math.min(Math.max(rect.y - size / 2, 2), Math.max(viewport.height - size - 2, 2));
  return { x: Math.round(x), y: Math.round(y), visible: true };
}

export function createPinLayer(
  layer: HTMLElement,
  onSelect: (targetId: string, kind: PinKind) => void,
): PinLayer {
  const controller = new AbortController();
  const container = document.createElement('div');
  container.className = 'pin-layer';
  layer.append(container);

  type Entry = { target: PinTarget; button: HTMLButtonElement };
  let entries: Entry[] = [];
  let frame = 0;
  let active: string | null = null;

  const reposition = (): void => {
    frame = 0;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    for (const { target, button } of entries) {
      // Prefer the live element: it reflects the page as it is now, including
      // anything that moved since the audit.
      const rect =
        target.element && target.element.isConnected
          ? target.element.getBoundingClientRect()
          : {
              x: target.pin.documentRect.x - scrollX,
              y: target.pin.documentRect.y - scrollY,
              width: target.pin.documentRect.width,
              height: target.pin.documentRect.height,
            };

      const placement = placePin(rect, viewport);
      if (!placement.visible) {
        button.hidden = true;
        continue;
      }
      button.hidden = false;
      button.style.transform = `translate3d(${placement.x}px, ${placement.y}px, 0)`;
    }
  };

  const schedule = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(reposition);
  };

  window.addEventListener('scroll', schedule, { passive: true, capture: true, signal: controller.signal });
  window.addEventListener('resize', schedule, { passive: true, signal: controller.signal });

  // An SPA that swaps the view moves everything without a scroll or resize.
  const observer = new ResizeObserver(schedule);
  observer.observe(document.documentElement);

  const applyActive = (): void => {
    for (const { target, button } of entries) {
      button.dataset['active'] = String(target.pin.targetId === active);
    }
  };

  return {
    render(targets) {
      container.replaceChildren();
      entries = targets.map((target) => {
        const comment = target.pin.kind === 'comment';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pin';
        button.dataset['kind'] = target.pin.kind satisfies PinKind;
        if (target.pin.severity) button.dataset['severity'] = target.pin.severity satisfies Severity;
        button.dataset['approximate'] = String(target.approximate);
        button.dataset['targetId'] = target.pin.targetId;
        // Comments are lettered and findings numbered, so the two series on
        // one page cannot be mistaken for each other -- a "3" that is somebody
        // else's note reads as the third measured problem otherwise.
        button.textContent = comment ? commentLabel(target.pin.ordinal) : String(target.pin.ordinal);
        const name = [
          comment
            ? `Comment ${commentLabel(target.pin.ordinal)}`
            : `Finding ${target.pin.ordinal}, ${target.pin.severity ?? 'unrated'}`,
          target.approximate ? 'position approximate' : null,
        ]
          .filter((part) => part !== null)
          .join(', ');
        button.setAttribute('aria-label', name);
        button.title = name;
        button.addEventListener('click', () => onSelect(target.pin.targetId, target.pin.kind), {
          signal: controller.signal,
        });
        container.append(button);
        return { target, button };
      });
      applyActive();
      reposition();
    },
    clear() {
      container.replaceChildren();
      entries = [];
    },
    setActive(targetId) {
      active = targetId;
      applyActive();
    },
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      controller.abort();
      container.remove();
    },
  };
}
