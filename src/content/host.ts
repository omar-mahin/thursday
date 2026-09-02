import { HOST_TAG_NAME } from '../shared/constants/product';
import { CONTENT_CSS, OVERLAY_CSS, PIN_CSS } from './styles';

export type ShadowHost = {
  host: HTMLElement;
  root: ShadowRoot;
  /** Non-interactive full-viewport layer; children opt into pointer events. */
  layer: HTMLElement;
  destroy(): void;
};

const MAX_REATTACH = 20;

/**
 * Events fired inside a shadow root retarget to the host and keep bubbling, so
 * without this the page's own document listeners see every click on our
 * toolbar -- closing its menus, firing its analytics, stealing its keyboard
 * shortcuts. The extension must not interfere with normal page interaction
 * (spec section 7), so the host boundary contains them.
 *
 * These run in the bubble phase, after the toolbar's own handlers, so
 * containment costs the toolbar nothing.
 */
const CONTAINED_EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'keydown',
  'keyup',
  'keypress',
] as const;

/**
 * The host is styled with !important inline properties because the page's own
 * stylesheet can otherwise target our element by tag name.
 *
 * The shadow root is open, not closed, which deviates from the original plan.
 * Reasoning: the isolation that matters is the shadow boundary itself (identical
 * either way), a closed root does not actually stop a hostile page (it can still
 * see the host element, watch mutations, and patch attachShadow before we run),
 * and an open root lets the E2E suite drive the real UI instead of forcing us to
 * ship a testing backdoor -- which would be the genuinely worse trade.
 */
export function createHost(): ShadowHost {
  for (const stale of document.querySelectorAll(HOST_TAG_NAME)) stale.remove();

  const host = document.createElement(HOST_TAG_NAME);
  host.setAttribute('data-thursday-version', '1');
  const fixed: Array<[string, string]> = [
    ['position', 'fixed'],
    ['top', '0'],
    ['left', '0'],
    ['width', '0'],
    ['height', '0'],
    ['margin', '0'],
    ['padding', '0'],
    ['border', '0'],
    ['z-index', '2147483647'],
    ['pointer-events', 'none'],
    ['contain', 'layout style'],
    ['color-scheme', 'light dark'],
  ];
  for (const [prop, value] of fixed) host.style.setProperty(prop, value, 'important');

  const root = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CONTENT_CSS + OVERLAY_CSS + PIN_CSS);
  root.adoptedStyleSheets = [sheet];

  const layer = document.createElement('div');
  layer.className = 'layer';
  root.append(layer);

  const contained = new AbortController();
  for (const type of CONTAINED_EVENTS) {
    host.addEventListener(type, (event) => event.stopPropagation(), { signal: contained.signal });
  }

  // Attach to documentElement, not body: SPA frameworks replace body wholesale.
  document.documentElement.append(host);

  let reattached = 0;
  const observer = new MutationObserver(() => {
    if (host.isConnected || reattached >= MAX_REATTACH) return;
    reattached += 1;
    document.documentElement.append(host);
  });
  observer.observe(document.documentElement, { childList: true });

  return {
    host,
    root,
    layer,
    destroy() {
      observer.disconnect();
      contained.abort();
      host.remove();
    },
  };
}

export const hostExists = (): boolean => document.querySelector(HOST_TAG_NAME) !== null;
