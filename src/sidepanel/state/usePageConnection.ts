import { useCallback, useEffect, useRef, useState } from 'react';
import { connectPort, type TypedPort } from '../../shared/messaging/port';
import type {
  ElementRectReply,
  SelectedElement,
  ThursdayMessage,
  ToolbarAction,
} from '../../shared/messaging/protocol';
import { assertNever, USER_MESSAGES } from '../../shared/result';
import type { ElementPreview, PageSnapshot, ResolutionLevel, Viewport } from '../../shared/types';

export type PageState = {
  activated: boolean;
  url: string | null;
  title: string | null;
  viewport: Viewport | null;
  lastToolbarAction: ToolbarAction | null;
  error: string | null;
  selecting: boolean;
  hovered: ElementPreview | null;
  selection: SelectedElement | null;
  /** Last pin the user clicked on the page. */
  pinClicked: { findingId: string; at: number } | null;
  /** Which rung of the resolution ladder last found the selected element. */
  resolution: ResolutionLevel | null | 'unresolved';
  snapshot: PageSnapshot | null;
  /** The page's answer to the last screenshot rect request. */
  elementRect: (ElementRectReply & { at: number }) | null;
};

export type LogEntry = { at: number; direction: 'in' | 'out'; type: ThursdayMessage['type'] };

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
  resolution: null,
  snapshot: null,
  elementRect: null,
};

const LOG_LIMIT = 40;

/**
 * The side panel owns audit state (the service worker cannot: MV3 kills it).
 * This hook is the panel's single connection to the page.
 */
export function usePageConnection(): {
  page: PageState;
  log: LogEntry[];
  send(message: ThursdayMessage): void;
} {
  const [page, setPage] = useState<PageState>(INITIAL);
  const [log, setLog] = useState<LogEntry[]>([]);
  const portRef = useRef<TypedPort | null>(null);

  const record = useCallback((direction: 'in' | 'out', type: ThursdayMessage['type']) => {
    setLog((entries) => [{ at: Date.now(), direction, type }, ...entries].slice(0, LOG_LIMIT));
  }, []);

  useEffect(() => {
    const port = connectPort('sidepanel');
    portRef.current = port;

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
          setPage((state) => ({ ...state, lastToolbarAction: message.payload.action }));
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
            pinClicked: { findingId: message.payload.findingId, at: Date.now() },
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
        case 'SET_ACTIVE_FINDING':
        case 'FOCUS_ELEMENT':
        case 'REQUEST_ELEMENT_RECT':
          return;
        default:
          assertNever(message, 'sidepanel.onMessage');
      }
    });

    port.onDisconnect(() => {
      portRef.current = null;
    });

    return () => {
      port.disconnect();
      portRef.current = null;
    };
  }, [record]);

  const send = useCallback(
    (message: ThursdayMessage) => {
      record('out', message.type);
      portRef.current?.post(message);
    },
    [record],
  );

  return { page, log, send };
}
