import { assertNever, type ErrorCode } from '../shared/result';
import type { AnnotationSubmission, Envelope, ThursdayMessage } from '../shared/messaging/protocol';
import { isEnvelope } from '../shared/messaging/protocol';
import { checkUrl } from '../shared/utils/url';
import { annotationFromSubmission, notesBucketId, saveAnnotation } from '../storage/annotations';
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
/**
 * Panel ports, keyed by the tab they are in.
 *
 * A set used to be enough, because there was one side panel. Now the panel is
 * a frame the content script mounts, so every activated tab has one -- and
 * broadcasting to all of them meant pressing Audit on one tab made every other
 * tab's panel audit *this* tab and display its findings. A panel belongs to a
 * tab, so it hears about that tab.
 *
 * The undefined key holds panels opened outside a tab -- a panel document
 * opened directly, which is how the tests and a debugging session reach it.
 * Those hear everything, because there is nothing better to tell them.
 */
const panelPorts = new Map<chrome.runtime.Port, number | undefined>();

/**
 * Tabs where a comment was stored while no panel was listening.
 *
 * The worker tells panels when it stores one, but the panel it needs to tell is
 * often the one that has not reconnected yet -- that is why the worker had to
 * store it in the first place. So the notice is held until a panel for that tab
 * turns up, rather than broadcast into an empty room.
 *
 * Lost when the worker is collected, which is fine: it only has to survive the
 * couple of seconds between storing a note and a panel reconnecting.
 */
const pendingNotes = new Set<number>();

/** The tab the user most recently activated. See targetTab(). */
let lastActivatedTabId: number | undefined;

const CONTENT_SCRIPT_FILE = 'content.js';

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
  for (const [port, home] of panelPorts) {
    /*
     * A panel that belongs to an audited page hears only that page.
     *
     * Every real panel is one: it is a frame the content script mounts, so its
     * tab always has a content port. That is what stops an audit on one tab
     * appearing in another tab's panel -- which it did, because there is now a
     * panel on every activated tab rather than one side panel for the window.
     *
     * A panel whose own tab has no content script is not that. It is a panel
     * document somebody opened directly -- debugging, or the test harness
     * standing in for a panel -- and it has no page of its own to be about, so
     * it hears everything.
     */
    const ownsAPage = home !== undefined && contentPorts.has(home);
    if (ownsAPage && tabId !== undefined && home !== tabId) continue;
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
 * inside the panel (PLAN.md section 2.1).
 *
 * There is nothing to open any more: the panel is part of what gets injected,
 * so activating is the whole of it.
 */
chrome.commands.onCommand.addListener((command) => {
  if (command !== ACTIVATE_COMMAND) return;
  void (async () => {
    const tab = await getActiveTab();
    if (tab?.id === undefined) return;
    const result = await activate(tab.id, tab.url);
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
    // A panel framed in a page reports the containing tab; one opened as its
    // own document reports none.
    const home = port.sender?.tab?.id;
    panelPorts.set(port, home);
    port.onDisconnect.addListener(() => panelPorts.delete(port));
    // A comment stored while nothing was listening: tell this panel to look.
    if (home !== undefined && pendingNotes.delete(home)) {
      try {
        port.postMessage({ from: 'content', tabId: home, message: { type: 'COMMENTS_CHANGED' } });
      } catch {
        pendingNotes.add(home);
      }
    }
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

/**
 * Stores a comment when no panel is open to store it.
 *
 * Into the origin's notes bucket, because this side cannot know which audit a
 * panel would have chosen -- and a note in that bucket is adopted by the next
 * audit of the origin regardless of who wrote it.
 *
 * The content script is answered either way. It retries until it hears
 * something, so silence here would leave a card saying "Adding..." until its
 * own deadline, which is the failure this whole path exists to remove.
 */
async function storeWithoutPanel(tabId: number, submission: AnnotationSubmission): Promise<void> {
  const reply = (payload: ThursdayMessage & { type: 'ANNOTATION_SAVED' }): void => {
    toContent(tabId, payload);
  };
  try {
    const tab = await chrome.tabs.get(tabId);
    const origin = tab.url ? new URL(tab.url).origin : null;
    if (!origin) {
      reply({ type: 'ANNOTATION_SAVED', payload: { ok: false, detail: 'This page cannot be commented on.' } });
      return;
    }
    const { annotation, blobs } = annotationFromSubmission(submission, notesBucketId(origin));
    await saveAnnotation(annotation, blobs);
    reply({ type: 'ANNOTATION_SAVED', payload: { ok: true } });
    // Any panel that has appeared in the meantime is told to look, because it
    // may have already checked and found nothing. If none has, the notice
    // waits for one -- see pendingNotes.
    pendingNotes.add(tabId);
    toPanels({ type: 'COMMENTS_CHANGED' }, tabId);
  } catch {
    reply({
      type: 'ANNOTATION_SAVED',
      payload: { ok: false, detail: 'That comment could not be saved on this machine.' },
    });
  }
}

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
    case 'BAND_READY':
    case 'TOOLBAR_ACTION':
    case 'ERROR':
      toPanels(message, tabId);
      return;
    case 'OPEN_PANEL_TAB':
      // The frame could not show the panel, so give it a tab. Nothing else
      // in the extension can navigate on the page's behalf.
      void chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') }).catch(() => {
        toPanels({ type: 'ERROR', payload: { code: 'UNKNOWN', detail: 'Could not open the panel.' } }, tabId);
      });
      return;
    case 'ANNOTATION_SUBMITTED':
      /*
       * The one thing the worker stores rather than forwards, and only when
       * there is nobody to forward it to.
       *
       * The side panel owns the database, which quietly made "the panel is
       * open" a requirement for writing a comment -- a strange thing to be
       * true of a tool whose composer is on the page. Closing the panel and
       * writing a note lost the note, and the card could do nothing better
       * than say so.
       *
       * With a panel connected nothing changes: it stores, because it knows
       * which audit is open and this does not. Without one, the note goes to
       * the origin's own bucket and the next audit adopts it -- the same place
       * a note written before any audit goes.
       */
      if (panelPorts.size > 0) toPanels(message, tabId);
      else void storeWithoutPanel(tabId, message.payload);
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
      return;
    case 'COMMENTS_CHANGED':
      // Sent by this worker, never received from a page.
      toPanels(message, tabId);
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
    case 'COMMENTS_CHANGED':
    case 'OPEN_PANEL_TAB':
    case 'TOOLBAR_ACTION':
    case 'ERROR':
      return;
    default:
      assertNever(message, 'routeFromPanel');
  }
}
