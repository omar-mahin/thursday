import { describe, expect, it } from 'vitest';
import type { Audit, Finding, PageSnapshotDigest } from '../../src/shared/types';
import { AUDIT_FILE_FORMAT } from '../../src/shared/constants/product';
import {
  auditFileName,
  buildAuditFile,
  FILE_VERSION,
  parseAuditFile,
  serializeAuditFile,
} from '../../src/storage/file';

const audit: Audit = {
  id: 'audit-1',
  url: 'https://shop.example.test/cart?token=secret#frag',
  origin: 'https://shop.example.test',
  title: 'Cart',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  viewportWidth: 1280,
  viewportHeight: 800,
  categories: ['a11y', 'ui'],
  status: 'completed',
  findingIds: ['f1'],
  truncated: false,
  elementsScanned: 240,
};

const digest: PageSnapshotDigest = {
  snapshotId: 'snap-1',
  capturedAt: 1_700_000_000_000,
  url: audit.url,
  origin: audit.origin,
  title: audit.title,
  viewport: {
    width: 1280,
    height: 800,
    devicePixelRatio: 2,
    scrollX: 0,
    scrollY: 120,
    documentWidth: 1280,
    documentHeight: 4000,
  },
  elementCount: 240,
  truncated: false,
  locations: [{ index: 7, documentRect: { x: 10, y: 900, width: 120, height: 44 } }],
};

const finding: Finding = {
  id: 'f1',
  auditId: 'audit-1',
  ruleId: 'A11Y-004',
  category: 'a11y',
  type: 'rule',
  title: 'Interactive target is smaller than the minimum',
  severity: 'low',
  confidence: 1,
  summary: 'The control is 30 x 18 CSS px.',
  evidence: ['width 30px', 'height 18px'],
  impact: 'Hard to hit.',
  recommendation: 'Give it 44px.',
  status: 'accepted',
  note: 'Design is aware',
  inReport: true,
  elementIndex: 7,
  elementRef: {
    tagName: 'button',
    role: 'button',
    accessibleName: 'Remove',
    structuralPath: 'main>ul:nth-of-type(1)>li:nth-of-type(2)>button:nth-of-type(1)',
    ancestry: ['main', 'ul', 'li'],
    rect: { x: 10, y: 780, width: 30, height: 18 },
    centroid: { x: 25, y: 789 },
  },
  measurements: { width: 30, height: 18 },
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_001,
};

const roundTrip = (overrides: Partial<Record<string, unknown>> = {}) => {
  const file = { ...buildAuditFile({ audit, findings: [finding], digest, productVersion: '0.1.0' }), ...overrides };
  const outcome = parseAuditFile(JSON.stringify(file));
  if (!outcome.ok) throw new Error(`expected a parse, got: ${outcome.error}`);
  return outcome.value;
};

describe('audit file round trip', () => {
  it('keeps every field a reopened audit needs', () => {
    const { file } = roundTrip();
    expect(file.audit).toEqual(audit);
    expect(file.findings[0]).toEqual(finding);
    expect(file.digest).toEqual(digest);
  });

  it('keeps the user status, note and report membership', () => {
    const restored = roundTrip().file.findings[0];
    expect(restored?.status).toBe('accepted');
    expect(restored?.note).toBe('Design is aware');
    expect(restored?.inReport).toBe(true);
  });

  it('names the file after the host and the audit time', () => {
    expect(auditFileName(audit)).toMatch(/^thursday-shop\.example\.test-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.thursday\.json$/);
  });

  it('writes readable JSON, not one long line', () => {
    const text = serializeAuditFile(buildAuditFile({ audit, findings: [finding], digest, productVersion: '0.1.0' }));
    expect(text.split('\n').length).toBeGreaterThan(20);
  });

  it('omits the screenshots key when there are none', () => {
    const file = buildAuditFile({ audit, findings: [finding], digest, productVersion: '0.1.0', screenshots: {} });
    expect('screenshots' in file).toBe(false);
  });
});

