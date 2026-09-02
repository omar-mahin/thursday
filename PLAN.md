# Thursday — Engineering Plan

> **Thursday** is a local-first website audit tool that lives in the browser.
> Select any element on a live site and get evidence-backed UX/UI/a11y findings.
> No account, no login, no server, no network. Audits are files on your disk.

Derived from `AI_Website_Auditor_Chrome_Extension_Spec.md`. Working name **AuditLens → Thursday**.
The spec's AI layer is **deferred to Phase 2** (see §12) — this plan builds the complete
deterministic tool first.

---

## 0. Name & identity

| Thing | Value |
|---|---|
| Product name | Thursday |
| Repo root | `thursday/` (single package — no workspaces needed until Phase 2) |
| DOM host element | `<thursday-root>` (open shadow root — see section 2.8) |
| Storage DB name | `thursday` |
| Audit file extension | `.thursday.json` |
| Finding IDs | rule-scoped, not product-scoped: `A11Y-001`, `UI-002`, `UX-004` |

The name lives in exactly one place: `src/shared/constants/product.ts` (`PRODUCT_NAME`, `PRODUCT_SLUG`).
Everything user-facing reads from there. No string literal `"Thursday"` anywhere else in `src/`.

---

## 1. Hard constraints (these define the product)

1. **Zero network.** No `fetch`, no `XMLHttpRequest`, no `WebSocket`, no remote fonts, no
   analytics, no telemetry, no crash reporting. Not "we don't send much" — the code has no
   ability to send anything. Enforced by a CI check (§7).
2. **Zero accounts.** No login, no OAuth, no third-party identity, no install ID, no device
   fingerprint. Nothing in the product knows who the user is.
3. **All data is the user's, on their machine.** IndexedDB for working state, plain files on disk
   for anything they want to keep, move, or share. No sync, no cloud, no export-to-service.
4. **Four permissions, no host permissions.** `storage`, `activeTab`, `scripting`, `sidePanel`.
   Nothing injects until the user clicks.

These are the differentiator now, not a compliance chore. Every AI website auditor on the market
requires an account and ships your page content to a server. Thursday works on an air-gapped
laptop, on staging behind a VPN, and on an internal admin panel you are not allowed to send anywhere.
That is a real, defensible product position — and it should be said plainly in the store listing.

---

## 2. Corrections to the spec (read this first)

The spec is sound as product direction. Six things in it will not survive contact with Chrome,
and one architectural change makes the whole thing testable. These are decided, not open questions.

### 2.1 `activeTab` alone cannot power a persistent toolbar
The spec's minimal permission set is correct and we keep it — but it changes the UX contract:
**no content script is declared in the manifest**. Nothing is injected until the user clicks the
action, at which point the service worker calls `chrome.scripting.executeScript` on the active tab.
Consequence: the toolbar does *not* survive navigation or reload, and Thursday has zero presence
on sites the user never activated.

That is the right trade (it *is* the privacy story), but the side panel must show
"Activate Thursday on this page" rather than assuming injection. `optional_host_permissions:
["<all_urls>"]` can be requested later, per-origin, behind a settings toggle — never at install time.

### 2.2 Rules must not run against live DOM
The spec's `AuditRule.run(context: AuditContext)` implies rules touch the page. That makes every
rule untestable outside a browser and invites layout thrash. Instead:

```
content script  →  ONE read pass  →  PageSnapshot (plain JSON, structuredClone-safe)
                                         │
                                         └─ rules: (snapshot) => Finding[]   ← pure, Node-testable
```

Rules become pure functions over a serialized snapshot, running in the side panel (or in Vitest)
with no DOM access at all. The content script's only jobs are: measure, highlight, pin, scroll.
This is the single most important structural decision in the plan — and it is also what makes the
Phase 2 AI layer a pure add-on rather than a rewrite.

### 2.3 Contrast cannot always be computed — say so
`getComputedStyle().backgroundColor` returns `rgba(0,0,0,0)` constantly. Real algorithm: walk
ancestors accumulating alpha-composited backgrounds until an opaque stop. If we hit a
`background-image`, gradient, `backdrop-filter`, `mix-blend-mode`, or a positioned element
overlapping the text box, the result is **`indeterminate`**, not a guess. Indeterminate contrast
emits an `info` finding ("could not verify — visual check needed"), never a `high`.
Faking a number here is the fastest way to lose designer trust (spec §47, Shortcut 2).

