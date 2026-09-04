import { CATEGORY_LABELS } from '../audit/engine/registry';
import { SEVERITY_LABELS } from '../audit/engine/severity';
import { countBySeverity } from '../audit/engine/run';
import { commentLabel } from '../shared/utils/labels';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '../shared/constants/product';
import { hexToUnitRgb, SEVERITY_HEX } from '../shared/constants/severity';
import type {
  Annotation,
  Audit,
  Finding,
  PageSnapshotDigest,
  Severity,
} from '../shared/types';
import { safeLink } from '../report/escape';
import { coverageNotices } from '../report/notices';
import { BLACK, DIM, PdfLayout, type PdfColor, type PdfImage } from './layout';
import { measure } from './metrics';
import { PdfDocument } from './writer';

/**
 * The audit as a PDF.
 *
 * The HTML report is the lossless artifact and stays the recommended one: it
 * carries any script, any alphabet, and a browser's typography. This exists
 * because a PDF is what gets attached to a ticket, printed for a review, or
 * sent to a client who will not open an HTML file from an email -- and because
 * "print the HTML to PDF" is a thing the user has to do by hand, in a dialog,
 * once per report.
 *
 * The content is the same content. Where the two can differ is text outside
 * WinAnsiEncoding, which the base-14 fonts cannot draw; that is counted and
 * stated on the page rather than silently mangled (see pdf/metrics.ts).
 */
export type PdfReportInput = {
  audit: Audit;
  /** Exactly what the user chose to include. */
  findings: readonly Finding[];
  digest: PageSnapshotDigest;
  /** The user's comments, in the order they were written. */
  annotations?: readonly Annotation[];
  /** findingId -> JPEG, already scaled. */
  screenshots?: Record<string, PdfImage>;
  /** attachmentId -> JPEG, already scaled. */
  attachments?: Record<string, PdfImage>;
  productVersion: string;
  generatedAt: number;
  /** Findings the audit produced but the user left out. Stated, not hidden. */
  omitted?: number;
};

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * The same palette the HTML report and the screenshots use, derived from the
 * one place it is written down rather than transcribed into floats a second
 * time -- which is how a printed badge ends up a different red from the picture
 * next to it.
 */
const SEVERITY_COLORS: Record<Severity, PdfColor> = {
  critical: hexToUnitRgb(SEVERITY_HEX.critical),
  high: hexToUnitRgb(SEVERITY_HEX.high),
  medium: hexToUnitRgb(SEVERITY_HEX.medium),
  low: hexToUnitRgb(SEVERITY_HEX.low),
  info: hexToUnitRgb(SEVERITY_HEX.info),
};

const COMMENT_COLOR: PdfColor = [0.059, 0.42, 0.42];

const TYPE_LABEL: Record<Finding['type'], string> = {
  rule: 'Measured',
  heuristic: 'Heuristic',
  inference: 'Inference',
  recommendation: 'Suggestion',
};

const dateTime = (at: number): string =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function buildAuditPdf(input: PdfReportInput): Uint8Array<ArrayBuffer> {
  const layout = new PdfLayout(new PdfDocument());
  const { audit } = input;
  const annotations = input.annotations ?? [];
  const title = audit.title || audit.url || 'Untitled page';

  cover(layout, input, title);
  findingSections(layout, input);
  commentSection(layout, input, annotations);
  colophon(layout, input);

  return layout.finish({
    title: `${PRODUCT_NAME} audit — ${title}`,
    author: `${PRODUCT_NAME} ${input.productVersion}`,
    subject: audit.url,
    createdAt: input.generatedAt,
  });
}

