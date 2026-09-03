/**
 * Ids for audits, findings and snapshots.
 *
 * `crypto.randomUUID` needs a secure context, and Thursday runs on whatever
 * page the user activates -- including plain http. So the fallback is not
 * defensive noise: it is the path taken on every insecure page.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      /* insecure context: fall through */
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
