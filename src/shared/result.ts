export type ErrorCode =
  | 'RESTRICTED_PAGE'
  | 'NO_ACTIVE_TAB'
  | 'INJECTION_FAILED'
  | 'NOT_ACTIVATED'
  | 'CONTENT_DISCONNECTED'
  | 'SNAPSHOT_FAILED'
  | 'STORAGE_FAILED'
  | 'UNKNOWN';

export type ThursdayError = {
  code: ErrorCode;
  detail?: string;
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: ThursdayError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (code: ErrorCode, detail?: string): Result<never> => ({
  ok: false,
  error: detail === undefined ? { code } : { code, detail },
});

/** Compile-time exhaustiveness guard for message switches. */
export function assertNever(value: never, context: string): never {
  throw new Error(`${context}: unhandled variant ${JSON.stringify(value)}`);
}

export const USER_MESSAGES: Record<ErrorCode, string> = {
  RESTRICTED_PAGE: 'This page cannot be audited by the extension.',
  NO_ACTIVE_TAB: 'No active tab was found.',
  INJECTION_FAILED: 'Could not start on this page. Try reloading it.',
  NOT_ACTIVATED: 'Not running on this page yet.',
  CONTENT_DISCONNECTED: 'Lost the connection to the page. Activate it again.',
  SNAPSHOT_FAILED: 'Could not read the page.',
  STORAGE_FAILED: 'Could not save locally.',
  UNKNOWN: 'Something went wrong.',
};