function cover(layout: PdfLayout, input: PdfReportInput, title: string): void {
  const { audit, digest, findings } = input;
  const counts = countBySeverity(findings);
  const annotations = input.annotations ?? [];

  layout.text(PRODUCT_NAME.toUpperCase(), { font: 'bold', size: 8, color: DIM, after: 3 });
  layout.text(title, { font: 'bold', size: 19, leading: 1.2, after: 10 });

  const link = safeLink(audit.url);
  layout.keyValue('Page', audit.url);
  if (link) {
    // A live link on the URL line, so the reader of a printed-to-screen PDF
    // can get to the page the report is about in one click.
    layout.link(link, 13.3, Math.min(layout.columnWidth - 96, measure(audit.url, 'regular', 9.5)));
  }
  layout.keyValue('Audited', dateTime(audit.createdAt));
  layout.keyValue('Report', dateTime(input.generatedAt));
  layout.keyValue('Viewport', `${digest.viewport.width} x ${digest.viewport.height} CSS px`);
  layout.keyValue('Categories', audit.categories.map((category) => CATEGORY_LABELS[category]).join(', '));
  layout.keyValue('Elements', `${audit.elementsScanned} examined`);

  const totals = [
    `${findings.length} finding${findings.length === 1 ? '' : 's'}`,
    ...SEVERITY_ORDER.filter((severity) => counts[severity] > 0).map(
      (severity) => `${counts[severity]} ${SEVERITY_LABELS[severity].toLowerCase()}`,
    ),
    ...(annotations.length > 0
      ? [`${annotations.length} comment${annotations.length === 1 ? '' : 's'}`]
      : []),
  ];
  layout.text(totals.join('   ·   '), { font: 'bold', size: 10, before: 8, after: 6 });

  for (const notice of coverageNotices(input)) {
    const panel = layout.beginPanel();
    layout.text(notice, { size: 9, color: DIM, leading: 1.4 });
    layout.endPanel(panel);
    layout.gap(8);
  }
  layout.rule(BLACK, 1.2);
  layout.gap(4);
}

function findingSections(layout: PdfLayout, input: PdfReportInput): void {
  const grouped = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: input.findings.filter((finding) => finding.severity === severity),
  })).filter((group) => group.items.length > 0);

  if (grouped.length === 0) {
    layout.text('No findings were included in this report.', { size: 10, color: DIM, before: 8, after: 8 });
    return;
  }

  for (const group of grouped) {
    // Room for the heading and the start of the first finding under it. A
    // heading alone at the foot of a page reads as a section with nothing in
    // it, which is how the comments section first came out.
    layout.ensure(110);
    layout.text(`${SEVERITY_LABELS[group.severity].toUpperCase()} — ${group.items.length}`, {
      font: 'bold',
      size: 9,
      color: DIM,
      before: 14,
      after: 6,
    });
    for (const finding of group.items) renderFinding(layout, finding, input);
  }
}

function renderFinding(layout: PdfLayout, finding: Finding, input: PdfReportInput): void {
  // Enough room for the badge, the title and the first lines of the summary.
  // A whole finding will not always fit on the remainder of a page and should
  // not have to -- but a heading alone at the foot of one is just untidy.
  layout.ensure(layout.heightOf(finding.title, { font: 'bold', size: 11.5 }) + 46);
  layout.gap(6);

  const badgeWidth = layout.badge(SEVERITY_LABELS[finding.severity], SEVERITY_COLORS[finding.severity]);
  layout.text(finding.title, { font: 'bold', size: 11.5, indent: badgeWidth + 7, leading: 1.25, after: 2 });

  const tags = [
    CATEGORY_LABELS[finding.category],
    TYPE_LABEL[finding.type],
    finding.ruleId,
    ...(finding.type === 'rule' ? [] : [`Confidence ${Math.round(finding.confidence * 100)}%`]),
    ...(finding.status === 'open' ? [] : [finding.status]),
  ];
  layout.text(tags.join('  ·  '), { size: 8.5, color: DIM, after: 4 });
  layout.text(finding.summary, { size: 10, leading: 1.4, after: 4 });

  if (finding.evidence.length > 0) {
    label(layout, 'Evidence');
    for (const line of finding.evidence) {
      // A hanging indent, so a wrapped evidence line does not read as a new one.
      layout.text(`- ${line}`, { size: 9.5, indent: 10, leading: 1.35 });
    }
    layout.gap(4);
  }

  label(layout, 'Impact');
  layout.text(finding.impact, { size: 9.5, leading: 1.4, after: 4 });
  label(layout, 'Recommendation');
  layout.text(finding.recommendation, { size: 9.5, leading: 1.4, after: 4 });

  if (finding.note) {
    const panel = layout.beginPanel();
    layout.text('NOTE', { font: 'bold', size: 7.5, color: DIM, after: 2 });
    layout.text(finding.note, { size: 9.5, leading: 1.4 });
    layout.endPanel(panel);
    layout.gap(8);
  }

  const shot = input.screenshots?.[finding.id];
  if (shot) layout.place(shot, { caption: `Screenshot of the element this finding is about.` });

  const location = where(finding);
  if (location) layout.text(location, { font: 'mono', size: 8, color: DIM, after: 2 });

  layout.gap(4);
  layout.rule();
}

/**
 * The comments the user wrote.
 *
 * A section of its own, after the findings and clearly labelled as somebody's
 * opinion. Interleaving them with measured findings would let a note read as a
 * result, which is the one confusion this product is built to avoid -- and it
 * would put them under a severity heading they do not have.
 */
