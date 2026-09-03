import type { ElementReference, Finding, Severity } from '../../shared/types';
import { compareSeverity } from './severity';

/**
 * Comparing two audits of the same page.
 *
 * This is what turns Thursday from a snapshot tool into a regression tool: run
 * it, fix things, run it again, and see what actually moved. The whole thing is
 * a pure function over two finding lists, so it is testable without a browser
 * and works identically on a saved file and a live re-audit.
 */
export type DeltaStatus = 'fixed' | 'unchanged' | 'new';

export type AuditDiff = {
  /** Present before, absent now. */
  fixed: Finding[];
  /** Present in both. `before` carries the user's status and note. */
  unchanged: Array<{ before: Finding; after: Finding }>;
  /** Absent before, present now. */
  introduced: Finding[];
};

const normalise = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);

/**
 * How an element is identified across two runs.
 *
 * Deliberately the same precedence as the resolution ladder (PLAN.md 2.5):
 * a test attribute beats a name, a name beats text, text beats position. Using
 * position first would report every reflowed page as entirely new findings.
 */
export function elementKey(reference: ElementReference | undefined): string {
  if (!reference) return 'page';
  if (reference.stableAttribute) {
    return `a:${reference.stableAttribute.name}=${normalise(reference.stableAttribute.value)}`;
  }
  const role = reference.role ?? reference.tagName;
  if (reference.accessibleName) return `n:${role}/${normalise(reference.accessibleName)}`;
  if (reference.textSnippet) return `t:${reference.tagName}/${normalise(reference.textSnippet)}`;
  if (reference.structuralPath) return `p:${reference.structuralPath}`;
  return `g:${reference.tagName}`;
}

/** The identity a finding keeps between runs: this rule, about this element. */
export function findingKey(finding: Finding): string {
  return `${finding.ruleId}#${elementKey(finding.elementRef)}`;
}

const bucket = (findings: readonly Finding[]): Map<string, Finding[]> => {
  const map = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = findingKey(finding);
    const existing = map.get(key);
    if (existing) existing.push(finding);
    else map.set(key, [finding]);
  }
  return map;
};

const bySeverity = (a: Finding, b: Finding): number => {
  const delta = compareSeverity(a.severity, b.severity);
  return delta !== 0 ? delta : a.ruleId.localeCompare(b.ruleId);
};

/**
 * Matched as multisets, not as sets.
 *
 * Six targets too small becoming two is progress, and reporting it as
 * "unchanged" would hide the four that were fixed. So identical keys are paired
 * off one for one and the leftovers on each side are the real change.
 */
export function compareAudits(before: readonly Finding[], after: readonly Finding[]): AuditDiff {
  const beforeBuckets = bucket(before);
  const afterBuckets = bucket(after);

  const diff: AuditDiff = { fixed: [], unchanged: [], introduced: [] };

  for (const [key, previous] of beforeBuckets) {
    const current = afterBuckets.get(key) ?? [];
    const paired = Math.min(previous.length, current.length);
    for (let i = 0; i < paired; i += 1) {
      const beforeFinding = previous[i];
      const afterFinding = current[i];
      if (beforeFinding && afterFinding) diff.unchanged.push({ before: beforeFinding, after: afterFinding });
    }
    diff.fixed.push(...previous.slice(paired));
  }

  for (const [key, current] of afterBuckets) {
    const previous = beforeBuckets.get(key) ?? [];
    diff.introduced.push(...current.slice(previous.length));
  }

  diff.fixed.sort(bySeverity);
  diff.introduced.sort(bySeverity);
  diff.unchanged.sort((a, b) => bySeverity(a.after, b.after));
  return diff;
}

/**
 * Carries the user's own work forward into a re-audit.
 *
 * Dismissing a finding and then re-running the audit should not resurrect it.
 * Status, note and report membership belong to the person, not to the run, so a
 * matched finding inherits them; a genuinely new finding starts open.
 */
export function carryAnnotations(before: readonly Finding[], after: readonly Finding[]): Finding[] {
  const diff = compareAudits(before, after);
  const inherited = new Map<string, Finding>();
  for (const pair of diff.unchanged) inherited.set(pair.after.id, pair.before);

  return after.map((finding) => {
    const previous = inherited.get(finding.id);
    if (!previous) return finding;
    const carried: Finding = { ...finding, status: previous.status };
    if (previous.note) carried.note = previous.note;
    if (previous.inReport) carried.inReport = true;
    return carried;
  });
}

export type DiffCounts = {
  fixed: number;
  unchanged: number;
  introduced: number;
  /** Net change in open findings, negative when the page improved. */
  net: number;
};

export function diffCounts(diff: AuditDiff): DiffCounts {
  return {
    fixed: diff.fixed.length,
    unchanged: diff.unchanged.length,
    introduced: diff.introduced.length,
    net: diff.introduced.length - diff.fixed.length,
  };
}

/** Worst severity in a set, for a one-line summary of a diff. */
export function worstSeverity(findings: readonly Finding[]): Severity | null {
  if (findings.length === 0) return null;
  return [...findings].sort(bySeverity)[0]?.severity ?? null;
}
