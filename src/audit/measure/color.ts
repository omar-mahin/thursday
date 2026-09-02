/**
 * Colour parsing, alpha compositing and WCAG contrast.
 *
 * The important part of this file is what it refuses to answer. A text colour
 * means nothing without the background actually behind it, and the background
 * is frequently unknowable from computed styles alone: a gradient, an image, a
 * blend mode, or an overlapping positioned element all defeat it. Those cases
 * return `indeterminate` instead of a number (PLAN.md section 2.3) -- inventing
 * a ratio is the fastest way to lose a designer's trust.
 */

export type Rgb = { r: number; g: number; b: number; a: number };

const HEX_SHORT = /^#([\da-f])([\da-f])([\da-f])([\da-f])?$/i;
const HEX_LONG = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})?$/i;
const FUNCTIONAL = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/i;

const clamp255 = (value: number): number => Math.min(255, Math.max(0, value));

export function parseColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase();
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (value === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (value === 'black') return { r: 0, g: 0, b: 0, a: 1 };

  const short = HEX_SHORT.exec(value);
  if (short) {
    const [, r, g, b, a] = short;
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
      a: a === undefined ? 1 : Number.parseInt(`${a}${a}`, 16) / 255,
    };
  }
  const long = HEX_LONG.exec(value);
  if (long) {
    const [, r, g, b, a] = long;
    return {
      r: Number.parseInt(r!, 16),
      g: Number.parseInt(g!, 16),
      b: Number.parseInt(b!, 16),
      a: a === undefined ? 1 : Number.parseInt(a, 16) / 255,
    };
  }
  const functional = FUNCTIONAL.exec(value);
  if (functional) {
    const [, r, g, b, a] = functional;
    const alpha = a === undefined ? 1 : a.endsWith('%') ? Number.parseFloat(a) / 100 : Number.parseFloat(a);
    return {
      r: clamp255(Number.parseFloat(r!)),
      g: clamp255(Number.parseFloat(g!)),
      b: clamp255(Number.parseFloat(b!)),
      a: Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1,
    };
  }
  // Named colours beyond the three above, lab(), oklch() and friends: we do not
  // pretend to resolve them. getComputedStyle hands us rgb() in practice.
  return null;
}

export const isOpaque = (color: Rgb): boolean => color.a >= 0.999;

/** Source-over compositing of `top` onto `bottom`. */
export function composite(top: Rgb, bottom: Rgb): Rgb {
  if (isOpaque(top)) return top;
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const blend = (t: number, b: number): number => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return {
    r: blend(top.r, bottom.r),
    g: blend(top.g, bottom.g),
    b: blend(top.b, bottom.b),
    a,
  };
}

const channelLuminance = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  );
}

/** WCAG 2.x contrast ratio, rounded to two decimals. */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/** WCAG 1.4.3: 3:1 for large text, 4.5:1 otherwise. */
export function contrastTarget(fontSizePx: number, fontWeight: number): { ratio: number; large: boolean } {
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  return { ratio: large ? 3 : 4.5, large };
}

export const formatColor = (color: Rgb): string =>
  color.a >= 0.999
    ? `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
    : `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${Math.round(color.a * 100) / 100})`;

/** Perceptual-ish distance, used to spot near-duplicate colours in a palette. */
export function colorDistance(a: Rgb, b: Rgb): number {
  const rMean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
}
