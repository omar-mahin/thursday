import type { FormFieldSnapshot } from '../../shared/types';

/**
 * The privacy filter (PLAN.md section 7).
 *
 * With no network, the risk is not transmission -- it is what lands in a saved
 * `.thursday.json` that someone then emails to a colleague. So redaction runs
 * during collection, before anything leaves the page, and the shape of this
 * module is the reason the content script has no code path that reads a value.
 */

/** Field types whose mere presence we record, and nothing else. */
const SENSITIVE_TYPES = new Set(['password', 'hidden']);

const SENSITIVE_AUTOCOMPLETE = /^(cc-|new-password|current-password|one-time-code)/i;

const SENSITIVE_NAME = /pass|pwd|cvv|cvc|csc|card|ssn|social.?security|token|secret|otp|passcode|security.?code|routing|iban|account.?number/i;

const SENSITIVE_LABEL = /password|card number|cvv|cvc|security code|social security|passcode|one.?time code/i;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;

/**
 * A phone number needs either a country prefix or internal separators. Bare
 * digit runs fall through to LONG_NUMBER instead, and the digit-count floor
 * below keeps dates like 12-04-2026 out: over-redacting destroys the evidence
 * text that makes a finding useful, so the patterns are deliberately narrow
 * while the catch-all for long digit runs stays broad.
 */
const PHONE = /(?:\+\d[\d\s().-]{6,}\d)|(?:\(?\d{2,}[\s().-][\d\s().-]{4,}\d)/g;
const PHONE_MIN_DIGITS = 9;

const LONG_NUMBER = /\b\d{5,}\b/g;

export const TEXT_LIMIT_PER_ELEMENT = 200;
export const TEXT_BUDGET_PER_SNAPSHOT = 12_000;

export function isSensitiveField(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false;

  const type = (element.getAttribute('type') ?? 'text').toLowerCase();
  if (SENSITIVE_TYPES.has(type)) return true;

  const autocomplete = element.getAttribute('autocomplete');
  if (autocomplete && SENSITIVE_AUTOCOMPLETE.test(autocomplete.trim())) return true;

  for (const attribute of ['name', 'id']) {
    const value = element.getAttribute(attribute);
    if (value && SENSITIVE_NAME.test(value)) return true;
  }

  for (const attribute of ['aria-label', 'placeholder']) {
    const value = element.getAttribute(attribute);
    if (value && SENSITIVE_LABEL.test(value)) return true;
  }

  return false;
}

/** Strips things that identify a person from text we keep for evidence. */
export function redactText(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(PHONE, (match) => (match.replace(/\D/g, '').length >= PHONE_MIN_DIGITS ? '[phone]' : match))
    .replace(LONG_NUMBER, '[number]');
}

export function capText(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > TEXT_LIMIT_PER_ELEMENT
    ? `${trimmed.slice(0, TEXT_LIMIT_PER_ELEMENT).trimEnd()}…`
    : trimmed;
}

export const sanitize = (text: string): string => redactText(capText(text));

/** URLs are evidence, but query strings carry tokens and identifiers. */
export function sanitizeHref(raw: string | null, base: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol;
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

/**
 * Form metadata. Note what is absent: there is no branch here that touches the
 * element's value, checked state, or selection.
 */
export function formSnapshot(element: Element, labelledBy: FormFieldSnapshot['labelledBy']): FormFieldSnapshot {
  const tag = element.tagName.toLowerCase();
  const type = tag === 'input' ? (element.getAttribute('type') ?? 'text').toLowerCase() : tag;
  const snapshot: FormFieldSnapshot = {
    type,
    required: element.hasAttribute('required') || element.getAttribute('aria-required') === 'true',
    labelledBy,
  };
  const autocomplete = element.getAttribute('autocomplete');
  if (autocomplete) snapshot.autocomplete = autocomplete;
  return snapshot;
}
