import type {
  AnnotationPriority,
  AuditStage,
  ElementPreview,
  ElementReference,
  ElementSnapshot,
  PageSnapshot,
  Pin,
  PinKind,
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
  | { type: 'PIN_CLICKED'; payload: { targetId: string; kind: PinKind } }
  /** Panel -> page: which finding or comment is open, so its pin stands out. */
  | { type: 'SET_ACTIVE_PIN'; payload: { targetId: string | null } }
  | { type: 'FOCUS_ELEMENT'; payload: { ref: ElementReference } }
  | { type: 'ELEMENT_RESOLVED'; payload: { ref: ElementReference; level: ResolutionLevel | null } }
  // -- comments (Sprint 7) ---------------------------------------------------
  /**
   * Panel -> page: let the user click the thing they want to comment on.
   *
   * Separate from START_SELECTION even though both pick an element, because
   * what happens next differs: a selection fills the Element tab, an
   * annotation target opens a compose box. One message with a mode flag would
   * mean every handler downstream has to remember to check it.
   */
  /**
   * Panel -> page: open the comment card.
   *
   * `anchored` false opens it straight away with no element behind it. A
   * comment about the page as a whole is a real and common thing to want --
   * "the checkout asks for the same thing twice" is about no single element --
   * and when the composer moved onto the page that was briefly the one thing
   * it could not do.
   */
  | { type: 'START_ANNOTATION'; payload: { anchored: boolean } }
  | { type: 'CANCEL_ANNOTATION' }
  | { type: 'ANNOTATION_TARGET'; payload: AnnotationTarget }
  | { type: 'ANNOTATION_STATE'; payload: { active: boolean } }
  /**
   * Page -> panel: a comment the user finished writing on the page.
   *
   * The composer gathers, the panel stores. Storage stays in one place --
   * the panel owns the database -- so the page never needs its own copy of
   * attachment handling, image refusals or the annotation schema.
   *
   * Images travel as data URLs because runtime messaging is JSON: a Blob does
   * not survive the trip. They are downscaled by the page first, using the
   * same code the panel uses, so what crosses is a few hundred kilobytes
   * rather than the original file.
   */
  | { type: 'ANNOTATION_SUBMITTED'; payload: AnnotationSubmission }
  /** Panel -> page: stored, or refused with a reason to show in the card. */
  | { type: 'ANNOTATION_SAVED'; payload: { ok: true } | { ok: false; detail: string } }
  /**
   * Panel -> page: whether there is somewhere to put a comment yet.
   *
   * A comment is stored against the audit it was written on, so until there is
   * one there is nowhere for it to go. Without this the toolbar's Comment
   * button was pressable, the card opened, the user typed, and only then were
   * they told it could not be kept -- the same dead end the greyed-out Report
   * button used to be, with the added insult of having written something first.
   */
  | { type: 'COMMENTS_READY'; payload: { ready: boolean } }
  // -- screenshot crops (Sprint 5) -------------------------------------------
  /** Panel -> page: bring an element on screen and say exactly where it landed. */
  | { type: 'REQUEST_ELEMENT_RECT'; payload: { findingId: string; ref: ElementReference } }
  | { type: 'ELEMENT_RECT'; payload: ElementRectReply }
  /**
   * Panel -> page: scroll to a position and measure these elements there.
   *
   * One message per screenful rather than one per finding, because tab capture
   * is rate-limited to two calls a second -- thirty findings one at a time is
   * fifteen seconds of a page scrolling under the user, and most of those
   * captures would be photographs of the same screenful.
   *
   * `indices` empty means "just go there": the panel sends one of those at the
   * end to put the page back where the user left it.
   */
  | { type: 'CAPTURE_BAND'; payload: { snapshotId: string; scrollY: number; indices: number[] } }
  | { type: 'BAND_READY'; payload: CaptureBandReply }
  // -- toolbar intents -------------------------------------------------------
  | { type: 'TOOLBAR_ACTION'; payload: { action: ToolbarAction } }
  // -- failure ---------------------------------------------------------------
  | { type: 'ERROR'; payload: { code: ErrorCode; detail?: string } };

/**
 * Where the user chose to put a comment.
 *
 * Carries the document rect as well as the reference so the pin can be drawn
 * immediately, before any re-resolution: the element is right there under the
 * pointer, and making the first draw of a brand-new pin approximate would be
 * needlessly pessimistic.
 */
export type AnnotationTarget = {
  reference: ElementReference;
  /** Document-relative, so it survives scrolling. */
  documentRect: Rect;
  /**
   * Index into the current snapshot, when this element was one of the ones the
   * audit measured. Absent for anything the audit did not see, which is normal
   * -- a comment can be about an element no rule looked at.
   *
   * There is deliberately no separate label field: `reference` already carries
   * the tag, role, accessible name and text snippet, and a second description
   * of the same element is a second thing to keep in step.
   */
  elementIndex?: number;
  /**
   * Which snapshot that index belongs to.
   *
   * Sent with the index or not at all. An index with no snapshot behind it is
   * not a shortcut, it is a number that happens to be in range -- and using it
   * against a different snapshot draws a confident pin on the wrong element.
   */
  snapshotId?: string;
};

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
  /**
   * Sensitive fields on screen, viewport-relative. Painted over before the
   * crop is encoded -- a crop taken for one finding can contain a card field
   * belonging to another. See CaptureBandReply, which carries the same thing
   * for the same reason.
   */
  masks: Rect[];
  /** Where the screenful sits in the document, for the locator's page track. */
  scrollY: number;
  documentHeight: number;
};

