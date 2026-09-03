import { useCallback, useEffect, useRef, useState } from 'react';
import type { ElementRectReply, ThursdayMessage } from '../../shared/messaging/protocol';
import type { Finding } from '../../shared/types';
import { deleteScreenshot, putScreenshot, screenshotsFor } from '../../storage/audits';
import { getSetting } from '../../storage/settings';
import { blobToDataUrl } from '../../shared/utils/base64';
import { cropCapture } from '../capture/crop';

export type ShotState = {
  /** findingId -> object URL, for showing the crop in the panel. */
  urls: Record<string, string>;
  enabled: boolean;
  /** The finding a capture is in flight for. */
  pending: string | null;
  error: string | null;
};

const REFUSALS: Record<string, string> = {
  notFound: 'That element is not on the page any more, so there is nothing to photograph.',
  sensitive:
    'That element is (or contains) a password, payment or similar field. Thursday will not photograph it.',
  hidden: 'Bring the audited tab to the front and try again — a capture photographs the visible tab.',
  offscreen: 'That element is outside the part of the page the browser captured. Scroll it into view and try again.',
  mismatch:
    'The capture came back showing a different tab. Bring the audited tab to the front and try again.',
  decode: 'The capture could not be decoded.',
  encode: 'The crop could not be encoded.',
  denied: 'Chrome refused the capture. Reactivate Thursday on this tab and try again.',
};

/**
 * Screenshot crops of individual findings.
 *
 * Off unless the user turns it on, because this is the one feature that puts a
 * picture of the page into storage -- everything else Thursday keeps is
 * measurements and text it has already redacted. The page decides whether an
 * element is safe to photograph (it is the only side that can see the DOM), and
 * refusals are shown as refusals rather than as failures.
 *
 * Crops are held in memory for the session and written to IndexedDB alongside
 * the audit, so an export works even when history is turned off.
 */
export function useScreenshots(
  auditId: string | null,
  send: (message: ThursdayMessage) => void,
  reply: (ElementRectReply & { at: number }) | null,
): ShotState & {
  capture(finding: Finding): void;
  discard(findingId: string): void;
  has(findingId: string): boolean;
  /** findingId -> data URL, for the audit file and the HTML report. */
  dataUrls(): Promise<Record<string, string>>;
  reload(): void;
} {
  const [state, setState] = useState<ShotState>({ urls: {}, enabled: false, pending: null, error: null });
  const blobs = useRef(new Map<string, Blob>());
  const urls = useRef(new Map<string, string>());
  const auditRef = useRef<string | null>(auditId);
  auditRef.current = auditId;
  const handledReply = useRef(0);

  useEffect(() => {
    void getSetting('captureScreenshots').then((enabled) =>
      setState((current) => ({ ...current, enabled })),
    );
  }, []);

  const publish = useCallback((findingId: string, blob: Blob | null) => {
    const previous = urls.current.get(findingId);
    if (previous) URL.revokeObjectURL(previous);
    if (!blob) {
      blobs.current.delete(findingId);
      urls.current.delete(findingId);
    } else {
      blobs.current.set(findingId, blob);
      urls.current.set(findingId, URL.createObjectURL(blob));
    }
    setState((current) => ({ ...current, urls: Object.fromEntries(urls.current) }));
  }, []);

  const reset = useCallback(() => {
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
    urls.current.clear();
    blobs.current.clear();
    setState((current) => ({ ...current, urls: {}, pending: null, error: null }));
  }, []);

  const reload = useCallback(() => {
    const id = auditRef.current;
    reset();
    if (!id) return;
    void screenshotsFor(id)
      .then((stored) => {
        for (const [findingId, blob] of stored) {
          blobs.current.set(findingId, blob);
          urls.current.set(findingId, URL.createObjectURL(blob));
        }
        setState((current) => ({ ...current, urls: Object.fromEntries(urls.current) }));
      })
      .catch(() => {
        /* no stored crops, or no storage: the panel works either way */
      });
  }, [reset]);

  // A different audit means different crops.
  useEffect(reload, [auditId, reload]);

  // Revoke on unmount: object URLs outlive the component otherwise.
  useEffect(
    () => () => {
      for (const url of urls.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );

  const fail = useCallback((reason: keyof typeof REFUSALS | string) => {
    setState((current) => ({ ...current, pending: null, error: REFUSALS[reason] ?? reason }));
  }, []);

  const capture = useCallback(
    (finding: Finding) => {
      if (!finding.elementRef) return;
      setState((current) => ({ ...current, pending: finding.id, error: null }));
      send({ type: 'REQUEST_ELEMENT_RECT', payload: { findingId: finding.id, ref: finding.elementRef } });
    },
    [send],
  );

  // The page has measured the element; take the picture.
  useEffect(() => {
    if (!reply || reply.at === handledReply.current) return;
    if (state.pending !== reply.findingId) return;
    handledReply.current = reply.at;
    const findingId = reply.findingId;

    void (async () => {
      if (reply.sensitive) {
        fail('sensitive');
        return;
      }
      if (!reply.rect) {
        fail('notFound');
        return;
      }
      if (!reply.pageVisible) {
        fail('hidden');
        return;
      }
      let dataUrl: string | undefined;
      try {
        dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
      } catch {
        fail('denied');
        return;
      }
      if (!dataUrl) {
        fail('denied');
        return;
      }
      const result = await cropCapture(dataUrl, reply.rect, reply.viewport, reply.devicePixelRatio);
      if (!result.ok) {
        fail(result.reason);
        return;
      }
      publish(findingId, result.blob);
      setState((current) => ({ ...current, pending: null, error: null }));
      const id = auditRef.current;
      if (id) {
        await putScreenshot(id, findingId, result.blob).catch(() => {
          setState((current) => ({
            ...current,
            error: 'The crop is in this panel but could not be saved to history.',
          }));
        });
      }
    })();
  }, [fail, publish, reply, state.pending]);

  const discard = useCallback(
    (findingId: string) => {
      publish(findingId, null);
      void deleteScreenshot(findingId).catch(() => {
        /* nothing stored: removing it from the panel is the whole job */
      });
    },
    [publish],
  );

  const has = useCallback((findingId: string) => blobs.current.has(findingId), []);

  const dataUrls = useCallback(async (): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const [findingId, blob] of blobs.current) {
      try {
        out[findingId] = await blobToDataUrl(blob);
      } catch {
        /* a crop that will not re-read is left out rather than exported broken */
      }
    }
    return out;
  }, []);

  return { ...state, capture, discard, has, dataUrls, reload };
}
