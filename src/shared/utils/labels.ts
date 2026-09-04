/**
 * A, B, ... Z, AA, AB for comment markers.
 *
 * Letters rather than numbers because a page can carry both series at once,
 * and "Comment C" next to "Finding 3" is unambiguous in a way that two 3s are
 * not -- on the pin, in the panel list, in the HTML report and in the PDF, all
 * four of which read from here so they can never disagree.
 *
 * Lives in shared rather than beside the pin layer it was first written for:
 * the report and the PDF both need it, and neither has any business importing
 * from the content script.
 */
export function commentLabel(ordinal: number): string {
  let remaining = Math.max(1, Math.floor(ordinal));
  let label = '';
  while (remaining > 0) {
    const index = (remaining - 1) % 26;
    label = String.fromCharCode(65 + index) + label;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return label;
}
