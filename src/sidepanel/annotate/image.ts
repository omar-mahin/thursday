/**
 * Preparing an image the user attached to a comment.
 *
 * Everything here happens before a single byte reaches storage, because the
 * file a person drags in is whatever their screenshot tool produced -- a 4MB
 * 5120px retina PNG is completely normal, and half a dozen of those in one
 * audit is tens of megabytes of IndexedDB for pictures nobody will view above
 * a thousand pixels wide.
 *
 * So an attachment is decoded, scaled to a sensible ceiling and re-encoded,
 * and the *result* is what gets stored. The original is never kept: it is not
 * needed, and holding the user's untouched file on disk is a liability rather
 * than a feature.
 */

/** Types the browser will decode and the report will accept. */
import type { PdfImage } from '../../pdf/layout';

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * The longest edge an attachment is kept at.
 *
 * 1600px is wider than any column that will ever display it -- the panel shows
 * a thumbnail, the HTML report a 760px figure, the PDF about 500 points -- and
 * still enough to zoom into a UI detail. Above this is storage spent on
 * pixels nobody sees.
 */
export const MAX_STORED_EDGE = 1600;

/** The ceiling for a PDF, where every image is embedded in the file itself. */
export const MAX_PDF_EDGE = 1400;

/**
 * Refused before decoding.
 *
 * A 60MB TIFF from a scanner would either fail to decode or succeed and cost
 * a second of frozen panel, so the size is checked first, on the file's own
 * declared length.
 */
export const MAX_SOURCE_BYTES = 24 * 1024 * 1024;

export type PreparedImage = {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  bytes: number;
};

export type ImageFailure = 'unsupported' | 'tooLarge' | 'decode' | 'encode' | 'empty';

export type PrepareResult = { ok: true; image: PreparedImage } | { ok: false; reason: ImageFailure };

export const IMAGE_REFUSALS: Record<ImageFailure, string> = {
  unsupported: 'Only PNG, JPEG and WebP images can be attached.',
  tooLarge: `That image is larger than ${Math.round(MAX_SOURCE_BYTES / (1024 * 1024))}MB.`,
  decode: 'That file could not be read as an image.',
  encode: 'That image could not be prepared for storage.',
  empty: 'That file is empty.',
};

const isAccepted = (mime: string): boolean =>
  (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mime);

/** Scaled dimensions, at most `maxEdge` on the long side and never enlarged. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decodes, scales and re-encodes one attachment.
 *
 * PNG is kept as PNG. A screenshot of an interface is exactly the case JPEG
 * handles worst -- hard edges and small text turn to mush around the ringing
 * -- and a screenshot of an interface is what nine attachments in ten will be.
 * Photographs arriving as JPEG stay JPEG, where the codec is the right one.
 */
export async function prepareImage(
  file: Blob,
  maxEdge: number = MAX_STORED_EDGE,
): Promise<PrepareResult> {
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.size > MAX_SOURCE_BYTES) return { ok: false, reason: 'tooLarge' };
  if (!isAccepted(file.type)) return { ok: false, reason: 'unsupported' };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: 'decode' };
  }

  try {
    const target = fitWithin(bitmap.width, bitmap.height, maxEdge);
    // Already small enough and already in a format the report accepts: hand
    // back the original bytes rather than re-encoding them, which would only
    // add a generation of loss for no benefit.
    if (target.width === bitmap.width && target.height === bitmap.height) {
      return {
        ok: true,
        image: {
          blob: file,
          mime: file.type,
          width: bitmap.width,
          height: bitmap.height,
          bytes: file.size,
        },
      };
    }
    const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await redraw(bitmap, target, mime, 0.9);
    if (!blob) return { ok: false, reason: 'encode' };
    return {
      ok: true,
      image: { blob, mime, width: target.width, height: target.height, bytes: blob.size },
    };
  } catch {
    return { ok: false, reason: 'encode' };
  } finally {
    bitmap.close();
  }
}

/** Exactly what the PDF writer embeds, so there is one shape and not two. */
export type JpegImage = PdfImage & { jpeg: Uint8Array<ArrayBuffer> };

/**
 * Re-encodes an image as baseline JPEG for embedding in a PDF.
 *
 * The PDF writer embeds JPEG through DCTDecode, which is the one image filter
 * that needs no work at all: the compressed bytes go into the file as they
 * are. A PNG would have to be decoded to raw samples and deflated by hand,
 * which is more code carrying more ways to be subtly wrong, for a format
 * difference nobody will see on paper at quality 0.9.
 */
export async function toPdfImage(
  blob: Blob,
  maxEdge: number = MAX_PDF_EDGE,
): Promise<JpegImage | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    const target = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const encoded = await redraw(bitmap, target, 'image/jpeg', 0.9);
    if (!encoded) return null;
    const buffer = await encoded.arrayBuffer();
    return {
      jpeg: new Uint8Array(buffer),
      width: target.width,
      height: target.height,
    };
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

/**
 * Draws a bitmap at a new size and encodes it.
 *
 * The white fill matters for JPEG: a PNG with transparency composited onto
 * nothing comes out with black where the page was empty, which makes a crop of
 * a rounded button look like it has been cut out with scissors.
 */
async function redraw(
  bitmap: ImageBitmap,
  size: { width: number; height: number },
  mime: string,
  quality: number,
): Promise<Blob | null> {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext('2d');
  if (!context) return null;
  if (mime === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
  }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return canvas.convertToBlob({ type: mime, quality });
}
