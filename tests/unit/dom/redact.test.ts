import { beforeEach, describe, expect, it } from 'vitest';
import {
  capText,
  formSnapshot,
  isSensitiveField,
  redactText,
  sanitizeHref,
} from '../../../src/content/snapshot/redact';

const field = (markup: string): Element => {
  document.body.innerHTML = markup;
  const element = document.querySelector('input, select, textarea, div');
  if (!element) throw new Error('fixture needs a field');
  return element;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('isSensitiveField', () => {
  it('catches password and hidden inputs', () => {
    expect(isSensitiveField(field('<input type="password">'))).toBe(true);
    expect(isSensitiveField(field('<input type="hidden" name="csrf">'))).toBe(true);
  });

  it('catches payment and credential autocomplete tokens', () => {
    for (const value of ['cc-number', 'cc-csc', 'cc-exp', 'current-password', 'new-password', 'one-time-code']) {
      expect(isSensitiveField(field(`<input autocomplete="${value}">`)), value).toBe(true);
    }
  });

  it('catches revealing name and id attributes', () => {
    for (const name of ['cardNumber', 'user_password', 'cvv', 'ssn', 'api_token', 'otp', 'routingNumber']) {
      expect(isSensitiveField(field(`<input name="${name}">`)), name).toBe(true);
    }
    expect(isSensitiveField(field('<input id="credit-card-number">'))).toBe(true);
  });

  it('catches sensitive placeholders and labels', () => {
    expect(isSensitiveField(field('<input placeholder="Card number">'))).toBe(true);
    expect(isSensitiveField(field('<input aria-label="Security code">'))).toBe(true);
  });

  it('leaves ordinary fields alone', () => {
    for (const markup of [
      '<input type="text" name="firstName">',
      '<input type="email" name="email" autocomplete="email">',
      '<input type="search" name="q">',
      '<textarea name="message"></textarea>',
      '<select name="country"></select>',
    ]) {
      expect(isSensitiveField(field(markup)), markup).toBe(false);
    }
  });

  it('is not fooled into flagging non-fields', () => {
    expect(isSensitiveField(field('<div>password</div>'))).toBe(false);
  });
});

describe('formSnapshot', () => {
  it('records type and requirements, and nothing about contents', () => {
    document.body.innerHTML = '<input type="email" required autocomplete="email" value="me@example.com">';
    const input = document.querySelector('input')!;
    const snapshot = formSnapshot(input, 'label-for');

    expect(snapshot).toEqual({
      type: 'email',
      required: true,
      autocomplete: 'email',
      labelledBy: 'label-for',
    });
    // The guarantee: no key of the snapshot carries the value, its length, or
    // even whether the field is filled.
    expect(JSON.stringify(snapshot)).not.toContain('me@example.com');
    expect(Object.keys(snapshot)).not.toContain('hasValue');
    expect(Object.keys(snapshot)).not.toContain('valueLength');
  });

  it('honours aria-required', () => {
    document.body.innerHTML = '<input aria-required="true">';
    expect(formSnapshot(document.querySelector('input')!, 'none').required).toBe(true);
  });
});

describe('redactText', () => {
  it('removes emails, phone numbers and long digit runs', () => {
    expect(redactText('Contact ada@example.com now')).toBe('Contact [email] now');
    expect(redactText('Call +1 (555) 123-4567 today')).toBe('Call [phone] today');
    expect(redactText('Order 918273645')).toBe('Order [number]');
  });

  it('leaves ordinary copy and short numbers intact', () => {
    expect(redactText('Save 20% on 3 plans')).toBe('Save 20% on 3 plans');
    expect(redactText('Version 2.1 ships 2026')).toBe('Version 2.1 ships 2026');
  });

  it('does not mistake dates and prices for phone numbers', () => {
    // Over-redaction destroys the evidence text a finding is built on.
    expect(redactText('Updated 12-04-2026')).toBe('Updated 12-04-2026');
    expect(redactText('Total 1,299.00 today')).toBe('Total 1,299.00 today');
  });

  it('still catches phone numbers in the shapes people actually write', () => {
    for (const value of ['+1 (555) 123-4567', '555-123-4567', '(555) 123 4567', '+44 20 7946 0958']) {
      expect(redactText(`Call ${value} now`), value).toBe('Call [phone] now');
    }
  });
});

describe('capText', () => {
  it('collapses whitespace and truncates at the per-element limit', () => {
    expect(capText('  a\n\n  b  ')).toBe('a b');
    const capped = capText('x'.repeat(400));
    expect(capped.length).toBe(201);
    expect(capped.endsWith('…')).toBe(true);
  });
});

describe('sanitizeHref', () => {
  it('keeps origin and path but drops query and fragment', () => {
    expect(sanitizeHref('/pricing?utm_source=x&token=abc#top', 'https://site.test/a')).toBe(
      'https://site.test/pricing',
    );
  });

  it('reduces non-http schemes to the scheme alone', () => {
    expect(sanitizeHref('mailto:ada@example.com', 'https://site.test/')).toBe('mailto:');
    expect(sanitizeHref('tel:+15551234567', 'https://site.test/')).toBe('tel:');
  });

  it('returns nothing for missing or unparseable hrefs', () => {
    expect(sanitizeHref(null, 'https://site.test/')).toBeUndefined();
    expect(sanitizeHref('http://[bad', 'https://site.test/')).toBeUndefined();
  });
});
