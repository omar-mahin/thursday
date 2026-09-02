import { assertNever } from '../shared/result';
import type { Envelope, ThursdayMessage, ToolbarAction } from '../shared/messaging/protocol';
import { isEnvelope } from '../shared/messaging/protocol';
import type { ElementReference, Pin, ResolutionLevel, Viewport } from '../shared/types';
import { describeElement, resolveReference } from '../audit/element/identity';
import { getSetting, setSetting } from '../storage/settings';
import { createHost, type ShadowHost } from './host';
import { createHighlight, describeForLabel, type Highlight } from './overlay/highlight';
import { createSelection, type Selection } from './selector/selection';
import { createPinLayer, type PinLayer, type PinTarget } from './pins/pins';
import { collectSnapshot } from './snapshot/collect';
import { snapshotSingleElement } from './snapshot/element';
import { toRect } from './snapshot/measure';
import { createToolbar, type Toolbar } from './toolbar/toolbar';

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
  let port: chrome.runtime.Port | null = null;
  /** The live element behind the current selection. Held directly, never
   *  re-queried, so identity cannot drift during a session. */
  let selected: Element | null = null;
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
        selection?.start();
        return;
      case 'CANCEL_SELECTION':
        selection?.cancel();
        return;
      case 'REQUEST_SNAPSHOT':
        sendSnapshot(message.payload.includeOffscreen);
        return;
      case 'FOCUS_ELEMENT':
        focusElement(message.payload.ref);
        return;
      case 'RENDER_PINS':
        renderPins(message.payload.pins);
        return;
      case 'CLEAR_PINS':
        pins?.clear();
        return;
      case 'SET_ACTIVE_FINDING':
        pins?.setActive(message.payload.findingId);
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
      case 'SET_ACTIVE_FINDING':
      case 'PIN_CLICKED':
      case 'ELEMENT_RESOLVED':
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
      post({ type: 'SNAPSHOT_READY', payload: collected.snapshot });
    } catch (error) {
      post({
        type: 'ERROR',
        payload: { code: 'SNAPSHOT_FAILED', detail: error instanceof Error ? error.message : undefined },
      });
    }
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
   * Draws the pins the panel asked for. Each pin prefers the element measured
   * during the audit, and falls back to the resolution ladder when that element
   * is gone -- a pin found that way is drawn dashed, because its position is a
   * best guess rather than a measurement.
   */
  const renderPins = (requested: Pin[]): void => {
    if (!pins) return;
    const targets: PinTarget[] = requested.map((pin) => {
      const fromAudit = measured[pin.elementIndex];
      if (fromAudit?.isConnected) return { pin, element: fromAudit, approximate: false };
      const resolved = resolveReference(pin.ref, document, (target) => toRect(target.getBoundingClientRect()));
      return { pin, element: resolved.element, approximate: true };
    });
    pins.render(targets);
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
    if (action === 'select') {
      if (selection?.isActive()) selection.cancel();
      else selection?.start();
    }
    post({ type: 'TOOLBAR_ACTION', payload: { action } });
  };

  function teardown(): void {
    if (disposed) return;
    disposed = true;
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
  pins = createPinLayer(host.layer, (findingId) => post({ type: 'PIN_CLICKED', payload: { findingId } }));
  selection = createSelection(highlight, {
    onHover: (preview) => post({ type: 'ELEMENT_HOVERED', payload: { preview } }),
    onPick: emitSelection,
    onStateChange: (active) => {
      toolbar?.setPressed('select', active);
      toolbar?.announce(active ? 'Selection mode on. Click an element, or press Escape to cancel.' : 'Selection mode off.');
      post({ type: 'SELECTION_STATE', payload: { active } });
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
    toolbar.setEnabled('select', true);
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
