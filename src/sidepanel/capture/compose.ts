import type { Rect } from '../../shared/types';
import { dataUrlToBlob } from '../../shared/utils/base64';
import { cropScale, type Size } from './crop';

/**
 * One finding's picture: a crop of the problem, and a map of where it is.
 *
 * The crop on its own was the whole feature for a while and it was not enough.
 * A finding is often a 40x18 button or a line of low-contrast text, and cut out
 * with eight pixels of padding it is a photograph of a grey rectangle -- true,
 * and useless for finding the thing again on a page you are looking at. So each
 * picture is two panels side by side:
 *
 *   - the crop, with enough of its surroundings to recognise the place, and the
 *     element itself boxed;
 *   - a thumbnail of the whole screenful with the same element boxed, and a
 *     track down the side showing where that screenful sits in the page.
 *
 * The masking is not cosmetic. A capture is of the entire screenful, so a crop
 * taken for one finding can contain a password or card field that belongs to a
 * different one -- or to no finding at all. Every sensitive rect the page
 * reported is painted over before anything is encoded, in both panels. Thursday
 * will not photograph those fields for the same reason it will not read them.
 */

/** Context around the element in the crop. The old value was 8, which is why
 *  crops were unrecognisable. */
export const CONTEXT_PADDING = 40;

/** The crop is never smaller than this, however small the element is. */
export const MIN_CROP = { width: 320, height: 180 };

/** Width of the locator thumbnail, in CSS pixels. */
export const LOCATOR_WIDTH = 168;

/**
 * How far a mask is grown past the field it covers.
 *
 * Not a safety margin in the vague sense -- it fixes a measured leak. Masking a
 * password field at its exact rect left a ring of the field's own pixels
 * around the edge: a rect measured in CSS pixels, painted into a canvas at a
 * device ratio, antialiases its border, and in the shrunken locator a 40px-tall
 * field becomes a 5px bar where one pixel of slack is a fifth of it. A test
 * looking for the field's colour found 321 surviving pixels.
 *
 * A mask that is a pixel short is not a mask, and covering two pixels of
 * somebody's page that did not need covering costs nothing.
 */
const MASK_OUTSET = 2;

const GAP = 12;
const TRACK_WIDTH = 6;
const TRACK_GAP = 8;

/** Cap on output resolution. Above this the file grows faster than it reads. */
const MAX_OUTPUT_SCALE = 2;

const FRAME = 'rgba(0, 0, 0, 0.22)';
const SHEET = '#ffffff';
const TRACK_BASE = 'rgba(0, 0, 0, 0.12)';
const MASK_FILL = '#1f2430';
const MASK_HATCH = 'rgba(255, 255, 255, 0.35)';

export type ComposeInput = {
  /** The whole screenful, as captured. */
  bitmap: ImageBitmap;
  /** The element, viewport-relative CSS pixels, at the captured scroll position. */
  rect: Rect;
  /** Sensitive fields on screen, viewport-relative CSS pixels. */
  masks: readonly Rect[];
  viewport: Size;
  devicePixelRatio: number;
  /** Where the screenful sits in the document, for the track. */
  scrollY: number;
  documentHeight: number;
  /** The severity colour, so a picture matches the row it belongs to. */
  accent: string;
};

export type ComposeFailure = 'mismatch' | 'offscreen' | 'encode' | 'decode';
export type ComposeResult = { ok: true; blob: Blob } | { ok: false; reason: ComposeFailure };

/**
 * Turns one tab capture into an ImageBitmap.
 *
 * Note what is absent: the usual `fetch(dataUrl)`. Network APIs are banned
 * outright in this codebase and a CI guard enforces it, so the base64 is
 * decoded by hand (shared/utils/base64.ts).
 */
