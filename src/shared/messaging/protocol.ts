import type {
  AuditStage,
  ElementPreview,
  ElementReference,
  ElementSnapshot,
  PageSnapshot,
  Pin,
  Rect,
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
  /** Panel -> page: which finding is open, so its pin can stand out. */
  | { type: 'SET_ACTIVE_FINDING'; payload: { findingId: string | null } }
  | { type: 'FOCUS_ELEMENT'; payload: { ref: ElementReference } }
  | { type: 'ELEMENT_RESOLVED'; payload: { ref: ElementReference; level: ResolutionLevel | null } }
  // -- screenshot crops (Sprint 5) -------------------------------------------
  /** Panel -> page: bring an element on screen and say exactly where it landed. */
  | { type: 'REQUEST_ELEMENT_RECT'; payload: { findingId: string; ref: ElementReference } }
  | { type: 'ELEMENT_RECT'; payload: ElementRectReply }
  // -- toolbar intents -------------------------------------------------------
  | { type: 'TOOLBAR_ACTION'; payload: { action: ToolbarAction } }
  // -- failure ---------------------------------------------------------------
  | { type: 'ERROR'; payload: { code: ErrorCode; detail?: string } };

/**
 * The answer to REQUEST_ELEMENT_RECT.
 *
 * `pageVisible` and `sensitive` exist so the panel can refuse a capture rather
 * than take a wrong or private one: the tab capture API photographs whichever
 * tab is visible, and a crop of a password or payment field is exactly the
 * thing Thursday goes out of its way never to read.
 */
export type ElementRectReply = {
  findingId: string;
  rect: Rect | null;
  level: ResolutionLevel | null;
  pageVisible: boolean;
  sensitive: boolean;
  devicePixelRatio: number;
  /**
   * The viewport the rect was measured against.
   *
   * Tab capture photographs whichever tab is in front, and switching tabs is
   * not instant -- so the panel checks the image it got back really is this
   * page before cutting a rect out of it. Without that check a mistimed
   * capture crops the wrong page at plausible coordinates, which is a wrong
   * screenshot rather than a failed one.
   */
  viewport: { width: number; height: number };
};

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
