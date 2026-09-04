import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaptureBandReply, ElementRectReply, ThursdayMessage } from '../../shared/messaging/protocol';
import type { Finding, PageSnapshot, Severity } from '../../shared/types';
import { SEVERITY_HEX } from '../../shared/constants/severity';
import {
  composeShot,
  decodeCapture,
  type ComposeInput,
  type ComposeResult,
} from '../capture/compose';
import { BAND_MARGIN, planCapture } from '../capture/plan';
import { CLEARED_AT_KEY, deleteScreenshot, putScreenshot, screenshotsFor } from '../../storage/audits';
import { getSetting } from '../../storage/settings';
import { blobToDataUrl } from '../../shared/utils/base64';
import type { PdfImage } from '../../pdf/layout';
import { toPdfImage } from '../annotate/image';

export type ShotState = {
  /** findingId -> object URL, for showing the crop in the panel. */
  urls: Record<string, string>;
  enabled: boolean;
  /** The finding a capture is in flight for. */
  pending: string | null;
  error: string | null;
  /**
   * Progress through a whole-audit capture, counted in screenfuls rather than
   * findings -- that is what the user watches happen, and what the time is
   * actually spent on.
   */
  sweep: { done: number; total: number } | null;
};

/**
 * Milliseconds between tab captures.
 *
 * Chrome permits two `captureVisibleTab` calls a second and throws on the
 * third. Pacing here rather than catching the throw means a long page comes
 * back complete and slow instead of fast and half empty.
 */
const CAPTURE_INTERVAL = 550;

/** How long to wait for one screenful before giving up on the page. */
const BAND_TIMEOUT = 6000;

/**
 * How long a single Capture waits for the page to answer.
 *
 * Longer than a band, because this one is a person watching a button: a real
 * capture takes well under a second, and the extra seconds buy nothing except
 * confidence that a slow page is not being called dead.
 */
const CAPTURE_TIMEOUT = 8000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const SEVERITY_RANK: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * The colour for an element several findings point at.
 *
 * One element commonly fails three rules at once -- a button can miss on
 * contrast, target size and accessible name -- and they share one picture. It
 * gets the worst of their colours, so a critical is never drawn in the colour
 * of the `info` that happens to sit beside it.
 */
function worstOf(findings: readonly Finding[] | undefined): Severity {
  let worst = SEVERITY_RANK.length - 1;
  for (const finding of findings ?? []) {
    const rank = SEVERITY_RANK.indexOf(finding.severity);
    if (rank >= 0 && rank < worst) worst = rank;
  }
  return SEVERITY_RANK[worst]!;
}

/** Decode, compose, and always release the bitmap. */
async function drawShot(
  dataUrl: string,
  input: Omit<ComposeInput, 'bitmap'>,
): Promise<ComposeResult> {
  const bitmap = await decodeCapture(dataUrl);
  if (!bitmap) return { ok: false, reason: 'decode' };
  try {
    return await composeShot({ ...input, bitmap });
  } finally {
    bitmap.close();
  }
}

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
  timeout:
    'The page did not answer. Thursday reconnects on its own, so pressing Capture again usually works — reload the page if it does not.',
};

/**
 * Pictures of findings.
 *
 * Two ways in. `captureAll` sweeps the whole page after an audit and is what
 * normally produces them; `capture` does one finding on demand, for a retake or
 * for a finding the sweep could not reach. Both end in the same compositor, so
 * a retaken picture looks like a swept one and both are masked the same way.
 *
 * The page decides what is safe to photograph -- it is the only side that can
 * see the DOM -- and refusals are shown as refusals rather than as failures.
 *
 * Both paths have a deadline, and that is not defensive padding. Each is a
 * round trip through a service worker that Chrome is entitled to collect at any
 * moment, so a request really can go unanswered; without a deadline the panel
 * sat at "Capturing..." indefinitely with no error and nothing to retry.
 *
 * Pictures are held in memory for the session and written to IndexedDB
 * alongside the audit, so an export works even when history is turned off.
 */
