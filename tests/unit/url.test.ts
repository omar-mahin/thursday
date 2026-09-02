import { describe, expect, it } from 'vitest';
import { checkUrl, displayOrigin, isAuditableUrl, restrictionMessage } from '../../src/shared/utils/url';

describe('checkUrl', () => {
  it('accepts ordinary web pages', () => {
    expect(isAuditableUrl('https://example.com/pricing')).toBe(true);
    expect(isAuditableUrl('http://localhost:3000/')).toBe(true);
  });

  it('rejects browser-internal pages', () => {
    for (const url of [
      'chrome://settings',
      'chrome-extension://abc/popup.html',
      'devtools://devtools/bundled/inspector.html',
      'about:blank',
      'view-source:https://example.com',
    ]) {
      expect(checkUrl(url)).toEqual({ auditable: false, reason: 'scheme' });
    }
  });

  it('rejects the Chrome Web Store, which Chrome blocks regardless', () => {
    expect(checkUrl('https://chromewebstore.google.com/detail/x')).toEqual({
      auditable: false,
      reason: 'host',
    });
  });

  it('separates file URLs so the user gets actionable advice', () => {
    expect(checkUrl('file:///Users/me/page.html')).toEqual({ auditable: false, reason: 'file' });
    expect(restrictionMessage('file')).toMatch(/Allow access to file URLs/);
  });

  it('rejects unparseable and missing URLs', () => {
    expect(checkUrl(undefined)).toEqual({ auditable: false, reason: 'invalid' });
    expect(checkUrl('not a url')).toEqual({ auditable: false, reason: 'invalid' });
  });

  it('has a message for every rejection reason', () => {
    for (const reason of ['scheme', 'host', 'file', 'invalid'] as const) {
      expect(restrictionMessage(reason).length).toBeGreaterThan(10);
    }
  });
});

describe('displayOrigin', () => {
  it('drops the scheme and a leading www', () => {
    expect(displayOrigin('https://www.example.com/a/b?c=1')).toBe('example.com');
    expect(displayOrigin('http://localhost:5173/x')).toBe('localhost:5173');
  });

  it('is empty for junk rather than throwing', () => {
    expect(displayOrigin('nope')).toBe('');
    expect(displayOrigin(undefined)).toBe('');
  });
});
