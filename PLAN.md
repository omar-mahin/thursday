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

- `input` values are **never read**. Nor is anything derived from them: the spec sketched
  `{ type, hasValue }` and even that is gone, because no rule consumes it and any signal about
  contents is a privacy surface with no upside. Thursday cannot tell whether a field is filled,
  which is a stronger claim than "we redact it". No code path reads `.value` in `src/content/` —
  enforced by guard 1.
- Never snapshotted at all: `type` in `password|hidden`, `autocomplete` matching
  `cc-*|new-password|current-password|one-time-code`, `name`/`id` matching
  `/pass|pwd|cvv|cvc|card|ssn|token|secret|otp|iban|account.?number/i`, and labels or placeholders
  naming the same things. Recorded as `{ redacted: true }`.
- **A redacted element is excluded from the candidate set**, so no rule can produce a finding about
  a sensitive field at all — not a weaker finding, none. The consequence is worth stating: the only
  way a screenshot could ever contain a secret is a finding about a *container* that holds one, and
  that is the case the crop guard defends (Sprint 5).
- Text nodes capped at **200 chars** per element, **12k chars** per snapshot. Strings matching
  email / phone / long-digit patterns become `[email]`, `[phone]`, `[number]`.
- No cookies, no `localStorage`, no headers, no request bodies — the extension never reads them.
- **Screenshots are opt-in and off by default**, taken one finding at a time on explicit action,
  and refused for anything that is or contains a sensitive field. A crop is the only evidence
  Thursday stores that can contain something it otherwise never reads, so it is the one feature the
  user has to turn on.
- **Files are the only thing that leaves.** Nothing is written outside the browser profile unless
  the user picks a location and a name.

**CI guards** (these make the constraints real, not aspirational):

```
1. grep-ban in src/: fetch( | XMLHttpRequest | WebSocket | EventSource | sendBeacon | importScripts
2. manifest assertion test: permissions === [storage, activeTab, scripting, sidePanel]
                            && no host_permissions && no externally_connectable
3. lint rule: no .value read on any *Snapshot type
4. Playwright test: intercept all network from the extension origin during a full audit → assert 0 requests
5. built-bundle scan: the same identifiers, in the shipped bytes, dependencies included
```

Guard 5 was added in Sprint 6 and is the one that closes the gap the others left: guards 1-3 are
about our source, and a dependency could have brought a network call with it. None of those
identifiers appears anywhere in the current build.

