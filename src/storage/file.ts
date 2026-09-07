import {
  AUDIT_FILE_EXTENSION,
  AUDIT_FILE_FORMAT,
  PRODUCT_NAME,
  PRODUCT_SLUG,
} from '../shared/constants/product';
import { isAnnotationPriority } from '../shared/constants/priority';
import type {
  Annotation,
  AnnotationAttachment,
  Audit,
  AuditCategory,
  ElementLocation,
  ElementReference,
  Finding,
  FindingStatus,
  FindingType,
  PageSnapshotDigest,
  Rect,
  ResolutionLevel,
  Severity,
  Viewport,
} from '../shared/types';

/**
 * The on-disk format.
 *
 * v2 adds comments and their attached images. A v1 file still opens: every
 * field it lacks has an honest default, and a file with no comments is
 * indistinguishable from one written before comments existed. The reverse is
 * refused, loudly -- see `parseAuditFile`.
 */
export const FILE_VERSION = 2;

export type ThursdayAuditFile = {
  format: typeof AUDIT_FILE_FORMAT;
  version: number;
  exportedAt: number;
  product: { name: string; version: string };
  page: { url: string; title: string; viewport: Viewport };
  audit: Audit;
  findings: Finding[];
  digest: PageSnapshotDigest;
  /** findingId -> data URL. Present only if the user captured crops. */
  screenshots?: Record<string, string>;
  /** The user's own comments. Absent when they wrote none. */
  annotations?: Annotation[];
  /** attachmentId -> data URL, for the images inside those comments. */
  attachments?: Record<string, string>;
};

export function buildAuditFile(input: {
  audit: Audit;
  findings: readonly Finding[];
  digest: PageSnapshotDigest;
  productVersion: string;
  screenshots?: Record<string, string>;
  annotations?: readonly Annotation[];
  attachments?: Record<string, string>;
}): ThursdayAuditFile {
  const file: ThursdayAuditFile = {
    format: AUDIT_FILE_FORMAT,
    version: FILE_VERSION,
    exportedAt: Date.now(),
    product: { name: PRODUCT_NAME, version: input.productVersion },
    page: {
      url: input.audit.url,
      title: input.audit.title,
      viewport: input.digest.viewport,
    },
    audit: input.audit,
    findings: [...input.findings],
    digest: input.digest,
  };
  if (input.screenshots && Object.keys(input.screenshots).length > 0) {
    file.screenshots = input.screenshots;
  }
  if (input.annotations && input.annotations.length > 0) {
    file.annotations = [...input.annotations];
    if (input.attachments && Object.keys(input.attachments).length > 0) {
      file.attachments = input.attachments;
    }
  }
  return file;
}

export function auditFileName(audit: Audit): string {
  const host = safeHost(audit.url);
  const stamp = new Date(audit.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `${PRODUCT_SLUG}-${host}-${stamp}${AUDIT_FILE_EXTENSION}`;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '') || 'page';
  } catch {
    return 'page';
  }
}

export function serializeAuditFile(file: ThursdayAuditFile): string {
  return JSON.stringify(file, null, 2);
}

// -- reading ---------------------------------------------------------------
//
// Everything below treats the file as hostile input. A `.thursday.json` can
// arrive by email or from a shared drive, and its strings end up in the panel
// and in an HTML report. So no object from the file is ever spread into ours:
// each field is read, type-checked and copied, and anything unrecognised is
// left behind rather than carried along.

export type ParsedAuditFile = {
  file: ThursdayAuditFile;
  /** What had to be repaired or dropped. Shown to the user, never swallowed. */
  warnings: string[];
};

export type ParseOutcome =
  | { ok: true; value: ParsedAuditFile }
  | { ok: false; error: string };

const MAX_TEXT = 4000;
const MAX_LIST = 40;
const MAX_FINDINGS = 500;
const MAX_SCREENSHOTS = 200;
/** A crop, not a photo album. 4MB of base64 per finding is already generous. */
const MAX_SCREENSHOT_CHARS = 4_000_000;
const MAX_ANNOTATIONS = 200;
/** Enough for a paragraph of considered criticism, not a pasted document. */
const MAX_BODY = 8000;
const MAX_ATTACHMENTS_PER_COMMENT = 12;

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const STATUSES: readonly FindingStatus[] = ['open', 'accepted', 'dismissed', 'resolved'];
const TYPES: readonly FindingType[] = ['rule', 'heuristic', 'inference', 'recommendation'];
const CATEGORIES: readonly AuditCategory[] = ['a11y', 'ui', 'ux', 'content', 'cro', 'responsive'];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.slice(0, MAX_TEXT) : fallback;

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const bool = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;

