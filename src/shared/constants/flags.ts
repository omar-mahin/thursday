/** Feature flags (PLAN.md / spec section 50.16). Flipped by hand for now. */
export const FLAGS = {
  /** Shows the raw message log in the side panel. Development aid. */
  messageLog: true,
  /** Sprint 2. */
  elementSelection: false,
  /** Sprint 3. */
  auditEngine: false,
  /** Phase 2, and it stays off until there is something to turn on. */
  aiAnalysis: false,
} as const;

export type FeatureFlag = keyof typeof FLAGS;