/**
 * The answer to CAPTURE_BAND: where the page ended up, and where the elements
 * are now that it is there.
 *
 * Rects are re-measured rather than taken from the snapshot. The snapshot's
 * were correct when it was built, and scrolling a real page invalidates them --
 * images finish loading, sticky headers detach, scroll-triggered layout runs.
 * Cropping a stale rect produces a confident photograph of the wrong thing.
 *
 * `masks` is the part that has nothing to do with accuracy. A capture is of the
 * whole screenful, so a crop taken for one finding can contain a password or
 * card field belonging to something else entirely. These are the viewport rects
 * of every sensitive field on screen, and the compositor paints over them
 * before anything is stored. Thursday will not photograph them for the same
 * reason it will not read them.
 */
export type CaptureBandReply = {
  snapshotId: string;
  /** Where the page actually landed, which is not always where it was asked. */
  scrollX: number;
  scrollY: number;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  pageVisible: boolean;
  targets: CaptureTarget[];
  masks: Rect[];
};

export type CaptureTarget = {
  index: number;
  /** Viewport-relative, at the scroll position above. Null when it is gone. */
  rect: Rect | null;
  /** True when this element is (or contains) a field Thursday will not photograph. */
  sensitive: boolean;
};

/** A finished comment, on its way from the page to the panel. */
export type AnnotationSubmission = {
  /**
   * Identifies this submission across retries.
   *
   * The page resends until the panel acknowledges, because either half of the
   * round trip can be down: the worker can be collected, and after it restarts
   * the panel may not have reconnected yet -- so a message forwarded in that
   * window reaches nobody. Retrying makes delivery at-least-once, and this id
   * is what stops at-least-once becoming duplicate comments.
   */
  submissionId: string;
  /** Null for a comment about the page as a whole. */
  target: AnnotationTarget | null;
  body: string;
  priority: AnnotationPriority;
  /** The author's name as it stood when they wrote it. */
  author: string;
  images: SubmittedImage[];
};

export type SubmittedImage = {
  name: string;
  mime: string;
  /** Already downscaled and re-encoded by the page. */
  dataUrl: string;
};

export type ThursdayMessageType = ThursdayMessage['type'];

/**
 * The buttons on the page toolbar.
 *
 * Deliberately short. Two actions used to be here and are not:
 *
 *  - 'report', which was greyed out and unwireable -- the panel already has
 *    Save report and Save PDF, so a third control was a place to look rather
 *    than a thing to do.
 *  - 'settings', which opened the settings page. Settings is not something
 *    anyone reaches for mid-audit, and the popup already has it.
 */
export type ToolbarAction = 'audit' | 'select' | 'comment' | 'inspect' | 'close';

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
