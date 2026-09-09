import { CATEGORY_LABELS } from '../audit/engine/registry';
import { SEVERITY_LABELS } from '../audit/engine/severity';
import { countBySeverity } from '../audit/engine/run';
import { commentLabel } from '../shared/utils/labels';
import { PRIORITY_LABELS } from '../shared/constants/priority';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '../shared/constants/product';
import type { Annotation, Audit, Finding, PageSnapshotDigest, Severity } from '../shared/types';
import { escapeHtml, safeImageSource, safeLink } from './escape';
import { coverageNotices } from './notices';
import { REPORT_CSS } from './styles';

export type ReportInput = {
  audit: Audit;
  /** Exactly what the user chose to include. */
  findings: readonly Finding[];
  digest: PageSnapshotDigest;
  /** findingId -> data URL. */
  screenshots?: Record<string, string>;
  /** The user's own comments, in the order they were written. */
  annotations?: readonly Annotation[];
  /** attachmentId -> data URL, for the images inside those comments. */
  attachments?: Record<string, string>;
  productVersion: string;
  generatedAt: number;
  /** Findings the audit produced but the user left out. Stated, not hidden. */
  omitted?: number;
};

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const TYPE_LABEL: Record<Finding['type'], string> = {
  rule: 'Measured',
  heuristic: 'Heuristic',
  inference: 'Inference',
  recommendation: 'Suggestion',
};

const dateTime = (at: number): string =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The shareable artifact: one HTML file, no scripts, no network.
 *
 * Everyone who needs to act on an audit does not have Thursday installed, and a
 * JSON file is not a deliverable. This opens in any browser with the network
 * off and prints to PDF without a layout falling apart.
 *
 * It is also built from untrusted text -- an audit file can come from anywhere
 * -- so every value is escaped and only inline images and http(s) links are
 * emitted (see report/escape.ts).
 */
export function renderReport(input: ReportInput): string {
  const { audit, digest, findings } = input;
  const annotations = input.annotations ?? [];
  const counts = countBySeverity(findings);
  const title = audit.title || audit.url || 'Untitled page';

  const link = safeLink(audit.url);
  const url = link ? `<a href="${escapeHtml(link)}">${escapeHtml(audit.url)}</a>` : escapeHtml(audit.url);

  const grouped = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: findings.filter((finding) => finding.severity === severity),
  })).filter((group) => group.items.length > 0);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`${PRODUCT_NAME} audit — ${title}`)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="sheet">
<header class="report-head">
  <div class="brand">${escapeHtml(PRODUCT_NAME)}</div>
  <h1>${escapeHtml(title)}</h1>
  <dl class="meta">
    <dt>Page</dt><dd>${url}</dd>
    <dt>Audited</dt><dd>${escapeHtml(dateTime(audit.createdAt))}</dd>
    <dt>Report</dt><dd>${escapeHtml(dateTime(input.generatedAt))}</dd>
    <dt>Viewport</dt><dd>${digest.viewport.width} x ${digest.viewport.height} CSS px</dd>
    <dt>Categories</dt><dd>${escapeHtml(audit.categories.map((category) => CATEGORY_LABELS[category]).join(', '))}</dd>
    <dt>Elements</dt><dd>${audit.elementsScanned} examined</dd>
  </dl>
  <ul class="totals">
    <li>${findings.length} finding${findings.length === 1 ? '' : 's'}</li>
    ${SEVERITY_ORDER.filter((severity) => counts[severity] > 0)
      .map((severity) => `<li data-severity="${severity}">${counts[severity]} ${escapeHtml(SEVERITY_LABELS[severity].toLowerCase())}</li>`)
      .join('\n    ')}
    ${annotations.length > 0 ? `<li data-kind="comment">${annotations.length} comment${annotations.length === 1 ? '' : 's'}</li>` : ''}
  </ul>
  ${notices(input)}
</header>

${findings.length === 0
      ? '<p class="notice">No findings were included in this report.</p>'
      : grouped
          .map(
            (group) => `<section>
<h2>${escapeHtml(SEVERITY_LABELS[group.severity])} — ${group.items.length}</h2>
${group.items.map((finding) => renderFinding(finding, input)).join('\n')}
</section>`,
          )
          .join('\n')}
