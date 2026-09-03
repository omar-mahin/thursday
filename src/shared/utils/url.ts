/**
 * Pages Chrome refuses to let extensions script, plus the ones where scripting
 * is technically possible but a bad idea. Checked before injection so the user
 * gets the spec section 36 message instead of a thrown error.
 */
const RESTRICTED_SCHEMES = [
  'chrome:',
  'chrome-extension:',
  'chrome-untrusted:',
  'devtools:',
  'edge:',
  'about:',
  'data:',
  'blob:',
  'view-source:',
  'javascript:',
];

/** Chrome blocks extension scripting on its own web store, whatever we ask. */
const RESTRICTED_HOSTS = ['chrome.google.com', 'chromewebstore.google.com'];

export type UrlVerdict =
  | { auditable: true }
  | { auditable: false; reason: 'scheme' | 'host' | 'file' | 'invalid' };

export function checkUrl(rawUrl: string | undefined): UrlVerdict {
  if (!rawUrl) return { auditable: false, reason: 'invalid' };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { auditable: false, reason: 'invalid' };
  }
  if (url.protocol === 'file:') return { auditable: false, reason: 'file' };
  if (RESTRICTED_SCHEMES.includes(url.protocol)) return { auditable: false, reason: 'scheme' };
  if (url.protocol === 'https:' && RESTRICTED_HOSTS.includes(url.hostname)) {
    return { auditable: false, reason: 'host' };
  }
  return { auditable: true };
}

export const isAuditableUrl = (url: string | undefined): boolean => checkUrl(url).auditable;

export function restrictionMessage(reason: Exclude<UrlVerdict, { auditable: true }>['reason']): string {
  switch (reason) {
    case 'file':
      return 'Local files need "Allow access to file URLs" in the extension details page.';
    case 'host':
      return 'Chrome does not allow extensions to run on the Web Store.';
    case 'scheme':
      return 'This is a browser page, so it cannot be audited.';
    case 'invalid':
      // Reached when Chrome withholds the tab's URL, which it does for its own
      // pages and the Web Store. Saying "cannot be audited" implied a choice on
      // our part; the truth is that the browser will not let us look.
      return 'The browser will not give extensions access to this page.';
  }
}

/** Short display form for the panel header: host without a leading www. */
export function displayOrigin(rawUrl: string | undefined): string {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}
