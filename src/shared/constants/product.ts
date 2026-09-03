/**
 * The only place the product is named. Everything user-facing reads from here
 * so the name stays swappable (PLAN.md section 0).
 */
export const PRODUCT_NAME = 'Thursday';
export const PRODUCT_SLUG = 'thursday';
export const PRODUCT_TAGLINE = 'Audit any live website. No account, no server, no network.';

/** Valid custom-element name, so attachShadow() is allowed on it. */
export const HOST_TAG_NAME = `${PRODUCT_SLUG}-root`;
export const DB_NAME = PRODUCT_SLUG;
export const AUDIT_FILE_FORMAT = `${PRODUCT_SLUG}.audit`;
export const AUDIT_FILE_EXTENSION = `.${PRODUCT_SLUG}.json`;
export const STORAGE_KEY_PREFIX = `${PRODUCT_SLUG}:`;

/**
 * The suggested activation shortcut. Named here because it appears in the
 * manifest, the popup and the options page, and three copies of a key
 * combination is three chances to describe a shortcut the user does not have.
 * Chrome lets the user change it; these surfaces state the default.
 */
export const ACTIVATE_SHORTCUT = 'Alt+Shift+T';
export const ACTIVATE_COMMAND = 'activate-page';
