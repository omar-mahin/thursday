/**
 * Base64 without the network.
 *
 * The usual trick for turning a data URL into a Blob is `fetch(dataUrl)`, which
 * is banned outright in this codebase (scripts/guard.mjs): a build that cannot
 * name `fetch` cannot be argued with. So the conversion is done by hand, which
 * costs about fifteen lines and keeps the guarantee absolute.
 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type DataUrlParts = { mime: string; base64: string };

/** Splits `data:image/png;base64,AAAA` into its parts. */
export function parseDataUrl(dataUrl: string): DataUrlParts | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const [, mime, isBase64, payload] = match;
  if (!isBase64) return null;
  return { mime: mime || 'application/octet-stream', base64: payload ?? '' };
}

export function dataUrlToBlob(dataUrl: string): Blob | null {
  const parts = parseDataUrl(dataUrl);
  if (!parts) return null;
  try {
    return new Blob([base64ToBytes(parts.base64)], { type: parts.mime });
  } catch {
    return null;
  }
}

/** Reads a Blob back out as a data URL, for embedding in a file or a report. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('Could not read the image'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image'));
    reader.readAsDataURL(blob);
  });
}