export function useScreenshots(
  auditId: string | null,
  send: (message: ThursdayMessage) => void,
  reply: (ElementRectReply & { at: number }) | null,
  band: (CaptureBandReply & { at: number }) | null,
): ShotState & {
  capture(finding: Finding): void;
  /**
   * Every finding in one sweep of the page. Resolves when it is done, so the
   * caller can export straight afterwards.
   */
  captureAll(findings: readonly Finding[], snapshot: PageSnapshot): Promise<void>;
  discard(findingId: string): void;
  has(findingId: string): boolean;
  /** findingId -> data URL, for the audit file and the HTML report. */
  dataUrls(): Promise<Record<string, string>>;
  /** findingId -> JPEG, for the PDF. */
  pdfImages(): Promise<Record<string, PdfImage>>;
  reload(): void;
} {
  const [state, setState] = useState<ShotState>({
    urls: {},
    enabled: false,
    pending: null,
    error: null,
    sweep: null,
  });
  const blobs = useRef(new Map<string, Blob>());
  const urls = useRef(new Map<string, string>());
  const auditRef = useRef<string | null>(auditId);
  auditRef.current = auditId;
  const handledReply = useRef(0);
  /** The last band answer seen, and whoever is waiting for the next one. */
  const bandSeen = useRef(0);
  const bandWaiter = useRef<((answer: CaptureBandReply) => void) | null>(null);
  /** True while a sweep is running, so two cannot overlap. */
  const sweeping = useRef(false);
  /** Severity of the finding a manual capture is in flight for. */
  const pendingSeverity = useRef<Severity | null>(null);
  /** Deadline for that capture. See `capture`. */
  const deadline = useRef<number | undefined>(undefined);
  /** Set when somebody clears the database while a sweep is running. */
  const cleared = useRef(false);

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
    setState((current) => ({ ...current, urls: {}, pending: null, error: null, sweep: null }));
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

  /*
   * Somebody cleared everything, possibly from another document.
   *
   * A sweep runs for a few seconds after an audit, and the options page's
   * "Clear everything" is reachable throughout. Without this the sweep kept
   * writing pictures into the database the user had just emptied -- two of them
   * survived a clear in a test -- and the panel went on holding the rest in
   * memory as though nothing had happened.
   */
  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>): void => {
      if (!(CLEARED_AT_KEY in changes)) return;
      cleared.current = true;
      reset();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [reset]);

  // A different audit means different crops.
  useEffect(reload, [auditId, reload]);

  // Revoke on unmount: object URLs outlive the component otherwise.
  useEffect(
    () => () => {
      for (const url of urls.current.values()) URL.revokeObjectURL(url);
      if (deadline.current !== undefined) clearTimeout(deadline.current);
    },
    [],
  );

  // Hand each new band answer to whoever is waiting for one.
  useEffect(() => {
    if (!band || band.at === bandSeen.current) return;
    bandSeen.current = band.at;
    const waiting = bandWaiter.current;
    bandWaiter.current = null;
    waiting?.(band);
  }, [band]);

  const fail = useCallback((reason: keyof typeof REFUSALS | string) => {
    setState((current) => ({ ...current, pending: null, error: REFUSALS[reason] ?? reason }));
  }, []);

  /**
   * Asks the page to scroll to one screenful and report what is there.
   *
   * Times out rather than waiting forever. The content script can be gone
   * halfway through a sweep -- the user navigated, or closed Thursday on that
   * tab -- and an await with no deadline would leave the sweep flag set and
   * every later attempt silently refused.
   */
  const requestBand = useCallback(
    (scrollY: number, indices: number[], snapshotId: string): Promise<CaptureBandReply | null> =>
      new Promise((resolve) => {
        let settled = false;
        const finish = (answer: CaptureBandReply | null): void => {
          if (settled) return;
          settled = true;
          if (bandWaiter.current === handler) bandWaiter.current = null;
          resolve(answer);
        };
        const handler = (answer: CaptureBandReply): void => finish(answer);
        bandWaiter.current = handler;
        setTimeout(() => finish(null), BAND_TIMEOUT);
        send({ type: 'CAPTURE_BAND', payload: { snapshotId, scrollY, indices } });
      }),
    [send],
  );

  const capture = useCallback(
    (finding: Finding) => {
      if (!finding.elementRef) return;
      // Kept so the picture is drawn in the same colour as the row it belongs
      // to, which is the whole point of colouring it.
      pendingSeverity.current = finding.severity;
      setState((current) => ({ ...current, pending: finding.id, error: null }));
      send({ type: 'REQUEST_ELEMENT_RECT', payload: { findingId: finding.id, ref: finding.elementRef } });

      /*
       * A deadline, because a request that gets no answer used to wait forever.
       *
       * This is a round trip through the service worker, and an MV3 worker is
       * allowed to die -- so the request can simply never arrive, and then
       * neither can the reply. The button said "Capturing..." indefinitely with
       * no error anywhere near it, which is the worst possible way to fail:
       * nothing to read, nothing to retry, no way to tell a slow capture from a
       * dead one.
       *
       * The panel reconnects on its own now (see usePageConnection), so the
       * next press generally works. This is what makes there *be* a next press.
       */
      if (deadline.current !== undefined) clearTimeout(deadline.current);
      deadline.current = self.setTimeout(() => {
        deadline.current = undefined;
        setState((current) =>
          current.pending === finding.id
            ? { ...current, pending: null, error: REFUSALS.timeout! }
            : current,
        );
      }, CAPTURE_TIMEOUT);
    },
    [send],
  );

  // The page has measured the element; take the picture.
  useEffect(() => {
    if (!reply || reply.at === handledReply.current) return;
    if (state.pending !== reply.findingId) return;
    handledReply.current = reply.at;
    const findingId = reply.findingId;
    if (deadline.current !== undefined) {
      clearTimeout(deadline.current);
      deadline.current = undefined;
    }

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
      const result = await drawShot(dataUrl, {
        rect: reply.rect,
        masks: reply.masks,
        viewport: reply.viewport,
        devicePixelRatio: reply.devicePixelRatio,
        scrollY: reply.scrollY,
        documentHeight: reply.documentHeight,
        accent: SEVERITY_HEX[pendingSeverity.current ?? 'info'],
      });
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

  /**
   * One sweep of the page, photographing every finding that has an element.
   *
   * Sequential and paced, both by necessity. Chrome allows two
   * `captureVisibleTab` calls a second and throws past that, so a burst would
   * fail most of the way through rather than run fast; and the page has to be
   * standing still at the right scroll position before each one, which is a
   * round trip to the content script.
   *
   * Partial success is the normal outcome and is treated as success: an element
   * that vanished, a sensitive field, a screenful the browser refused -- each
   * loses its own picture and nothing else. The one failure that stops the
   * sweep is the page going away, because nothing after it can work either.
   */
  const captureAll = useCallback(
    async (findings: readonly Finding[], snapshot: PageSnapshot): Promise<void> => {
      if (sweeping.current) return;
      const plan = planCapture(findings, snapshot);
      if (plan.bands.length === 0) return;

      // findingId per snapshot index: several findings can share one element,
      // and each of them wants the picture.
      const wanted = new Map<number, Finding[]>();
      for (const finding of findings) {
        if (finding.elementIndex === undefined) continue;
        const list = wanted.get(finding.elementIndex);
        if (list) list.push(finding);
        else wanted.set(finding.elementIndex, [finding]);
      }

      sweeping.current = true;
      cleared.current = false;
      let total = plan.bands.length;
      let done = 0;
      setState((current) => ({ ...current, sweep: { done, total }, error: null }));
      let lastCapture = 0;
      let refused = 0;
      let dead = false;
      /**
       * Targets a band photographed a screenful for but could not draw.
       *
       * Almost always one thing: the element sat below the part of the window
       * the browser actually captured. `captureVisibleTab` photographs the
       * content area, which is not always as tall as `innerHeight` says -- so
       * whether a target near the bottom of a screenful makes it into the
       * picture cannot be known until after the capture.
       */
      const missed = new Set<number>();
      /**
       * Targets the retry could not reach either.
       *
       * Real, and worth saying out loud rather than leaving as a finding with
       * no picture: an element in the last few pixels of a page that cannot
       * scroll any further is outside every capture this window can take.
       */
      const stranded = new Set<number>();

      /** One screenful: go there, photograph it, draw everything on it. */
      const sweepBand = async (
        scrollY: number,
        indices: number[],
        /** Where an unreachable target is recorded. */
        unreachable: Set<number>,
      ): Promise<void> => {
        const answer = await requestBand(scrollY, indices, snapshot.id);
        done += 1;
        setState((current) => ({ ...current, sweep: { done, total } }));
        if (!answer || answer.snapshotId !== snapshot.id) {
          dead = true;
          return;
        }
        if (!answer.pageVisible) {
          fail('hidden');
          dead = true;
          return;
        }
        // Asked for after the request went out, so a clear during the round
        // trip is caught before anything is written rather than after.
        if (cleared.current) {
          dead = true;
          return;
        }

        // Two a second, enforced here rather than discovered as a throw.
        const wait = CAPTURE_INTERVAL - (Date.now() - lastCapture);
        if (wait > 0) await sleep(wait);
        let dataUrl: string | undefined;
        try {
          dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
        } catch {
          refused += 1;
          return;
        }
        lastCapture = Date.now();
        if (!dataUrl) {
          refused += 1;
          return;
        }

        const bitmap = await decodeCapture(dataUrl);
        if (!bitmap) {
          refused += 1;
          return;
        }
        try {
          for (const target of answer.targets) {
            if (!target.rect || target.sensitive) continue;
            const shot = await composeShot({
              bitmap,
              rect: target.rect,
              masks: answer.masks,
              viewport: answer.viewport,
              devicePixelRatio: answer.devicePixelRatio,
              scrollY: answer.scrollY,
              documentHeight: snapshot.viewport.documentHeight,
              accent: SEVERITY_HEX[worstOf(wanted.get(target.index))],
            });
            if (!shot.ok) {
              // Worth one more try from the top of its own screenful, where
              // nothing can be below the captured area. The set it goes into
              // decides whether that retry happens, so a retry cannot queue
              // another one.
              if (shot.reason === 'offscreen') unreachable.add(target.index);
              continue;
            }
            if (cleared.current) return;
            for (const finding of wanted.get(target.index) ?? []) {
              publish(finding.id, shot.blob);
              const id = auditRef.current;
              if (id) {
                await putScreenshot(id, finding.id, shot.blob).catch(() => {
                  /* in the panel, not in history: reported once, below */
                });
              }
            }
          }
        } finally {
          bitmap.close();
        }
      };

      try {
        for (const bandPlan of plan.bands) {
          await sweepBand(bandPlan.scrollY, bandPlan.indices, missed);
          if (dead || cleared.current) break;
        }

        /*
         * The retry pass.
         *
         * One band per missed element, anchored so the element sits near the
         * top of the screenful -- the one position that is inside the captured
         * area whatever its height turns out to be. Bounded: `retry` is true,
         * so nothing here can queue more work.
         */
        if (!dead && missed.size > 0) {
          total += missed.size;
          setState((current) => ({ ...current, sweep: { done, total } }));
          for (const index of missed) {
            const rect = snapshot.elements[index]?.documentRect;
            if (!rect) continue;
            await sweepBand(Math.max(0, rect.y - BAND_MARGIN), [index], stranded);
            if (dead) break;
          }
        }

        // Back where the user left it. They did not ask to be moved.
        await requestBand(plan.restoreY, [], snapshot.id);
      } finally {
        sweeping.current = false;
        // Said plainly, because the alternative is a finding with no picture
        // and no reason -- which is the state this whole feature replaced.
        const notes: string[] = [];
        if (refused > 0) {
          notes.push(`${refused} of ${total} screenfuls could not be photographed.`);
        }
        if (stranded.size > 0) {
          notes.push(
            `${stranded.size} ${stranded.size === 1 ? 'finding sits' : 'findings sit'} outside the area the browser will photograph, so ${stranded.size === 1 ? 'it has' : 'they have'} no picture.`,
          );
        }
        setState((current) => ({
          ...current,
          sweep: null,
          error: notes.length > 0 ? notes.join(' ') : current.error,
        }));
      }
    },
    [fail, publish, requestBand],
  );

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

  /**
   * Crops re-encoded for the PDF.
   *
   * Separate from `dataUrls` because the two exports want different things: an
   * HTML report embeds the PNG as it was cropped, while the PDF needs JPEG
   * bytes it can hand straight to DCTDecode.
   */
  const pdfImages = useCallback(async (): Promise<Record<string, PdfImage>> => {
    const out: Record<string, PdfImage> = {};
    for (const [findingId, blob] of blobs.current) {
      const image = await toPdfImage(blob);
      if (image) out[findingId] = image;
    }
    return out;
  }, []);

  return { ...state, capture, captureAll, discard, has, dataUrls, pdfImages, reload };
}