function commentSection(
  layout: PdfLayout,
  input: PdfReportInput,
  annotations: readonly Annotation[],
): void {
  if (annotations.length === 0) return;

  // The heading, the sentence under it, and the first comment's own opening --
  // measured rather than guessed at, because the sentence wraps differently
  // depending on how many comments there are.
  layout.ensure(150);
  layout.text(`COMMENTS — ${annotations.length}`, {
    font: 'bold',
    size: 9,
    color: DIM,
    before: 18,
    after: 3,
  });
  layout.text(
    `Written by hand during the audit. These are observations and opinions, not measurements, and ${PRODUCT_NAME} makes no claim about them.`,
    { size: 8.5, color: DIM, leading: 1.4, after: 8 },
  );

  for (let index = 0; index < annotations.length; index += 1) {
    const annotation = annotations[index];
    if (!annotation) continue;
    // The marker, the anchor line and the first lines of the comment. A long
    // comment will not fit on the remainder of a page and does not have to.
    layout.ensure(76);
    layout.gap(6);

    const marker = commentLabel(index + 1);
    const badgeWidth = layout.badge(marker, COMMENT_COLOR, 8.5);
    const anchor = where(annotation) ?? 'On the page as a whole (no element anchor).';
    layout.text(anchor, { font: 'mono', size: 8, color: DIM, indent: badgeWidth + 7, after: 3 });
    layout.text(annotation.body, { size: 10, leading: 1.45, after: 4 });

    for (const meta of annotation.attachments) {
      const image = input.attachments?.[meta.id];
      if (!image) continue;
      layout.place(image, {
        caption: meta.caption || `Image attached to comment ${marker}.`,
      });
    }

    layout.text(`Written ${dateTime(annotation.createdAt)}`, { size: 8, color: DIM, after: 2 });
    layout.gap(4);
    layout.rule();
  }
}

function colophon(layout: PdfLayout, input: PdfReportInput): void {
  layout.ensure(90);
  layout.gap(12);
  layout.text(`${PRODUCT_NAME} ${input.productVersion} — ${PRODUCT_TAGLINE}`, {
    font: 'bold',
    size: 9,
    color: DIM,
    after: 4,
  });
  layout.text(
    'Generated on the machine that ran the audit. Nothing in this file was fetched from anywhere.',
    { size: 8.5, color: DIM, leading: 1.4, after: 3 },
  );
  layout.text(
    'Severity describes how much the problem matters. Confidence describes how sure the measurement is. They are separate on purpose: a certain small problem is not an urgent one, and an uncertain serious one is still worth checking by hand.',
    { size: 8.5, color: DIM, leading: 1.4, after: 3 },
  );

  // Stamped last because it is only true once everything has been laid out.
  if (layout.lost > 0) {
    layout.text(
      `${layout.lost} character${layout.lost === 1 ? '' : 's'} in this audit could not be drawn with this PDF's built-in fonts and ${
        layout.lost === 1 ? 'was' : 'were'
      } replaced with "?". The HTML report keeps them exactly as they appear on the page.`,
      { size: 8.5, color: DIM, leading: 1.4 },
    );
  }
}

const label = (layout: PdfLayout, text: string): void => {
  layout.text(text.toUpperCase(), { font: 'bold', size: 7.5, color: DIM, after: 1 });
};

/** Where the thing is, in words a developer can act on without the tool. */
function where(item: { elementRef?: Finding['elementRef'] }): string | null {
  const reference = item.elementRef;
  if (!reference) return null;
  const parts: string[] = [`<${reference.tagName}>`];
  if (reference.role) parts.push(`role=${reference.role}`);
  if (reference.accessibleName) parts.push(`name "${reference.accessibleName}"`);
  else if (reference.textSnippet) parts.push(`text "${reference.textSnippet}"`);
  if (reference.stableAttribute) {
    parts.push(`${reference.stableAttribute.name}="${reference.stableAttribute.value}"`);
  }
  if (reference.structuralPath) parts.push(reference.structuralPath);
  return parts.join(' · ');
}

export function pdfFileName(audit: Audit): string {
  let host = 'page';
  try {
    host = new URL(audit.url).hostname.replace(/[^a-z0-9.-]/gi, '') || 'page';
  } catch {
    /* a page with no parseable URL still gets a report */
  }
  const stamp = new Date(audit.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `thursday-report-${host}-${stamp}.pdf`;
}
