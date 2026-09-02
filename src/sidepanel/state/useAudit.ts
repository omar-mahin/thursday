import { useCallback, useEffect, useRef, useState } from 'react';
import { runAudit, type AuditResult } from '../../audit/engine/run';
import { ALL_CATEGORIES } from '../../audit/engine/registry';
import { DEFAULT_AUDIT_SETTINGS } from '../../audit/types';
import type { AuditCategory, AuditSettings, PageSnapshot } from '../../shared/types';
import type { ThursdayMessage } from '../../shared/messaging/protocol';
import { getSetting } from '../../storage/settings';

export type AuditState = {
  running: boolean;
  result: AuditResult | null;
  categories: AuditCategory[];
  error: string | null;
};

/**
 * Runs the audit in the panel: ask the page for a snapshot, then evaluate the
 * rules here. The rules never touch the DOM, so this is the same code path the
 * tests exercise in Node (PLAN.md section 2.2).
 */
export function useAudit(
  snapshot: PageSnapshot | null,
  send: (message: ThursdayMessage) => void,
): AuditState & { start(categories?: AuditCategory[]): void; clear(): void } {
  const [state, setState] = useState<AuditState>({
    running: false,
    result: null,
    categories: [...ALL_CATEGORIES],
    error: null,
  });
  const [settings, setSettings] = useState<AuditSettings>(DEFAULT_AUDIT_SETTINGS);
  const pending = useRef<AuditCategory[] | null>(null);
  const lastSnapshot = useRef<PageSnapshot | null>(null);

  useEffect(() => {
    void getSetting('minTouchTarget').then((minTouchTarget) =>
      setSettings((current) => ({ ...current, minTouchTarget })),
    );
  }, []);

  useEffect(() => {
    if (!snapshot || snapshot === lastSnapshot.current) return;
    lastSnapshot.current = snapshot;
    const categories = pending.current;
    if (!categories) return;
    pending.current = null;
    try {
      const result = runAudit(snapshot, { categories, settings });
      setState({ running: false, result, categories, error: null });
    } catch (error) {
      setState((current) => ({
        ...current,
        running: false,
        error: error instanceof Error ? error.message : 'The audit could not be completed.',
      }));
    }
  }, [settings, snapshot]);

  const start = useCallback(
    (categories: AuditCategory[] = [...ALL_CATEGORIES]) => {
      pending.current = categories;
      setState({ running: true, result: null, categories, error: null });
      send({ type: 'REQUEST_SNAPSHOT', payload: { includeOffscreen: true } });
    },
    [send],
  );

  const clear = useCallback(() => {
    pending.current = null;
    setState({ running: false, result: null, categories: [...ALL_CATEGORIES], error: null });
  }, []);

  return { ...state, start, clear };
}