describe('refusing what it cannot read', () => {
  it('refuses text that is not JSON', () => {
    expect(parseAuditFile('not json at all')).toMatchObject({ ok: false });
  });

  it('refuses a JSON file that is not an audit', () => {
    const outcome = parseAuditFile(JSON.stringify({ hello: 'world' }));
    expect(outcome).toMatchObject({ ok: false });
    if (!outcome.ok) expect(outcome.error).toContain('not a Thursday audit file');
  });

  it('refuses a file from a newer format rather than reading part of it', () => {
    // Reading a v2 file as v1 would drop whatever v2 added, silently.
    const outcome = parseAuditFile(
      JSON.stringify({ format: AUDIT_FILE_FORMAT, version: FILE_VERSION + 1, audit, findings: [] }),
    );
    expect(outcome).toMatchObject({ ok: false });
    if (!outcome.ok) expect(outcome.error).toContain('newer');
  });

  it('refuses a file with no audit record', () => {
    expect(
      parseAuditFile(JSON.stringify({ format: AUDIT_FILE_FORMAT, version: 1, findings: [] })),
    ).toMatchObject({ ok: false });
  });

  it('refuses a version it cannot recognise at all', () => {
    expect(
      parseAuditFile(JSON.stringify({ format: AUDIT_FILE_FORMAT, version: 'one', audit })),
    ).toMatchObject({ ok: false });
  });
});

describe('treating the file as hostile input', () => {
  it('drops unknown fields instead of carrying them along', () => {
    // Nothing from the file is spread into our objects, so a key we have never
    // heard of cannot ride along into storage or into a report.
    const source = buildAuditFile({ audit, findings: [finding], digest, productVersion: '0.1.0' });
    const outcome = parseAuditFile(JSON.stringify({ ...source, evil: 'payload' }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect('evil' in outcome.value.file).toBe(false);
  });

  it('coerces a severity it does not recognise instead of trusting it', () => {
    const outcome = parseAuditFile(
      JSON.stringify({
        format: AUDIT_FILE_FORMAT,
        version: 1,
        audit,
        findings: [{ ...finding, severity: 'apocalyptic', category: 'astrology', type: 'divination' }],
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.file.findings[0]?.severity).toBe('low');
    expect(outcome.value.file.findings[0]?.category).toBe('ux');
    expect(outcome.value.file.findings[0]?.type).toBe('rule');
  });

  it('drops a finding with no id, rule or title and says so', () => {
    const outcome = parseAuditFile(
      JSON.stringify({
        format: AUDIT_FILE_FORMAT,
        version: 1,
        audit,
        findings: [finding, { id: '', ruleId: '', title: '' }, 'not an object'],
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.file.findings).toHaveLength(1);
    expect(outcome.value.warnings.join(' ')).toContain('2 findings could not be read');
  });

  it('drops duplicate finding ids, which would break pin numbering', () => {
    const outcome = parseAuditFile(
      JSON.stringify({ format: AUDIT_FILE_FORMAT, version: 1, audit, findings: [finding, finding] }),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.file.findings).toHaveLength(1);
  });

  it('rebuilds findingIds from what actually survived', () => {
    const outcome = parseAuditFile(
      JSON.stringify({
        format: AUDIT_FILE_FORMAT,
        version: 1,
        audit: { ...audit, findingIds: ['f1', 'ghost', 'phantom'] },
        findings: [finding],
      }),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.file.audit.findingIds).toEqual(['f1']);
  });

  it('refuses a screenshot that is not an inline image', () => {
    const outcome = parseAuditFile(
      JSON.stringify({
        format: AUDIT_FILE_FORMAT,
        version: 1,
        audit,
        findings: [finding],
        screenshots: {
          f1: 'https://tracker.example/pixel.png',
          f2: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
        },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.file.screenshots).toBeUndefined();
    expect(outcome.value.warnings.join(' ')).toContain('inline PNG');
  });

  it('keeps a real inline image, but only for a finding that exists', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const outcome = parseAuditFile(
      JSON.stringify({
        format: AUDIT_FILE_FORMAT,
        version: 1,
        audit,
        findings: [finding],
        screenshots: { f1: png, orphan: png },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.file.screenshots).toEqual({ f1: png });
  });

  it('warns when there are no positions to pin with', () => {
    const outcome = parseAuditFile(
      JSON.stringify({ format: AUDIT_FILE_FORMAT, version: 1, audit, findings: [finding] }),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.warnings.join(' ')).toContain('no element positions');
  });

  it('fills in a digest from the audit when the file has none', () => {
    const outcome = parseAuditFile(
      JSON.stringify({ format: AUDIT_FILE_FORMAT, version: 1, audit, findings: [finding] }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.file.digest.viewport.width).toBe(audit.viewportWidth);
    expect(outcome.value.file.digest.url).toBe(audit.url);
  });
});
