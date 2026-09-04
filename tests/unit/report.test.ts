import { describe, expect, it } from 'vitest';
import type { Annotation, Audit, Finding, PageSnapshotDigest } from '../../src/shared/types';
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
  framesNotInspected: { crossOrigin: 0, sameOrigin: 0 },
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

// -- comments --------------------------------------------------------------

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const comment = (overrides: Partial<Annotation> = {}): Annotation => ({
  id: 'c1',
  auditId: 'audit-1',
  body: 'The middle plan is the one to buy and nothing says so.',
  attachments: [],
  createdAt: audit.createdAt,
  updatedAt: audit.createdAt,
  ...overrides,
});

describe('comments in the report', () => {
  it('does not mention comments at all when there are none', () => {
    // The stylesheet always carries the comment rules; the section must not.
    expect(render([finding()])).not.toContain('<h2>Comments');
  });

  it('puts comments in their own section, labelled as opinions', () => {
    const html = render([finding()], { annotations: [comment()] });
    expect(html).toContain('<h2>Comments — 1</h2>');
    expect(html).toContain('observations and opinions, not measurements');
    // After the findings, so nobody reads a note as a measured result.
    expect(html.indexOf('Image has no alternative text')).toBeLessThan(html.indexOf('<h2>Comments'));
  });

  it('letters comments and counts them in the totals', () => {
    const html = render([], { annotations: [comment(), comment({ id: 'c2' })] });
    expect(html).toContain('<li data-kind="comment">2 comments</li>');
    expect(html).toContain('<h3>Comment A</h3>');
    expect(html).toContain('<h3>Comment B</h3>');
  });

  it('says a comment has no anchor rather than inventing one', () => {
    expect(render([], { annotations: [comment()] })).toContain(
      'No element anchor: this comment is about the page as a whole.',
    );
  });

  it('gives an anchored comment the element a developer can find', () => {
    const html = render([], {
      annotations: [
        comment({
          elementRef: {
            tagName: 'section',
            structuralPath: 'main>section:nth-of-type(2)',
            ancestry: ['main'],
            rect: { x: 0, y: 0, width: 100, height: 100 },
            centroid: { x: 50, y: 50 },
            accessibleName: 'Plans',
          },
        }),
      ],
    });
    expect(html).toContain('&lt;section&gt;');
    expect(html).toContain('main&gt;section:nth-of-type(2)');
  });

  it('keeps the line breaks the user typed', () => {
    // Collapsing their paragraphs would lose something they put there.
    const html = render([], { annotations: [comment({ body: 'one\n\ntwo\nthree' })] });
    expect(html).toContain('<p class="body">one</p><p class="body">two<br>three</p>');
  });

  it('escapes a comment body before breaking it into paragraphs', () => {
    // The other order would let an injected tag survive the split.
    const html = render([], { annotations: [comment({ body: '<img src=x onerror=alert(1)>\n<b>' })] });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;<br>&lt;b&gt;');
  });

  it('shows an attached image with the user caption as its alt text', () => {
    const html = render([], {
      annotations: [
        comment({
          attachments: [
            {
              id: 'att-1',
              annotationId: 'c1',
              auditId: 'audit-1',
              mime: 'image/png',
              bytes: 68,
              width: 1,
              height: 1,
              caption: 'The three plan columns',
              source: 'file',
              createdAt: audit.createdAt,
            },
          ],
        }),
      ],
      attachments: { 'att-1': PIXEL },
    });
    expect(html).toContain(`src="${PIXEL}"`);
    expect(html).toContain('alt="The three plan columns"');
    expect(html).toContain('<figcaption>The three plan columns</figcaption>');
  });

  it('refuses an image source that is not an inline image', () => {
    // Otherwise a crafted audit file turns an offline report into a tracker.
    const html = render([], {
      annotations: [
        comment({
          attachments: [
            {
              id: 'att-1',
              annotationId: 'c1',
              auditId: 'audit-1',
              mime: 'image/png',
              bytes: 1,
              width: 1,
              height: 1,
              source: 'file',
              createdAt: audit.createdAt,
            },
          ],
        }),
      ],
      attachments: { 'att-1': 'https://tracker.example/pixel.png' },
    });
    expect(html).not.toContain('tracker.example');
    expect(html).not.toContain('<img');
  });

  it('is still a report when the audit found nothing but the user had plenty to say', () => {
    const html = render([], { annotations: [comment()] });
    expect(html).toContain('No findings were included in this report.');
    expect(html).toContain('The middle plan is the one to buy');
  });
});
