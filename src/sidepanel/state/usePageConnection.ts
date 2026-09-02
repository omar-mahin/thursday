import { useCallback, useEffect, useRef, useState } from 'react';
import { connectPort, type TypedPort } from '../../shared/messaging/port';
import type { ThursdayMessage, ToolbarAction } from '../../shared/messaging/protocol';
import { assertNever, USER_MESSAGES } from '../../shared/result';
import type { Viewport } from '../../shared/types';

export type PageState = {
  activated: boolean;
  url: string | null;
  title: string | null;
  viewport: Viewport | null;
  lastToolbarAction: ToolbarAction | null;
  error: string | null;
};

export type LogEntry = { at: number; direction: 'in' | 'out'; type: ThursdayMessage['type'] };

const INITIAL: PageState = {
  activated: false,
  url: null,
  title: null,
  viewport: null,
  lastToolbarAction: null,
  error: null,
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
          setPage({
            activated: true,
            url: message.payload.url,
            title: message.payload.title,
            viewport: message.payload.viewport,
            lastToolbarAction: null,
            error: null,
          });
          return;
        case 'DEACTIVATED':
          setPage((state) => ({ ...state, activated: false, viewport: null }));
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
        // Sprints 2-4 wire these up.
        case 'ELEMENT_HOVERED':
        case 'ELEMENT_SELECTED':
        case 'SNAPSHOT_READY':
        case 'AUDIT_PROGRESS':
        case 'PIN_CLICKED':
        case 'ELEMENT_RESOLVED':
          return;
        // Panel-to-page only.
        case 'ACTIVATE_PAGE':
        case 'GET_PAGE_STATUS':
        case 'DEACTIVATE':
        case 'START_SELECTION':
        case 'CANCEL_SELECTION':
        case 'REQUEST_SNAPSHOT':
        case 'RENDER_PINS':
        case 'CLEAR_PINS':
        case 'FOCUS_ELEMENT':
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
