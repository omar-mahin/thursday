import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, Audit, Finding, PageSnapshotDigest } from '../../shared/types';
import {
  clearAll,
  deleteAudit,
  deleteByOrigin,
  getAudit,
  listAudits,
  saveAudit,
  storageAvailable,
  updateFinding,
  type AuditSummary,
} from '../../storage/audits';
import { getSetting } from '../../storage/settings';
import { parseAuditFile } from '../../storage/file';

/** Whatever the panel is currently showing, wherever it came from. */
export type ActiveAudit = {
  source: 'live' | 'stored' | 'file';
  audit: Audit;
  digest: PageSnapshotDigest;
  findings: Finding[];
  /**
   * Comments that came in with an opened file.
   *
   * Only ever set for `source: 'file'`. A live or stored audit reads its
   * comments from IndexedDB instead, so carrying them here would be a second
   * copy that could disagree with the first.
   */
  annotations?: Annotation[];
  /** attachmentId -> data URL, alongside `annotations`. */
  attachments?: Record<string, string>;
  /** Live runs only. */
  suppressed: number;
  failedRules: string[];
  /** True once this audit exists in IndexedDB. */
  persisted: boolean;
  /**
   * When this audit was put on screen. Distinct from `audit.id`, so reopening
   * the same stored audit reloads it -- discarding unsaved edits deliberately
   * rather than appearing to ignore the click.
   */
  openedAt: number;
};

export type LibraryState = {
  /** False when IndexedDB is unavailable -- some private windows refuse it. */
  available: boolean;
  keepHistory: boolean;
  history: AuditSummary[];
  busy: boolean;
  /** A one-line confirmation of the last thing that happened. */
  status: string | null;
  error: string | null;
  /** Repairs made while reading a file. Reported, never swallowed. */
  warnings: string[];
};

const INITIAL: LibraryState = {
  available: true,
  keepHistory: true,
  history: [],
  busy: false,
  status: null,
  error: null,
  warnings: [],
};

const message = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * The audit library: history in IndexedDB, and files on disk.
 *
 * Persistence is deliberately not silent about failing. If the browser refuses
 * storage -- which a private window is entitled to do -- the panel says so and
 * keeps working in memory, because losing an audit is better than pretending
 * one was saved.
 */
