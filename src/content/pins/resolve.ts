import type { ElementReference, Pin } from '../../shared/types';
import type { PinTarget } from './pins';

export type PinResolutionContext = {
  /** The snapshot the live `measured` elements came from, if any. */
  snapshotId: string | null;
  /** Live elements, index-aligned with that snapshot. */
  measured: readonly Element[];
  /** The resolution ladder. */
  resolve(reference: ElementReference): Element | null;
};

/**
 * Decides what each pin points at.
 *
 * The element index is only a valid shortcut for the snapshot it came from.
 * Reopening a saved audit, or running a second audit in the same session, hands
 * the page indexes from a different snapshot -- and index 42 of one snapshot is
 * an unrelated element in another. Checking the snapshot id keeps that shortcut
 * honest; without it a restored audit would draw confident pins on the wrong
 * elements, which is worse than drawing none.
 */
export function resolvePinTargets(pins: readonly Pin[], context: PinResolutionContext): PinTarget[] {
  return pins.map((pin) => {
    if (pin.snapshotId === context.snapshotId) {
      const measured = context.measured[pin.elementIndex];
      if (measured?.isConnected) return { pin, element: measured, approximate: false };
    }
    return { pin, element: context.resolve(pin.ref), approximate: true };
  });
}
