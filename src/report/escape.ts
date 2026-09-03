/**
 * The report is an HTML document built from finding text, and finding text can
 * come out of a `.thursday.json` that arrived by email. So every interpolation
 * is escaped, and the only URLs that reach an attribute are ones this module
 * has recognised.
 */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** Inline images only. Anything else -- including a remote URL -- is refused,
 *  which is what keeps a report a single self-contained offline file. */
export const safeImageSource = (value: string): string | null =>
  IMAGE_DATA_URL.test(value) ? value : null;

/** An http(s) link, or nothing. `javascript:` and friends never get an href. */
export function safeLink(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
