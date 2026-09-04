import type { Audit, AuditRecord, Finding, FindingStatus, PageSnapshotDigest } from '../shared/types';
import { STORAGE_KEY_PREFIX } from '../shared/constants/product';
import {
  database,
  requestAsPromise,
  STORE_ANNOTATIONS,
  STORE_ATTACHMENTS,
  STORE_AUDITS,
  STORE_BLOBS,
  STORE_FINDINGS,
  transact,
} from './db';

/** An audit and its findings, as stored and as reopened. */
export type StoredAudit = {
  audit: Audit;
  digest: PageSnapshotDigest;
  findings: Finding[];
};

/** Enough to draw a history row without loading any findings. */
export type AuditSummary = {
  id: string;
  url: string;
  origin: string;
  title: string;
  createdAt: number;
  findingCount: number;
  categories: Audit['categories'];
  truncated: boolean;
};

type BlobRecord = { findingId: string; auditId: string; blob: Blob };

const toRecord = (audit: Audit, digest: PageSnapshotDigest): AuditRecord => ({ ...audit, digest });

const toSummary = (record: AuditRecord): AuditSummary => ({
  id: record.id,
  url: record.url,
  origin: record.origin,
  title: record.title,
  createdAt: record.createdAt,
  findingCount: record.findingIds.length,
  categories: record.categories,
  truncated: record.truncated,
});

/**
 * Writes an audit and every one of its findings in a single transaction.
 *
 * Half-written history is worse than none: an audit row whose findings failed
 * to write would open as an audit that found nothing, which is a lie the user
 * has no way to detect.
 */
export async function saveAudit(stored: StoredAudit): Promise<void> {
  await transact([STORE_AUDITS, STORE_FINDINGS], 'readwrite', (transaction) => {
    transaction.objectStore(STORE_AUDITS).put(toRecord(stored.audit, stored.digest));
    const findings = transaction.objectStore(STORE_FINDINGS);
    for (const finding of stored.findings) findings.put(finding);
  });
}

export async function listAudits(origin?: string): Promise<AuditSummary[]> {
  return transact(STORE_AUDITS, 'readonly', async (transaction) => {
    const store = transaction.objectStore(STORE_AUDITS);
    const records =
      origin === undefined
        ? await requestAsPromise(store.getAll() as IDBRequest<AuditRecord[]>)
        : await requestAsPromise(store.index('origin').getAll(origin) as IDBRequest<AuditRecord[]>);
    return records.map(toSummary).sort((a, b) => b.createdAt - a.createdAt);
  });
}

export async function getAudit(id: string): Promise<StoredAudit | null> {
  return transact([STORE_AUDITS, STORE_FINDINGS], 'readonly', async (transaction) => {
    const record = await requestAsPromise(
      transaction.objectStore(STORE_AUDITS).get(id) as IDBRequest<AuditRecord | undefined>,
    );
    if (!record) return null;
    const findings = await requestAsPromise(
      transaction.objectStore(STORE_FINDINGS).index('auditId').getAll(id) as IDBRequest<Finding[]>,
    );
    const { digest, ...audit } = record;
    // Stored order is by key, not by severity: restore the order the audit had.
    const rank = new Map(record.findingIds.map((findingId, position) => [findingId, position]));
    findings.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
    return { audit, digest, findings };
  });
}

/** Persists the parts of a finding the user owns. Nothing else is rewritten. */
export async function updateFinding(
  id: string,
  patch: { status?: FindingStatus; note?: string; inReport?: boolean },
): Promise<void> {
  await transact(STORE_FINDINGS, 'readwrite', async (transaction) => {
    const store = transaction.objectStore(STORE_FINDINGS);
    const existing = await requestAsPromise(store.get(id) as IDBRequest<Finding | undefined>);
    // An audit the user chose not to keep has no row here. Silently doing
    // nothing is right: the annotation lives in the panel either way.
    if (!existing) return;
    store.put({ ...existing, ...patch, updatedAt: Date.now() });
  });
}

/**
 * Deletes an audit and everything hanging off it.
 *
 * One transaction across all five stores, so "delete this audit" cannot leave
 * orphaned comments or attachments behind. Orphans would be invisible in the
 * panel and still counted in the storage figures on the options page, which is
 * the worst of both: space the user cannot see and cannot reclaim.
 */
export async function deleteAudit(id: string): Promise<void> {
  await transact(
    [STORE_AUDITS, STORE_FINDINGS, STORE_BLOBS, STORE_ANNOTATIONS, STORE_ATTACHMENTS],
    'readwrite',
    async (transaction) => {
      transaction.objectStore(STORE_AUDITS).delete(id);
      const findings = transaction.objectStore(STORE_FINDINGS);
      const ids = await requestAsPromise(
        findings.index('auditId').getAllKeys(id) as IDBRequest<IDBValidKey[]>,
      );
      const blobs = transaction.objectStore(STORE_BLOBS);
      for (const findingId of ids) {
        findings.delete(findingId);
        blobs.delete(findingId);
      }

      const annotations = transaction.objectStore(STORE_ANNOTATIONS);
      for (const annotationId of await requestAsPromise(
        annotations.index('auditId').getAllKeys(id) as IDBRequest<IDBValidKey[]>,
      )) {
        annotations.delete(annotationId);
      }
      const attachments = transaction.objectStore(STORE_ATTACHMENTS);
      for (const attachmentId of await requestAsPromise(
        attachments.index('auditId').getAllKeys(id) as IDBRequest<IDBValidKey[]>,
      )) {
        attachments.delete(attachmentId);
      }
    },
  );
}

