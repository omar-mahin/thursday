import { describe, expect, it } from 'vitest';
import { isEnvelope } from '../../src/shared/messaging/protocol';
import { assertNever, err, ok, USER_MESSAGES } from '../../src/shared/result';

describe('isEnvelope', () => {
  it('accepts well-formed envelopes from either side', () => {
    expect(isEnvelope({ from: 'content', message: { type: 'DEACTIVATED' } })).toBe(true);
    expect(isEnvelope({ from: 'sidepanel', tabId: 4, message: { type: 'DEACTIVATE' } })).toBe(true);
  });

  it('rejects anything else, since ports are a trust boundary', () => {
    for (const value of [
      null,
      undefined,
      42,
      'DEACTIVATE',
      {},
      { from: 'page', message: { type: 'DEACTIVATE' } },
      { from: 'content' },
      { from: 'content', message: {} },
      { from: 'content', message: { type: 7 } },
    ]) {
      expect(isEnvelope(value)).toBe(false);
    }
  });
});

describe('result helpers', () => {
  it('wraps values and errors', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('RESTRICTED_PAGE')).toEqual({ ok: false, error: { code: 'RESTRICTED_PAGE' } });
    expect(err('UNKNOWN', 'why')).toEqual({ ok: false, error: { code: 'UNKNOWN', detail: 'why' } });
  });

  it('has a user-facing message for every error code', () => {
    for (const [code, message] of Object.entries(USER_MESSAGES)) {
      expect(message, code).toMatch(/[a-z]/);
    }
  });

  it('assertNever throws with context when a variant is missed at runtime', () => {
    expect(() => assertNever('surprise' as never, 'test')).toThrow(/test: unhandled variant/);
  });
});
