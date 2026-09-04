/**
 * The scale between CSS pixels and a tab capture's pixels.
 *
 * Measured, not assumed. `devicePixelRatio` is the obvious candidate and it is
 * wrong often enough to matter: browser zoom changes the ratio between the
 * two, and a captured image is the real content area rather than whatever the
 * page thinks its viewport is. Dividing the image width by the viewport width
 * is exact in every one of those cases, and self-correcting.
 *
 * This file used to hold the cropping too. Compositing replaced it -- a crop
 * with eight pixels of padding and no marker turned out to be a photograph of
 * a grey rectangle -- and the framing arithmetic now lives in compose.ts. What
 * is left here is the one piece that was never about framing.
 */

export type Size = { width: number; height: number };

/** Plausible scales between CSS pixels and captured pixels. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

/**
 * How many captured pixels there are per CSS pixel, or null when the image
 * cannot be of this page at all.
 *
 * Tab capture photographs whichever tab is in front, and switching tabs is not
 * instant, so a mistimed capture can be of something else entirely. Drawing
 * that at plausible coordinates would produce a *wrong* screenshot rather than
 * a failed one, which is much worse.
 */
export function cropScale(image: Size, viewport: Size, devicePixelRatio: number): number | null {
  if (viewport.width <= 0) return devicePixelRatio > 0 ? devicePixelRatio : 1;
  const scale = image.width / viewport.width;
  if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) return null;
  return scale;
}