/** Deletes every audit for one origin. Returns how many went. */
export async function deleteByOrigin(origin: string): Promise<number> {
  const summaries = await listAudits(origin);
  for (const summary of summaries) await deleteAudit(summary.id);
  return summaries.length;
}

/**
 * The key that says everything was cleared, and when.
 *
 * A clear can be asked for from the options page while the side panel is
 * mid-sweep, photographing findings in another tab. The panel cannot see the
 * clear -- it is a different document -- so it carried on writing pictures into
 * the database the user had just emptied. Measured: two blobs back afterwards.
 *
 * chrome.storage is the one thing both documents can watch, so the clear
 * announces itself here and anything writing stops when it sees this change.
 */
export const CLEARED_AT_KEY = `${STORAGE_KEY_PREFIX}clearedAt`;

export async function clearAll(): Promise<void> {
  await transact(
    [STORE_AUDITS, STORE_FINDINGS, STORE_BLOBS, STORE_ANNOTATIONS, STORE_ATTACHMENTS],
    'readwrite',
    (transaction) => {
      transaction.objectStore(STORE_AUDITS).clear();
      transaction.objectStore(STORE_FINDINGS).clear();
      transaction.objectStore(STORE_BLOBS).clear();
      transaction.objectStore(STORE_ANNOTATIONS).clear();
      transaction.objectStore(STORE_ATTACHMENTS).clear();
    },
  );
  // Announced after the fact, so nobody stops writing on the strength of a
  // clear that then failed.
  try {
    await chrome.storage.local.set({ [CLEARED_AT_KEY]: Date.now() });
  } catch {
    /* the database is empty either way; this only tells other documents */
  }
}

export async function putScreenshot(auditId: string, findingId: string, blob: Blob): Promise<void> {
  await transact(STORE_BLOBS, 'readwrite', (transaction) => {
    transaction.objectStore(STORE_BLOBS).put({ findingId, auditId, blob } satisfies BlobRecord);
  });
}

export async function getScreenshot(findingId: string): Promise<Blob | null> {
  return transact(STORE_BLOBS, 'readonly', async (transaction) => {
    const record = await requestAsPromise(
      transaction.objectStore(STORE_BLOBS).get(findingId) as IDBRequest<BlobRecord | undefined>,
    );
    return record?.blob ?? null;
  });
}

export async function deleteScreenshot(findingId: string): Promise<void> {
  await transact(STORE_BLOBS, 'readwrite', (transaction) => {
    transaction.objectStore(STORE_BLOBS).delete(findingId);
  });
}

/** Every crop for one audit, for the file export and the HTML report. */
export async function screenshotsFor(auditId: string): Promise<Map<string, Blob>> {
  return transact(STORE_BLOBS, 'readonly', async (transaction) => {
    const records = await requestAsPromise(
      transaction.objectStore(STORE_BLOBS).getAll() as IDBRequest<BlobRecord[]>,
    );
    return new Map(records.filter((record) => record.auditId === auditId).map((r) => [r.findingId, r.blob]));
  });
}

export type StorageUsage = {
  audits: number;
  findings: number;
  screenshots: number;
  comments: number;
  /** Images attached to comments. Counted separately from finding crops,
   *  because the user chose to add these and can point at each one. */
  attachments: number;
  /** Bytes, from the Storage API. Null when the browser will not say. */
  bytes: number | null;
  /** Distinct origins with stored audits, newest first. */
  origins: Array<{ origin: string; audits: number; lastAudit: number }>;
};

/**
 * What is on disk, for the options page.
 *
 * The byte figure comes from `navigator.storage.estimate()` and covers the
 * whole extension origin, so it is reported as such rather than passed off as
 * an exact size for Thursday's own rows.
 */
export async function usage(): Promise<StorageUsage> {
  const summaries = await listAudits();
  const byOrigin = new Map<string, { origin: string; audits: number; lastAudit: number }>();
  for (const summary of summaries) {
    const entry = byOrigin.get(summary.origin) ?? { origin: summary.origin, audits: 0, lastAudit: 0 };
    entry.audits += 1;
    entry.lastAudit = Math.max(entry.lastAudit, summary.createdAt);
    byOrigin.set(summary.origin, entry);
  }

  const [findings, screenshots, comments, attachments] = await transact(
    [STORE_FINDINGS, STORE_BLOBS, STORE_ANNOTATIONS, STORE_ATTACHMENTS],
    'readonly',
    async (transaction) =>
      Promise.all([
        requestAsPromise(transaction.objectStore(STORE_FINDINGS).count()),
        requestAsPromise(transaction.objectStore(STORE_BLOBS).count()),
        requestAsPromise(transaction.objectStore(STORE_ANNOTATIONS).count()),
        requestAsPromise(transaction.objectStore(STORE_ATTACHMENTS).count()),
      ]),
  );

  let bytes: number | null = null;
  try {
    const estimate = await navigator.storage?.estimate?.();
    bytes = estimate?.usage ?? null;
  } catch {
    /* the browser is entitled to decline */
  }

  return {
    audits: summaries.length,
    findings,
    screenshots,
    comments,
    attachments,
    bytes,
    origins: [...byOrigin.values()].sort((a, b) => b.lastAudit - a.lastAudit),
  };
}

/** True when IndexedDB is usable at all. Private windows can refuse it. */
export async function storageAvailable(): Promise<boolean> {
  try {
    await database();
    return true;
  } catch {
    return false;
  }
}
