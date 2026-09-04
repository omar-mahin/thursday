import { assertNever } from '../shared/result';
import type { CaptureTarget, Envelope, ThursdayMessage, ToolbarAction } from '../shared/messaging/protocol';
import { isEnvelope } from '../shared/messaging/protocol';
import type { ElementReference, Pin, Rect, ResolutionLevel, Viewport } from '../shared/types';
import { describeElement, resolveReference } from '../audit/element/identity';
import { getSetting, setSetting } from '../storage/settings';
import { createHost, type ShadowHost } from './host';
import { createHighlight, describeForLabel, type Highlight } from './overlay/highlight';
import { createSelection, type Selection } from './selector/selection';
import { createPinLayer, type PinLayer } from './pins/pins';
import { resolvePinTargets } from './pins/resolve';
import { collectSnapshot } from './snapshot/collect';
import { isSensitiveField } from './snapshot/redact';
import { snapshotSingleElement } from './snapshot/element';
import { toRect } from './snapshot/measure';
import { createToolbar, type Toolbar } from './toolbar/toolbar';

/**
 * How long Thursday stays hidden after a capture request before showing itself
 * again unasked.
 *
 * Longer than the gap between two captures (the panel paces them at 550ms, so
 * each band refreshes this well before it fires) and short enough that a sweep
 * which dies halfway is a flicker rather than an extension that has vanished.
 */
const OVERLAY_RESTORE_MS = 2500;

/**
 * Injected on demand by chrome.scripting.executeScript. The user *will* click
 * the action twice, so installation is idempotent: a second run re-attaches to
 * the existing instance instead of stacking a second toolbar.
 *
 * Content scripts share one isolated world per extension per frame, so this
 * global survives repeated injection.
 */
const RUNTIME_KEY = '__thursdayRuntime';

type Runtime = {
  version: 1;
  reveal(): void;
  teardown(): void;
};

type GlobalWithRuntime = typeof globalThis & { [RUNTIME_KEY]?: Runtime };

function readViewport(): Viewport {
  const element = document.documentElement;
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    scrollX: Math.round(window.scrollX),
    scrollY: Math.round(window.scrollY),
    documentWidth: Math.max(element.scrollWidth, element.clientWidth),
    documentHeight: Math.max(element.scrollHeight, element.clientHeight),
  };
}

