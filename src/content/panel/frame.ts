import type { PanelGeometry } from '../../storage/settings';

/**
 * The panel, floating over the page.
 *
 * It used to be docked in Chrome's side panel, which put it somewhere the user
 * did not want it and could not move. Floating it means framing it: the panel
 * is an extension document -- it needs the extension origin to reach IndexedDB
 * and chrome.* at all -- so it cannot simply be built in the content script's
 * shadow root. An iframe of `panel.html` gets the whole existing panel, React
 * and storage included, positioned wherever the user puts it.
 *
 * Everything here is chrome around that iframe: a bar to drag it by, a corner
 * to resize it from, and a collapse. The iframe's own content knows nothing
 * about any of it.
 *
 * Sizes are in CSS pixels and clamped to the viewport on every move, because a
 * panel dragged mostly off-screen and then reloaded is a panel with no visible
 * handle to drag back.
 */

export type PanelFrame = {
  element: HTMLElement;
  /** Puts it where it was last left, or in a sensible default place. */
  place(saved: PanelGeometry | null): void;
  collapse(collapsed: boolean): void;
  isCollapsed(): boolean;
  destroy(): void;
};

export type { PanelGeometry };

export type PanelFrameOptions = {
  /** The extension URL of the panel document. */
  src: string;
  onMoved(geometry: PanelGeometry): void;
  onClose(): void;
  /** The frame could not load the panel; offer it somewhere that can. */
  onOpenElsewhere(): void;
};

/**
 * How long the frame waits for the panel to report in.
 *
 * Generous from cold, because the panel has to boot React and open a database
 * before it can say anything, and a false alarm reads worse than a slow start.
 * Shorter once something has actually loaded: at that point the page is there
 * and either it is ours or it is not.
 */
const READY_TIMEOUT_MS = 6000;
const LOADED_GRACE_MS = 2500;

const MIN_WIDTH = 300;
const MIN_HEIGHT = 260;
const MARGIN = 12;
/** Enough of the bar left on screen to grab it by. */
const KEEP_VISIBLE = 80;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(value, high));

