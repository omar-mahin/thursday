import { useCallback, useEffect, useRef, useState } from 'react';
import { connectPort, type TypedPort } from '../../shared/messaging/port';
import type {
  AnnotationSubmission,
  AnnotationTarget,
  CaptureBandReply,
  ElementRectReply,
  SelectedElement,
  ThursdayMessage,
  ToolbarAction,
} from '../../shared/messaging/protocol';
import { assertNever, USER_MESSAGES } from '../../shared/result';
import type { ElementPreview, PageSnapshot, PinKind, ResolutionLevel, Viewport } from '../../shared/types';

export type PageState = {
  activated: boolean;
  url: string | null;
  title: string | null;
  viewport: Viewport | null;
  /**
   * The last button pressed on the page toolbar, stamped.
   *
   * Stamped for the same reason PIN_CLICKED is: pressing Audit twice is two
   * requests to audit, and an unstamped value would compare equal the second
   * time and be dropped.
   */
  lastToolbarAction: { action: ToolbarAction; at: number } | null;
  error: string | null;
  selecting: boolean;
  hovered: ElementPreview | null;
  selection: SelectedElement | null;
  /** Last pin the user clicked on the page. */
  pinClicked: { targetId: string; kind: PinKind; at: number } | null;
  /** True while the page is waiting for the user to click a comment anchor. */
  annotating: boolean;
  /** The last element picked for a comment. */
  annotationTarget: (AnnotationTarget & { at: number }) | null;
  /** Which rung of the resolution ladder last found the selected element. */
  resolution: ResolutionLevel | null | 'unresolved';
  snapshot: PageSnapshot | null;
  /** The page's answer to the last screenshot rect request. */
  elementRect: (ElementRectReply & { at: number }) | null;
  /**
   * The page's answer to the last CAPTURE_BAND, stamped.
   *
   * Stamped because two screenfuls can answer identically -- a page that
   * refuses to scroll answers with the same position and the same empty target
   * list every time -- and the second answer still has to move the sequence
   * along rather than look like no answer at all.
   */
  band: (CaptureBandReply & { at: number }) | null;
  /** The last comment the page finished writing, waiting to be stored. */
  submitted: (AnnotationSubmission & { at: number }) | null;
  /**
   * How many times the port has been re-established.
   *
   * Watched rather than ignored because things happen while a panel is
   * unreachable: the service worker stores comments itself when it cannot
   * forward them, so a reconnect is the panel's cue to go and look.
   */
  reconnects: number;
  /** Bumped when something outside this panel wrote a comment. */
  commentsChanged: number;
};

/** Reconnect tries before the panel admits the worker is not coming back. */
const RECONNECT_ATTEMPTS = 4;
const RECONNECT_DELAY_MS = 250;

/**
 * Messages held while the port is being re-established, and how long for.
 *
 * The click that discovers a dead worker is the one that loses its message.
 * Reconnecting takes a moment, so without this the first press after an idle
 * period always fails and the second works -- which is a fair description of
 * the bug this was reported as, only with an explanation attached. Holding the
 * message and sending it when the port comes back makes the first press work.
 *
 * Capped in both size and age. A message replayed seconds later is answering a
 * question the user has stopped asking.
 */
const OUTBOX_LIMIT = 20;
const OUTBOX_MAX_AGE_MS = 4000;

/**
 * Whether a message can be sent late.
 *
 * CAPTURE_BAND cannot. It is one step of a sequence that scrolls the user's
 * page and has its own deadline, so a copy arriving after that deadline has
 * passed would move the page for a sweep that has already given up. Losing it
 * is correct; the sweep notices and stops.
 */
const replayable = (message: ThursdayMessage): boolean => message.type !== 'CAPTURE_BAND';

const INITIAL: PageState = {
  activated: false,
  url: null,
  title: null,
  viewport: null,
  lastToolbarAction: null,
  error: null,
  selecting: false,
  hovered: null,
  selection: null,
  pinClicked: null,
  annotating: false,
  annotationTarget: null,
  resolution: null,
  snapshot: null,
  elementRect: null,
  band: null,
  submitted: null,
  reconnects: 0,
  commentsChanged: 0,
};


/**
 * The side panel owns audit state (the service worker cannot: MV3 kills it).
 * This hook is the panel's single connection to the page.
 */
