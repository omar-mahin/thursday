import type {
  AuditStage,
  ElementPreview,
  ElementReference,
  ElementSnapshot,
  PageSnapshot,
  Pin,
  ResolutionLevel,
  Viewport,
} from '../types';

/** A hand-picked element: the measured facts plus the handle used to find it
 *  again after a reload (PLAN.md section 2.5). */
export type SelectedElement = {
  element: ElementSnapshot;
  reference: ElementReference;
};
import type { ErrorCode } from '../result';

/**
 * The whole extension speaks this union and nothing else. No message string
 * literals exist outside this file (spec section 52).
 */
export type ThursdayMessage =
  // -- lifecycle -------------------------------------------------------------
  | { type: 'ACTIVATE_PAGE' }
  | { type: 'PAGE_ACTIVATED'; payload: { url: string; title: string; viewport: Viewport } }
  | { type: 'GET_PAGE_STATUS' }
  /** Panel -> page: re-announce, for a panel that opened after activation. */
  | { type: 'REQUEST_PAGE_INFO' }
  | { type: 'PAGE_STATUS'; payload: { activated: boolean; url?: string; title?: string } }
  | { type: 'DEACTIVATE' }
  | { type: 'DEACTIVATED' }
  // -- selection (Sprint 2) --------------------------------------------------
  | { type: 'START_SELECTION' }
  | { type: 'CANCEL_SELECTION' }
  | { type: 'ELEMENT_HOVERED'; payload: { preview: ElementPreview | null } }
  | { type: 'ELEMENT_SELECTED'; payload: SelectedElement }
  | { type: 'SELECTION_STATE'; payload: { active: boolean } }
  // -- audit (Sprint 3) ------------------------------------------------------
  | { type: 'REQUEST_SNAPSHOT'; payload: { includeOffscreen: boolean } }
  | { type: 'SNAPSHOT_READY'; payload: PageSnapshot }
  | { type: 'AUDIT_PROGRESS'; payload: { stage: AuditStage; done: number; total: number } }
  // -- findings on the page (Sprint 4) ---------------------------------------
  | { type: 'RENDER_PINS'; payload: { pins: Pin[] } }
  | { type: 'CLEAR_PINS' }
  | { type: 'PIN_CLICKED'; payload: { findingId: string } }
  | { type: 'FOCUS_ELEMENT'; payload: { ref: ElementReference } }
  | { type: 'ELEMENT_RESOLVED'; payload: { ref: ElementReference; level: ResolutionLevel | null } }
  // -- toolbar intents -------------------------------------------------------
  | { type: 'TOOLBAR_ACTION'; payload: { action: ToolbarAction } }
  // -- failure ---------------------------------------------------------------
  | { type: 'ERROR'; payload: { code: ErrorCode; detail?: string } };

export type ThursdayMessageType = ThursdayMessage['type'];

export type ToolbarAction = 'audit' | 'select' | 'inspect' | 'report' | 'settings' | 'close';

/** Who is on the other end of a long-lived port. */
export type PortName = 'sidepanel' | 'content';

export type Envelope = {
  from: PortName;
  /** Present when the message came from (or is bound for) a specific tab. */
  tabId?: number;
  message: ThursdayMessage;
};

export const isEnvelope = (value: unknown): value is Envelope => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['from'] !== 'sidepanel' && candidate['from'] !== 'content') return false;
  const message = candidate['message'];
  return typeof message === 'object' && message !== null && typeof (message as Record<string, unknown>)['type'] === 'string';
};
