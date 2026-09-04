/**
 * Delivered via adoptedStyleSheets (a constructed CSSStyleSheet), not an inline
 * <style> tag, so a strict page CSP cannot block our UI.
 *
 * `all: initial` on the layer cuts every inherited property from the host page;
 * everything after it in that rule re-establishes what we actually want.
 */
export const CONTENT_CSS = `
.layer {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color-scheme: light dark;

  --thu-bg: #17181d;
  --thu-bg-hover: #23252c;
  --thu-fg: #f2f3f5;
  --thu-fg-dim: #a2a7b3;
  --thu-line: #32353d;
  --thu-accent: #7aa2f7;
  --thu-shadow: 0 6px 20px rgba(0, 0, 0, 0.32), 0 1px 2px rgba(0, 0, 0, 0.4);
}

@media (prefers-color-scheme: light) {
  .layer {
    --thu-bg: #ffffff;
    --thu-bg-hover: #f1f2f5;
    --thu-fg: #16181d;
    --thu-fg-dim: #5c6270;
    --thu-line: #e2e4ea;
    --thu-accent: #2f5fd0;
    --thu-shadow: 0 6px 20px rgba(15, 20, 40, 0.16), 0 1px 2px rgba(15, 20, 40, 0.12);
  }
}

.toolbar {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px 6px;
  border: 1px solid var(--thu-line);
  border-radius: 10px;
  background: var(--thu-bg);
  color: var(--thu-fg);
  box-shadow: var(--thu-shadow);
  pointer-events: auto;
  user-select: none;
  touch-action: none;
  will-change: transform;
}

.toolbar[data-dragging="true"] { cursor: grabbing; }

.grip {
  display: grid;
  grid-template-columns: repeat(2, 2px);
  gap: 2px 3px;
  padding: 4px 5px;
  cursor: grab;
  border-radius: 6px;
}
.grip span {
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: var(--thu-fg-dim);
}
.grip:hover { background: var(--thu-bg-hover); }

/*
 * The brandmark: the name, with its credit set under it.
 *
 * The credit has to read as subordinate without becoming unreadable, so the
 * separation is carried by weight and colour rather than by shrinking the type
 * much further. Both still clear 4.5:1 against the toolbar in either theme --
 * a credit line nobody can read is not a credit.
 */
.brand {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 0 9px 0 3px;
  white-space: nowrap;
}
.brand-name {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  line-height: 1.1;
  color: var(--thu-fg);
}
.brand-credit {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
  line-height: 1.1;
  color: var(--thu-fg-dim);
}

.sep {
  width: 1px;
  align-self: stretch;
  margin: 2px 4px;
  background: var(--thu-line);
}

button {
  font: inherit;
  appearance: none;
  border: 0;
  margin: 0;
  padding: 6px 9px;
  border-radius: 6px;
  background: transparent;
  color: var(--thu-fg);
  cursor: pointer;
  white-space: nowrap;
}
button:hover:not(:disabled) { background: var(--thu-bg-hover); }
button:disabled { color: var(--thu-fg-dim); cursor: default; }
button[aria-pressed="true"] {
  background: var(--thu-accent);
  color: #fff;
}
button:focus-visible {
  outline: 2px solid var(--thu-accent);
  outline-offset: 2px;
}

/*
 * The action buttons.
 *
 * 30px square, which clears the 24px floor in WCAG 2.5.8 with room to spare --
 * this is a toolbar that floats over somebody else's page, so it is worth
 * being comfortably hittable rather than exactly compliant.
 */
.tb-btn {
  position: relative;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  color: var(--thu-fg);
}
.tb-btn:disabled {
  /*
   * Dimmed and faded, because an icon has no text weight to lose. Without the
   * opacity a disabled icon looks exactly like an available one -- the labels
   * used to carry that difference on their own, and icons do not.
   *
   * Below 4.5:1 on purpose: WCAG 1.4.3 exempts inactive controls, and a
   * disabled button that reads as available is the worse mistake.
   */
  color: var(--thu-fg-dim);
  opacity: 0.5;
}

/*
 * One place decides how the whole set is drawn.
 *
 * The path data in icons.ts carries no stroke, weight or cap of its own, so
 * these five declarations are the entire appearance of every icon. 1.5 is the
 * weight the set was drawn at; nudging it here re-weights all seven together,
 * which is the point.
 */
.tb-icon {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* White on the accent fill when a mode is on, icon included. */
.tb-btn[aria-pressed="true"] { color: #fff; }

/*
 * The label, on hover and on focus.
 *
 * On focus as well as hover, and that is the whole point of doing this in CSS
 * rather than with a title attribute: a native tooltip waits a second,
 * cannot be styled, and never appears for somebody arriving by keyboard. This
 * one is instant and appears for both.
 *
 * Marked aria-hidden in the markup, and never the button's accessible name -- see
 * addButton in toolbar.ts.
 */
.tb-tip {
  position: absolute;
  top: calc(100% + 7px);
  left: 50%;
  z-index: 1;
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--thu-fg);
  color: var(--thu-bg);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.35;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
  opacity: 0;
  transform: translate(-50%, -3px);
  /* Never a click target: it sits under the pointer that summoned it. */
  pointer-events: none;
  transition: opacity 90ms ease, transform 90ms ease;
}
.tb-btn:hover .tb-tip,
.tb-btn:focus-visible .tb-tip {
  opacity: 1;
  transform: translate(-50%, 0);
}
@media (prefers-reduced-motion: reduce) {
  .tb-tip { transition: none; }
}

/* Screen-reader-only live region for state announcements. */
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
`;