export function usePageConnection(): {
  page: PageState;
  send(message: ThursdayMessage): void;
} {
  const [page, setPage] = useState<PageState>(INITIAL);
  const portRef = useRef<TypedPort | null>(null);
  /** Messages waiting for a port. See OUTBOX_LIMIT. */
  const outbox = useRef<{ at: number; message: ThursdayMessage }[]>([]);

  /*
   * The message tap, kept as a no-op hook point rather than as a log.
   *
   * There used to be a running list of every message, rendered in the panel
   * behind a flag. It was a development aid with no user, and it held every
   * message type this session had seen in state for no purpose. What is worth
   * keeping is the single place every message passes through, so the next
   * person debugging the protocol has one line to add a console call to.
   */
  const record = useCallback((_direction: 'in' | 'out', _type: ThursdayMessage['type']) => {}, []);

  /*
   * The port, reconnected when it drops.
   *
   * MV3 service workers are meant to die. A connected port keeps one alive
   * while messages are flowing and for a while after, but not indefinitely --
   * leave the panel open and read a report for a few minutes and the worker is
   * collected, which disconnects both ports.
   *
   * The content script has always reconnected. The panel did not: it set its
   * port to null and left it there, so `send` quietly dropped everything
   * afterwards. Nothing in the panel looked broken -- the findings were still
   * on screen -- but every button that talks to the page had stopped working,
   * and a request that expects an answer waited for one that could never come.
   * That was the "Capturing..." that never finished.
   *
   * Reconnecting also wakes the worker, which is the intended way to bring one
   * back. The re-announce afterwards is what makes the panel's idea of the page
   * true again rather than merely connected.
   */
  useEffect(() => {
    let disposed = false;
    let attempts = 0;
    let retry: number | undefined;

    const open = (): void => {
      if (disposed) return;
      const port = connectPort('sidepanel');
      portRef.current = port;
      wire(port);
      // Anything the user asked for while there was no port to ask over.
      const now = Date.now();
      const held = outbox.current;
      outbox.current = [];
      for (const entry of held) {
        if (now - entry.at > OUTBOX_MAX_AGE_MS) continue;
        try {
          port.post(entry.message);
        } catch {
          /* the new port is already gone; onDisconnect will handle it */
        }
      }
    };

    const wire = (port: TypedPort): void => {

    port.onMessage(({ message }) => {
      record('in', message.type);
      switch (message.type) {
        case 'PAGE_STATUS':
          setPage((state) => ({
            ...state,
            activated: message.payload.activated,
            url: message.payload.url ?? state.url,
            title: message.payload.title ?? state.title,
            error: null,
          }));
          return;
        case 'PAGE_ACTIVATED':
          setPage((state) => ({
            ...state,
            activated: true,
            url: message.payload.url,
            title: message.payload.title,
            viewport: message.payload.viewport,
            error: null,
          }));
          return;
        case 'DEACTIVATED':
          setPage((state) => ({
            ...state,
            activated: false,
            viewport: null,
            selecting: false,
            hovered: null,
          }));
          return;
        case 'SELECTION_STATE':
          setPage((state) => ({
            ...state,
            selecting: message.payload.active,
            hovered: message.payload.active ? state.hovered : null,
          }));
          return;
        case 'ELEMENT_HOVERED':
          setPage((state) => ({ ...state, hovered: message.payload.preview }));
          return;
        case 'ELEMENT_SELECTED':
          setPage((state) => ({
            ...state,
            selection: message.payload,
            resolution: null,
            selecting: false,
            hovered: null,
          }));
          return;
        case 'ELEMENT_RESOLVED':
          setPage((state) => ({
            ...state,
            resolution: message.payload.level === null ? 'unresolved' : message.payload.level,
          }));
          return;
        case 'SNAPSHOT_READY':
          setPage((state) => ({ ...state, snapshot: message.payload }));
          return;
        case 'ELEMENT_RECT':
          setPage((state) => ({ ...state, elementRect: { ...message.payload, at: Date.now() } }));
          return;
        case 'TOOLBAR_ACTION':
          setPage((state) => ({
            ...state,
            lastToolbarAction: { action: message.payload.action, at: Date.now() },
          }));
          return;
        case 'COMMENTS_CHANGED':
          setPage((state) => ({ ...state, commentsChanged: state.commentsChanged + 1 }));
          return;
        case 'ANNOTATION_SUBMITTED':
          // Stamped: two comments can be written in the same millisecond of
          // wall clock only in tests, but a second one with identical text
          // must still reach the store.
          setPage((state) => ({ ...state, submitted: { ...message.payload, at: Date.now() } }));
          return;
        case 'BAND_READY':
          // Stamped, because two screenfuls can answer identically -- same
          // scroll position, same empty target list -- and the second answer
          // still has to move the sequence along.
          setPage((state) => ({ ...state, band: { ...message.payload, at: Date.now() } }));
          return;
        case 'ERROR':
          setPage((state) => ({
            ...state,
            error: message.payload.detail ?? USER_MESSAGES[message.payload.code],
          }));
          return;
        case 'PIN_CLICKED':
          // Stamped so two clicks on the same pin still register.
          setPage((state) => ({
            ...state,
            pinClicked: { targetId: message.payload.targetId, kind: message.payload.kind, at: Date.now() },
          }));
          return;
        case 'ANNOTATION_STATE':
          setPage((state) => ({
            ...state,
            annotating: message.payload.active,
            hovered: message.payload.active ? state.hovered : null,
          }));
          return;
        case 'ANNOTATION_TARGET':
          // Stamped, so commenting on the same element twice in a row is two
          // separate targets rather than one the panel ignores.
          setPage((state) => ({
            ...state,
            annotating: false,
            hovered: null,
            annotationTarget: { ...message.payload, at: Date.now() },
          }));
          return;
        case 'AUDIT_PROGRESS':
          return;
        // Panel-to-page only.
        case 'ACTIVATE_PAGE':
        case 'GET_PAGE_STATUS':
        case 'REQUEST_PAGE_INFO':
        case 'DEACTIVATE':
        case 'START_SELECTION':
        case 'CANCEL_SELECTION':
        case 'REQUEST_SNAPSHOT':
        case 'RENDER_PINS':
        case 'CLEAR_PINS':
        case 'SET_ACTIVE_PIN':
        case 'FOCUS_ELEMENT':
        case 'CAPTURE_BAND':
        case 'ANNOTATION_SAVED':
        case 'OPEN_PANEL_TAB':
        case 'REQUEST_ELEMENT_RECT':
        case 'START_ANNOTATION':
        case 'CANCEL_ANNOTATION':
          return;
        default:
          assertNever(message, 'sidepanel.onMessage');
      }
    });

    port.onDisconnect(() => {
      portRef.current = null;
      if (disposed) return;
      /*
       * Backoff, and a ceiling.
       *
       * A worker that died of idleness comes back on the first try. One that
       * cannot be reached at all -- the extension was reloaded or removed from
       * under this panel -- would otherwise spin forever, so this gives up and
       * says so rather than reconnecting in a loop nobody can see.
       */
      if (attempts >= RECONNECT_ATTEMPTS) {
        setPage((state) => ({
          ...state,
          error: 'Lost the connection to the extension. Reopen the panel to reconnect.',
        }));
        return;
      }
      attempts += 1;
      retry = self.setTimeout(() => {
        open();
        setPage((state) => ({ ...state, reconnects: state.reconnects + 1 }));
        // Ask the page what it is, so the panel's idea of it is true again and
        // not just its socket.
        portRef.current?.post({ type: 'GET_PAGE_STATUS' });
        portRef.current?.post({ type: 'REQUEST_PAGE_INFO' });
      }, RECONNECT_DELAY_MS * attempts);
    });
    };

    open();

    return () => {
      disposed = true;
      if (retry !== undefined) clearTimeout(retry);
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, [record]);

  const send = useCallback(
    (message: ThursdayMessage) => {
      record('out', message.type);
      const port = portRef.current;
      if (port) {
        try {
          port.post(message);
          return;
        } catch {
          // postMessage on a port whose worker has gone throws. Treat it as a
          // disconnect: onDisconnect is already on its way with a reconnect.
          portRef.current = null;
        }
      }
      if (!replayable(message)) return;
      if (outbox.current.length >= OUTBOX_LIMIT) outbox.current.shift();
      outbox.current.push({ at: Date.now(), message });
    },
    [record],
  );

  return { page, send };
}
