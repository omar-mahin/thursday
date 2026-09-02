import type {
  Audit,
  AuditOptions,
  Finding,
  PageSnapshot,
  RawFinding,
} from '../../shared/types';
import { isAuditable, type Rule, type RuleContext } from '../types';
import { referenceFromSnapshot } from '../element/reference';
import { applyCaps, dedupe } from './dedupe';
import { rulesFor } from './registry';
import { compareSeverity, resolveConfidence, resolveSeverity } from './severity';

export type AuditResult = {
  audit: Audit;
  findings: Finding[];
  /** Findings dropped by the caps, reported rather than hidden. */
  suppressed: number;
  /** Rules that threw, so one bad rule cannot fail the whole audit. */
  failedRules: string[];
  durationMs: number;
};

const id = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Runs the requested categories over a snapshot.
 *
 * Pure: a snapshot in, findings out, no DOM and no clock beyond timestamps. That
 * is what makes every rule testable in Node against a fixture, and what will
 * let the AI layer slot in later without touching any of this.
 */
export function runAudit(
  snapshot: PageSnapshot,
  options: AuditOptions,
  /** Injected so tests can exercise the engine with a specific rule set. */
  rules: readonly Rule[] = rulesFor(options.categories),
): AuditResult {
  const started = Date.now();
  const candidates = snapshot.elements.filter(isAuditable);
  const context: RuleContext = { snapshot, settings: options.settings, candidates };

  const raw: RawFinding[] = [];
  const failedRules: string[] = [];

  for (const rule of rules) {
    try {
      raw.push(...rule.run(context));
    } catch (error) {
      // A rule that throws is a bug in that rule, not a reason to lose the
      // other twenty-nine findings.
      failedRules.push(rule.id);
      void error;
    }
  }

  const deduped = dedupe(raw, snapshot);
  const ranked = [...deduped].sort((a, b) => {
    const severityDelta = compareSeverity(resolveSeverity(a), resolveSeverity(b));
    if (severityDelta !== 0) return severityDelta;
    // Measured findings outrank interpreted ones at the same severity.
    if (a.type !== b.type) return a.type === 'rule' ? -1 : 1;
    return a.ruleId.localeCompare(b.ruleId);
  });
  const { findings: capped, suppressed } = applyCaps(ranked);

  const auditId = id();
  const now = Date.now();
  const findings: Finding[] = capped.map((finding) => {
    const element = finding.elementIndex === undefined ? undefined : snapshot.elements[finding.elementIndex];
    const result: Finding = {
      id: id(),
      auditId,
      ruleId: finding.ruleId,
      category: finding.category,
      type: finding.type,
      title: finding.title,
      severity: resolveSeverity(finding),
      confidence: resolveConfidence(finding),
      summary: finding.summary,
      evidence: finding.evidence,
      impact: finding.impact,
      recommendation: finding.recommendation,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
    if (element) {
      result.elementRef = referenceFromSnapshot(snapshot, element);
      result.elementIndex = element.index;
    }
    if (finding.measurements) result.measurements = finding.measurements;
    return result;
  });

  const audit: Audit = {
    id: auditId,
    url: snapshot.url,
    origin: snapshot.origin,
    title: snapshot.title,
    createdAt: now,
    updatedAt: now,
    viewportWidth: snapshot.viewport.width,
    viewportHeight: snapshot.viewport.height,
    categories: [...options.categories],
    status: 'completed',
    findingIds: findings.map((finding) => finding.id),
    truncated: snapshot.truncated,
    elementsScanned: candidates.length,
  };

  return { audit, findings, suppressed, failedRules, durationMs: Date.now() - started };
}

/** Counts by severity, for the panel summary and the report header. */
export function countBySeverity(findings: readonly Finding[]): Record<Finding['severity'], number> {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}
