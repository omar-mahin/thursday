import type { Annotation, AnnotationAttachment } from '../shared/types';
import {
  requestAsPromise,
  STORE_ANNOTATIONS,
  STORE_ATTACHMENTS,
  transact,
} from './db';

/**
 * Comments and their attached images.
 *
 * Two stores rather than one record: the metadata a list needs is a few
 * hundred bytes, and the images are megabytes. Keeping them apart means the
 * comments card renders from one small read, and an image is paged in only
 * when something is actually going to show it.
 */

/** An attachment plus its bytes. Read one at a time, deliberately. */
export type StoredAttachment = AnnotationAttachment & { blob: Blob };

/**
 * Writes a comment and its attachments together.
 *
 * One transaction for the same reason an audit and its findings share one: a
 * comment whose images failed to write is a comment that silently lost the
 * evidence the user attached, and they would have no way to tell until they
 * opened the report.
 */
export async function saveAnnotation(
  annotation: Annotation,
  blobs: ReadonlyMap<string, Blob>,
): Promise<void> {
  await transact([STORE_ANNOTATIONS, STORE_ATTACHMENTS], 'readwrite', (transaction) => {
    transaction.objectStore(STORE_ANNOTATIONS).put(annotation);
    const attachments = transaction.objectStore(STORE_ATTACHMENTS);
    for (const meta of annotation.attachments) {
      const blob = blobs.get(meta.id);
      // An attachment with no bytes to write is left alone rather than stored
      // as a broken row: this is the path taken when only the body was edited.
      if (blob) attachments.put({ ...meta, blob });
    }
  });
}

/** Just the text and metadata. Ordered oldest first, as they were written. */
export async function listAnnotations(auditId: string): Promise<Annotation[]> {
  return transact(STORE_ANNOTATIONS, 'readonly', async (transaction) => {
    const rows = await requestAsPromise(
      transaction.objectStore(STORE_ANNOTATIONS).index('auditId').getAll(auditId) as IDBRequest<Annotation[]>,
    );
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  });
}

/** Every attachment for one audit, for an export. Keyed by attachment id. */
export async function attachmentsFor(auditId: string): Promise<Map<string, StoredAttachment>> {
  return transact(STORE_ATTACHMENTS, 'readonly', async (transaction) => {
    const rows = await requestAsPromise(
      transaction.objectStore(STORE_ATTACHMENTS).index('auditId').getAll(auditId) as IDBRequest<
        StoredAttachment[]
      >,
    );
    return new Map(rows.map((row) => [row.id, row]));
  });
}

export async function deleteAnnotation(id: string): Promise<void> {
  await transact([STORE_ANNOTATIONS, STORE_ATTACHMENTS], 'readwrite', async (transaction) => {
    transaction.objectStore(STORE_ANNOTATIONS).delete(id);
    const attachments = transaction.objectStore(STORE_ATTACHMENTS);
    const ids = await requestAsPromise(
      attachments.index('annotationId').getAllKeys(id) as IDBRequest<IDBValidKey[]>,
    );
    for (const attachmentId of ids) attachments.delete(attachmentId);
  });
}

/** Removes one image from a comment, leaving the comment itself. */
export async function deleteAttachment(annotationId: string, attachmentId: string): Promise<void> {
  await transact([STORE_ANNOTATIONS, STORE_ATTACHMENTS], 'readwrite', async (transaction) => {
    transaction.objectStore(STORE_ATTACHMENTS).delete(attachmentId);
    const store = transaction.objectStore(STORE_ANNOTATIONS);
    const annotation = await requestAsPromise(
      store.get(annotationId) as IDBRequest<Annotation | undefined>,
    );
    if (!annotation) return;
    store.put({
      ...annotation,
      attachments: annotation.attachments.filter((meta) => meta.id !== attachmentId),
      updatedAt: Date.now(),
    });
  });
}

/** Deletes every comment under one audit. Called when the audit goes. */
export async function deleteAnnotationsFor(auditId: string): Promise<void> {
  await transact([STORE_ANNOTATIONS, STORE_ATTACHMENTS], 'readwrite', async (transaction) => {
    const annotations = transaction.objectStore(STORE_ANNOTATIONS);
    const ids = await requestAsPromise(
      annotations.index('auditId').getAllKeys(auditId) as IDBRequest<IDBValidKey[]>,
    );
    for (const id of ids) annotations.delete(id);
    const attachments = transaction.objectStore(STORE_ATTACHMENTS);
    const attachmentIds = await requestAsPromise(
      attachments.index('auditId').getAllKeys(auditId) as IDBRequest<IDBValidKey[]>,
    );
    for (const id of attachmentIds) attachments.delete(id);
  });
}

/**
 * Moves every comment from one audit to another.
 *
 * Called when a fresh audit supersedes one for the same page, and it exists
 * because the alternative is data loss the user cannot see coming: writing six
 * paragraphs of review, re-running the audit to check a fix, and finding the
 * review gone. A comment is a note about the page, not about one run over it.
 *
 * Moved rather than copied. Copying would leave the previous audit's history
 * row showing what was written at the time -- which is arguably nicer -- but
 * every copy duplicates the attached images, and six re-audits of a page with
 * five screenshots on it is thirty copies of the same pictures in IndexedDB.
 * The findings' own notes and statuses are still frozen on the old audit,
 * which is where a record of what was thought then belongs.
 *
 * The element indexes travel unchanged, and are deliberately not remapped:
 * they refer to a snapshot that is now gone, `Annotation.snapshotId` says so,
 * and the pin is placed by searching the live page instead.
 */
export async function carryComments(fromAuditId: string, toAuditId: string): Promise<number> {
  if (fromAuditId === toAuditId) return 0;
  return transact([STORE_ANNOTATIONS, STORE_ATTACHMENTS], 'readwrite', async (transaction) => {
    const annotations = transaction.objectStore(STORE_ANNOTATIONS);
    const moving = await requestAsPromise(
      annotations.index('auditId').getAll(fromAuditId) as IDBRequest<Annotation[]>,
    );
    if (moving.length === 0) return 0;

    const attachments = transaction.objectStore(STORE_ATTACHMENTS);
    const rows = await requestAsPromise(
      attachments.index('auditId').getAll(fromAuditId) as IDBRequest<StoredAttachment[]>,
    );
    for (const row of rows) attachments.put({ ...row, auditId: toAuditId });

    for (const annotation of moving) {
      annotations.put({
        ...annotation,
        auditId: toAuditId,
        attachments: annotation.attachments.map((meta) => ({ ...meta, auditId: toAuditId })),
      });
    }
    return moving.length;
  });
}
