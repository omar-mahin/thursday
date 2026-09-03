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

.brand {
  padding: 0 6px 0 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--thu-fg-dim);
  white-space: nowrap;
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

.icon-btn {
  padding: 6px 7px;
  color: var(--thu-fg-dim);
  font-size: 14px;
  line-height: 1;
}
.icon-btn:hover:not(:disabled) { color: var(--thu-fg); }

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
  background: var(--thu-fg-dim);
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
.pin[data-severity="critical"] { background: #b31038; }
.pin[data-severity="high"]     { background: #a04a10; }
.pin[data-severity="medium"]   { background: #7d5a00; }
.pin[data-severity="low"]      { background: #2f5fb5; }
.pin[data-severity="info"]     { background: #5c6270; }

/* The "display: grid" above beats the user-agent [hidden] rule, so without
   this a pin whose element scrolled away keeps rendering at its last spot. */
.pin[hidden] { display: none; }

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