const strList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, MAX_LIST).map((item) => item.slice(0, MAX_TEXT)) : [];

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const rect = (value: unknown): Rect => {
  const source = isObject(value) ? value : {};
  return {
    x: num(source['x']),
    y: num(source['y']),
    width: Math.max(0, num(source['width'])),
    height: Math.max(0, num(source['height'])),
  };
};

const viewport = (value: unknown): Viewport => {
  const source = isObject(value) ? value : {};
  return {
    width: Math.max(0, num(source['width'])),
    height: Math.max(0, num(source['height'])),
    devicePixelRatio: num(source['devicePixelRatio'], 1),
    scrollX: num(source['scrollX']),
    scrollY: num(source['scrollY']),
    documentWidth: Math.max(0, num(source['documentWidth'])),
    documentHeight: Math.max(0, num(source['documentHeight'])),
  };
};

function elementReference(value: unknown): ElementReference | undefined {
  if (!isObject(value)) return undefined;
  const tagName = str(value['tagName']).toLowerCase();
  if (!tagName) return undefined;
  const reference: ElementReference = {
    tagName,
    structuralPath: str(value['structuralPath']),
    ancestry: strList(value['ancestry']),
    rect: rect(value['rect']),
    centroid: {
      x: num(isObject(value['centroid']) ? value['centroid']['x'] : 0),
      y: num(isObject(value['centroid']) ? value['centroid']['y'] : 0),
    },
  };
  const role = str(value['role']);
  if (role) reference.role = role;
  const name = str(value['accessibleName']);
  if (name) reference.accessibleName = name;
  const snippet = str(value['textSnippet']);
  if (snippet) reference.textSnippet = snippet;
  const attribute = value['stableAttribute'];
  if (isObject(attribute) && typeof attribute['name'] === 'string' && typeof attribute['value'] === 'string') {
    reference.stableAttribute = { name: str(attribute['name']), value: str(attribute['value']) };
  }
  const resolved = value['resolvedAt'];
  if (typeof resolved === 'number' && resolved >= 1 && resolved <= 6) {
    reference.resolvedAt = Math.round(resolved) as ResolutionLevel;
  }
  return reference;
}

function measurements(value: unknown): Record<string, number | string | boolean> | undefined {
  if (!isObject(value)) return undefined;
  const out: Record<string, number | string | boolean> = {};
  let kept = 0;
  for (const [key, raw] of Object.entries(value)) {
    if (kept >= MAX_LIST) break;
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key.slice(0, 64)] = raw;
    else if (typeof raw === 'string') out[key.slice(0, 64)] = raw.slice(0, 200);
    else if (typeof raw === 'boolean') out[key.slice(0, 64)] = raw;
    else continue;
    kept += 1;
  }
  return kept > 0 ? out : undefined;
}

function finding(value: unknown, auditId: string): Finding | null {
  if (!isObject(value)) return null;
  const id = str(value['id'], '').slice(0, 128);
  const ruleId = str(value['ruleId'], '').slice(0, 32);
  const title = str(value['title']);
  // A finding with no id, no rule or no title cannot be shown, matched against
  // a re-audit, or pinned. Dropping it beats rendering an empty card.
  if (!id || !ruleId || !title) return null;

  const result: Finding = {
    id,
    auditId,
    ruleId,
    category: oneOf(value['category'], CATEGORIES, 'ux'),
    type: oneOf(value['type'], TYPES, 'rule'),
    title,
    severity: oneOf(value['severity'], SEVERITIES, 'low'),
    confidence: Math.min(1, Math.max(0, num(value['confidence'], 1))),
    summary: str(value['summary']),
    evidence: strList(value['evidence']),
    impact: str(value['impact']),
    recommendation: str(value['recommendation']),
    status: oneOf(value['status'], STATUSES, 'open'),
    createdAt: num(value['createdAt'], Date.now()),
    updatedAt: num(value['updatedAt'], Date.now()),
  };
  const reference = elementReference(value['elementRef']);
  if (reference) result.elementRef = reference;
  if (typeof value['elementIndex'] === 'number' && Number.isInteger(value['elementIndex'])) {
    result.elementIndex = value['elementIndex'];
  }
  const measured = measurements(value['measurements']);
  if (measured) result.measurements = measured;
  const note = str(value['note']);
  if (note) result.note = note;
  if (bool(value['inReport'])) result.inReport = true;
  return result;
}

