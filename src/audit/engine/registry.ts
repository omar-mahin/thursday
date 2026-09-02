import type { AuditCategory } from '../../shared/types';
import type { Rule } from '../types';
import { imageMissingAlt } from '../rules/a11y/images';
import { emptyInteractive, missingFormLabel } from '../rules/a11y/labels';
import { lowContrast } from '../rules/a11y/contrast';
import { smallTouchTarget } from '../rules/a11y/targets';
import {
  documentBasics,
  duplicateIds,
  focusIndicator,
  headingHierarchy,
  positiveTabIndex,
} from '../rules/a11y/structure';
import { inconsistentButtons } from '../rules/ui/buttons';
import { alignmentInconsistency, spacingInconsistency } from '../rules/ui/spacing';
import { colorSprawl, typographySprawl } from '../rules/ui/typography';
import { competingCtas, navigationSize } from '../rules/ux/hierarchy';
import { formLength, nonObviousClickable } from '../rules/ux/forms';
import {
  duplicateLinkText,
  longParagraphs,
  readingDifficulty,
  sectionWithoutHeading,
  shoutingText,
  vagueLabels,
} from '../rules/content/copy';
import { ctaAboveFold, heroCtaCount } from '../rules/cro/cta';
import { fixedWidthBlocker, horizontalOverflow, tinyMobileText } from '../rules/responsive/layout';

/**
 * Every rule, in one flat list. Order here is the order findings are produced
 * in, before ranking -- so keep each category's rules together.
 *
 * Deliberately absent: visual hierarchy, value-proposition clarity, trust
 * signals, unanswered objections, jargon and terminology consistency. Those
 * need interpretation, and a thin regex pretending to measure them would be
 * exactly the shortcut this product is meant to avoid.
 */
export const ALL_RULES: readonly Rule[] = [
  // accessibility
  imageMissingAlt,
  missingFormLabel,
  lowContrast,
  smallTouchTarget,
  headingHierarchy,
  focusIndicator,
  emptyInteractive,
  duplicateIds,
  documentBasics,
  positiveTabIndex,
  // ui
  inconsistentButtons,
  spacingInconsistency,
  typographySprawl,
  alignmentInconsistency,
  colorSprawl,
  // ux
  competingCtas,
  navigationSize,
  formLength,
  nonObviousClickable,
  // content
  vagueLabels,
  duplicateLinkText,
  longParagraphs,
  readingDifficulty,
  shoutingText,
  sectionWithoutHeading,
  // cro
  ctaAboveFold,
  heroCtaCount,
  // responsive
  horizontalOverflow,
  fixedWidthBlocker,
  tinyMobileText,
];

export const ALL_CATEGORIES: readonly AuditCategory[] = [
  'a11y',
  'ui',
  'ux',
  'content',
  'cro',
  'responsive',
];

export const rulesFor = (categories: readonly AuditCategory[]): Rule[] =>
  ALL_RULES.filter((rule) => categories.includes(rule.category));

export const ruleById = (id: string): Rule | undefined => ALL_RULES.find((rule) => rule.id === id);

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  a11y: 'Accessibility',
  ui: 'UI',
  ux: 'UX',
  content: 'Content',
  cro: 'Conversion',
  responsive: 'Responsive',
};