### 2.4 There is no accessible-name API on the web platform
`Element.computedName` exists only in DevTools/CDP. We implement a documented **subset** of
accname in `audit/accessibility/accname.ts`: `aria-labelledby` → `aria-label` → native
(`<label for>`, wrapping label, `alt`, `value` on buttons, `title`) → text content →
`placeholder` (last resort, flagged weak). Each result carries `{ name, source, confidence }`.
Rules depending on it (A11Y-002, A11Y-007) downgrade severity when `source === 'weak'`.

### 2.5 CSS selectors as element identity will break
Keep the spec's descriptor, add a **resolution ladder** with an explicit confidence level, tried
in order when re-opening a saved audit:

1. `id`, if unique and not framework-generated (reject `/^(:r|ember|mui-|radix-|__)/`, `/\d{4,}/`)
2. `data-testid` / `data-test` / `data-qa`
3. `role` + accessible name, if unique in document
4. tag + normalized text snippet, if unique
5. structural path (`nth-of-type` chain, capped at 6 levels from nearest landmark)
6. geometric fallback: `elementFromPoint` at the stored viewport-relative centroid, verified against tag + rect within ±15%

Within a live session, identity is a `WeakMap<Element, string>` — no re-query, no drift.
Selectors exist only for persistence, and a re-resolved element renders its pin in a
"position approximate" state at level ≥ 5, or "element not found" when the ladder fails.
**This matters more without AI**: re-opening a saved `.thursday.json` a week later is a core flow.

### 2.6 jsdom cannot test layout rules
`getBoundingClientRect()` returns all zeros in jsdom. So the test split is:

- **Vitest (Node)** — everything pure: contrast math, accname subset, dedupe, severity, readability math, and *every rule* fed hand-written snapshot fixtures.
- **Playwright (real Chromium, `--load-extension`)** — snapshot *production* from fixture HTML, selection/overlay/pin behavior, messaging, persistence, export/import round-trip.

Rules are tested in Vitest against fixture snapshots; the snapshot *builder* is tested in Playwright.
Never test a rule through a browser.

Vitest runs two projects: `node` for pure logic, and `jsdom` for DOM-structure logic that needs no
layout — accessible names and element identity. E2E uses two extension builds: `dist/` exactly as it
ships, and `dist-test/`, a copy whose only difference is host access to the fake fixture origin.
Playwright cannot click a browser-chrome action, and that click is what grants `activeTab`, so
without the second build the real injection and messaging path would be untestable. No test hooks
exist in the product itself.

### 2.7 The shadow root is open, not closed
Reversed during Sprint 1. The isolation that matters is the shadow boundary itself, which behaves
identically either way. A closed root does not actually stop a hostile page — it can still see the
host element, watch mutations, and patch `attachShadow` before we run — while an open root lets the
E2E suite drive the real UI instead of forcing a testing backdoor into the content script. A
backdoor is the genuinely worse security trade.

### 2.8 Full-page screenshots are out of MVP
`chrome.tabs.captureVisibleTab` captures the **visible viewport only**, at `devicePixelRatio`.
Full-page needs scroll-and-stitch (janky, mutates scroll, breaks sticky headers) or the `debugger`
permission (alarming install prompt). MVP: viewport capture + per-element crop via
`createImageBitmap` + `OffscreenCanvas` in the side panel, stored as a `Blob` in IndexedDB and
base64-inlined into exports. Crops are captured lazily — only for findings added to a report.

---

## 3. Repo layout

Single package. Node 26 + npm 11 are present locally.