function audit(value: unknown): Audit | null {
  if (!isObject(value)) return null;
  const id = str(value['id']).slice(0, 128);
  if (!id) return null;
  const categories = Array.isArray(value['categories'])
    ? CATEGORIES.filter((category) => (value['categories'] as unknown[]).includes(category))
    : [...CATEGORIES];
  return {
    id,
    url: str(value['url']),
    origin: str(value['origin']),
    title: str(value['title']),
    createdAt: num(value['createdAt'], Date.now()),
    updatedAt: num(value['updatedAt'], Date.now()),
    viewportWidth: Math.max(0, num(value['viewportWidth'])),
    viewportHeight: Math.max(0, num(value['viewportHeight'])),
    categories: categories.length > 0 ? categories : [...CATEGORIES],
    status: value['status'] === 'active' || value['status'] === 'archived' ? value['status'] : 'completed',
    findingIds: strList(value['findingIds']),
    truncated: bool(value['truncated']),
    elementsScanned: Math.max(0, num(value['elementsScanned'])),
    framesNotInspected: {
      crossOrigin: Math.max(0, num(frames(value)['crossOrigin'])),
      sameOrigin: Math.max(0, num(frames(value)['sameOrigin'])),
    },
  };
}

/** Older files predate the frame counts; zero is the honest default. */
const frames = (value: Record<string, unknown>): Record<string, unknown> =>
  isObject(value['framesNotInspected']) ? value['framesNotInspected'] : {};

function digestOf(value: unknown, fallback: Audit): PageSnapshotDigest {
  const source = isObject(value) ? value : {};
  const locations: ElementLocation[] = Array.isArray(source['locations'])
    ? source['locations']
        .filter(isObject)
        .filter((entry) => Number.isInteger(entry['index']))
        .slice(0, MAX_FINDINGS)
        .map((entry) => ({ index: entry['index'] as number, documentRect: rect(entry['documentRect']) }))
    : [];
  return {
    snapshotId: str(source['snapshotId']).slice(0, 128) || `imported-${fallback.id}`,
    capturedAt: num(source['capturedAt'], fallback.createdAt),
    url: str(source['url'], fallback.url),
    origin: str(source['origin'], fallback.origin),
    title: str(source['title'], fallback.title),
    viewport: isObject(source['viewport'])
      ? viewport(source['viewport'])
      : {
          width: fallback.viewportWidth,
          height: fallback.viewportHeight,
          devicePixelRatio: 1,
          scrollX: 0,
          scrollY: 0,
          documentWidth: fallback.viewportWidth,
          documentHeight: fallback.viewportHeight,
        },
    elementCount: Math.max(0, num(source['elementCount'], fallback.elementsScanned)),
    truncated: bool(source['truncated'], fallback.truncated),
    locations,
  };
}

function attachment(value: unknown, annotationId: string, auditId: string): AnnotationAttachment | null {
  if (!isObject(value)) return null;
  const id = str(value['id']).slice(0, 128);
  if (!id) return null;
  const mime = str(value['mime'], 'image/png').slice(0, 64);
  // Only the three types this build can decode. An attachment claiming to be
  // an SVG or a PDF would render as a broken image at best, and an SVG in a
  // report is a script vector at worst.
  if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') return null;
  const result: AnnotationAttachment = {
    id,
    annotationId,
    auditId,
    mime,
    bytes: Math.max(0, Math.round(num(value['bytes']))),
    width: Math.max(0, Math.round(num(value['width']))),
    height: Math.max(0, Math.round(num(value['height']))),
    source: value['source'] === 'paste' ? 'paste' : 'file',
    createdAt: num(value['createdAt'], Date.now()),
  };
  const caption = str(value['caption']).slice(0, 400);
  if (caption) result.caption = caption;
  return result;
}