${renderComments(annotations, input)}

<footer class="report-foot">
  <p><strong>${escapeHtml(PRODUCT_NAME)} ${escapeHtml(input.productVersion)}</strong> — ${escapeHtml(PRODUCT_TAGLINE)}</p>
  <p>Generated on the machine that ran the audit. This file contains no scripts and loads nothing from the network, so it reads the same offline as online.</p>
  <p><strong>Severity</strong> describes how much the problem matters. <strong>Confidence</strong> describes how sure the measurement is. They are separate on purpose: a certain small problem is not an urgent one, and an uncertain serious one is still worth checking by hand.</p>
</footer>
</div>
</body>
</html>
`;
}

const notices = (input: ReportInput): string =>
  coverageNotices(input)
    .map((line) => `<p class="notice">${escapeHtml(line)}</p>`)
    .join('\n  ');

/**
 * The comments the user wrote, as their own section.
 *
 * Deliberately after the findings and deliberately labelled. A comment is
 * someone's judgement; a finding is a measurement Thursday will defend. Mixing
 * the two into one list -- which would be easier to build and read slightly
 * better -- would let an opinion inherit the authority of the numbers above
 * it, and that is the trade this whole product refuses to make.
 *
 * The panel does merge them, and that is not a contradiction: the panel is a
 * worklist for the person who wrote the comments, where what matters is one
 * count of what is left. This is a document handed to somebody who was not
 * there, where what matters is which claims came with a measurement behind
 * them. Same items, different question.
 */
/**
 * Whether a comment has been put away.
 *
 * The same two statuses that close a finding, because they are the same
 * statuses -- and absent means untriaged, which is open.
 */
const isClosedComment = (annotation: Annotation): boolean =>
  annotation.status === 'resolved' || annotation.status === 'dismissed';

function renderComments(annotations: readonly Annotation[], input: ReportInput): string {
  if (annotations.length === 0) return '';
  const open = annotations.filter((annotation) => !isClosedComment(annotation)).length;
  return `<section class="comments">
<h2>Comments — ${annotations.length}</h2>
<p class="dim">Written by hand during the audit. These are observations and opinions, not measurements, and ${escapeHtml(
    PRODUCT_NAME,
  )} makes no claim about them.${
    open === annotations.length ? '' : ` ${open} of ${annotations.length} still open.`
  }</p>
${annotations.map((annotation, index) => renderComment(annotation, index + 1, input)).join('\n')}
</section>`;
}

function renderComment(annotation: Annotation, ordinal: number, input: ReportInput): string {
  const marker = commentLabel(ordinal);
  const images = annotation.attachments
    .map((meta) => {
      const source = input.attachments?.[meta.id];
      const safe = source ? safeImageSource(source) : null;
      if (!safe) return '';
      // The caption is the alt text as well as the visible label: it is the
      // user's own description of what they photographed, which is exactly
      // what alt text is for.
      const description = meta.caption || `Image attached to comment ${marker}`;
      return `<figure class="shot"><img alt="${escapeHtml(description)}" src="${escapeHtml(safe)}">${
        meta.caption ? `<figcaption>${escapeHtml(meta.caption)}</figcaption>` : ''
      }</figure>`;
    })
    .join('\n  ');

  const status = annotation.status ?? 'open';
  return `<article class="finding comment" data-status="${escapeHtml(status)}">
  <div class="finding-head">
    <span class="sev" data-kind="comment">${escapeHtml(marker)}</span>
    <h3>Comment ${escapeHtml(marker)}</h3>
    ${
      annotation.priority && annotation.priority !== 'normal'
        ? `<span class="priority" data-level="${escapeHtml(annotation.priority)}">${escapeHtml(
            PRIORITY_LABELS[annotation.priority],
          )}</span>`
        : ''
    }
  </div>
  ${
    /*
     * Said out loud when it is not open, exactly as a finding says it.
     * A comment the author has already resolved, printed identically to one
     * still outstanding, is a report that overstates the work remaining.
     */
    status === 'open' ? '' : `<ul class="tags"><li>${escapeHtml(status)}</li></ul>`
  }
  ${annotation.author ? `<p class="byline">${escapeHtml(annotation.author)}</p>` : ''}
  <p class="body">${paragraphs(annotation.body)}</p>
  ${images}
  <div class="where">${
    annotation.elementRef
      ? `Element: ${escapeHtml(describe(annotation.elementRef))}${
          annotation.elementRef.structuralPath
            ? `<div class="mono">${escapeHtml(annotation.elementRef.structuralPath)}</div>`
            : ''
        }`
      : 'No element anchor: this comment is about the page as a whole.'
  }</div>
  <div class="dim">Written ${escapeHtml(dateTime(annotation.createdAt))}</div>