export function useLibrary(origin: string | null): {
  state: LibraryState;
  refresh(): void;
  persist(active: ActiveAudit): Promise<boolean>;
  annotate(id: string, patch: { status?: Finding['status']; note?: string; inReport?: boolean }): void;
  open(id: string): Promise<ActiveAudit | null>;
  importText(text: string): Promise<ActiveAudit | null>;
  remove(id: string): Promise<void>;
  removeOrigin(origin: string): Promise<void>;
  wipe(): Promise<void>;
  note(status: string): void;
  dismissMessages(): void;
} {
  const [state, setState] = useState<LibraryState>(INITIAL);
  const originRef = useRef<string | null>(origin);
  originRef.current = origin;

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const available = await storageAvailable();
        const keepHistory = await getSetting('keepHistory');
        if (!available) {
          setState((current) => ({ ...current, available: false, keepHistory, history: [] }));
          return;
        }
        const history = await listAudits(originRef.current ?? undefined);
        setState((current) => ({ ...current, available: true, keepHistory, history }));
      } catch (error) {
        setState((current) => ({
          ...current,
          available: false,
          error: message(error, 'Local storage could not be opened.'),
        }));
      }
    })();
  }, []);

  useEffect(refresh, [refresh, origin]);

  const persist = useCallback(
    async (active: ActiveAudit): Promise<boolean> => {
      const keepHistory = await getSetting('keepHistory');
      setState((current) => ({ ...current, keepHistory }));
      if (!keepHistory) return false;
      try {
        await saveAudit({ audit: active.audit, digest: active.digest, findings: active.findings });
        refresh();
        return true;
      } catch (error) {
        setState((current) => ({ ...current, error: message(error, 'This audit could not be saved locally.') }));
        return false;
      }
    },
    [refresh],
  );

  /**
   * Writes one annotation through. Fire-and-forget on purpose: typing a note
   * must not wait on a disk write, and a failure here does not lose the note
   * from the panel -- only from history.
   */
  const annotate = useCallback(
    (id: string, patch: { status?: Finding['status']; note?: string; inReport?: boolean }) => {
      void updateFinding(id, patch).catch(() => {
        setState((current) =>
          current.error ? current : { ...current, error: 'A change could not be saved to history.' },
        );
      });
    },
    [],
  );

  const open = useCallback(async (id: string): Promise<ActiveAudit | null> => {
    setState((current) => ({ ...current, busy: true, error: null, warnings: [] }));
    try {
      const stored = await getAudit(id);
      if (!stored) {
        setState((current) => ({ ...current, busy: false, error: 'That audit is no longer stored.' }));
        return null;
      }
      setState((current) => ({
        ...current,
        busy: false,
        status: `Reopened the audit from ${new Date(stored.audit.createdAt).toLocaleString()}.`,
      }));
      return {
        source: 'stored',
        audit: stored.audit,
        digest: stored.digest,
        findings: stored.findings,
        suppressed: 0,
        failedRules: [],
        persisted: true,
        openedAt: Date.now(),
      };
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: message(error, 'That audit could not be read.') }));
      return null;
    }
  }, []);

  const importText = useCallback(
    async (text: string): Promise<ActiveAudit | null> => {
      setState((current) => ({ ...current, busy: true, error: null, warnings: [], status: null }));
      const outcome = parseAuditFile(text);
      if (!outcome.ok) {
        setState((current) => ({ ...current, busy: false, error: outcome.error }));
        return null;
      }
      const { file, warnings } = outcome.value;
      const active: ActiveAudit = {
        source: 'file',
        audit: file.audit,
        digest: file.digest,
        findings: file.findings,
        annotations: file.annotations ?? [],
        attachments: file.attachments ?? {},
        suppressed: 0,
        failedRules: [],
        persisted: false,
        openedAt: Date.now(),
      };
      const comments = file.annotations?.length ?? 0;
      setState((current) => ({
        ...current,
        busy: false,
        warnings,
        status: `Opened ${file.findings.length} finding${file.findings.length === 1 ? '' : 's'}${
          comments > 0 ? ` and ${comments} comment${comments === 1 ? '' : 's'}` : ''
        } from ${file.page.title || file.page.url || 'a file'}.`,
      }));
      return active;
    },
    [],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteAudit(id);
        setState((current) => ({ ...current, status: 'Audit deleted.' }));
        refresh();
      } catch (error) {
        setState((current) => ({ ...current, error: message(error, 'That audit could not be deleted.') }));
      }
    },
    [refresh],
  );

  const removeOrigin = useCallback(
    async (target: string) => {
      try {
        const count = await deleteByOrigin(target);
        setState((current) => ({
          ...current,
          status: `Deleted ${count} audit${count === 1 ? '' : 's'} for ${target}.`,
        }));
        refresh();
      } catch (error) {
        setState((current) => ({ ...current, error: message(error, 'Those audits could not be deleted.') }));
      }
    },
    [refresh],
  );

  const wipe = useCallback(async () => {
    try {
      await clearAll();
      setState((current) => ({ ...current, status: 'All stored audits deleted.' }));
      refresh();
    } catch (error) {
      setState((current) => ({ ...current, error: message(error, 'Stored audits could not be deleted.') }));
    }
  }, [refresh]);

  const note = useCallback((status: string) => {
    setState((current) => ({ ...current, status, error: null }));
  }, []);

  const dismissMessages = useCallback(() => {
    setState((current) => ({ ...current, status: null, error: null, warnings: [] }));
  }, []);

  return { state, refresh, persist, annotate, open, importText, remove, removeOrigin, wipe, note, dismissMessages };
}