function install(): void {
  const globalScope = globalThis as GlobalWithRuntime;
  const existing = globalScope[RUNTIME_KEY];
  if (existing) {
    existing.reveal();
    return;
  }

  let host: ShadowHost | null = null;
  let toolbar: Toolbar | null = null;
  let highlight: Highlight | null = null;
  let selection: Selection | null = null;
  let pins: PinLayer | null = null;
  /** Live elements from the most recent snapshot, index-aligned with it. */
  let measured: Element[] = [];
  /** Which snapshot `measured` belongs to. Pins carry the same id. */
  let measuredSnapshotId: string | null = null;
  /** Pending restore of the overlay after a capture. See captureBand. */
  let overlayTimer: number | null = null;
  let port: chrome.runtime.Port | null = null;
  /** The live element behind the current selection. Held directly, never
   *  re-queried, so identity cannot drift during a session. */
  let selected: Element | null = null;
  /**
   * What the next pick is for.
   *
   * The picker is one machine used for two jobs, and the difference matters
   * only at the moment something is clicked -- so the intent is recorded when
   * picking starts rather than threaded through every event handler.
   */
  let picking: 'inspect' | 'comment' = 'inspect';
  let reconnectAttempts = 0;
  let disposed = false;

  const post = (message: ThursdayMessage): void => {
    try {
      port?.postMessage({ from: 'content', message } satisfies Envelope);
    } catch {
      /* worker asleep; the reconnect path below handles it */
    }
  };

  const announceActivation = (): void => {
    post({
      type: 'PAGE_ACTIVATED',
      payload: { url: location.href, title: document.title, viewport: readViewport() },
    });
  };

  const handle = (message: ThursdayMessage): void => {
    switch (message.type) {
      case 'DEACTIVATE':
        teardown();
        return;
      case 'REQUEST_PAGE_INFO':
        announceActivation();
        return;
      case 'START_SELECTION':
        startPicking('inspect');
        return;
      case 'CANCEL_SELECTION':
      case 'CANCEL_ANNOTATION':
        selection?.cancel();
        return;
      case 'START_ANNOTATION':
        startPicking('comment');
        return;
      case 'REQUEST_SNAPSHOT':
        sendSnapshot(message.payload.includeOffscreen);
        return;
      case 'FOCUS_ELEMENT':
        focusElement(message.payload.ref);
        return;
      case 'REQUEST_ELEMENT_RECT':
        measureForCapture(message.payload.findingId, message.payload.ref);
        return;
      case 'CAPTURE_BAND':
        captureBand(message.payload.snapshotId, message.payload.scrollY, message.payload.indices);
        return;
      case 'RENDER_PINS':
        renderPins(message.payload.pins);
        return;
      case 'CLEAR_PINS':
        pins?.clear();
        return;
      case 'SET_ACTIVE_PIN':
        pins?.setActive(message.payload.targetId);
        return;
      // Never sent to the page.
      case 'ACTIVATE_PAGE':
      case 'PAGE_ACTIVATED':
      case 'GET_PAGE_STATUS':
      case 'PAGE_STATUS':
      case 'DEACTIVATED':
      case 'ELEMENT_HOVERED':
      case 'ELEMENT_SELECTED':
      case 'SELECTION_STATE':
      case 'SNAPSHOT_READY':
      case 'AUDIT_PROGRESS':
      case 'PIN_CLICKED':
      case 'ANNOTATION_TARGET':
      case 'ANNOTATION_STATE':
      case 'ELEMENT_RESOLVED':
      case 'ELEMENT_RECT':
      case 'BAND_READY':
      case 'TOOLBAR_ACTION':
      case 'ERROR':
        return;
      default:
        assertNever(message, 'content.handle');
    }
  };

  const sendSnapshot = (includeOffscreen: boolean): void => {
    try {
      const collected = collectSnapshot({ includeOffscreen });
      // Hold on to the live elements: pins and scroll-to-element then resolve
      // in constant time instead of walking the resolution ladder.
      measured = collected.elements;
      measuredSnapshotId = collected.snapshot.id;
      post({ type: 'SNAPSHOT_READY', payload: collected.snapshot });
    } catch (error) {
      post({
        type: 'ERROR',
        payload: { code: 'SNAPSHOT_FAILED', detail: error instanceof Error ? error.message : undefined },
      });
    }
  };

  const startPicking = (purpose: 'inspect' | 'comment'): void => {
    picking = purpose;
    selection?.start();
  };

  /**
   * Reports where a comment was placed.
   *
   * Sends the document rect as well as the reference so the panel can draw the
   * pin straight away. The element index is looked up in the elements the last
   * snapshot measured -- present when the comment is on something the audit
   * saw, absent when it is not, and absent is a perfectly ordinary answer: a
   * comment can be about a element no rule ever looked at.
   */
  const emitAnnotationTarget = (element: Element): void => {
    const rect = toRect(element.getBoundingClientRect());
    const index = measured.indexOf(element);
    post({
      type: 'ANNOTATION_TARGET',
      payload: {
        reference: describeElement(element, rect),
        documentRect: {
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          width: rect.width,
          height: rect.height,
        },
        ...(index >= 0 ? { elementIndex: index } : {}),
      },
    });
    toolbar?.announce(`Comment anchored to ${describeForLabel(element).selector}.`);
  };

  const emitSelection = (element: Element): void => {
    selected = element;
    const snapshot = snapshotSingleElement(element);
    const reference = describeElement(element, snapshot.rect);
    post({ type: 'ELEMENT_SELECTED', payload: { element: snapshot, reference } });
    toolbar?.announce(`Selected ${snapshot.tagName}${snapshot.accessibleName.name ? `, ${snapshot.accessibleName.name}` : ''}`);
  };

  /**
   * Jumps to an element the panel asked for. Prefers the live handle from this
   * session and only walks the resolution ladder when that is gone -- and it
   * reports which rung answered, so the panel can admit when a hit is a guess.
   */
  const focusElement = (reference: ElementReference): void => {
    const live = selected?.isConnected && selected.tagName.toLowerCase() === reference.tagName ? selected : null;
    let element: Element | null = live;
    let level: ResolutionLevel | null = null;
    if (!element) {
      const resolution = resolveReference(reference, document, (target) => toRect(target.getBoundingClientRect()));
      element = resolution.element;
      level = resolution.level;
    }
    if (!element) {
      post({ type: 'ELEMENT_RESOLVED', payload: { ref: reference, level: null } });
      return;
    }
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    const rect = toRect(element.getBoundingClientRect());
    highlight?.flash(rect, describeForLabel(element));
    // Only report a resolution when the ladder was actually walked. Reusing the
    // live handle from this session is not a match worth qualifying, and saying
    // "found by id" for it would be a small lie.
    if (!live) post({ type: 'ELEMENT_RESOLVED', payload: { ref: reference, level } });
  };

  /**
   * Draws the pins the panel asked for. Deciding what each pin points at lives
   * in pins/resolve.ts so it can be tested without a browser.
   */
  const renderPins = (requested: Pin[]): void => {
    if (!pins) return;
    pins.render(
      resolvePinTargets(requested, {
        snapshotId: measuredSnapshotId,
        measured,
        resolve: (reference) =>
          resolveReference(reference, document, (target) => toRect(target.getBoundingClientRect())).element,
      }),
    );
  };

  /**
   * Every sensitive field currently on screen, in viewport coordinates.
   *
   * Sent with every capture answer, whether or not anything asked about those
   * fields. A tab capture is of the whole screenful, so a crop taken for one
   * finding can contain somebody's card number sitting next to it -- the panel
   * paints over these before it encodes anything.
   *
   * Queried live rather than read off the snapshot. It is cheap, since forms
   * are small next to pages, and it is exact: a field that appeared after the
   * snapshot was taken still gets covered.
   */
  const viewportMasks = (): Rect[] => {
    const height = window.innerHeight;
    const width = window.innerWidth;
    const out: Rect[] = [];
    for (const field of document.querySelectorAll('input, textarea, select')) {
      if (!isSensitiveField(field)) continue;
      const rect = toRect(field.getBoundingClientRect());
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.y + rect.height <= 0 || rect.y >= height) continue;
      if (rect.x + rect.width <= 0 || rect.x >= width) continue;
      out.push(rect);
    }
    return out;
  };

  /**
   * Scrolls to one screenful and reports every element the panel asked about.
   *
   * The panel drives this: it works out from the snapshot which findings share
   * a screenful, sends one of these per screenful, and takes a single tab
   * capture from each answer. One capture per screenful rather than per
   * finding is not an optimisation -- tab capture allows two calls a second,
   * so per-finding would scroll a long page under the user for the better part
   * of a minute.
   *
   * Everything here is measured after the scroll rather than carried over from
   * the snapshot, because scrolling a real page changes it: lazy images
   * resolve, sticky headers detach, scroll-triggered layout runs.
   */
  const captureBand = (snapshotId: string, scrollY: number, indices: number[]): void => {
    /*
     * Thursday takes itself off the page for the capture.
     *
     * The toolbar floats over the page and pins sit on top of the very
     * elements being photographed, so without this a picture meant to show
     * somebody their own button shows our marker covering it.
     *
     * Restored two ways, because leaving the extension invisible would be much
     * worse than a screenshot with a pin in it: immediately when the panel
     * sends the final "just go back" band, and otherwise by a timer that each
     * band refreshes. A sweep that dies halfway -- the page navigates, the
     * panel closes -- cannot leave the overlay hidden.
     */
    host?.setVisible(false);
    if (overlayTimer !== null) clearTimeout(overlayTimer);
    overlayTimer = window.setTimeout(() => {
      overlayTimer = null;
      host?.setVisible(true);
    }, OVERLAY_RESTORE_MS);
    const reply = (targets: CaptureTarget[], masks: Rect[]): void => {
      post({
        type: 'BAND_READY',
        payload: {
          snapshotId,
          // Where the page actually landed. A short page, a scroll container or
          // a scroll-snap rule can all refuse the position that was asked for,
          // and cropping against the requested one would be off by the
          // difference.
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          devicePixelRatio: window.devicePixelRatio,
          pageVisible: document.visibilityState === 'visible',
          targets,
          masks,
        },
      });
    };

    // A stale snapshot id means the page was re-audited underneath this
    // sequence, and every index in it now points at something else.
    if (snapshotId !== measuredSnapshotId) {
      reply([], []);
      return;
    }

    // Instant, not smooth: a capture taken mid-animation photographs the page
    // halfway there. Two frames, because scrolling settles after the first.
    window.scrollTo({ top: Math.max(0, scrollY), left: 0, behavior: 'instant' });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (disposed) {
          reply([], []);
          return;
        }
        const targets = indices.map((index) => {
          const element = measured[index];
          if (!element?.isConnected) return { index, rect: null, sensitive: false };
          // The element itself or any field inside it: a finding is often
          // about the form row rather than the input in it.
          const sensitive =
            isSensitiveField(element) ||
            [...element.querySelectorAll('input, textarea, select')].some(isSensitiveField);
          if (sensitive) return { index, rect: null, sensitive: true };
          return { index, rect: toRect(element.getBoundingClientRect()), sensitive: false };
        });

        reply(targets, viewportMasks());

        // The last band of a sweep carries no targets: it is the panel putting
        // the page back where the user had it, and nothing is photographed
        // from it, so Thursday can come back straight away.
        if (indices.length === 0) {
          if (overlayTimer !== null) clearTimeout(overlayTimer);
          overlayTimer = null;
          host?.setVisible(true);
        }
      }),
    );
  };

  /**
   * Brings an element on screen and reports where it landed, so the panel can
   * crop a screenshot to it.
   *
   * Two facts travel with the rect because the panel cannot check either one:
   * whether this page is the visible tab (tab capture photographs whatever is
   * on screen, not whatever we asked about), and whether the element is a
   * sensitive field. Thursday never reads field contents, and it will not
   * photograph them either.
   */
  const measureForCapture = (findingId: string, reference: ElementReference): void => {
    const live = selected?.isConnected && selected.tagName.toLowerCase() === reference.tagName ? selected : null;
    let element: Element | null = live;
    let level: ResolutionLevel | null = null;
    if (!element) {
      const resolution = resolveReference(reference, document, (target) => toRect(target.getBoundingClientRect()));
      element = resolution.element;
      level = resolution.level;
    }

    const reply = (rect: Rect | null, sensitive: boolean): void => {
      post({
        type: 'ELEMENT_RECT',
        payload: {
          findingId,
          rect,
          level,
          pageVisible: document.visibilityState === 'visible',
          sensitive,
          devicePixelRatio: window.devicePixelRatio,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          masks: viewportMasks(),
          scrollY: window.scrollY,
          documentHeight: document.documentElement.scrollHeight,
        },
      });
    };

    if (!element) {
      reply(null, false);
      return;
    }
    // A crop of a card number is still a card number. The check covers the
    // element itself and any field inside it, because a finding is often about
    // the form row rather than the input.
    const sensitive =
      isSensitiveField(element) ||
      [...element.querySelectorAll('input, textarea, select')].some(isSensitiveField);
    if (sensitive) {
      reply(null, true);
      return;
    }

    // Off the page for the capture, same as a sweep: our own pin sits directly
    // on top of the element being photographed. Restored by the timer.
    host?.setVisible(false);
    if (overlayTimer !== null) clearTimeout(overlayTimer);
    overlayTimer = window.setTimeout(() => {
      overlayTimer = null;
      host?.setVisible(true);
    }, OVERLAY_RESTORE_MS);

    // Instant, not smooth: a crop taken mid-animation is a crop of the wrong
    // thing. Two frames, because scrolling settles after the first.
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const target = element;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (disposed || !target.isConnected) {
          reply(null, false);
          return;
        }
        reply(toRect(target.getBoundingClientRect()), false);
      }),
    );
  };

  const connect = (): void => {
    if (disposed) return;
    try {
      port = chrome.runtime.connect({ name: 'content' });
    } catch {
      port = null;
      return;
    }
    port.onMessage.addListener((raw: unknown) => {
      if (isEnvelope(raw)) handle(raw.message);
    });
    port.onDisconnect.addListener(() => {
      port = null;
      if (disposed) return;
      // The service worker is allowed to die; reconnecting wakes it. Give up
      // after a few tries so a removed extension does not spin forever.
      if (reconnectAttempts >= 3) return;
      reconnectAttempts += 1;
      setTimeout(() => {
        connect();
        if (port) announceActivation();
      }, 250 * reconnectAttempts);
    });
    reconnectAttempts = 0;
  };

  const onToolbarAction = (action: ToolbarAction): void => {
    if (action === 'close') {
      teardown();
      return;
    }
    if (action === 'select' || action === 'comment') {
      const purpose = action === 'comment' ? 'comment' : 'inspect';
      // A second press of the same button cancels; pressing the other one
      // switches purpose rather than stacking two pickers.
      if (selection?.isActive() && picking === purpose) selection.cancel();
      else startPicking(purpose);
    }
    post({ type: 'TOOLBAR_ACTION', payload: { action } });
  };

  function teardown(): void {
    if (disposed) return;
    disposed = true;
    if (overlayTimer !== null) clearTimeout(overlayTimer);
    post({ type: 'DEACTIVATED' });
    pins?.destroy();
    selection?.destroy();
    highlight?.destroy();
    toolbar?.destroy();
    host?.destroy();
    try {
      port?.disconnect();
    } catch {
      /* already gone */
    }
    port = null;
    delete globalScope[RUNTIME_KEY];
  }

  host = createHost();
  highlight = createHighlight(host.layer);
  pins = createPinLayer(host.layer, (targetId, kind) =>
    post({ type: 'PIN_CLICKED', payload: { targetId, kind } }),
  );
  selection = createSelection(highlight, {
    onHover: (preview) => post({ type: 'ELEMENT_HOVERED', payload: { preview } }),
    onPick: (element) => {
      if (picking === 'comment') emitAnnotationTarget(element);
      else emitSelection(element);
    },
    onStateChange: (active) => {
      const commenting = picking === 'comment';
      toolbar?.setPressed('select', active && !commenting);
      toolbar?.setPressed('comment', active && commenting);
      toolbar?.announce(
        active
          ? commenting
            ? 'Click the element you want to comment on, or press Escape to cancel.'
            : 'Selection mode on. Click an element, or press Escape to cancel.'
          : commenting
            ? 'Comment placement cancelled.'
            : 'Selection mode off.',
      );
      // Both states are announced, so the panel can show the right prompt and
      // never leaves a "click an element" banner up after Escape.
      post({ type: commenting ? 'ANNOTATION_STATE' : 'SELECTION_STATE', payload: { active } });
    },
  });
  connect();

  void getSetting('toolbarPosition').then((saved) => {
    if (disposed || !host) return;
    toolbar = createToolbar({
      initialPosition: saved,
      onAction: onToolbarAction,
      onMoved: (position) => void setSetting('toolbarPosition', position),
    });
    host.layer.append(toolbar.element);
    // Measured, not guessed: the toolbar has to be in the document before its
    // width is knowable, and the width changed when the labels became icons.
    if (!saved) toolbar.centre();
    // Everything the panel can act on the moment the page has answered. Audit
    // belongs here too and was missing, which left the toolbar's first button
    // permanently greyed out.
    toolbar.setEnabled('audit', true);
    toolbar.setEnabled('select', true);
    toolbar.setEnabled('comment', true);
    toolbar.setEnabled('inspect', true);
    announceActivation();
  });

  globalScope[RUNTIME_KEY] = {
    version: 1,
    reveal() {
      // Second activation on an already-running page: re-announce so a freshly
      // opened side panel gets the current page details, and nudge the toolbar
      // back on screen in case the window was resized while we were idle.
      announceActivation();
      window.dispatchEvent(new Event('resize'));
    },
    teardown,
  };
}

install();
