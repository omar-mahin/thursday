import type { Severity } from '../types';

/**
 * The severity palette, once.
 *
 * It had grown three copies -- the HTML report's CSS, the PDF's floats, and
 * whatever the panel used -- and a picture of a finding needs a fourth. Four
 * copies of five colours is a drift waiting to happen, and the drift would show
 * up as a report whose printed badge is a different red from the screenshot
 * beside it.
 *
 * Chosen for print as much as screen: all five clear 4.5:1 on white, because
 * they are used as text and as hairlines, not just as fills.
 */
export const SEVERITY_HEX: Record<Severity, string> = {
  critical: '#c1123c',
  high: '#b8531f',
  medium: '#8a6300',
  low: '#2f5fd0',
  info: '#5b6270',
};

/** The same colour as PDF operands: three components, 0 to 1. */
export function hexToUnitRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  if (!Number.isFinite(value) || hex.length !== 7) throw new Error(`not a hex colour: ${hex}`);
  return [
    Math.round((((value >> 16) & 0xff) / 255) * 1000) / 1000,
    Math.round((((value >> 8) & 0xff) / 255) * 1000) / 1000,
    Math.round(((value & 0xff) / 255) * 1000) / 1000,
  ];
}