export async function decodeCapture(dataUrl: string): Promise<ImageBitmap | null> {
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return null;
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

type Box = { x: number; y: number; width: number; height: number };

/** The crop window: the element, padded, grown to a minimum, kept on screen. */
export function cropWindow(rect: Rect, viewport: Size): Box {
  const width = Math.min(viewport.width, Math.max(MIN_CROP.width, rect.width + CONTEXT_PADDING * 2));
  const height = Math.min(viewport.height, Math.max(MIN_CROP.height, rect.height + CONTEXT_PADDING * 2));
  const centreX = rect.x + rect.width / 2;
  const centreY = rect.y + rect.height / 2;
  // Centred on the element, then slid back inside the viewport rather than
  // clipped: a window that hangs off the edge would be padded with blank
  // canvas, which looks like empty page rather than a crop that ran out of room.
  const x = Math.max(0, Math.min(centreX - width / 2, viewport.width - width));
  const y = Math.max(0, Math.min(centreY - height / 2, viewport.height - height));
  return { x, y, width, height };
}

/** Whether two boxes touch at all. */
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A box grown by `by` on every side. */
const grow = (box: Box, by: number): Box => ({
  x: box.x - by,
  y: box.y - by,
  width: box.width + by * 2,
  height: box.height + by * 2,
});

/**
 * Paints out a sensitive field.
 *
 * Solid, plus diagonal hatching. Solid alone reads as a dark UI element that
 * happens to be there; the hatching says a human removed something, which is
 * the honest message and the one somebody reviewing the report needs.
 */
function mask(context: OffscreenCanvasRenderingContext2D, box: Box): void {
  context.save();
  context.beginPath();
  context.rect(box.x, box.y, box.width, box.height);
  context.clip();
  context.fillStyle = MASK_FILL;
  context.fillRect(box.x, box.y, box.width, box.height);
  context.strokeStyle = MASK_HATCH;
  context.lineWidth = 1;
  const step = 6;
  context.beginPath();
  for (let offset = -box.height; offset < box.width; offset += step) {
    context.moveTo(box.x + offset, box.y + box.height);
    context.lineTo(box.x + offset + box.height, box.y);
  }
  context.stroke();
  context.restore();
}

function outline(
  context: OffscreenCanvasRenderingContext2D,
  box: Box,
  color: string,
  width: number,
): void {
  context.strokeStyle = color;
  context.lineWidth = width;
  // Half-pixel inset so a 1px line lands on a pixel rather than across two.
  context.strokeRect(box.x + width / 2, box.y + width / 2, Math.max(0, box.width - width), Math.max(0, box.height - width));
}

export async function composeShot(input: ComposeInput): Promise<ComposeResult> {
  const { bitmap, rect, viewport, masks, accent } = input;

  const captured = cropScale(bitmap, viewport, input.devicePixelRatio);
  if (captured === null) return { ok: false, reason: 'mismatch' };

  /*
   * The frame is what the browser actually photographed, in CSS pixels -- not
   * what the page thinks its viewport is. Those differ, and using the wrong one
   * was a bug worth recording because both symptoms looked like something else:
   *
   *   - the locator drew the whole bitmap into a box sized from the *viewport's*
   *     aspect ratio, so a capture 93px shorter than innerHeight came out
   *     stretched, and every mask -- placed from viewport coordinates -- landed
   *     above the field it was covering. A password field photographed at
   *     x32 y566 had its mask painted at y72 in a thumbnail where the field was
   *     at y85. The hatching was plainly visible in the picture, which is what
   *     made it look like the masking worked.
   *   - the crop clamped to the viewport too, so its bottom edge ran past the
   *     end of the bitmap and came back as a strip of blank canvas that reads
   *     as empty page.
   *
   * One uniform scale, measured off the bitmap, fixes both: the locator's
   * height now comes from the bitmap's own aspect, which makes the horizontal
   * and vertical shrink identical and the mask arithmetic correct by
   * construction rather than by coincidence.
   */
  const frame = {
    width: Math.max(1, bitmap.width / captured),
    height: Math.max(1, bitmap.height / captured),
  };

  const crop = cropWindow(rect, frame);
  if (crop.width < 1 || crop.height < 1) return { ok: false, reason: 'offscreen' };
  // Entirely outside what the browser actually captured -- a real case, since
  // the captured area can be shorter than the page's own viewport.
  if (rect.y >= frame.height || rect.y + rect.height <= 0) {
    return { ok: false, reason: 'offscreen' };
  }

  const locator = {
    width: LOCATOR_WIDTH,
    height: Math.max(1, Math.round((LOCATOR_WIDTH * frame.height) / frame.width)),
  };

  const totalWidth = crop.width + GAP + locator.width + TRACK_GAP + TRACK_WIDTH;
  const totalHeight = Math.max(crop.height, locator.height);
  const scale = Math.min(MAX_OUTPUT_SCALE, Math.max(1, captured));

  const canvas = new OffscreenCanvas(Math.round(totalWidth * scale), Math.round(totalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return { ok: false, reason: 'encode' };

  try {
    context.scale(scale, scale);
    context.fillStyle = SHEET;
    context.fillRect(0, 0, totalWidth, totalHeight);

    // -- the crop -----------------------------------------------------------
    context.save();
    context.beginPath();
    context.rect(0, 0, crop.width, crop.height);
    context.clip();
    context.drawImage(
      bitmap,
      crop.x * captured,
      crop.y * captured,
      crop.width * captured,
      crop.height * captured,
      0,
      0,
      crop.width,
      crop.height,
    );
    for (const sensitive of masks) {
      if (!overlaps(crop, sensitive)) continue;
      mask(
        context,
        grow(
          { x: sensitive.x - crop.x, y: sensitive.y - crop.y, width: sensitive.width, height: sensitive.height },
          MASK_OUTSET,
        ),
      );
    }
    outline(
      context,
      { x: rect.x - crop.x, y: rect.y - crop.y, width: rect.width, height: rect.height },
      accent,
      2,
    );
    context.restore();
    outline(context, { x: 0, y: 0, width: crop.width, height: crop.height }, FRAME, 1);

    // -- the locator --------------------------------------------------------
    const left = crop.width + GAP;
    // One scale for both axes, off the frame. See the note above.
    const shrink = locator.width / frame.width;
    context.save();
    context.beginPath();
    context.rect(left, 0, locator.width, locator.height);
    context.clip();
    context.drawImage(bitmap, left, 0, locator.width, locator.height);
    for (const sensitive of masks) {
      // Outset after shrinking, not before: at this scale the slack has to be
      // in output pixels or it shrinks away with everything else.
      mask(
        context,
        grow(
          {
            x: left + sensitive.x * shrink,
            y: sensitive.y * shrink,
            width: Math.max(1, sensitive.width * shrink),
            height: Math.max(1, sensitive.height * shrink),
          },
          MASK_OUTSET,
        ),
      );
    }
    outline(
      context,
      {
        x: left + rect.x * shrink,
        y: rect.y * shrink,
        // A 40x18 button shrinks to 5x2, which is invisible. Floored at
        // something a person can actually see, since pointing at the element is
        // this panel's entire job.
        width: Math.max(6, rect.width * shrink),
        height: Math.max(6, rect.height * shrink),
      },
      accent,
      1.5,
    );
    context.restore();
    outline(context, { x: left, y: 0, width: locator.width, height: locator.height }, FRAME, 1);

    // -- where this screenful sits in the page ------------------------------
    const trackX = left + locator.width + TRACK_GAP;
    const documentHeight = Math.max(input.documentHeight, frame.height);
    context.fillStyle = TRACK_BASE;
    context.fillRect(trackX, 0, TRACK_WIDTH, locator.height);
    const from = (input.scrollY / documentHeight) * locator.height;
    // The frame, not the viewport: the track marks the part of the page the
    // thumbnail beside it actually shows.
    const span = Math.max(3, (frame.height / documentHeight) * locator.height);
    context.fillStyle = accent;
    context.fillRect(trackX, Math.min(from, Math.max(0, locator.height - span)), TRACK_WIDTH, span);

    return { ok: true, blob: await canvas.convertToBlob({ type: 'image/png' }) };
  } catch {
    return { ok: false, reason: 'encode' };
  }
}
