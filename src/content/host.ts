import { HOST_TAG_NAME } from '../shared/constants/product';
import { CONTENT_CSS } from './styles';

export type ShadowHost = {
  host: HTMLElement;
  root: ShadowRoot;
  /** Non-interactive full-viewport layer; children opt into pointer events. */
  layer: HTMLElement;
  destroy(): void;
};

const MAX_REATTACH = 20;

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
  sheet.replaceSync(CONTENT_CSS);
  root.adoptedStyleSheets = [sheet];

  const layer = document.createElement('div');
  layer.className = 'layer';
  root.append(layer);

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
      host.remove();
    },
  };
}

export const hostExists = (): boolean => document.querySelector(HOST_TAG_NAME) !== null;
