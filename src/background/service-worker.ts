import { assertNever, type ErrorCode } from '../shared/result';
import type { Envelope, ThursdayMessage } from '../shared/messaging/protocol';
import { isEnvelope } from '../shared/messaging/protocol';
import { checkUrl } from '../shared/utils/url';
import { ACTIVATE_COMMAND } from '../shared/constants/product';

/**
 * The MV3 service worker is killed after ~30s idle, so it owns no audit state
 * (PLAN.md section 4). It does three things: inject on request, route messages
 * between the side panel and the content script, and capture screenshots.
 *
 * The registry below is intentionally allowed to evaporate: connected ports keep
 * the worker alive, and every port re-registers on reconnect.
 */
const contentPorts = new Map<number, chrome.runtime.Port>();
const panelPorts = new Set<chrome.runtime.Port>();

/** The tab the user most recently activated. See targetTab(). */
let lastActivatedTabId: number | undefined;

const CONTENT_SCRIPT_FILE = 'content.js';

// The popup opens the side panel itself (it has the user gesture), so the action
// click must not also toggle it.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
    /* older Chrome: default behaviour is fine */
  });
});

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

/**
 * Which tab a panel message is for.
 *
 * Routing purely by "the active tab" is wrong the moment the user switches tabs
 * while the panel is open: the message lands on a page that has no content
 * script, and the panel reports "not activated" for a page it is still showing.
 * So prefer the active tab only when it is actually running Thursday, then fall
 * back to the last tab the user activated, then to the only running tab.
 */
async function targetTab(): Promise<number | undefined> {
  const active = await getActiveTab();
  if (active?.id !== undefined && contentPorts.has(active.id)) return active.id;
  if (lastActivatedTabId !== undefined && contentPorts.has(lastActivatedTabId)) return lastActivatedTabId;
  if (contentPorts.size === 1) return [...contentPorts.keys()][0];
  return undefined;
}

function toPanels(message: ThursdayMessage, tabId?: number): void {
  const envelope: Envelope = tabId === undefined ? { from: 'content', message } : { from: 'content', tabId, message };
  for (const port of panelPorts) {
    try {
      port.postMessage(envelope);
    } catch {
      panelPorts.delete(port);
    }
  }
}

function toContent(tabId: number, message: ThursdayMessage): boolean {
  const port = contentPorts.get(tabId);
  if (!port) return false;
  try {
    port.postMessage({ from: 'sidepanel', tabId, message } satisfies Envelope);
    return true;
  } catch {
    contentPorts.delete(tabId);
    return false;
  }
}

function panelError(code: ErrorCode, detail?: string): void {
  toPanels({ type: 'ERROR', payload: detail === undefined ? { code } : { code, detail } });
}

async function activate(tabId: number, url: string | undefined): Promise<{ ok: boolean; code?: ErrorCode }> {
  const verdict = checkUrl(url);
  if (!verdict.auditable) return { ok: false, code: 'RESTRICTED_PAGE' };
  try {
    // Idempotent on the page side: a second injection re-attaches rather than
    // installing twice (PLAN.md section 4).
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: [CONTENT_SCRIPT_FILE],
    });
    lastActivatedTabId = tabId;
    return { ok: true };
  } catch {
    return { ok: false, code: 'INJECTION_FAILED' };
  }
}

/**
 * The keyboard shortcut.
 *
 * Like clicking the action, pressing it is a user gesture that grants
 * activeTab -- which is why activation can start here and not from a button
 * inside the side panel (PLAN.md section 2.1). It also opens the panel, since
 * the gesture is what makes that allowed.
 */
chrome.commands.onCommand.addListener((command) => {
  if (command !== ACTIVATE_COMMAND) return;
  void (async () => {
    const tab = await getActiveTab();
    if (tab?.id === undefined) return;
    // Opened first: the gesture window closes once we start awaiting other work.
    const panel = chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
    const result = await activate(tab.id, tab.url);
    await panel;
    if (!result.ok) panelError(result.code ?? 'UNKNOWN');
  })();
});

