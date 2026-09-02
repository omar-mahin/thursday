import { assertNever } from '../shared/result';
import type { Envelope, ThursdayMessage, ToolbarAction } from '../shared/messaging/protocol';
import { isEnvelope } from '../shared/messaging/protocol';
import type { Viewport } from '../shared/types';
import { getSetting, setSetting } from '../storage/settings';
import { createHost, type ShadowHost } from './host';
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
  let port: chrome.runtime.Port | null = null;
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
      case 'START_SELECTION':
      case 'CANCEL_SELECTION':
        // Sprint 2.
        toolbar?.announce('Element selection is not available yet.');
        return;
      case 'REQUEST_SNAPSHOT':
        // Sprint 2 builds the snapshot; failing loudly beats a silent no-op.
        post({ type: 'ERROR', payload: { code: 'SNAPSHOT_FAILED', detail: 'Snapshot lands in Sprint 2.' } });
        return;
      case 'RENDER_PINS':
      case 'CLEAR_PINS':
      case 'FOCUS_ELEMENT':
        // Sprint 4.
        return;
      // Never sent to the page.
      case 'ACTIVATE_PAGE':
      case 'PAGE_ACTIVATED':
      case 'GET_PAGE_STATUS':
      case 'PAGE_STATUS':
      case 'DEACTIVATED':
      case 'ELEMENT_HOVERED':
      case 'ELEMENT_SELECTED':
      case 'SNAPSHOT_READY':
      case 'AUDIT_PROGRESS':
      case 'PIN_CLICKED':
      case 'ELEMENT_RESOLVED':
      case 'TOOLBAR_ACTION':
      case 'ERROR':
        return;
      default:
        assertNever(message, 'content.handle');
    }
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
    if (action === 'settings') {
      post({ type: 'TOOLBAR_ACTION', payload: { action } });
      return;
    }
    post({ type: 'TOOLBAR_ACTION', payload: { action } });
  };

  function teardown(): void {
    if (disposed) return;
    disposed = true;
    post({ type: 'DEACTIVATED' });
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
  connect();

  void getSetting('toolbarPosition').then((saved) => {
    if (disposed || !host) return;
    toolbar = createToolbar({
      initialPosition: saved,
      onAction: onToolbarAction,
      onMoved: (position) => void setSetting('toolbarPosition', position),
    });
    host.layer.append(toolbar.element);
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
