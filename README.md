# Thursday

A local-first website audit tool for Chrome. Select any element on a live site and get
evidence-backed UX/UI/accessibility findings.

**No account. No server. No network.** Thursday cannot send your page anywhere — and the build is
tested for it, not just documented.

See [PLAN.md](PLAN.md) for the full engineering plan.

---

## Status

Sprints 1–5 of 6 are complete. **Thursday audits pages, marks them up, keeps the results and
tells you what changed.**

- **Sprint 1** — extension foundation: on-demand injection, shadow-DOM toolbar, typed messaging, four privacy guards.
- **Sprint 2** — inspection: click any element and read its measured facts (box, type, color, accessibility, reference), plus the page snapshot pipeline behind it.
- **Sprint 3** — the rule engine: 30 deterministic rules across accessibility, UI, UX, content, conversion and responsive layout, each finding carrying its own evidence.
- **Sprint 4** — the findings UI: numbered pins on the page, grouped and filterable findings, the detail card, statuses, notes and report membership.
- **Sprint 5** — persistence and files: audits survive a restart, save and reopen as `.thursday.json`, export as a self-contained HTML report, and re-audit to see what was fixed.

Next is Sprint 6: hardening, performance and packaging for the store.

## Keeping an audit

Finished audits are stored on this machine and listed per site, so reopening one takes a click.
Reopening says so on screen, because findings from last week are not a measurement of the page in
front of you — and its pins are drawn dashed when their position had to be found by searching the
live page rather than measured.

Two file formats, for two readers:

- **`.thursday.json`** is Thursday's own. It reopens with every finding, status and note intact, and
  re-pins a live page. A file from a newer version is refused rather than half-read.
- **An HTML report** is for everyone who does not have Thursday. One file, no scripts, nothing
  loaded from the network: it opens offline in any browser and prints cleanly to PDF.

**Re-audit and compare.** Run it, fix things, run it again: Thursday pairs the two audits up and
tells you what is fixed, what is still open and what is new. Anything you dismissed stays
dismissed, because triage belongs to you and not to the run.

**Screenshots are off by default.** You can attach a cropped screenshot to a finding once you turn
them on in settings. A crop is the only evidence Thursday stores that can contain something it
otherwise never reads, so it is the one feature you have to ask for — and a crop of anything that
is or contains a password or payment field is refused even then.

Settings has the other end of this: how much is stored, deletion per site, delete everything, and a
switch to keep no history at all.

## The rules

| Category | Rules |
|---|---|
| Accessibility | missing alt, unlabelled fields, contrast, touch targets, heading hierarchy, focus indicator, empty controls, duplicate ids, document lang/title, positive tabindex |
| UI | inconsistent buttons, spacing off the page's scale, type sprawl, alignment near-misses, near-duplicate colours |
| UX | competing calls to action, oversized navigation, long ungrouped forms, non-obvious clickables |
| Content | vague link labels, duplicate link text, long paragraphs, reading grade, shouting text, unheaded copy |
| Conversion | no action before the fold, too many competing actions in the first screen |
| Responsive | horizontal overflow, fixed-width blockers, tiny text on small screens |

Three things the rules will not do: report a contrast ratio it cannot actually compute (it says
"could not be verified", and why), call a heuristic a WCAG violation, or claim a spacing scale
exists when the page has none.

## Run it

```bash
npm install
npm run build
```

Then in Chrome:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the `dist/` folder
3. Open any website, click the Thursday icon, then **Activate on this page**

The floating toolbar appears on the page and the audit panel opens beside it.

Nothing is injected until you click Activate, so the toolbar does not survive a reload — that is
the cost of asking for no host permissions, and it is deliberate.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Builds pages, content script and service worker into `dist/` |
| `npm run dev` | Rebuilds the extension pages on change (reload the extension to pick up changes) |
| `npm run typecheck` | TypeScript, strict, no emit |
| `npm run guard` | Static privacy guards (see below) |
| `npm run test:unit` | Vitest — pure logic |
| `npm run test:e2e` | Playwright — real Chromium with the extension loaded |
| `npm run build:test` | Test-only build with wider host access (see below) |
| `npm test` | All of the above, in order |

First E2E run needs a browser: `npx playwright install chromium`.

## The privacy guards

Four checks turn the promises in PLAN.md section 1 into properties:

1. **No network APIs in `src/`** — `npm run guard` fails on `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `importScripts`.
2. **No form-value reads in `src/content/`** — the content script has no code path that can read what you typed.
3. **Manifest shape** — `tests/unit/manifest.test.ts` asserts exactly four permissions, no host permissions, no content scripts, no web-accessible resources, no external connectability.
4. **Zero requests at runtime** — `tests/e2e/network.spec.ts` exercises the whole extension in real Chromium and asserts the browser made no request outside the local fixture and the extension's own pages.

Widening any of these has to break a test.

The E2E suite loads two builds: `dist/` exactly as it ships, and `dist-test/` — a copy that differs
only in host access. Playwright cannot click a browser-chrome extension action, and that click is
what grants `activeTab`, so without the second build the real injection path would be untestable.
The copy grants a fake fixture origin that does not exist, plus `<all_urls>`, which Chrome demands
specifically for `chrome.tabs.captureVisibleTab` — a narrow host permission is refused outright, so
without it the screenshot pipeline could not be tested at all. The shipped manifest is unchanged,
a test asserts it never contains that string, and the product itself contains no test hooks.

## Layout

```
manifest.config.ts     typed manifest, the single source for permissions
src/background/        service worker: router only, holds no state
src/content/           injected on demand: shadow host, toolbar, selection, snapshot
src/audit/             rules, engine, measurement, element identity, audit comparison
src/report/            the self-contained HTML report
src/sidepanel/         React audit UI, owns audit state
src/popup/             activation entry point (the only place that can grant activeTab)
src/options/           settings and data management
src/shared/            types, message protocol, constants, utilities
src/storage/           settings, IndexedDB and its migrations, the audit file format
scripts/               icon generator, privacy guard
tests/                 unit (Vitest) · fixtures · e2e (Playwright)
```
