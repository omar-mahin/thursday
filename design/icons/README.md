# Toolbar icons

The drawings behind the page toolbar's buttons, one SVG per action.
`cancel.svg` is the `close` action; the rest are named after theirs.

`report.svg` is here but unused: the toolbar's Report button was removed
because the side panel already has Save report and Save PDF. It is kept in case
that changes, and named in `tests/unit/toolbar-icons.test.ts` so that an unused
drawing is on the record rather than one somebody forgot to wire up -- the same
test fails if a new SVG is added and never used.

**These files are not shipped.** They deliberately do not live in `public/`,
which Vite copies into `dist/` wholesale -- an extension package should contain
what it runs and nothing else, and `scripts/check-bundle.mjs` will fail the
build if they end up there.

What the extension actually mounts is the same geometry inlined in
[`src/content/toolbar/icons.ts`](../../src/content/toolbar/icons.ts), because a
content script cannot read a file out of the repo. That makes two copies of one
thing, so `tests/unit/toolbar-icons.test.ts` compares them and fails when they
disagree -- which is the failure mode worth guarding, since a redrawn SVG that
nobody re-inlines looks completely fine in a diff.

Redrawing one:

1. Replace the SVG here, keeping `viewBox="0 0 24 24"`.
2. Copy each `d` into `TOOLBAR_ICONS`, in the same order, and nothing else --
   no `stroke`, no `stroke-width`, no caps. `styles.ts` decides all of that for
   the whole set at once, and an icon that brings its own colour will not turn
   white when a mode is switched on.
3. Draw strokes, not filled outlines of strokes. A filled shape keeps its width
   while everything around it follows `stroke-width`.
4. Look at it at 18px, which is the size it renders at. The set's previous Audit
   icon passed every assertion and was indistinguishable from Select on screen.
