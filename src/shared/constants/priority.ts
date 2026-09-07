import type { AnnotationPriority } from '../types';

/**
 * The three levels a comment can carry, and how to check one.
 *
 * Here rather than in types/audit.ts because the type modules are re-exported
 * as `export type *` and hold no runtime values -- a const in one would compile
 * but would not be importable through the barrel, which is a confusing way to
 * find out about a convention.
 *
 * In order, which is also least to most urgent: the UI offers them in this
 * order and nothing else has to decide what that order is.
 */
export const ANNOTATION_PRIORITIES: readonly AnnotationPriority[] = ['normal', 'medium', 'high'];

export const PRIORITY_LABELS: Record<AnnotationPriority, string> = {
  normal: 'Normal',
  medium: 'Medium',
  high: 'High',
};

/**
 * Whether an unknown value is a priority.
 *
 * Exists for reading a `.thursday.json` somebody else wrote. Nothing from a
 * file is trusted or spread into our objects, so every field is checked and
 * copied -- and a priority that is not one of these three is dropped rather
 * than carried into the panel as a string nothing knows how to render.
 */
export const isAnnotationPriority = (value: unknown): value is AnnotationPriority =>
  value === 'normal' || value === 'medium' || value === 'high';
