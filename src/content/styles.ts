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
  /* Centred on the button, then nudged by however much it would otherwise hang
     off the window. The nudge is set by clampTip in toolbar.ts. */
  --tb-shift: 0px;
  transform: translate(calc(-50% + var(--tb-shift)), -3px);
  /* Never a click target: it sits under the pointer that summoned it. */
  pointer-events: none;
  transition: opacity 90ms ease, transform 90ms ease;
}
.tb-btn:hover .tb-tip,
.tb-btn:focus-visible .tb-tip {
  opacity: 1;
  transform: translate(calc(-50% + var(--tb-shift)), 0);
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

/**
 * The ruler.
 *
 * Its own stylesheet section rather than an extension of the highlight, because
 * the two answer different questions: the highlight says "this is the element
 * under your pointer", the ruler says what that element measures.
 *
 * Everything is positioned with transforms on a fixed layer, so nothing here
 * can reflow the page being measured -- which would be a special kind of
 * useless in a measuring tool.
 */
export const RULER_CSS = `
.rl-outline {
  position: absolute;
  top: 0;
  left: 0;
  display: none;
  box-sizing: border-box;
  /* Dashed and pink, so it reads as an annotation over the page rather than as
     part of it. A solid accent border is too easy to mistake for a focus ring. */
  border: 1.5px dashed #ec4899;
  border-radius: 2px;
  pointer-events: none;
  will-change: transform, width, height;
}

/* Hairlines extending the element's edges, for judging alignment against the
   rest of the page. Faint on purpose: they are a straight edge, not content. */
.rl-guide {
  position: absolute;
  top: 0;
  left: 0;
  display: none;
  pointer-events: none;
  background: color-mix(in srgb, #6366f1 45%, transparent);
  will-change: transform;
}
.rl-guide[data-axis="h"] { width: 100vw; height: 1px; }
.rl-guide[data-axis="v"] { width: 1px; height: 100vh; }

/* The gap pills, sitting in the middle of the space they describe. */
.rl-gap {
  position: absolute;
  top: 0;
  left: 0;
  display: none;
  height: 20px;
  padding: 0 7px;
  border-radius: 10px;
  background: #8b5cf6;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  will-change: transform;
}

.rl-hud {
  position: absolute;
  top: 0;
  left: 0;
  display: none;
  align-items: center;
  gap: 6px;
  max-width: calc(100vw - 8px);
  padding: 5px 8px;
  border-radius: 10px;
  background: #16181e;
  color: #e7e9ee;
  font-size: 12px;
  font-weight: 500;
  line-height: 22px;
  white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.32);
  pointer-events: none;
  will-change: transform;
  /* Never a scrollbar and never wider than the screen: on a narrow viewport the
     chips at the end are clipped, which loses information but cannot push the
     bar off where it can be read at all. */
  overflow: hidden;
}
/* Shown by the attribute the ruler sets, never by clearing an inline style --
   see the note in ruler.ts about why clearing an inline display value reverts
   to a display-none rule and hides the thing you meant to show. */
.rl-outline[data-on="true"],
.rl-guide[data-on="true"],
.rl-gap[data-on="true"] { display: block; }
.rl-hud[data-on="true"] { display: flex; }
.rl-chip[data-on="false"], .rl-div[data-on="false"] { display: none; }

.rl-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border-radius: 6px;
  font-variant-numeric: tabular-nums;
}
/* One divider between groups: dimensions | typography | colour and contrast. */
.rl-div {
  flex: none;
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.16);
}
.rl-size { background: #2b2f3a; color: #fff; font-weight: 700; }
/* The font stack and the size are what people look for first, so they are the
   two that get colour. */
.rl-family { background: #4c1d95; color: #ddd6fe; }
.rl-fontsize { background: #0e7490; color: #a5f3fc; }
.rl-weight, .rl-plain { color: #a8adba; }
.rl-colour { background: #2b2f3a; color: #fff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.rl-swatch {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  /* An outline, so a swatch of the page's own background colour is still a
     visible circle rather than a hole in the bar. */
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.45);
}
.rl-grade { font-weight: 700; }
.rl-grade[data-state="pass"] { background: #14532d; color: #86efac; }
.rl-grade[data-state="fail"] { background: #7f1d1d; color: #fca5a5; }
/* Not "fail". Nothing was measured, and a red badge would be a claim. */
.rl-grade[data-state="unknown"] { background: #2b2f3a; color: #a8adba; font-weight: 500; }
`;

/**
 * The on-page comment composer.
 *
 * Dark whatever the page is, and whatever the theme is. The card sits directly
 * on somebody else's design and has to read as Thursday's own surface rather
 * than as part of the page -- a light card on a light page looks like a modal
 * the site opened, and the user is about to write a criticism of that site
 * inside it.
 */
export const COMPOSER_CSS = `
.cm-card {
  position: absolute;
  top: 0;
  left: 0;
  width: 320px;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid #2b2f3a;
  border-radius: 12px;
  background: #16181e;
  color: #e7e9ee;
  font-size: 13px;
  line-height: 1.45;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
  will-change: transform;
}
.cm-card[hidden] { display: none; }

.cm-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid #2b2f3a;
}
.cm-who {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
}
.cm-name {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid #4c5565;
  border-radius: 6px;
  background: #0f1116;
  color: #e7e9ee;
  font: inherit;
}
.cm-edit {
  flex: none;
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #7c9cff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  /* Small text, so it still needs to be a real target: 2.5.8 applies to a
     link-shaped button as much as to an icon. */
  min-width: 24px;
  min-height: 24px;
}
.cm-edit:hover { background: #21252e; }

.cm-priorities { display: flex; gap: 8px; margin-bottom: 8px; }
.cm-priority {
  flex: 1;
  min-height: 32px;
  padding: 4px 8px;
  border: 1px solid #3a4150;
  border-radius: 16px;
  background: transparent;
  color: #a8adba;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.cm-priority:hover { background: #21252e; }
/* Each level keeps its own colour when chosen, so the choice is legible without
   reading the word -- and none of them is red-on-dark at low contrast. */
.cm-priority[data-on="true"][data-level="normal"] { border-color: #6b7280; background: #343a46; color: #fff; }
.cm-priority[data-on="true"][data-level="medium"] { border-color: #d97706; color: #fbbf24; }
.cm-priority[data-on="true"][data-level="high"] { border-color: #dc2626; color: #f87171; }

.cm-body {
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-height: 84px;
  padding: 8px;
  border: 1px solid #4c5565;
  border-radius: 8px;
  background: #0f1116;
  color: #e7e9ee;
  font: inherit;
  resize: vertical;
}
.cm-body::placeholder { color: #6b7280; }

.cm-queue { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.cm-queue li { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.cm-file { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #a8adba; }
.cm-drop {
  flex: none;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #a8adba;
  font: inherit;
  cursor: pointer;
}
.cm-drop:hover { background: #21252e; color: #fff; }

.cm-error { margin: 8px 0 0; color: #fca5a5; font-size: 12px; }
.cm-error[hidden] { display: none; }

.cm-foot { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.cm-spacer { flex: 1; }
.cm-attach {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid #3a4150;
  border-radius: 8px;
  background: transparent;
  color: #e7e9ee;
  cursor: pointer;
}
.cm-attach:hover { background: #21252e; }
.cm-clip { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.cm-cancel, .cm-add {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.cm-cancel { background: #343a46; color: #e7e9ee; }
.cm-cancel:hover { background: #3f4653; }
.cm-add { background: #4f46e5; color: #fff; }
.cm-add:hover { background: #4338ca; }
.cm-add:disabled, .cm-cancel:disabled, .cm-attach:disabled { opacity: 0.55; cursor: default; }

.cm-card button:focus-visible, .cm-card textarea:focus-visible, .cm-card input:focus-visible {
  outline: 2px solid #7c9cff;
  outline-offset: 2px;
}
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