function annotation(value: unknown, auditId: string): Annotation | null {
  if (!isObject(value)) return null;
  const id = str(value['id']).slice(0, 128);
  const body = typeof value['body'] === 'string' ? value['body'].slice(0, MAX_BODY) : '';
  // A comment with no id cannot be pinned or deleted, and one with no body is
  // not a comment. Either way there is nothing to show, so it is dropped.
  if (!id || !body.trim()) return null;

  const result: Annotation = {
    id,
    auditId,
    body,
    attachments: (Array.isArray(value['attachments']) ? value['attachments'] : [])
      .slice(0, MAX_ATTACHMENTS_PER_COMMENT)
      .map((entry) => attachment(entry, id, auditId))
      .filter((entry): entry is AnnotationAttachment => entry !== null),
    createdAt: num(value['createdAt'], Date.now()),
    updatedAt: num(value['updatedAt'], Date.now()),
  };
  const reference = elementReference(value['elementRef']);
  if (reference) result.elementRef = reference;
  const snapshotId = str(value['snapshotId']).slice(0, 128);
  // Read as a pair, exactly as they are written: an index whose snapshot is
  // unknown is not a shortcut and must not be offered as one.
  if (
    snapshotId &&
    typeof value['elementIndex'] === 'number' &&
    Number.isInteger(value['elementIndex'])
  ) {
    result.elementIndex = value['elementIndex'];
    result.snapshotId = snapshotId;
  }
  if (isObject(value['documentRect'])) result.documentRect = rect(value['documentRect']);
  // Both optional and both checked. A priority that is not one of the three is
  // dropped rather than carried in as a string nothing knows how to render, and
  // an author is capped like every other free-text field in this file.
  if (isAnnotationPriority(value['priority'])) result.priority = value['priority'];
  const author = str(value['author']).slice(0, 120);
  if (author) result.author = author;
  return result;
}

const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * Validates a map of id -> inline image.
 *
 * Used for both finding crops and comment attachments, because the rule is the
 * same for both and the consequence of getting it wrong is the same too: these
 * strings go straight into an `src` attribute in the HTML report.
 */