```
thursday/
├── package.json
├── manifest.config.ts            # typed, built into manifest.json by vite
├── vite.config.ts                # @crxjs/vite-plugin
├── PLAN.md
├── src/
│   ├── background/service-worker.ts   # router + activation + capture only, NO state
│   ├── content/
│   │   ├── index.ts                   # entry, idempotent install/uninstall
│   │   ├── host.ts                    # <thursday-root> + closed shadow + adoptedStyleSheets
│   │   ├── toolbar/                   # draggable floating toolbar
│   │   ├── selector/                  # hover → pick state machine
│   │   ├── overlay/                   # highlight box + measurement label
│   │   ├── pins/                      # numbered severity pins
│   │   └── snapshot/                  # ← the one read pass
│   │       ├── collect.ts             # page + element traversal
│   │       ├── measure.ts             # batched rect/style reads
│   │       ├── visibility.ts          # IntersectionObserver + style checks
│   │       └── redact.ts              # sensitive-data filter (§7)
│   ├── sidepanel/                     # React app: the audit UI
│   ├── popup/                         # activate / status / open panel
│   ├── options/                       # settings, thresholds, data management
│   ├── audit/
│   │   ├── engine/{run.ts,registry.ts,severity.ts,dedupe.ts}
│   │   ├── rules/{a11y,ui,ux,content,cro,responsive}/
│   │   ├── accessibility/{accname.ts,contrast.ts,color.ts}
│   │   └── types.ts
│   ├── report/{json.ts,html.ts,import.ts}
│   ├── storage/{db.ts,audits.ts,findings.ts,blobs.ts,settings.ts,migrations.ts}
│   └── shared/{types,constants,messaging,result.ts}
└── tests/{unit,fixtures,e2e}
```

`src/ai/` is deliberately absent. It arrives in Phase 2 as a new directory plus one call site in
`audit/engine/run.ts` — nothing else changes.

---

## 4. Runtime architecture

```
┌─────────────┐  action click   ┌──────────────────┐
│   popup     │────────────────▶│  service worker  │  stateless router
└─────────────┘                 │  - executeScript │  - port registry (tabId → panel port)
                                │  - sidePanel.open│  - captureVisibleTab
┌─────────────┐   port msgs     └────────┬─────────┘
│ side panel  │◀───────────────────────  │  ────────────────────▶┌─────────────────┐
│  React      │                          └──────────────────────▶│ content script  │
│  owns state │                                                  │ <thursday-root> │
│  + IndexedDB│                                                  └─────────────────┘
└─────────────┘
```

**State ownership.** The MV3 service worker is killed after ~30s idle, so it holds *nothing*: it
routes, injects, and captures. All audit state lives in the side panel (React store) and persists
to IndexedDB on the extension origin. The content script holds only ephemeral DOM state (current
selection, live element handles, pin positions), fully rebuildable from a snapshot.

**Messaging.** One typed union, one file, `chrome.runtime.connect` long-lived ports (not
`sendMessage`) so the panel can stream audit progress and detect content-script death.

```ts
type ThursdayMessage =
  | { type: 'ACTIVATE_PAGE' }
  | { type: 'PAGE_ACTIVATED';    payload: { url: string; title: string; viewport: Viewport } }
  | { type: 'START_SELECTION' }  | { type: 'CANCEL_SELECTION' }
  | { type: 'ELEMENT_HOVERED';   payload: ElementPreview }        // throttled to rAF
  | { type: 'ELEMENT_SELECTED';  payload: ElementSnapshot }
  | { type: 'REQUEST_SNAPSHOT';  payload: SnapshotOptions }
  | { type: 'SNAPSHOT_READY';    payload: PageSnapshot }
  | { type: 'AUDIT_PROGRESS';    payload: { stage: AuditStage; done: number; total: number } }
  | { type: 'RENDER_PINS';       payload: Pin[] }
  | { type: 'FOCUS_ELEMENT';     payload: { ref: ElementReference } }
  | { type: 'ELEMENT_RESOLVED';  payload: { ref: ElementReference; level: 1|2|3|4|5|6 | null } }
  | { type: 'DEACTIVATE' }
  | { type: 'ERROR';             payload: { code: ErrorCode; detail?: string } };
```

Every handler is exhaustive-switched (`never` check). No message string literals outside this file.

**Injection is idempotent.** `content/index.ts` checks for an existing `<thursday-root>` and
re-attaches instead of double-installing (users *will* click the action twice). Uninstall tears
down completely: overlay removed, all listeners dropped via a single `AbortController` signal,
shadow host disconnected, `WeakMap` released.

---

## 5. The snapshot (the core data structure)

One synchronous read pass, no interleaved writes, so the browser does a single layout:

