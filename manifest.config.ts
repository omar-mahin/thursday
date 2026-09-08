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
   * It was declared with `use_dynamic_url: true` first, for an unguessable
   * address that rotates per session. That has to come out, and the reason is
   * worth recording: `chrome.runtime.getURL()` returns the *static* path, and
   * with a dynamic URL in force that path is not loadable from a page -- so
   * the panel came up as Chrome's "This page has been blocked" screen inside
   * its own frame. It did so in a real browser while every test passed, which
   * is its own lesson about where this can and cannot be verified.
   *
   * What remains is a guessable URL for one HTML file. The frame is still
   * cross-origin to whatever page embeds it, so a hostile site can display
   * Thursday's panel and read nothing out of it -- no pixel, no byte, no
   * script access. That is the whole of the exposure, and it buys an attacker
   * nothing they could not achieve by drawing a picture of the panel.
   */
  web_accessible_resources: [{ resources: ['panel.html'], matches: ['<all_urls>'] }],
  options_page: 'options.html',
  background: { service_worker: 'service-worker.js', type: 'module' },
} as const;

export type ThursdayManifest = typeof manifest;