</article>`;
}

/**
 * Keeps the line breaks the user typed.
 *
 * A comment is prose someone wrote in a textarea, and collapsing their
 * paragraphs into one block would be losing information they put there on
 * purpose. Escaped first, then broken -- never the other way round.
 */
const paragraphs = (text: string): string =>
  escapeHtml(text)
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n/g, '<br>'))
    .join('</p><p class="body">');

function renderFinding(finding: Finding, input: ReportInput): string {
  const shot = input.screenshots?.[finding.id];
  const source = shot ? safeImageSource(shot) : null;

  return `<article class="finding">
  <div class="finding-head">
    <span class="sev" data-severity="${finding.severity}">${escapeHtml(SEVERITY_LABELS[finding.severity])}</span>
    <h3>${escapeHtml(finding.title)}</h3>
  </div>
  <ul class="tags">
    <li>${escapeHtml(CATEGORY_LABELS[finding.category])}</li>
    <li>${escapeHtml(TYPE_LABEL[finding.type])}</li>
    <li class="mono">${escapeHtml(finding.ruleId)}</li>
    ${finding.type === 'rule' ? '' : `<li>Confidence ${Math.round(finding.confidence * 100)}%</li>`}
    ${finding.status === 'open' ? '' : `<li>${escapeHtml(finding.status)}</li>`}
  </ul>
  <p>${escapeHtml(finding.summary)}</p>
  ${finding.evidence.length > 0
      ? `<div class="block"><h4>Evidence</h4><ul>${finding.evidence.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul></div>`
      : ''}
  <div class="block"><h4>Impact</h4><p>${escapeHtml(finding.impact)}</p></div>
  <div class="block"><h4>Recommendation</h4><p>${escapeHtml(finding.recommendation)}</p></div>
  ${finding.note ? `<div class="note"><h4>Note</h4><p>${escapeHtml(finding.note)}</p></div>` : ''}
  ${source ? `<figure class="shot"><img alt="${escapeHtml(`Screenshot of ${finding.title}`)}" src="${escapeHtml(source)}"></figure>` : ''}
  ${where(finding)}
</article>`;
}

/** Where the problem is, in words a developer can act on without the tool. */
function where(finding: Finding): string {
  const reference = finding.elementRef;
  if (!reference) return '';
  const path = reference.structuralPath ? `<div class="mono">${escapeHtml(reference.structuralPath)}</div>` : '';
  return `<div class="where">Element: ${escapeHtml(describe(reference))}${path}</div>`;
}

/** One element, in one line, without the structural path. */
function describe(reference: NonNullable<Finding['elementRef']>): string {
  const parts: string[] = [`<${reference.tagName}>`];
  if (reference.role) parts.push(`role=${reference.role}`);
  if (reference.accessibleName) parts.push(`name "${reference.accessibleName}"`);
  else if (reference.textSnippet) parts.push(`text "${reference.textSnippet}"`);
  if (reference.stableAttribute) {
    parts.push(`${reference.stableAttribute.name}="${reference.stableAttribute.value}"`);
  }
  return parts.join(' · ');
}

export function reportFileName(audit: Audit): string {
  let host = 'page';
  try {
    host = new URL(audit.url).hostname.replace(/[^a-z0-9.-]/gi, '') || 'page';
  } catch {
    /* a page with no parseable URL still gets a report */
  }
  const stamp = new Date(audit.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `thursday-report-${host}-${stamp}.html`;
}
