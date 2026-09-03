import { PRODUCT_NAME, PRODUCT_TAGLINE } from './src/shared/constants/product';

/**
 * The permission set is a product constraint, not an implementation detail.
 * `tests/unit/manifest.test.ts` asserts this list exactly. Adding to it is a
 * deliberate product decision (see PLAN.md section 1).
 */
export const REQUIRED_PERMISSIONS = ['storage', 'activeTab', 'scripting', 'sidePanel'] as const;

/** One version number, shown in the panel and stamped into every export. */
export const PRODUCT_VERSION = '0.1.0';

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
  // sidePanel.open() requires 116.
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
  side_panel: { default_path: 'sidepanel.html' },
  options_page: 'options.html',
  background: { service_worker: 'service-worker.js', type: 'module' },
} as const;

export type ThursdayManifest = typeof manifest;