/** One-shot commands. Used by the popup, which cannot hold a port open. */
chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const message = raw as ThursdayMessage;
  if (typeof message?.type !== 'string') return false;

  switch (message.type) {
    case 'ACTIVATE_PAGE': {
      void (async () => {
        const tab = await getActiveTab();
        if (!tab?.id) {
          sendResponse({ ok: false, error: { code: 'NO_ACTIVE_TAB' } });
          return;
        }
        const result = await activate(tab.id, tab.url);
        sendResponse(
          result.ok ? { ok: true, value: undefined } : { ok: false, error: { code: result.code } },
        );
      })();
      return true; // async response
    }
    case 'GET_PAGE_STATUS': {
      void (async () => {
        const tab = await getActiveTab();
        const activated = tab?.id !== undefined && contentPorts.has(tab.id);
        sendResponse({ ok: true, value: { activated } });
      })();
      return true;
    }
    case 'DEACTIVATE': {
      void (async () => {
        const tabId = await targetTab();
        const delivered = tabId !== undefined && toContent(tabId, { type: 'DEACTIVATE' });
        sendResponse(delivered ? { ok: true, value: undefined } : { ok: false, error: { code: 'NOT_ACTIVATED' } });
      })();
      return true;
    }
    default:
      return false;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'content') {
    const tabId = port.sender?.tab?.id;
    if (tabId === undefined) {
      port.disconnect();
      return;
    }
    contentPorts.set(tabId, port);
    // A connecting content script is the truest signal of what the user
    // activated -- truer than the injection call, which a reload invalidates.
    lastActivatedTabId = tabId;
    port.onDisconnect.addListener(() => {
      contentPorts.delete(tabId);
      toPanels({ type: 'PAGE_STATUS', payload: { activated: false } }, tabId);
    });
    port.onMessage.addListener((raw: unknown) => {
      if (!isEnvelope(raw)) return;
      routeFromContent(tabId, raw.message);
    });
    return;
  }

  if (port.name === 'sidepanel') {
    panelPorts.add(port);
    port.onDisconnect.addListener(() => panelPorts.delete(port));
    port.onMessage.addListener((raw: unknown) => {
      if (!isEnvelope(raw)) return;
      void routeFromPanel(raw.message);
    });
    // Tell a freshly opened panel what it is looking at. PAGE_ACTIVATED is a
    // one-shot broadcast, so a panel opened after activation missed it: ask the
    // page to say it again rather than caching a stale copy here.
    void (async () => {
      const tabId = await targetTab();
      const activated = tabId !== undefined;
      port.postMessage({
        from: 'content',
        message: { type: 'PAGE_STATUS', payload: { activated } },
      } satisfies Envelope);
      if (tabId !== undefined) toContent(tabId, { type: 'REQUEST_PAGE_INFO' });
    })();
    return;
  }

  port.disconnect();
});

/** Content -> panel. The worker never interprets, it only forwards. */
function routeFromContent(tabId: number, message: ThursdayMessage): void {
  switch (message.type) {
    case 'PAGE_ACTIVATED':
    case 'DEACTIVATED':
    case 'ELEMENT_HOVERED':
    case 'ELEMENT_SELECTED':
    case 'SELECTION_STATE':
    case 'SNAPSHOT_READY':
    case 'PIN_CLICKED':
    case 'ELEMENT_RESOLVED':
    case 'ELEMENT_RECT':
    case 'ANNOTATION_TARGET':
    case 'ANNOTATION_STATE':
    case 'ANNOTATION_SUBMITTED':
    case 'BAND_READY':
    case 'TOOLBAR_ACTION':
    case 'ERROR':
      toPanels(message, tabId);
      return;
    // Panel-bound or worker-bound message types never originate in the page.
    case 'ACTIVATE_PAGE':
    case 'DEACTIVATE':
    case 'GET_PAGE_STATUS':
    case 'REQUEST_PAGE_INFO':
    case 'PAGE_STATUS':
    case 'START_SELECTION':
    case 'CANCEL_SELECTION':
    case 'REQUEST_SNAPSHOT':
    case 'AUDIT_PROGRESS':
    case 'RENDER_PINS':
    case 'CLEAR_PINS':
    case 'SET_ACTIVE_PIN':
    case 'FOCUS_ELEMENT':
    case 'REQUEST_ELEMENT_RECT':
    case 'START_ANNOTATION':
    case 'CANCEL_ANNOTATION':
    case 'CAPTURE_BAND':
    case 'ANNOTATION_SAVED':
    case 'COMMENTS_READY':
      return;
    default:
      assertNever(message, 'routeFromContent');
  }
}

/** Panel -> content, for the tab the panel is bound to (see targetTab). */
async function routeFromPanel(message: ThursdayMessage): Promise<void> {
  switch (message.type) {
    case 'ACTIVATE_PAGE': {
      const tab = await getActiveTab();
      if (!tab?.id) {
        panelError('NO_ACTIVE_TAB');
        return;
      }
      const result = await activate(tab.id, tab.url);
      if (!result.ok) panelError(result.code ?? 'UNKNOWN');
      return;
    }
    case 'DEACTIVATE':
    case 'START_SELECTION':
    case 'CANCEL_SELECTION':
    case 'REQUEST_PAGE_INFO':
    case 'REQUEST_SNAPSHOT':
    case 'RENDER_PINS':
    case 'CLEAR_PINS':
    case 'SET_ACTIVE_PIN':
    case 'FOCUS_ELEMENT':
    case 'REQUEST_ELEMENT_RECT':
    case 'START_ANNOTATION':
    case 'CANCEL_ANNOTATION':
    case 'ANNOTATION_SAVED':
    case 'COMMENTS_READY':
    case 'CAPTURE_BAND': {
      const tabId = await targetTab();
      if (tabId === undefined || !toContent(tabId, message)) panelError('NOT_ACTIVATED');
      return;
    }
    // Content-bound or panel-bound only.
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
    case 'ELEMENT_RESOLVED':
    case 'ELEMENT_RECT':
    case 'ANNOTATION_TARGET':
    case 'ANNOTATION_STATE':
    case 'ANNOTATION_SUBMITTED':
    case 'BAND_READY':
    case 'TOOLBAR_ACTION':
    case 'ERROR':
      return;
    default:
      assertNever(message, 'routeFromPanel');
  }
}
