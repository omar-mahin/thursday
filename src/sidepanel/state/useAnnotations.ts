import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnotationTarget } from '../../shared/messaging/protocol';
import type { Annotation, AnnotationAttachment } from '../../shared/types';
import { newId } from '../../shared/utils/id';
import { blobToDataUrl, dataUrlToBlob } from '../../shared/utils/base64';
import {
  attachmentsFor,
  deleteAnnotation,
  deleteAttachment,
  listAnnotations,
  saveAnnotation,
} from '../../storage/annotations';
import type { PdfImage } from '../../pdf/layout';
import { IMAGE_REFUSALS, prepareImage, toPdfImage } from '../annotate/image';

export type AnnotationsState = {
  /** Oldest first: the order they were written is the order they read in. */
  annotations: Annotation[];
  /** attachmentId -> object URL, for showing the image in the panel. */
  urls: Record<string, string>;
  busy: boolean;
  error: string | null;
  /**
   * True when comments are being kept in this panel only.
   *
   * Either history is off or the audit was never stored. Saying so is the
   * whole point: someone who writes six paragraphs of review and closes the
   * panel has to have been told those paragraphs were not on disk.
   */
  memoryOnly: boolean;
};

/**
 * Where this panel's comments come from.
 *
 * Passed as one object rather than as loose arguments so the reload key is
 * unambiguous: `openedAt` is what says "this is a fresh opening of an audit,
 * start again", exactly as it does for findings. Without it, marking an audit
 * as saved -- which changes `persisted` -- would look like a new audit and
 * wipe whatever had just been typed.
 */
export type AnnotationSource = {
  auditId: string;
  openedAt: number;
  /** Whether the audit is in history. Comments follow the audit. */
  persisted: boolean;
  /**
   * Comments that arrived inside an opened file, with their images as data
   * URLs. Null means "read whatever is in storage for this audit".
   */
  imported: { annotations: readonly Annotation[]; attachments: Record<string, string> } | null;
};

/** What the compose box hands over. */
export type NewAnnotation = {
  body: string;
  /** The element the user clicked, or null for a comment about the page. */
  target: AnnotationTarget | null;
  files: readonly File[];
  /**
   * The snapshot the anchor's element index refers to.
   *
   * Recorded with the comment so a pin can tell later whether that index is
   * still meaningful. See Annotation.snapshotId.
   */
  snapshotId: string | null;
};

const EMPTY: AnnotationsState = {
  annotations: [],
  urls: {},
  busy: false,
  error: null,
  memoryOnly: false,
};

const message = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * The user's comments on a page.
 *
 * Held here rather than in the findings reducer, and stored in their own
 * tables, because a comment is not a finding: it has no severity, no
 * confidence and no rule behind it, and the moment the two share a list
 * somebody's opinion starts being read as a measurement.
 *
 * Attachment bytes stay in IndexedDB and are surfaced as object URLs. The
 * whole map is held in memory for the session, which is what makes an export
 * work even when history is turned off -- at the cost of a few megabytes for
 * as long as the panel is open, which is the right trade for a tool that must
 * never lose what somebody typed.
 */