/** Selection overlay. Appended to the same constructed stylesheet. */
export const OVERLAY_CSS = `
.hl-box {
  position: absolute;
  top: 0;
  left: 0;
  display: none;
  pointer-events: none;
  box-sizing: border-box;
  border: 1px solid var(--thu-accent);
  background: color-mix(in srgb, var(--thu-accent) 12%, transparent);
  border-radius: 2px;
  will-change: transform, width, height;
}
.hl-box[data-tone="selected"] {
  border-width: 2px;
  border-style: solid;
}
.hl-box[data-flash="true"] {
  animation: thu-flash 1.4s ease-out;
}
@keyframes thu-flash {
  0%, 40% { background: color-mix(in srgb, var(--thu-accent) 34%, transparent); }
  100% { background: color-mix(in srgb, var(--thu-accent) 6%, transparent); }
}

.hl-label {
  position: absolute;
  top: 0;
  left: 0;
  display: none;
  align-items: center;
  gap: 8px;
  max-width: 240px;
  height: 22px;
  padding: 0 7px;
  border-radius: 5px;
  background: var(--thu-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  will-change: transform;
}
.hl-identity {
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.hl-size { opacity: 0.8; font-variant-numeric: tabular-nums; }
`;

/** Page pins. Positioned with transforms only, so page layout is untouched. */
export const PIN_CSS = `
.pin-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.pin {
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 2px solid #fff;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: var(--thu-pin-fill, var(--thu-fg-dim));
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
  cursor: pointer;
  will-change: transform;
}

/*
 * Pin fills, with the ordinal in white on top. Chosen for contrast against
 * white rather than against the page, and darkened from the first version --
 * white on the old amber measured 3.4:1, which is a number this product exists
 * to flag on other people's pages. Literal rather than tokenised because the
 * content stylesheet is injected into pages whose custom properties are not
 * ours to read.
 */
.pin[data-severity="critical"] { --thu-pin-fill: #b31038; }
.pin[data-severity="high"]     { --thu-pin-fill: #a04a10; }
.pin[data-severity="medium"]   { --thu-pin-fill: #7d5a00; }
.pin[data-severity="low"]      { --thu-pin-fill: #2f5fb5; }
.pin[data-severity="info"]     { --thu-pin-fill: #5c6270; }

/*
 * A pin keeps its own fill under the pointer.
 *
 * The fill is set as a custom property rather than as a background colour,
 * because the toolbar's generic hover rule -- button:hover:not(:disabled) --
 * is a type plus two pseudo-classes, which outranks a class plus an attribute.
 * Without this, every pin dropped its colour for the toolbar's pale hover the
 * moment the pointer touched it, taking the white ordinal on it down to
 * invisible. Setting the property here and reading it back in one rule that
 * outranks the generic one keeps the two systems from fighting.
 *
 * Found by looking at a screenshot with the pointer resting on a pin, which is
 * where a pointer usually is when somebody is about to click one.
 */
.pin:hover:not(:disabled) { background: var(--thu-pin-fill, var(--thu-fg-dim)); }

/* The "display: grid" above beats the user-agent [hidden] rule, so without
   this a pin whose element scrolled away keeps rendering at its last spot. */
.pin[hidden] { display: none; }

/*
 * Comment pins are the user's own marks, not Thursday's measurements, so they
 * are a different shape as well as a different colour: a squared-off pin in
 * the accent teal, lettered rather than numbered. Shape carries the
 * distinction for anyone who cannot tell the two fills apart.
 */
.pin[data-kind="comment"] {
  --thu-pin-fill: #0f6b6b;
  border-radius: 5px;
}

.pin[data-approximate="true"] { border-style: dashed; }

.pin[data-active="true"] {
  outline: 3px solid var(--thu-accent);
  outline-offset: 2px;
  transform-origin: center;
  z-index: 1;
}

.pin:hover { filter: brightness(1.12); }
.pin:focus-visible { outline: 3px solid var(--thu-accent); outline-offset: 2px; }
`;
