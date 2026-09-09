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
export const REQUIRED_PERMISSIONS = ['storage', 'activeTab', 'scripting', 'sidePanel'] as const;

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
  // chrome.sidePanel.open() needs 116.
  minimum_chrome_version: '116',

  permissions: [...REQUIRED_PERMISSIONS],
  // No host_permissions: nothing is injected until the user clicks the action.
  // No content_scripts: injection is on-demand via chrome.scripting.
  // No web_accessible_resources: the page never loads our files.
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
   * The panel, docked beside the page.
   *
   * It floated over the page for a while -- an iframe of this document inside
   * the content script's shadow root, draggable and resizable -- and that is
   * gone again. Docking is what Chrome gives you: the browser owns the edge, so
   * the panel cannot cover the page being audited, cannot be dragged somewhere
   * a screenshot will catch it, and needs no web-accessible resource to exist.
   *
   * That last point is the one worth keeping in view. Framing the panel meant
   * declaring panel.html web-accessible, which is a URL any site can embed.
   * The exposure was small and the reasoning was sound, but it was still a
   * widening of the manifest bought purely for placement. Docked, the page
   * never loads our files at all.
   */
  side_panel: { default_path: 'panel.html' },
  options_page: 'options.html',
  background: { service_worker: 'service-worker.js', type: 'module' },
} as const;

export type ThursdayManifest = typeof manifest;
