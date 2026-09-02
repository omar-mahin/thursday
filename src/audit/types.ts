import type { AuditCategory, AuditSettings, ElementSnapshot, PageSnapshot, RawFinding } from '../shared/types';

export type RuleContext = {
  snapshot: PageSnapshot;
  settings: AuditSettings;
  /** Set for a single-element audit; rules that only make sense page-wide skip. */
  selection?: number;
  /** Visible, non-hidden elements: what nearly every rule wants to look at. */
  candidates: ElementSnapshot[];
};

export type Rule = {
  id: string;
  category: AuditCategory;
  /** Constrains the finding type a rule is allowed to emit. */
  kind: 'rule' | 'heuristic';
  /** One line, for the settings screen and the report legend. */
  description: string;
  scope: 'page' | 'element';
  run(context: RuleContext): RawFinding[];
};

export const DEFAULT_AUDIT_SETTINGS: AuditSettings = {
  minTouchTarget: 44,
  vaguePhrases: [
    'click here',
    'here',
    'learn more',
    'read more',
    'more',
    'submit',
    'go',
    'this link',
    'link',
    'details',
    'continue',
  ],
};

/** Every rule reports through this, so the shape stays uniform. */
export function finding(
  rule: Pick<Rule, 'id' | 'category' | 'kind'>,
  parts: Omit<RawFinding, 'ruleId' | 'category' | 'type'> & { type?: RawFinding['type'] },
): RawFinding {
  return {
    ruleId: rule.id,
    category: rule.category,
    type: parts.type ?? (rule.kind === 'rule' ? 'rule' : 'heuristic'),
    ...parts,
  };
}

/** Elements worth auditing: visible, not hidden from assistive tech, not ours. */
export const isAuditable = (element: ElementSnapshot): boolean =>
  !element.ariaHidden && !element.redacted;

export const describe = (element: ElementSnapshot): string => {
  if (element.id) return `${element.tagName}#${element.id}`;
  const first = element.classNames[0];
  return first ? `${element.tagName}.${first}` : element.tagName;
};

export const label = (element: ElementSnapshot): string =>
  element.accessibleName.name || element.text || describe(element);