1. Collect candidates: an allowlist of tags + `[role]` + anything with click-ish attributes. Cap at **1500 elements**; if exceeded, prioritize interactive + heading + landmark elements and set `truncated: true`.
2. Cull invisible: `display:none`, `visibility:hidden`, `opacity:0`, zero-area, `aria-hidden`, `inert`, beyond 3 viewports offscreen.
3. Batch-read `getBoundingClientRect()` for all survivors, *then* batch-read `getComputedStyle()` for all survivors. Never alternate — that forces a sync layout per element.
4. Build `ElementSnapshot[]` with the field set from spec §10 (identity / content / layout / box / typography / visual / a11y).
5. Derive relationships as **array indices into the snapshot**, not object references: parent, siblings, nearest landmark, nearest heading, section grouping. Keeps it `structuredClone`-safe and export-safe.
6. Run `redact()` (§7) before the snapshot leaves the content script.

Budget: **< 400ms for a 1500-element page**. Hover feedback is a separate, much cheaper path
(`elementFromPoint` + one rect read, rAF-throttled) with the spec's **< 100ms** target.

Cross-origin iframes are enumerated, never entered — each yields one `info` finding
("embedded content from another origin could not be inspected"). Same-origin iframes: out of MVP,
also reported as `info`. Satisfies spec §36 without a frame-coordination layer.

---

## 6. Rule engine

```ts
type RuleContext = {
  snapshot: PageSnapshot;
  settings: AuditSettings;       // thresholds, e.g. minTouchTarget: 44
  selection?: number;            // index into snapshot.elements
};
type Rule = {
  id: string;                    // 'A11Y-003'
  category: AuditCategory;
  kind: 'rule' | 'heuristic';    // constrains the Finding.type it may emit
  scope: 'page' | 'element';
  run(ctx: RuleContext): RawFinding[];   // synchronous, pure
};
```

Sync + pure means a full audit is a single tick and every rule gets a Vitest file.

The `Finding` shape keeps `type` (`rule | heuristic | inference | recommendation`) and
`confidence` from spec §20–21 even though MVP only ever emits `rule` and `heuristic` at
confidence 1.0 — so Phase 2 adds findings to an existing schema rather than migrating one.

### 6.1 MVP rule set — all deterministic, all local

**Accessibility**

| ID | Rule | Notes |
|---|---|---|
| A11Y-001 | Image missing alt | `alt=""` on a decorative-looking image → `info`, not a violation; size + position heuristic separates informative from decorative |
| A11Y-002 | Form control missing label | via accname subset; `placeholder`-only → `medium`, not `high` |
| A11Y-003 | Low contrast | ancestor compositing; `indeterminate` is a first-class result |
| A11Y-004 | Small touch target | default 44×44 configurable; labeled **usability heuristic**, cites WCAG 2.5.8 (24px) as the normative floor |
| A11Y-005 | Heading hierarchy | structural finding, `medium` ceiling |
| A11Y-006 | Focus indicator | heuristic: inspect `:focus-visible` rules via readable `document.styleSheets`; unreadable cross-origin sheets are skipped, not guessed |
| A11Y-007 | Empty interactive element | `high` — unambiguous |
| A11Y-008 | Duplicate `id` | new; trivial, and genuinely breaks `aria-labelledby` |
| A11Y-009 | Missing lang / page title | new; two-line rule, real screen-reader impact |
| A11Y-010 | Positive `tabindex` | new; deterministic focus-order smell |

**UI**

| ID | Rule | Notes |
|---|---|---|
| UI-001 | Inconsistent button styles | cluster by computed signature; report only when ≥3 buttons share a style and 1–2 deviate |
| UI-002 | Spacing inconsistency | cluster gaps, flag outliers >4px off the modal scale; phrased "potential" |
| UI-003 | Typography sprawl | count distinct (family, size, weight) triples; flag >12 |
| UI-005 | Alignment inconsistency | edge-position clustering within a section, 2px tolerance |
| UI-006 | Color sprawl | new; count distinct text/background/border colors, flag outliers near-but-not-equal to a dominant value (e.g. `#333` vs `#343434`) |

**UX (measurable only)**

