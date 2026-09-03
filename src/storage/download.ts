/**
 * Handing a file to the user, without the `downloads` permission.
 *
 * `showSaveFilePicker` is the good path: the user names the file and picks the
 * folder, and nothing is written anywhere else. It is not everywhere, and it
 * can be refused outright in some extension surfaces, so an anchor with
 * `download` is the fallback. Neither one touches the network.
 */
export type SaveOutcome =
  | { saved: true; via: 'picker' | 'anchor' }
  /** The user closed the dialog. Not an error, and not reported as one. */
  | { saved: false; cancelled: true }
  | { saved: false; cancelled: false; reason: string };

type PickerWindow = typeof globalThis & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
};

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException ? error.name === 'AbortError' : false;

export async function saveFile(
  suggestedName: string,
  mime: string,
  extensions: string[],
  contents: BlobPart,
): Promise<SaveOutcome> {
  const blob = new Blob([contents], { type: mime });
  const picker = (globalThis as PickerWindow).showSaveFilePicker;

  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: suggestedName, accept: { [mime]: extensions } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { saved: true, via: 'picker' };
    } catch (error) {
      if (isAbort(error)) return { saved: false, cancelled: true };
      // Anything else -- a blocked picker, a read-only folder -- falls through
      // to the anchor rather than losing the user's export.
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoked on the next turn: revoking synchronously can beat the download.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { saved: true, via: 'anchor' };
  } catch (error) {
    return {
      saved: false,
      cancelled: false,
      reason: error instanceof Error ? error.message : 'The file could not be written.',
    };
  }
}

/** Reads a file the user chose. No path, no directory, just the contents. */
export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file'));
    reader.readAsText(file);
  });
}
