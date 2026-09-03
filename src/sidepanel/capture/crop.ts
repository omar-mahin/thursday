import { dataUrlToBlob } from '../../shared/utils/base64';
import type { Rect } from '../../shared/types';

/**
 * Cropping a finding out of a tab capture.
 *
 * The scale between CSS pixels and the captured image is *measured*, not
 * assumed. `devicePixelRatio` is the obvious candidate and it is wrong often
 * enough to matter: browser zoom changes the ratio between the two, and a
 * captured image is the real content area rather than whatever the page thinks
 * its viewport is. Dividing the image width by the viewport width is exact in
 * every one of those cases, and it is self-correcting.
 *
 * The rect is then clamped to the image, because canvas silently pads a region
 * beyond its source with transparency -- which looks like an element with empty
 * space around it rather than a crop that went wrong.
 */
export const CROP_PADDING = 8;

export type CropRegion = { x: number; y: number; width: number; height: number };

export type Size = { width: number; height: number };

/** Plausible scales between CSS pixels and captured pixels. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

/**
 * How many captured pixels there are per CSS pixel, or null when the image
 * cannot be of this page at all.
 *
 * Tab capture photographs whichever tab is in front, and switching tabs is not
 * instant, so a mistimed capture can be of something else entirely. Cropping
 * that at plausible coordinates would produce a *wrong* screenshot rather than
 * a failed one, which is much worse.
 */
export function cropScale(image: Size, viewport: Size, devicePixelRatio: number): number | null {
  if (viewport.width <= 0) return devicePixelRatio > 0 ? devicePixelRatio : 1;
  const scale = image.width / viewport.width;
  if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) return null;
  return scale;
}

export function cropRegion(
  rect: Rect,
  image: Size,
  scale: number,
  padding: number = CROP_PADDING,
): CropRegion | null {
  const factor = scale > 0 ? scale : 1;
  const left = Math.floor((rect.x - padding) * factor);
  const top = Math.floor((rect.y - padding) * factor);
  const right = Math.ceil((rect.x + rect.width + padding) * factor);
  const bottom = Math.ceil((rect.y + rect.height + padding) * factor);

  const x = Math.max(0, Math.min(left, image.width));
  const y = Math.max(0, Math.min(top, image.height));
  const width = Math.min(right, image.width) - x;
  const height = Math.min(bottom, image.height) - y;
  // Entirely outside the captured area, or collapsed to nothing. The captured
  // area can be shorter than the page's own viewport, so this is a real case.
  if (width < 1 || height < 1) return null;
  return { x, y, width, height };
}

export type CropFailure = 'decode' | 'offscreen' | 'encode' | 'mismatch';

export type CropResult = { ok: true; blob: Blob } | { ok: false; reason: CropFailure };

/**
 * Decodes a capture, cuts the region out and re-encodes it as a PNG.
 *
 * Note what is absent: the usual `fetch(dataUrl)` for turning the capture into
 * a Blob. Network APIs are banned outright in this codebase, so the base64 is
 * decoded by hand (shared/utils/base64.ts).
 */
export async function cropCapture(
  dataUrl: string,
  rect: Rect,
  /** The viewport the rect was measured against. */
  viewport: Size,
  devicePixelRatio: number,
  padding: number = CROP_PADDING,
): Promise<CropResult> {
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return { ok: false, reason: 'decode' };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return { ok: false, reason: 'decode' };
  }

  try {
    const scale = cropScale(bitmap, viewport, devicePixelRatio);
    if (scale === null) return { ok: false, reason: 'mismatch' };

    const region = cropRegion(rect, bitmap, scale, padding);
    if (!region) return { ok: false, reason: 'offscreen' };

    const canvas = new OffscreenCanvas(region.width, region.height);
    const context = canvas.getContext('2d');
    if (!context) return { ok: false, reason: 'encode' };
    context.drawImage(
      bitmap,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height,
    );
    return { ok: true, blob: await canvas.convertToBlob({ type: 'image/png' }) };
  } catch {
    return { ok: false, reason: 'encode' };
  } finally {
    bitmap.close();
  }
}
