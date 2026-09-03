import { describe, expect, it } from 'vitest';
import type { Audit, Finding, PageSnapshotDigest } from '../../src/shared/types';
import { renderReport, reportFileName } from '../../src/report/render';
import { escapeHtml, safeImageSource, safeLink } from '../../src/report/escape';

const audit: Audit = {
  id: 'audit-1',
  url: 'https://shop.example.test/cart',
  origin: 'https://shop.example.test',
  title: 'Cart',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  viewportWidth: 1280,
  viewportHeight: 800,
  categories: ['a11y'],
  status: 'completed',
  findingIds: ['f1'],
  truncated: false,
  elementsScanned: 240,
};

const digest: PageSnapshotDigest = {
  snapshotId: 'snap-1',
  capturedAt: audit.createdAt,
  url: audit.url,
  origin: audit.origin,
  title: audit.title,
  viewport: {
    width: 1280,
    height: 800,
    devicePixelRatio: 2,
    scrollX: 0,
    scrollY: 0,
    documentWidth: 1280,
    documentHeight: 4000,
  },
  elementCount: 240,
  truncated: false,
  locations: [],
};

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'f1',
  auditId: 'audit-1',
  ruleId: 'A11Y-002',
  category: 'a11y',
  type: 'rule',
  title: 'Image has no alternative text',
  severity: 'high',
  confidence: 1,
  summary: 'A content image carries no alt attribute.',
  evidence: ['no alt attribute', '320 x 240 px'],
  impact: 'A screen reader announces nothing for it.',
  recommendation: 'Add alt text describing the image.',
  status: 'open',
  createdAt: audit.createdAt,
  updatedAt: audit.createdAt,
  ...overrides,
});

const render = (findings: Finding[], extra: Partial<Parameters<typeof renderReport>[0]> = {}): string =>
  renderReport({
    audit,
    findings,
    digest,
    productVersion: '0.1.0',
    generatedAt: 1_700_000_100_000,
    ...extra,
  });

describe('the report is one self-contained file', () => {
  const html = render([finding()]);

  it('is a complete HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
  });

  it('carries no scripts at all', () => {
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('fetches nothing when it opens', () => {
    // The offline promise is about loading, not about linking: nothing in the
    // document causes a request, so it renders identically with no network.
    expect(html).not.toMatch(/\bsrc\s*=\s*["'](?!data:)/i);
    expect(html).not.toContain('<link');
    expect(html).not.toContain('@import');
    expect(html).not.toMatch(/url\(\s*["']?(?!data:)[a-z]+:/i);
  });

  it('links back to the audited page, and to nothing else', () => {
    // One outward link, and it is the page the report is about.
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual([audit.url]);
  });

  it('inlines its stylesheet rather than linking one', () => {
    expect(html).toContain('<style>');
    expect(html).not.toContain('<link');
  });

  it('has print rules, because this gets turned into a PDF', () => {
    expect(html).toContain('@media print');
  });

  it('names the file after the host and the audit time', () => {
    expect(reportFileName(audit)).toMatch(/^thursday-report-shop\.example\.test-.*\.html$/);
  });
});

describe('what the report says', () => {
  it('states every part of a finding', () => {
    const html = render([finding()]);
    expect(html).toContain('Image has no alternative text');
    expect(html).toContain('no alt attribute');
    expect(html).toContain('A screen reader announces nothing for it.');
    expect(html).toContain('Add alt text describing the image.');
    expect(html).toContain('A11Y-002');
  });

  it('groups findings by severity, worst first', () => {
    const html = render([
      finding({ id: 'a', severity: 'low', title: 'Low thing' }),
      finding({ id: 'b', severity: 'critical', title: 'Critical thing' }),
    ]);
    expect(html.indexOf('Critical thing')).toBeLessThan(html.indexOf('Low thing'));
  });

  it('states how much of the page was examined when it was truncated', () => {
    const html = render([finding()], { audit: { ...audit, truncated: true } });
    expect(html).toContain('more elements than one pass examines');
  });

  it('states how many findings were left out of the report', () => {
    expect(render([finding()], { omitted: 3 })).toContain('3 further findings');
  });

  it('separates severity from confidence in words, not just in numbers', () => {
    expect(render([finding()])).toContain('<strong>Confidence</strong>');
  });

  it('shows confidence only for findings that are not measured', () => {
    expect(render([finding({ type: 'heuristic', confidence: 0.8 })])).toContain('Confidence 80%');
    expect(render([finding({ type: 'rule' })])).not.toContain('Confidence 100%');
  });

  it('includes the user note when there is one', () => {
    expect(render([finding({ note: 'Ticket AB-12' })])).toContain('Ticket AB-12');
  });

  it('says where the element is, in words a developer can use', () => {
    const html = render([
      finding({
        elementRef: {
          tagName: 'img',
          role: 'img',
          accessibleName: '',
          textSnippet: '',
          structuralPath: 'main>figure:nth-of-type(2)>img:nth-of-type(1)',
          ancestry: ['main', 'figure'],
          rect: { x: 0, y: 0, width: 320, height: 240 },
          centroid: { x: 160, y: 120 },
        },
      }),
    ]);
    expect(html).toContain('main&gt;figure:nth-of-type(2)&gt;img:nth-of-type(1)');
  });

  it('says so when nothing was included', () => {
    expect(render([])).toContain('No findings were included');
  });
});

describe('the report escapes untrusted text', () => {
  // An audit file can arrive from anywhere, and its strings end up in HTML.
  const hostile = '<img src=x onerror="alert(1)">';

  it('escapes a finding title', () => {
    const html = render([finding({ title: hostile })]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('escapes evidence, impact, recommendation and notes', () => {
    const html = render([
      finding({ evidence: [hostile], impact: hostile, recommendation: hostile, note: hostile }),
    ]);
    expect(html).not.toContain('onerror="alert(1)"');
  });

  it('escapes the page title and rule id', () => {
    const html = render([finding({ ruleId: '</style><script>x()</script>' })], {
      audit: { ...audit, title: hostile },
    });
    expect(html).not.toContain('<script>x()');
  });

  it('refuses a javascript: page URL an href', () => {
    const html = render([finding()], { audit: { ...audit, url: 'javascript:alert(1)' } });
    expect(html).not.toContain('href="javascript:');
    // Still shown, as text, because hiding it would hide what was audited.
    expect(html).toContain('javascript:alert(1)');
  });

  it('refuses a remote screenshot, which would break the offline promise', () => {
    const html = render([finding()], { screenshots: { f1: 'https://tracker.example/pixel.png' } });
    expect(html).not.toContain('tracker.example');
  });

  it('embeds an inline screenshot', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(render([finding()], { screenshots: { f1: png } })).toContain(`src="${png}"`);
  });
});

describe('escaping helpers', () => {
  it('escapes every character that can break out of HTML', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('accepts only inline images', () => {
    expect(safeImageSource('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(safeImageSource('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(safeImageSource('data:text/html;base64,AAAA')).toBeNull();
    expect(safeImageSource('https://example.test/a.png')).toBeNull();
  });

  it('accepts only http and https links', () => {
    expect(safeLink('https://example.test/a')).toBe('https://example.test/a');
    expect(safeLink('http://example.test/a')).toBe('http://example.test/a');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('data:text/html,<script>x</script>')).toBeNull();
    expect(safeLink('file:///etc/passwd')).toBeNull();
    expect(safeLink('not a url')).toBeNull();
  });
});