export function useAnnotations(source: AnnotationSource | null): AnnotationsState & {
  add(input: NewAnnotation): Promise<boolean>;
  edit(id: string, body: string): Promise<void>;
  attach(id: string, files: readonly File[]): Promise<void>;
  detach(annotationId: string, attachmentId: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** attachmentId -> data URL, for the audit file and the HTML report. */
  dataUrls(): Promise<Record<string, string>>;
  /** attachmentId -> JPEG, for the PDF. */
  pdfImages(): Promise<Record<string, PdfImage>>;
  dismissError(): void;
} {
  const [state, setState] = useState<AnnotationsState>(EMPTY);
  const blobs = useRef(new Map<string, Blob>());
  const urls = useRef(new Map<string, string>());
  const auditRef = useRef<string | null>(source?.auditId ?? null);
  auditRef.current = source?.auditId ?? null;
  const persistedRef = useRef(source?.persisted ?? false);
  persistedRef.current = source?.persisted ?? false;
  /** Read only by the loading effect, which must not depend on the whole object. */
  const sourceRef = useRef<AnnotationSource | null>(source);
  sourceRef.current = source;
  /**
   * The list, mirrored outside React state.
   *
   * Every mutation reads the current list from here rather than from a closure
   * over `state`, which is what keeps these callbacks stable: a callback that
   * changed identity on every keystroke is how the findings list came to reset
   * itself mid-note in Sprint 5, and the same shape of bug was available here.
   */
  const listRef = useRef<Annotation[]>([]);

  const mutate = useCallback((change: (list: readonly Annotation[]) => Annotation[]) => {
    const next = change(listRef.current);
    listRef.current = next;
    setState((current) => ({
      ...current,
      annotations: next,
      urls: Object.fromEntries(urls.current),
      memoryOnly: !persistedRef.current && next.length > 0,
    }));
  }, []);

  const putBlob = useCallback((id: string, blob: Blob) => {
    const previous = urls.current.get(id);
    if (previous) URL.revokeObjectURL(previous);
    blobs.current.set(id, blob);
    urls.current.set(id, URL.createObjectURL(blob));
  }, []);

  const dropBlob = useCallback((id: string) => {
    const previous = urls.current.get(id);
    if (previous) URL.revokeObjectURL(previous);
    urls.current.delete(id);
    blobs.current.delete(id);
  }, []);

  const clear = useCallback(() => {
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
    urls.current.clear();
    blobs.current.clear();
    listRef.current = [];
  }, []);

  /**
   * Loads the comments for whatever is on screen.
   *
   * Two paths, one effect: a file brings its comments with it as data URLs,
   * and anything else is read from storage. Keyed on the audit and on when it
   * was opened, never on the source object -- so this runs once per opening
   * and cannot race the adoption of an imported set.
   */
  useEffect(() => {
    let cancelled = false;
    clear();
    setState({ ...EMPTY });
    const current = sourceRef.current;
    if (!current) return () => undefined;

    if (current.imported) {
      for (const [attachmentId, dataUrl] of Object.entries(current.imported.attachments)) {
        const blob = dataUrlToBlob(dataUrl);
        if (blob) putBlob(attachmentId, blob);
      }
      mutate(() => [...(current.imported?.annotations ?? [])]);
      return () => undefined;
    }

    void (async () => {
      try {
        const [stored, images] = await Promise.all([
          listAnnotations(current.auditId),
          attachmentsFor(current.auditId),
        ]);
        if (cancelled) return;
        for (const [attachmentId, row] of images) putBlob(attachmentId, row.blob);
        mutate(() => stored);
      } catch {
        /* nothing stored, or no storage at all: the panel still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source?.auditId, source?.openedAt, clear, mutate, putBlob]);

  // Object URLs outlive the component otherwise.
  useEffect(
    () => () => {
      for (const url of urls.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );

  /**
   * Turns the files the user chose into attachments.
   *
   * A file that cannot be used is reported by name and the rest still go
   * through. Refusing the whole comment because one of four screenshots was a
   * PDF would lose the text as well, which is the part that took thought.
   */
  const intake = useCallback(
    async (
      annotationId: string,
      auditIdentifier: string,
      files: readonly File[],
      source: AnnotationAttachment['source'],
    ): Promise<{ metas: AnnotationAttachment[]; blobs: Map<string, Blob>; refusals: string[] }> => {
      const metas: AnnotationAttachment[] = [];
      const accepted = new Map<string, Blob>();
      const refusals: string[] = [];
      for (const file of files) {
        const outcome = await prepareImage(file);
        if (!outcome.ok) {
          refusals.push(`${file.name || 'That image'}: ${IMAGE_REFUSALS[outcome.reason]}`);
          continue;
        }
        const id = newId();
        metas.push({
          id,
          annotationId,
          auditId: auditIdentifier,
          mime: outcome.image.mime,
          bytes: outcome.image.bytes,
          width: outcome.image.width,
          height: outcome.image.height,
          source,
          createdAt: Date.now(),
        });
        accepted.set(id, outcome.image.blob);
      }
      return { metas, blobs: accepted, refusals };
    },
    [],
  );

  const add = useCallback(
    async (input: NewAnnotation): Promise<boolean> => {
      const auditIdentifier = auditRef.current;
      const body = input.body.trim();
      if (!auditIdentifier || !body) return false;
      setState((current) => ({ ...current, busy: true, error: null }));
      try {
        const id = newId();
        const { metas, blobs: accepted, refusals } = await intake(
          id,
          auditIdentifier,
          input.files,
          'file',
        );
        const now = Date.now();
        const annotation: Annotation = {
          id,
          auditId: auditIdentifier,
          body,
          attachments: metas,
          createdAt: now,
          updatedAt: now,
        };
        if (input.target) {
          annotation.elementRef = input.target.reference;
          annotation.documentRect = input.target.documentRect;
          // The index and the snapshot it belongs to travel together or not at
          // all: an index with no snapshot behind it is not a shortcut, it is
          // a number that happens to be in range.
          if (input.target.elementIndex !== undefined && input.snapshotId) {
            annotation.elementIndex = input.target.elementIndex;
            annotation.snapshotId = input.snapshotId;
          }
        }
        for (const [attachmentId, blob] of accepted) putBlob(attachmentId, blob);
        if (persistedRef.current) await saveAnnotation(annotation, accepted);
        mutate((list) => [...list, annotation]);
        setState((current) => ({
          ...current,
          busy: false,
          error: refusals.length > 0 ? refusals.join(' ') : null,
        }));
        return true;
      } catch (error) {
        setState((current) => ({
          ...current,
          busy: false,
          error: message(error, 'That comment could not be saved.'),
        }));
        return false;
      }
    },
    [intake, mutate, putBlob],
  );

  const edit = useCallback(
    async (id: string, body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      mutate((list) =>
        list.map((annotation) =>
          annotation.id === id ? { ...annotation, body: trimmed, updatedAt: Date.now() } : annotation,
        ),
      );
      const target = listRef.current.find((annotation) => annotation.id === id);
      if (!target || !persistedRef.current) return;
      try {
        await saveAnnotation(target, new Map());
      } catch (error) {
        setState((current) => ({
          ...current,
          error: message(error, 'That edit is in the panel but could not be saved.'),
        }));
      }
    },
    [mutate],
  );

  const attach = useCallback(
    async (id: string, files: readonly File[]) => {
      const auditIdentifier = auditRef.current;
      const existing = listRef.current.find((annotation) => annotation.id === id);
      if (!auditIdentifier || !existing || files.length === 0) return;
      setState((current) => ({ ...current, busy: true, error: null }));
      const { metas, blobs: accepted, refusals } = await intake(id, auditIdentifier, files, 'file');
      for (const [attachmentId, blob] of accepted) putBlob(attachmentId, blob);
      const updated: Annotation = {
        ...existing,
        attachments: [...existing.attachments, ...metas],
        updatedAt: Date.now(),
      };
      mutate((list) => list.map((annotation) => (annotation.id === id ? updated : annotation)));
      setState((current) => ({
        ...current,
        busy: false,
        error: refusals.length > 0 ? refusals.join(' ') : null,
      }));
      if (!persistedRef.current) return;
      try {
        await saveAnnotation(updated, accepted);
      } catch (error) {
        setState((current) => ({
          ...current,
          error: message(error, 'That image is in the panel but could not be saved.'),
        }));
      }
    },
    [intake, mutate, putBlob],
  );

  const detach = useCallback(
    async (annotationId: string, attachmentId: string) => {
      dropBlob(attachmentId);
      mutate((list) =>
        list.map((annotation) =>
          annotation.id === annotationId
            ? {
                ...annotation,
                attachments: annotation.attachments.filter((meta) => meta.id !== attachmentId),
                updatedAt: Date.now(),
              }
            : annotation,
        ),
      );
      await deleteAttachment(annotationId, attachmentId).catch(() => {
        /* nothing stored: removing it from the panel was the whole job */
      });
    },
    [dropBlob, mutate],
  );

  const remove = useCallback(
    async (id: string) => {
      const going = listRef.current.find((annotation) => annotation.id === id);
      for (const meta of going?.attachments ?? []) dropBlob(meta.id);
      mutate((list) => list.filter((annotation) => annotation.id !== id));
      await deleteAnnotation(id).catch(() => {
        /* nothing stored: removing it from the panel was the whole job */
      });
    },
    [dropBlob, mutate],
  );

  const dataUrls = useCallback(async (): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const [id, blob] of blobs.current) {
      try {
        out[id] = await blobToDataUrl(blob);
      } catch {
        /* an image that will not re-read is left out rather than exported broken */
      }
    }
    return out;
  }, []);

  const pdfImages = useCallback(async (): Promise<Record<string, PdfImage>> => {
    const out: Record<string, PdfImage> = {};
    for (const [id, blob] of blobs.current) {
      const image = await toPdfImage(blob);
      if (image) out[id] = image;
    }
    return out;
  }, []);

  const dismissError = useCallback(() => {
    setState((current) => ({ ...current, error: null }));
  }, []);

  return { ...state, add, edit, attach, detach, remove, dataUrls, pdfImages, dismissError };
}