Guard 4 is the one that matters. It's the claim on the store listing, so it needs a test. As of
Sprint 5 it also covers storing an audit, writing both file formats, reading a file back, comparing
two audits and reopening from history — the surfaces where "just sync it" or "just fetch the logo"
would be easiest to slip in later.

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
  screenshots?: Record<string, string>;   // findingId → base64 crop, opt-in and off by default
  digest: PageSnapshotDigest;             // trimmed snapshot, enough to re-resolve elements
};
```

As built, the digest keeps only the elements a finding points at, plus the page and viewport the
audit described — twelve locations for a 1500-element page, not fifteen hundred. Reading a file is
the one place Thursday handles input it did not produce, so `storage/file.ts` validates and copies
every field rather than trusting the shape, and refuses a file from a newer format outright.

- **Save** → `.thursday.json` via `showSaveFilePicker()` where available, else a Blob + `<a download>` fallback. No `downloads` permission needed either way.
- **Open** → file input / drag-and-drop onto the side panel. Re-hydrates the audit, and if the current tab is on the same origin, re-resolves every element via the §2.5 ladder and re-renders pins with honest confidence states.
- **Report** → self-contained HTML: inlined CSS, base64 crops, opens offline in any browser, prints cleanly to PDF. This is the shareable artifact for people who don't have Thursday.
- **Re-audit & compare** (small, high-value, cheap once files exist): open a saved audit, re-run on the live page, and diff — `fixed` / `still open` / `new`. Turns Thursday from a snapshot tool into a regression tool. **Built in Sprint 5**, including annotation carry-over, so triage survives a re-run.

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

### Sprint 4 — Findings UI ✅ complete

**Delivered.** Grouped findings list (repeats of one rule collapse into one expandable row),
severity filters, the finding detail card from spec §24, status transitions
(open / accepted / dismissed / resolved), report membership and notes; numbered severity-coloured
page pins with rAF scroll recompute, offscreen culling and zero layout impact; pin ↔ list
numbering that matches in both directions; Escape to close; the panel's whole state as a pure
reducer.

**Verified:** 282 unit tests and 51 Playwright tests. Pins provably do not change page layout
(`scrollWidth`/`scrollHeight`/body height identical before and after), follow the page as it
scrolls, hide when their element leaves the viewport, and open the right finding when clicked.
The panel is fully keyboard-operable, and **it passes its own contrast rule** — the E2E suite
samples the panel's own computed colours and runs them through `contrastRatio`, so an
accessibility tool that fails its own rules cannot ship.

**Two bugs the tests caught:**
1. **Hidden pins kept rendering at stale positions.** `.pin { display: grid }` overrides the
   user-agent `[hidden]` rule, so `button.hidden = true` had no visual effect and off-screen pins
   floated over the page at their last coordinates.
2. **A build failure hid behind a suppressed command.** A CSS comment inside a template literal
   used backticks, which closed the string; because the build output was piped to `/dev/null`, the
   next test run silently used a stale bundle. Build output is no longer suppressed.

**Design decisions:**
- **Accepting a finding keeps it in the list.** Accepting is agreement that something is a
  problem, not a statement that it is handled — only *dismissed* and *resolved* get out of the way.
- **Closing the open finding advances the selection**, so the detail card never sits there showing
  something the user has just dismissed.
- **A finding with no element gets no pin.** A pin with nothing behind it is a lie about where the
  problem is; page-level findings show `·` in the list instead of a number.
- **Pins prefer the element measured during the audit** (O(1), and it reflects the page as it is
  now); the resolution ladder is the fallback, and a pin found that way is drawn dashed because its
  position is a guess.
- Status, notes and report membership live in memory. Sprint 5 persisted them.

### Sprint 5 — Persistence, files & reports ✅ complete

**Delivered.** IndexedDB with a migration runner and three stores; audit history per origin, with
per-audit and per-origin deletion and a real storage-usage readout in options; automatic saving of
finished audits (switchable off); status, note and report membership persisted with the finding;
save and open `.thursday.json` with full validation of an untrusted file; a self-contained HTML
report; opt-in screenshot crops with a sensitive-field refusal; and re-audit comparison with
annotation carry-over.

**Verified:** 383 unit tests and 78 Playwright tests. IndexedDB is tested against real IndexedDB in
real Chromium, not a mock — the store definitions, index lookups and transaction boundaries are
exactly what a fake would get wrong. An audit provably survives the panel closing, reopens with its
findings, statuses and notes, and re-pins a live page; deleting an audit leaves no orphan findings;
clearing from options empties all three stores. The exported report is loaded from a route with
every other request aborted, and provably fetches nothing. A crop of a form containing a password
field is refused, and the *same* finding on the *same* page captures once the password field is
removed — a controlled pair, so a guard that refused everything would fail. The zero-network guard
now also covers storing, exporting, importing, comparing and reopening. And the new panel surfaces
pass Thursday's own contrast rule.

**Four defects the tests caught:**
1. **A restored audit could pin the wrong elements.** An element index is only meaningful for the
   snapshot it came from, and reopening an audit — or running a second one — hands the page indexes
   from a different snapshot, where index 42 is an unrelated element. Snapshots now carry an id,
   pins carry it too, and the page uses the fast path only when they match. Caught by design, then
   pinned down by a test; the E2E pair also proves the fast path is still *used* when it is valid.
2. **Screenshot crops were cut at the wrong offsets.** The code scaled the element rect by
   `devicePixelRatio`, which is not the scale between CSS pixels and a captured image: browser zoom
   changes it, and the capture is the real content area rather than whatever the page believes its
   viewport to be. Under test the two differed by 87px and every crop was silently displaced. The
   scale is now *measured* (`image.width / viewport.width`), which is exact in both cases, and a
   capture that cannot be of this page at all is refused rather than cropped — a mistimed capture
   would otherwise produce a wrong screenshot rather than a failed one.
3. **The settings toggles were named "Off".** Their accessible name came from the state text beside
   the checkbox, so a screen reader announced the value and never the subject. Found because a test
   could not locate the control by name — which is the same problem a user would have had.
4. **Typing a note reset the finding list.** The first cut wrote annotations back into the active
   audit, whose identity the list effect keyed on, so every keystroke reloaded the list and moved
   the selection. The reducer now owns annotations while the panel is open and they are merged back
   only where they are needed — export, comparison, storage.

**Design decisions:**
- **The digest, not the snapshot, is what persists.** Storing 1500 fully-measured elements to
  reopen one audit would cost megabytes for facts nothing reads back, so a stored audit keeps only
  the page it described and where the pinned elements were. Re-finding them is the ladder's job.
- **History is on by default and can be switched off.** History is the feature, but auditing a page
  does write its URL and title to disk, and someone working on a private system is entitled to
  decline that and still use the tool.
- **Screenshots are off by default.** A crop is the only kind of evidence Thursday keeps that can
  contain something it otherwise never reads. Where the guard actually has to work is subtler than
  it looks: a sensitive field is redacted out of the snapshot during collection, so no rule can
  produce a finding about one directly — the reachable case is a finding about a *container* that
  happens to hold a secret, and that is what the fixture and the test cover.
- **A file from a newer format is refused, not half-read.** Ignoring fields we do not understand
  would let a v2 file open as a v1 audit with parts quietly missing, and the user could not tell.
- **An audit file is treated as hostile input.** It can arrive by email, and its strings end up in
  the panel and in an HTML report. No object from a file is ever spread into ours: every field is
  read, type-checked and copied, unknown keys are left behind, and the report escapes everything and
  emits only inline images and `http(s)` links.
- **A re-audit inherits the user's triage.** Dismissing a finding and re-running must not resurrect
  it; status, note and report membership belong to the person, not the run. Findings are matched by
  rule plus element identity, using the same precedence as the resolution ladder — matching on
  position first would report every reflowed page as entirely new.
- **Findings are paired as multisets, not sets.** Six small targets becoming two is four fixed, and
  calling that "unchanged" would hide the work.
- **A reopened audit says so.** Without the banner the panel looks identical whether the findings
  came from the live page or from a file someone emailed, and every pin would be read as a
  measurement of the page in front of you.

**Not automated:** `showSaveFilePicker` opens a native dialog no test can drive, so the tests
exercise the `<a download>` fallback — same Blob, same file name, same bytes — and the picker itself
is checked by hand. Also `chrome.tabs.captureVisibleTab` requires `<all_urls>` or `activeTab`
specifically (a narrow host permission is refused outright), so `dist-test/` now grants `<all_urls>`
to make the capture pipeline testable at all. The shipped manifest is unchanged, and a test asserts
it never contains that string.

### Sprint 6 — Hardening & ship ✅ complete

**Delivered.** Both Definition-of-Done flows as end-to-end tests; a performance
pass with budgets rather than benchmarks; **Thursday audited by Thursday** — the
whole thirty-rule engine over the real markup and real stylesheet of the panel,
the popup, the settings page and the exported report; frame coverage reported
instead of silently skipped; a keyboard activation shortcut; a hand-written
packaging step with a byte-for-byte test and a load-the-zip-in-Chrome test; a
fifth guard over the shipped bundle; and the store listing with its permission
justifications and data disclosures.

**Verified:** 402 unit tests and 102 Playwright tests.

**Two defects in the rules, found by pointing Thursday at itself:**
1. **UX-001 treated every named button as a call to action.** It fired on
   Thursday's own findings list, comparing two clickable list rows as competing
   CTAs, and would have fired on any application with a toolbar or a list of
   rows. A call to action has been *promoted*: a fill that differs from the
   background behind it, or a shadow lifting it off the page. A button the same
   colour as the card it sits on has not been, whatever else is true of it.
2. **A11Y-004 measured a checkbox instead of the label that activates it.**
   Clicking anywhere in a wrapping `<label>` toggles the control, so the label
   is the target WCAG 2.5.8 measures — saying otherwise fires on very nearly
   every checkbox on the web. The check is structural (is there a label around
   it) and deliberately not "did the name come from a wrapping label": a control
   with an `aria-label` takes its name from the attribute while still being
   activated by the label, and the first version of the fix missed exactly that
   case, on Thursday's own settings page.
   A11Y-004 also stopped reporting elements of a few pixels: the visually-hidden
   pattern is everywhere (skip links, the file input behind a styled button),
   and "give this 1px input 24px" is advice nobody can act on.

**Eighteen defects in Thursday's own UI, all fixed.** The panel's severity
labels — its most meaningful text — measured **3.33:1** at 11px; five targets
sat under the WCAG 24px floor; metadata was 11px at panel width. The popup's
Settings link was 43 × 16px. Settings had two 16px toggles and a 4px gap on an
otherwise-8px page. Severity colours are now tokens with separate light and dark
values, each clearing 4.5:1 against the surface it sits on, and the pin fills
were darkened because white on the old amber measured 3.4:1 — a number this
product exists to flag on other people's pages.

**One performance defect, an 18× win.** The audit of a heavy page took 156ms,
and almost all of it was dedupe: the ancestor-collapse pass compared every
finding with every other one, rebuilding an ancestor chain each time. A page
with a thousand controls under the touch-target minimum meant a million chain
walks, nearly all of them on findings the per-rule cap discarded immediately
afterwards. Walking each element's chain once is the same answer in linear time.
**156ms → 8.5ms.** The test that should have caught it was measuring each rule
*through the whole engine*, so it charged the rules for dedupe and reported the
slowest rule at 181ms — that misattribution is why the engine pipeline now has
its own budget, separate from the rules it runs.

**Measured, on a 3000-node page capped at 1500 elements:** snapshot 40ms
(budget 400), full 30-rule audit 8.5ms, slowest single rule 0.7ms, click to
first finding 221ms end to end.

**A correction to section 5.** It called for one `info` finding per frame that
could not be entered. That was wrong: a finding is a claim about the page, and
"we could not look in here" is a claim about the audit. Mixing them puts items
in the findings list nobody can act on, and makes them compete for slots with
real defects under the per-audit cap. Frames are now counted — both cross-origin
and same-origin, since neither is entered — and reported as coverage in the
panel and the report. Frames that loaded nothing are not counted, because there
is no coverage to have missed.

**Two additions worth their size:**
- **A keyboard shortcut** (`Alt+Shift+T`). A keyboard shortcut grants
  `activeTab` exactly as clicking the action does, so it needs no permission —
  and it is the only activation path a keyboard user can reach without a
  pointer. After a reload, which drops the content script, restarting is one
  keystroke instead of two clicks.
- **A fifth guard.** `scripts/check-bundle.mjs` fails if any network identifier
  appears in the *shipped bytes* — dependencies included, after bundling and
  minification — if an unexpected file is in `dist/`, or if a size budget is
  exceeded. Guard 1 proves our source names no network API; this proves the
  artifact does not either. None of those identifiers appears in the current
  build, React included.

**Two process fixes.**

- Running Playwright directly rather than through the npm script skipped the
  `dist-test/` copy, so the suite could quietly test the previous build. That
  cost real time twice, once chasing a CSS fix that was already correct. It is
  now a Playwright `globalSetup`, so a stale artifact is not something anyone
  has to remember.
- A test written in this sprint flaked. `dedupe`'s new performance guard
  compared `time(2000)` against `time(200)`, and with both measurements under a
  millisecond the ratio swung wildly whenever the machine was busy -- it failed
  during a full `npm test`, where the browser suite was competing for the CPU.
  A ratio between two tiny numbers is not a property; it is noise with a
  threshold attached. It now measures 5000 findings once against a single
  absolute budget of 200ms. The linear implementation takes 9ms and the
  pair-comparing one it replaced takes ~830ms for the same input, so the budget
  sits between them with room on both sides.
  Playwright now also writes a JSON report and keeps a trace and screenshot on
  failure, because the first thing that went wrong with the earlier flake was
  losing which test it was to a shell pipeline.

**Not automated, and stated as such:** the popup's *successful* activation
depends on the `activeTab` grant that comes from clicking the browser action,
and Playwright cannot click browser chrome — so that path, and
`showSaveFilePicker`'s native dialog, are verified by hand. The manual pass on
five real sites is still outstanding.

**Licence.** All rights reserved (`LICENSE`). The source is published so the privacy claims can be
checked by anyone who wants to; using it needs written permission. A public repository with no
licence at all is the worst of both worlds — it reads as an invitation while granting nothing — so
this states the position instead of leaving it to be assumed.

**All six sprints complete.** It ships as a complete product — not an MVP waiting for a backend.
Phase 2 then adds interpretation on top of a working evidence engine, which is the right order
regardless of budget.

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