| ID | Rule | Notes |
|---|---|---|
| UX-001 | Competing primary CTAs | ≥2 same-section buttons within 15% visual weight |
| UX-002 | Navigation item count | >7 top-level nav items → `info` |
| UX-003 | Form length | field count above threshold, grouped by fieldset presence |
| UX-004 | Non-obvious clickables | new; elements with click handlers or `role=button` lacking cursor/affordance styling |

**Content** — fully computable without a model; this is where the "no AI" gap closes most cheaply

| ID | Rule | Notes |
|---|---|---|
| CNT-001 | Vague link/CTA text | new; `click here`, `learn more`, `submit`, `read more` — with an editable phrase list in settings |
| CNT-002 | Duplicate link text, different targets | new; deterministic and a genuine a11y + UX problem |
| CNT-003 | Long paragraphs | word count + character count per block |
| CNT-004 | Reading difficulty | Flesch–Kincaid on visible body copy; reported as `info` with the grade level, never as a failure |
| CNT-005 | ALL-CAPS / shouting runs | length-thresholded, excludes acronyms |
| CNT-006 | Section without heading | long text blocks with no preceding heading — scannability signal |

**CRO (measurable only)**

| ID | Rule | Notes |
|---|---|---|
| CRO-001 | No CTA in the first viewport | geometric, deterministic |
| CRO-002 | CTA count in hero region | flags >3 competing actions above the fold |

**Responsive**

| ID | Rule | Notes |
|---|---|---|
| RESP-001 | Horizontal overflow | `scrollWidth > clientWidth` + identifies the offending child |
| RESP-002 | Fixed-width blocker | new; elements with `width` in px exceeding common breakpoints |
| RESP-003 | Text too small on mobile viewports | new; `font-size` < 12px when viewport ≤ 480 |

**Deferred to Phase 2** (genuinely need a model — no deterministic stand-in will be faked):
UI-004 visual hierarchy, value-proposition clarity, trust-signal analysis, unanswered objections,
jargon detection, terminology consistency, hypothesis mode.

**Shipped count: 30 rules** — 10 accessibility, 5 UI, 4 UX, 6 content, 2 conversion, 3 responsive.

**Severity** is a pure function of rule + evidence, never of confidence (spec §22):
`severity(ruleId, evidence) => Severity`.

**Dedupe** (spec §34), in order:
1. drop a finding whose element is an ancestor/descendant of another with the same `ruleId`, keeping the innermost
2. exact merge on `(category, normalizedTitle, elementRef.resolved)`
3. cap at 8 findings per element, 5 per rule and 60 per audit, ranked by severity then rule
   specificity — the per-rule cap stops one noisy rule from burying the page, and the suppressed
   count is always reported