function imageMap(
  value: unknown,
  noun: string,
  limit: number,
  warnings: string[],
): Record<string, string> | undefined {
  if (!isObject(value)) return undefined;
  const out: Record<string, string> = {};
  let rejected = 0;
  for (const [id, raw] of Object.entries(value)) {
    if (Object.keys(out).length >= limit) break;
    if (typeof raw !== 'string' || raw.length > MAX_SCREENSHOT_CHARS || !IMAGE_DATA_URL.test(raw)) {
      rejected += 1;
      continue;
    }
    out[id.slice(0, 128)] = raw;
  }
  if (rejected > 0) {
    warnings.push(
      `${rejected} ${noun}${rejected === 1 ? '' : 's'} ${
        rejected === 1 ? 'was' : 'were'
      } dropped: only inline PNG, JPEG or WebP images are accepted.`,
    );
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Reads a `.thursday.json`.
 *
 * A file from a newer version is refused rather than half-read. Silently
 * ignoring fields we do not understand would let a v2 file open as a v1 audit
 * with parts of it quietly missing, and the user would have no way to tell.
 */
export function parseAuditFile(text: string): ParseOutcome {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!isObject(raw)) return { ok: false, error: 'That file does not contain an audit.' };
  if (raw['format'] !== AUDIT_FILE_FORMAT) {
    return { ok: false, error: `That is not a ${PRODUCT_NAME} audit file.` };
  }

  const version = num(raw['version'], 0);
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'That audit file does not say which version it is.' };
  }
  if (version > FILE_VERSION) {
    return {
      ok: false,
      error: `That file was written by a newer ${PRODUCT_NAME} (format v${version}; this build reads v${FILE_VERSION}). Update to open it.`,
    };
  }

  const warnings: string[] = [];
  const parsedAudit = audit(raw['audit']);
  if (!parsedAudit) return { ok: false, error: 'That audit file is missing its audit record.' };

  const rawFindings = Array.isArray(raw['findings']) ? raw['findings'] : [];
  if (rawFindings.length > MAX_FINDINGS) {
    warnings.push(`The file listed ${rawFindings.length} findings; the first ${MAX_FINDINGS} were kept.`);
  }
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const candidate of rawFindings.slice(0, MAX_FINDINGS)) {
    const parsed = finding(candidate, parsedAudit.id);
    if (!parsed || seen.has(parsed.id)) {
      dropped += 1;
      continue;
    }
    seen.add(parsed.id);
    findings.push(parsed);
  }
  if (dropped > 0) {
    warnings.push(`${dropped} finding${dropped === 1 ? '' : 's'} could not be read and were left out.`);
  }

  const digest = digestOf(raw['digest'], parsedAudit);
  if (digest.locations.length === 0 && findings.some((item) => item.elementIndex !== undefined)) {
    warnings.push('This file has no element positions, so pins will be placed by searching the live page.');
  }

  const file: ThursdayAuditFile = {
    format: AUDIT_FILE_FORMAT,
    version: FILE_VERSION,
    exportedAt: num(raw['exportedAt'], Date.now()),
    product: {
      name: str(isObject(raw['product']) ? raw['product']['name'] : '', PRODUCT_NAME),
      version: str(isObject(raw['product']) ? raw['product']['version'] : '', 'unknown'),
    },
    page: {
      url: str(isObject(raw['page']) ? raw['page']['url'] : parsedAudit.url, parsedAudit.url),
      title: str(isObject(raw['page']) ? raw['page']['title'] : parsedAudit.title, parsedAudit.title),
      viewport: digest.viewport,
    },
    // findingIds is rebuilt from what actually survived, so the order a
    // reopened audit shows is the order it can really display.
    audit: { ...parsedAudit, findingIds: findings.map((item) => item.id) },
    findings,
    digest,
  };

  const crops = imageMap(raw['screenshots'], 'screenshot', MAX_SCREENSHOTS, warnings);
  if (crops) {
    const known = new Set(findings.map((item) => item.id));
    const matched = Object.fromEntries(Object.entries(crops).filter(([id]) => known.has(id)));
    if (Object.keys(matched).length > 0) file.screenshots = matched;
  }

  const rawAnnotations = Array.isArray(raw['annotations']) ? raw['annotations'] : [];
  if (rawAnnotations.length > MAX_ANNOTATIONS) {
    warnings.push(`The file listed ${rawAnnotations.length} comments; the first ${MAX_ANNOTATIONS} were kept.`);
  }
  const annotations: Annotation[] = [];
  const seenComments = new Set<string>();
  let droppedComments = 0;
  for (const candidate of rawAnnotations.slice(0, MAX_ANNOTATIONS)) {
    const parsed = annotation(candidate, parsedAudit.id);
    if (!parsed || seenComments.has(parsed.id)) {
      droppedComments += 1;
      continue;
    }
    seenComments.add(parsed.id);
    annotations.push(parsed);
  }
  if (droppedComments > 0) {
    warnings.push(
      `${droppedComments} comment${droppedComments === 1 ? '' : 's'} could not be read and were left out.`,
    );
  }

  if (annotations.length > 0) {
    const images = imageMap(raw['attachments'], 'attached image', MAX_SCREENSHOTS, warnings) ?? {};
    // An attachment listed on a comment but with no image in the file is
    // dropped from the comment too, so nothing downstream renders a broken
    // picture -- and the comment's own text survives regardless.
    let missing = 0;
    const kept: Record<string, string> = {};
    for (const item of annotations) {
      item.attachments = item.attachments.filter((meta) => {
        const image = images[meta.id];
        if (!image) {
          missing += 1;
          return false;
        }
        kept[meta.id] = image;
        return true;
      });
    }
    if (missing > 0) {
      warnings.push(
        `${missing} attached image${missing === 1 ? '' : 's'} ${
          missing === 1 ? 'was' : 'were'
        } listed but not included in the file.`,
      );
    }
    file.annotations = annotations;
    if (Object.keys(kept).length > 0) file.attachments = kept;
  }

  return { ok: true, value: { file, warnings } };
}
