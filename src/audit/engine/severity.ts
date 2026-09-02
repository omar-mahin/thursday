import type { RawFinding, Severity } from '../../shared/types';

/**
 * Severity is a property of the rule and its evidence, never of confidence
 * (spec section 22). A rule may propose a severity when its measurements
 * justify it; otherwise the default for that rule applies.
 *
 * Heuristics are capped at `medium`: without a measurement behind it, a finding
 * has not earned the right to shout.
 */
const DEFAULTS: Record<string, Severity> = {
  'A11Y-001': 'medium',
  'A11Y-002': 'high',
  'A11Y-003': 'high',
  'A11Y-004': 'low',
  'A11Y-005': 'medium',
  'A11Y-006': 'medium',
  'A11Y-007': 'high',
  'A11Y-008': 'medium',
  'A11Y-009': 'medium',
  'A11Y-010': 'medium',
  'UI-001': 'low',
  'UI-002': 'low',
  'UI-003': 'low',
  'UI-005': 'low',
  'UI-006': 'low',
  'UX-001': 'medium',
  'UX-002': 'info',
  'UX-003': 'medium',
  'UX-004': 'low',
  'CNT-001': 'medium',
  'CNT-002': 'medium',
  'CNT-003': 'low',
  'CNT-004': 'info',
  'CNT-005': 'low',
  'CNT-006': 'low',
  'CRO-001': 'medium',
  'CRO-002': 'low',
  'RESP-001': 'high',
  'RESP-002': 'medium',
  'RESP-003': 'medium',
};

const ORDER: readonly Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

export const severityRank = (severity: Severity): number => ORDER.indexOf(severity);

export const compareSeverity = (a: Severity, b: Severity): number => severityRank(b) - severityRank(a);

const HEURISTIC_CEILING: Severity = 'medium';

export function resolveSeverity(raw: RawFinding): Severity {
  const proposed = raw.severity ?? DEFAULTS[raw.ruleId] ?? 'low';
  if (raw.type === 'rule') return proposed;
  // Heuristics and inferences do not get to claim critical or high.
  return severityRank(proposed) > severityRank(HEURISTIC_CEILING) ? HEURISTIC_CEILING : proposed;
}

/**
 * Confidence describes how sure we are of the *observation*, not how bad it is.
 * A measured value is 1.0; a heuristic is high but not certain; an inference is
 * lower. Nothing here feeds back into severity.
 */
export function resolveConfidence(raw: RawFinding): number {
  switch (raw.type) {
    case 'rule':
      return 1;
    case 'heuristic':
      return 0.8;
    case 'inference':
      return 0.6;
    case 'recommendation':
      return 0.7;
  }
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};