No embeddings, no semantic similarity — unnecessary when every finding comes from a known rule.
(Step 3 of the spec's dedupe list — AI-vs-deterministic overlap — arrives with Phase 2.)

---

## 7. Data handling

With no network, the threat model changes: the risk is not transmission, it's what gets **written
to disk and then shared**. An exported `.thursday.json` or HTML report is a file the user emails
to a colleague. So redaction still runs — it protects the export.

`redact()` runs in the content script, before data crosses a port:

- `input` values are **never read**. We emit `{ type, hasValue: boolean, length: 'empty'|'short'|'long' }`. No code path reads `.value` — enforced by an ESLint rule.
- Never snapshotted at all: `type` in `password|hidden`, `autocomplete` matching `cc-*|password|one-time-code`, `name`/`id` matching `/pass|cvv|cvc|card|ssn|token|secret|otp/i`. Recorded as `{ redacted: true, role }`.
- Text nodes capped at **200 chars** per element, **12k chars** per snapshot. Strings matching email / phone / long-digit patterns become `[email]`, `[phone]`, `[number]`.
- No cookies, no `localStorage`, no headers, no request bodies — the extension never reads them.
- Screenshots only on explicit user action.

**CI guards** (these make the constraints real, not aspirational):

```
1. grep-ban in src/: fetch( | XMLHttpRequest | WebSocket | EventSource | sendBeacon | importScripts
2. manifest assertion test: permissions === [storage, activeTab, scripting, sidePanel]
                            && no host_permissions && no externally_connectable
3. lint rule: no .value read on any *Snapshot type
4. Playwright test: intercept all network from the extension origin during a full audit → assert 0 requests
```

Guard 4 is the one that matters. It's the claim on the store listing, so it needs a test.

---

## 8. Storage & the audit file

**Working state — IndexedDB** (`thursday`), with a versioned migration runner from day one:

| Store | Contents |
|---|---|
| `audits` | `Audit` records (spec §27), keyed by id, indexed by `origin` and `createdAt` |
| `findings` | `Finding` records, indexed by `auditId` |
| `blobs` | screenshot crops as `Blob`, keyed by `findingId` |

Settings live in `chrome.storage.local` (small, sync-read at startup): thresholds, category
defaults, theme, vague-phrase list.

**Portable state — files on disk.** This is now a first-class flow, not an export afterthought.

```ts
type ThursdayAuditFile = {
  format: 'thursday.audit';
  version: 1;                    // migrated on import, never silently
  exportedAt: number;
  page: { url: string; title: string; viewport: Viewport };
  audit: Audit;
  findings: Finding[];
  screenshots?: Record<string, string>;   // findingId → base64 crop, opt-out for small files
  snapshotDigest?: PageSnapshotDigest;    // trimmed snapshot, enough to re-resolve elements
};
```

- **Save** → `.thursday.json` via `showSaveFilePicker()` where available, else a Blob + `<a download>` fallback. No `downloads` permission needed either way.
- **Open** → file input / drag-and-drop onto the side panel. Re-hydrates the audit, and if the current tab is on the same origin, re-resolves every element via the §2.5 ladder and re-renders pins with honest confidence states.
- **Report** → self-contained HTML: inlined CSS, base64 crops, opens offline in any browser, prints cleanly to PDF. This is the shareable artifact for people who don't have Thursday.
- **Re-audit & compare** (small, high-value, cheap once files exist): open a saved audit, re-run on the live page, and diff — `fixed` / `still open` / `new`. Turns Thursday from a snapshot tool into a regression tool. Slotted in Sprint 5 if the schedule holds.

Explicitly not built: sync, cloud backup, share links, team workspaces, any server.

---

## 9. Sprint plan

Each sprint ends with something demonstrable and a green test run. Sizing assumes one focused dev.

### Sprint 1 — Foundation ✅ complete

Vite + React + TS strict + `@crxjs/vite-plugin`; typed `manifest.config.ts` (MV3, four
permissions, no host permissions); service worker as pure router; popup with "Activate on this
page"; side panel shell; idempotent content-script install/uninstall; `<thursday-root>` with
closed shadow root + `adoptedStyleSheets` (constructable stylesheets, so page CSP cannot block our
styles) + `all: initial` reset; draggable toolbar; typed port messaging with exhaustive switches;
the four CI guards from §7 wired into `npm test` on day one.
**Delivered.** Vite 8 + React 19 + TS 7 strict; typed `manifest.config.ts` emitting `manifest.json`
at build time; service worker as a stateless router with a port registry; popup-driven activation;
side panel shell with a live message log; idempotent content-script install/uninstall; shadow host
with constructed stylesheets and MutationObserver re-attach; draggable, keyboard-operable toolbar
with a remembered position; all four privacy guards wired into `npm test`.

**Verified:** 19 unit tests, 10 Playwright tests in real Chromium — including hostile page CSS not
crossing the shadow boundary, zero page-layout change on injection, double injection re-attaching
instead of stacking, drag clamping to the viewport, close leaving no DOM trace, and **zero network
requests** across a full exercise of every surface.

**Deferred from this sprint:** `@crxjs/vite-plugin` was rejected — its dev mode injects a loader
that fetches from a dev server, which fights the zero-network posture and makes `dist/` harder to
audit. Cost: no HMR (`npm run dev` rebuilds instead). Manual verification on 5 real sites is still
outstanding; the fixture page covers the hostile-CSS and layout cases automatically.

### Sprint 2 — Inspection ✅ complete

**Delivered.** Selection state machine with rAF-throttled `elementFromPoint` hit testing; highlight
overlay with identity and dimension label; ESC / right-click cancel; capture-phase suppression of
the whole click family (plus a trailing-click guard, see below); self-exclusion of our own UI;
snapshot pipeline (`collect` / `measure` / `visibility` / `redact`) with a shared per-element
builder used by both full-page collection and single-element picking; accname subset reporting its
source and weakness; element descriptor plus the six-rung resolution ladder; the Element inspector
in the panel, showing real measured values.

**Verified:** 81 unit tests, 25 Playwright tests. Snapshot of a login page provably contains none
of the six planted secrets and no `hasValue`-style key; hover feedback lands in <100ms on a
3000-node page; a 3000-node snapshot completes in well under the 400ms budget and respects the
1500-element cap; offscreen culling reduces that page to ~220 elements in <100ms; an element picked
before a reload is found again through the ladder, and the panel says which rung answered.

**Five bugs the tests caught, all fixed:**
1. **Shadow-DOM events leaked into the page.** Events retarget to the host and keep bubbling, so
   every toolbar click reached the page's `document` listeners. Contained at the host boundary.
2. **The trailing click escaped.** Picking on `pointerdown` tore down the listeners before the
   `click` arrived, so the page received it — navigating away from the element just selected.
   A short-lived guard now outlives the session to eat it.
3. **Our own UI was unclickable during selection.** The suppression was indiscriminate, so Cancel
   could not be reached. Events are now checked against `composedPath()`.
4. **The element cap ran before visibility culling**, so a visible element could be dropped in
   favour of a hidden one. Culling now comes first; the cap applies to survivors.
5. **Level 5 of the ladder had no verification.** Deleting an element hands its structural path to
   the next sibling, so a removed element resolved confidently to an unrelated one. Positional
   rungs now require corroboration by text, name, or size.

**Two design changes made while building:**
- **`hasValue` is gone from the form snapshot.** The spec sketched `{ type, hasValue }`; no MVP rule
  consumes it, and any signal about contents is a privacy surface with no upside. Thursday cannot
  tell whether a field is filled, which is a stronger claim than "we redact it".
- **Panel messages no longer route to "the active tab".** They route to the tab that is actually
  running Thursday, because switching tabs mid-audit sent messages to a page with no content script.

### Sprint 3 — Rule engine ✅ complete

**Delivered.** Rule framework, flat registry, severity model, three-pass dedupe with caps, and the
pure audit runner; contrast with alpha compositing and a first-class `indeterminate`;
Flesch–Kincaid; robust spacing-scale fitting; colour and type clustering; **30 rules** across all
six categories; the panel wired to run them.

**Verified:** 253 unit tests and 36 Playwright tests. The E2E audit suite captures real snapshots
from real Chromium over the production message path, then runs the pure engine on them in Node —
so the browser is tested for measuring and the engine for judging. The clean control page produces
**zero findings**; every planted defect on five defect fixtures is found; every finding carries
non-empty evidence, impact and recommendation; no heuristic claims `high` or `critical`; and a
login-page audit leaks none of the planted secrets.

**Six rule defects the fixtures caught, all fixed:**
1. **A11Y-004 flagged a 640 × 24 label.** The 44px recommendation is about compact controls, so it
   now needs *both* dimensions under the threshold; the 24px WCAG floor still fails on one.
2. **UX-004 flagged a `<label>`** for not looking clickable. A label is clickable by design and is
   not meant to look like a button.
3. **UI-002 missed a 19px gap and flagged a legitimate 8px one.** It was clustering repeated values,
   so a step used once looked like an outlier. It now fits a step to the page (`fitScale`), because
   a plain GCD is poisoned by the very outlier being reported: `gcd(16, 19) = 1`.
4. **No step below 8px may be proposed.** With a 2px tolerance every integer is within 2 of a
   multiple of 4, so "the page steps in 4s" is a claim that cannot be false.
5. **CNT-003 extrapolated word counts from a 200-character sample** and under-counted dense copy by
   40%. Word count is now measured during collection, where the full text exists.
6. **One noisy rule could bury the page.** An unstyled form put six inputs under the target
   minimum, pushing everything else down. Findings are now capped per rule as well as per element,
   with the suppressed count reported.

**Deliberately not built:** visual hierarchy, value-proposition clarity, trust signals, unanswered
objections, jargon and terminology consistency. These need interpretation, and a thin regex
pretending to measure them is exactly the shortcut this product exists to avoid. They wait for
Phase 2.

### Sprint 4 — Findings UI (4–5 days) ← next
Side panel: category launcher, progress stages, grouped finding list, severity filters, finding
detail card (spec §24), status transitions (open / accepted / dismissed / resolved), report
membership, notes; pin overlay (numbered, severity-colored, `position:fixed` + transform,
rAF scroll/resize recompute, offscreen culling, zero layout impact); scroll-to-element with
resolution-confidence state; full keyboard nav, visible focus, ESC (spec §38 — an a11y tool that
isn't accessible is indefensible).
**Done when:** clicking a finding scrolls the page, flashes the element, opens the detail; pins
survive scroll, resize, and SPA route changes; the entire panel is operable keyboard-only and
passes its own audit.

### Sprint 5 — Persistence, files & reports (3–4 days)
IndexedDB + migration runner; audit history per origin; screenshot crop + Blob storage; save/open
`.thursday.json`; self-contained HTML report; data management in options (clear all, per-origin
delete, storage usage); re-audit & compare if time allows.
**Done when:** audits survive a browser restart; a saved file re-opens on a fresh profile and
re-resolves its elements; exported HTML renders correctly with networking disabled.

### Sprint 6 — Hardening & ship (3–4 days)
Fixture pages (spec §40) plus a clean control page; Playwright E2E for both Definition-of-Done
flows; performance pass against the snapshot budgets; Thursday audits its own UI; store listing
that leads with local-only/no-account; packaging and privacy disclosures (the "does not collect
any data" declaration is straightforward here, and true).

**Total: ~20–26 focused days**, and it ships as a complete product — not an MVP waiting for a
backend. Phase 2 then adds interpretation on top of a working evidence engine, which is the right
order regardless of budget.

---

## 10. Definition of done

Both flows from spec §53, green in Playwright, with no network and no account:

```
activate → Audit → findings → click finding → jumps to element → evidence/impact/recommendation → resolve → save file
activate → Select element → audit selection → contextual finding → add to report → export HTML
```

Plus the §57 metric, measured on a real site with a real designer:
**can they find a real issue, understand why it matters, and write a useful recommendation in under 2 minutes?**

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Deterministic-only findings feel thin next to AI competitors | 27 rules across 6 categories, incl. the content rules that usually get hand-waved to a model; every finding carries measured evidence a competitor's model-generated prose cannot match |
| False positives destroy trust faster than missing findings | the zero-findings-on-control-page gate in Sprint 3; confidence-gated phrasing; `info` findings collapsed by default |
| Snapshot too slow on heavy SPAs | element cap + visibility culling + batched reads; `truncated` flag surfaced honestly in the report |
| Overlay fights host CSS / z-index / sticky positioning | closed shadow root, `all: initial`, top-layer via `popover` where supported, MutationObserver re-attach if the page removes our host |
| `activeTab`-only means no persistence; users read it as broken | explicit "Activate" affordance + optional per-origin host permission behind a settings toggle |
| Saved audits go stale as the site changes | resolution ladder with visible confidence states + the re-audit/compare flow |
| Scores get treated as science | collapsed by default, labeled "heuristic summary", never the headline (spec §47, Shortcut 3) |

---

## 12. Phase 2 — AI (deferred, decided later)

Nothing in Phases 1 blocks this, and the seams are already cut: rules are pure functions over a
snapshot, `Finding` already carries `type` and `confidence`, and dedupe already has the slot for
AI-vs-deterministic overlap.

When it's time, the decisions to make (spec §56 requires stopping on all three):
1. Model/provider and who pays — a proxy so no key ever ships in the extension.
2. Whether AI is opt-in per audit (recommended) or per install.
3. Whether screenshots may ever reach a model (this plan's default: no).

Non-negotiable when it lands: **local-only mode stays the default**, the network guard test gets
scoped to the local-only path rather than deleted, and the payload-preview UI ships with the
feature — the user sees exactly what would leave their machine before it does.

---

## 13. Explicitly not in this build

AI/model integration, any backend, any account or login, sync, telemetry, Figma / Jira / Slack,
billing, teams, automated multi-viewport capture, full-page stitched screenshots, cross-origin
iframe inspection, DOM mutation of the live site, visual variant generation, hypothesis mode,
A/B infrastructure, any browser other than Chrome.
