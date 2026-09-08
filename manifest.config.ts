import {
  ACTIVATE_COMMAND,
  ACTIVATE_SHORTCUT,
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
} from './src/shared/constants/product';

/**
 * The permission set is a product constraint, not an implementation detail.
 * `tests/unit/manifest.test.ts` asserts this list exactly. Adding to it is a
 * deliberate product decision (see PLAN.md section 1).
 */
export const REQUIRED_PERMISSIONS = ['storage', 'activeTab', 'scripting'] as const;

/** One version number, shown in the panel and stamped into every export. */
export const PRODUCT_VERSION = '1.0.1';

const ICONS = {
  16: 'icons/icon16.png',
  32: 'icons/icon32.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png',
};

export const manifest = {
  manifest_version: 3,
  name: PRODUCT_NAME,
  version: PRODUCT_VERSION,
  description: PRODUCT_TAGLINE,
  // use_dynamic_url on a web-accessible resource requires 110; nothing here
  // needs more than that now the side panel is gone.
  minimum_chrome_version: '116',

  permissions: [...REQUIRED_PERMISSIONS],
  // No host_permissions: nothing is injected until the user clicks the action.
  // No content_scripts: injection is on-demand via chrome.scripting.
  // One web-accessible resource, and the reason is worth writing down.
  // No externally_connectable: no other extension or site can talk to us.

  icons: ICONS,
  action: {
    default_popup: 'popup.html',
    default_title: PRODUCT_NAME,
    default_icon: ICONS,
  },
  /**
   * A second way in, and the only one a keyboard user can reach without a
   * mouse. A keyboard shortcut grants activeTab exactly as clicking the action
   * does, so this needs no extra permission -- and after a reload, which drops
   * the content script, it makes restarting one keystroke instead of two
   * clicks.
   */
  commands: {
    [ACTIVATE_COMMAND]: {
      suggested_key: { default: ACTIVATE_SHORTCUT },
      description: `Activate ${PRODUCT_NAME} on this page`,
    },
  },

  /**
   * The panel, framed over the page rather than docked beside it.
   *
   * The panel is an extension document -- it needs the extension origin to
   * reach IndexedDB and chrome.* at all -- so floating it means the content
   * script puts it in an iframe, and an iframe of an extension page inside a
   * web page requires that page to be web-accessible.
   *
   * That is a real widening, so it is narrowed twice. `use_dynamic_url` gives
   * the resource an unguessable URL that rotates, so a site cannot hard-code
   * it; and the frame is cross-origin to whatever page it sits in, so a
   * hostile page can embed it but cannot read a pixel or a byte out of it. The
   * worst it buys an attacker is the ability to display Thursday's own panel.
   */
  web_accessible_resources: [
    { resources: ['panel.html'], matches: ['<all_urls>'], use_dynamic_url: true },
  ],
  options_page: 'options.html',
  background: { service_worker: 'service-worker.js', type: 'module' },
} as const;

export type ThursdayManifest = typeof manifest;