export function createPanelFrame(layer: HTMLElement, options: PanelFrameOptions): PanelFrame {
  const root = document.createElement('div');
  root.className = 'pf-root';

  const bar = document.createElement('div');
  bar.className = 'pf-bar';

  const grip = document.createElement('span');
  grip.className = 'pf-grip';
  grip.setAttribute('aria-hidden', 'true');
  const title = document.createElement('span');
  title.className = 'pf-title';
  title.textContent = 'Findings';

  const fold = document.createElement('button');
  fold.type = 'button';
  fold.className = 'pf-btn';
  fold.setAttribute('aria-label', 'Collapse the panel');
  fold.textContent = '–';

  const shut = document.createElement('button');
  shut.type = 'button';
  shut.className = 'pf-btn';
  shut.setAttribute('aria-label', 'Close the panel');
  shut.textContent = '✕';

  bar.append(grip, title, fold, shut);

  const frame = document.createElement('iframe');
  frame.className = 'pf-frame';
  frame.setAttribute('title', 'Thursday panel');
  // Same-extension document, so no sandbox: it needs storage and chrome.* to
  // be the panel at all. It is cross-origin to the page around it, which is
  // what keeps the page out of it.
  frame.src = options.src;

  /*
   * Shown when the framed panel never reports in.
   *
   * Without it a failure to load is one of Chrome's grey error screens inside
   * Thursday's own window: no explanation, no way out, and nothing that says
   * which half is broken. This says what happened and offers the panel in a
   * tab, which does not depend on being frameable at all.
   */
  const trouble = document.createElement('div');
  trouble.className = 'pf-trouble';
  trouble.hidden = true;
  const troubleText = document.createElement('p');
  troubleText.textContent = 'The panel could not load inside this page.';
  const troubleOut = document.createElement('button');
  troubleOut.type = 'button';
  troubleOut.className = 'pf-out';
  troubleOut.textContent = 'Open the panel in a tab';
  troubleOut.addEventListener('click', () => options.onOpenElsewhere());
  trouble.append(troubleText, troubleOut);

  const handle = document.createElement('span');
  handle.className = 'pf-resize';
  handle.setAttribute('aria-hidden', 'true');

  root.append(bar, frame, trouble, handle);
  layer.append(root);

  /*
   * The panel says hello when it has rendered; if it does not, something ate
   * the frame. Generous, because a cold start has to boot React and open a
   * database, and a false alarm here would be worse than a slow panel.
   */
  let ready = false;
  let watchdog = 0;

  const giveUp = (): void => {
    if (ready) return;
    frame.hidden = true;
    trouble.hidden = false;
  };

  /**
   * Waits for the panel to say hello, and gives up out loud if it does not.
   *
   * Armed twice, for two different failures. Once up front, because the frame
   * may never load anything at all. And again on every `load` the iframe
   * reports, because Chrome fires that for its own error pages too -- so
   * "something loaded" is not "the panel loaded", and a frame that swaps to a
   * blocked URL later has to be caught the same way.
   */
  const arm = (delay: number): void => {
    clearTimeout(watchdog);
    watchdog = window.setTimeout(giveUp, delay);
  };

  const onMessage = (event: MessageEvent): void => {
    const data = event.data as { thursday?: unknown } | null;
    if (data && typeof data === 'object' && data.thursday === 'panel-ready') {
      ready = true;
      clearTimeout(watchdog);
      trouble.hidden = true;
      frame.hidden = false;
    }
  };
  window.addEventListener('message', onMessage);
  frame.addEventListener('load', () => {
    // A load with no hello behind it is somebody else's page in our window.
    ready = false;
    arm(LOADED_GRACE_MS);
  });
  arm(READY_TIMEOUT_MS);

  let geometry: PanelGeometry = { x: 0, y: 0, width: 380, height: 560, collapsed: false };

  const apply = (): void => {
    root.style.transform = `translate3d(${geometry.x}px, ${geometry.y}px, 0)`;
    root.style.width = `${geometry.width}px`;
    root.style.height = geometry.collapsed ? 'auto' : `${geometry.height}px`;
    root.dataset['collapsed'] = geometry.collapsed ? 'true' : 'false';
    fold.setAttribute('aria-label', geometry.collapsed ? 'Expand the panel' : 'Collapse the panel');
    fold.textContent = geometry.collapsed ? '+' : '–';
  };

  /** Keeps the bar reachable however the window has changed since. */
  const settle = (): void => {
    const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - MARGIN * 2);
    const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - MARGIN * 2);
    geometry.width = clamp(geometry.width, MIN_WIDTH, maxWidth);
    geometry.height = clamp(geometry.height, MIN_HEIGHT, maxHeight);
    geometry.x = clamp(geometry.x, KEEP_VISIBLE - geometry.width, window.innerWidth - KEEP_VISIBLE);
    geometry.y = clamp(geometry.y, 0, Math.max(0, window.innerHeight - 44));
    apply();
  };

  /**
   * One drag handler for both the bar and the resize corner.
   *
   * Pointer capture, so the drag survives the pointer crossing the iframe --
   * which it otherwise would not: an iframe swallows the events, and a resize
   * that stops the moment you cross into the thing you are resizing is not a
   * resize. The iframe is also made inert for the duration for the same reason.
   */
  const drag = (
    start: PointerEvent,
    move: (dx: number, dy: number) => void,
  ): void => {
    start.preventDefault();
    const from = { x: start.clientX, y: start.clientY };
    const target = start.currentTarget as HTMLElement;
    target.setPointerCapture(start.pointerId);
    root.dataset['dragging'] = 'true';

    const onMove = (event: PointerEvent): void => {
      move(event.clientX - from.x, event.clientY - from.y);
      settle();
    };
    const onUp = (): void => {
      delete root.dataset['dragging'];
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      options.onMoved({ ...geometry });
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  bar.addEventListener('pointerdown', (event) => {
    if (event.target === fold || event.target === shut) return;
    const origin = { x: geometry.x, y: geometry.y };
    drag(event, (dx, dy) => {
      geometry.x = origin.x + dx;
      geometry.y = origin.y + dy;
    });
  });

  handle.addEventListener('pointerdown', (event) => {
    const origin = { width: geometry.width, height: geometry.height };
    drag(event, (dx, dy) => {
      geometry.width = origin.width + dx;
      geometry.height = origin.height + dy;
    });
  });

  fold.addEventListener('click', () => {
    geometry.collapsed = !geometry.collapsed;
    apply();
    options.onMoved({ ...geometry });
  });
  shut.addEventListener('click', () => options.onClose());

  const onResize = (): void => settle();
  window.addEventListener('resize', onResize, { passive: true });

  return {
    element: root,
    place(saved) {
      if (saved) {
        geometry = { ...saved };
      } else {
        // Bottom-right by default: out of the way of a page's own content,
        // which is nearly always top-left weighted.
        geometry = {
          width: 380,
          height: Math.min(560, window.innerHeight - MARGIN * 2),
          collapsed: false,
          x: window.innerWidth - 380 - MARGIN,
          y: Math.max(MARGIN, window.innerHeight - Math.min(560, window.innerHeight - MARGIN * 2) - MARGIN),
        };
      }
      settle();
    },
    collapse(collapsed) {
      geometry.collapsed = collapsed;
      apply();
    },
    isCollapsed: () => geometry.collapsed,
    destroy() {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('message', onMessage);
      clearTimeout(watchdog);
      root.remove();
    },
  };
}
