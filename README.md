# Thursday

A local-first website audit tool for Chrome. Select any element on a live site and get
evidence-backed UX/UI/accessibility findings.

**No account. No server. No network.** Thursday cannot send your page anywhere — and the build is
tested for it, not just documented.

See [PLAN.md](PLAN.md) for the full engineering plan.

**Source-available, not open source.** The code is published so the claims above can be checked
rather than taken on trust. All rights are reserved: reading it is welcome, using it needs written
permission. See [LICENSE](LICENSE).

---

## Status

**All six sprints are complete, plus comments and PDF export.** Thursday audits pages, marks them
up, lets you write on them, keeps the results, tells you what changed, and passes its own rules.

- **Sprint 1** — extension foundation: on-demand injection, shadow-DOM toolbar, typed messaging, four privacy guards.
- **Sprint 2** — inspection: click any element and read its measured facts (box, type, color, accessibility, reference), plus the page snapshot pipeline behind it.
- **Sprint 3** — the rule engine: 30 deterministic rules across accessibility, UI, UX, content, conversion and responsive layout, each finding carrying its own evidence.
- **Sprint 4** — the findings UI: numbered pins on the page, grouped and filterable findings, the detail card, statuses, notes and report membership.
- **Sprint 5** — persistence and files: audits survive a restart, save and reopen as `.thursday.json`, export as a self-contained HTML report, and re-audit to see what was fixed.
- **Sprint 6** — hardening and ship: both end-to-end flows tested, performance budgets, packaging, and Thursday audited by Thursday.
- **Sprint 7** — comments and PDF: write your own notes on any element, attach images to them, and export the whole audit as a PDF written from scratch with no dependencies.
- **1.0.1** — a ruler on hover, pictures of every finding, and the comment composer moved onto the page.

**482 unit tests and 120 Playwright tests.** [STORE_LISTING.md](STORE_LISTING.md) holds the
submission copy, the permission justifications and the data disclosures.

## Keeping an audit

Finished audits are stored on this machine and listed per site, so reopening one takes a click.
Reopening says so on screen, because findings from last week are not a measurement of the page in
front of you — and its pins are drawn dashed when their position had to be found by searching the
live page rather than measured.

Three file formats, for three readers:

- **`.thursday.json`** is Thursday's own. It reopens with every finding, comment, status and note
  intact, images included, and re-pins a live page. A file from a newer version is refused rather
  than half-read.
- **An HTML report** is for everyone who does not have Thursday. One file, no scripts, nothing
  loaded from the network: it opens offline in any browser and prints cleanly.
- **A PDF** is for the ticket, the print-out and the client who will not open an HTML attachment.

The HTML report is the lossless one. The PDF uses the three fonts every reader is required to
have, so nothing is embedded and the file stays small — but those fonts cover Latin-1 and no more.
Text outside it cannot be drawn, so the PDF counts what it had to replace and says so on its last
page rather than leaving you to wonder whether the question marks were the website's fault.

**Re-audit and compare.** Run it, fix things, run it again: Thursday pairs the two audits up and
tells you what is fixed, what is still open and what is new. Anything you dismissed stays
dismissed, because triage belongs to you and not to the run.

**Every finding comes with a picture of itself.** An audit sweeps the page and photographs each
finding twice over in one image: a crop of the problem with the element outlined, and a thumbnail of
the whole screenful with the same element marked and a track showing where on the page that
screenful sits. Findings below the fold are included — Thursday scrolls to reach them, one capture
per screenful rather than one per finding, and puts the page back where you left it.

This was off by default until 1.0.1 and it should not have been. A crop is the only evidence
Thursday stores that can contain something it otherwise never reads, which is a real risk — but the
answer is to handle it rather than to hide the feature behind a setting nobody finds. **Every
sensitive field on screen is painted out of every picture**, not merely the one being photographed:
a crop taken for a button can contain the password box next to it, and that is covered too. An
element that is or contains a password or payment field is not photographed at all. You can still
turn the whole thing off in settings, and off means no pictures anywhere.

## The ruler

Press **Select** and hover anything. A bar appears with what that element actually measures: its
size, the first family in its font stack, the font size, the weight, the line height, the letter
spacing, its text colour in hex — and, when the element has text of its own, whether it passes AA
and AAA. Purple pills show the gap to the neighbour above and below; four hairlines extend its edges
across the viewport, which is what turns "these look misaligned" into a fact.

Two things it will not do. It **will not grade contrast on an element with no text of its own**: a
wrapper inherits a colour and a size, so those chips are still true of it, but a ratio for text that
is not there is a number about nothing. And it **will not guess a background** — text on an image, a
gradient, a blend mode or a backdrop filter gets "contrast —" and a tooltip saying why, rather than a
fabricated number.

The contrast it shows is resolved by the same code the audit's own contrast rule uses. That is
deliberate and tested: hovering a paragraph and reading *AA passes* while the findings list reports
a contrast failure on that same paragraph would be a contradiction with no way to tell which half
was lying.

## Comments

Findings are what Thursday measured. Comments are what **you** noticed — and the two are kept
apart everywhere, on purpose. A comment has no severity and no confidence, sits in its own section
of the report, and is labelled as an opinion, because the moment somebody's judgement inherits the
authority of a contrast ratio the whole tool is worth less.

You do not need to run an audit first. Press **Comment on an element**, click the thing you mean,
and a card opens **on the page, next to it** — which is the whole point of an on-page annotation tool: the element, the marker and your
words are all in view at once, instead of you looking away to a box somewhere else. Or press
**Comment on the page** and write without picking anything: "the checkout asks for the email twice"
is about the flow, not about one button, and Thursday will not make you pin it to an arbitrary
element.

You do not need the side panel open either — if it is closed, the extension's background worker
stores the comment itself. A note written before you audit anything is kept against that site, and
the next audit of it adopts the note — the same mechanism that carries comments across a re-audit. So you can open a page, write
down what you noticed, and audit it afterwards.

Each comment carries **your name** and a **priority** — Normal, Medium or High. Both are yours
rather than Thursday's: the name is what you typed about yourself in settings, so a report handed to
a client says whose opinion each note is, and the priority is how urgent *you* think your own
opinion is. It is deliberately not a severity. A finding's severity comes from a measurement and
sits on a five-rung ladder Thursday can defend; a priority is kept in different words, on a
different scale, and drawn in a different style everywhere it appears, so nobody weighs the two the
same way.

Comments are lettered — A, B, C — where findings are numbered, so a marker on the page can never be
mistaken for the other kind. They pin, they persist, they travel in the audit file, and they appear
in both the HTML report and the PDF.

**They survive a re-audit**, because a comment is about the page and not about one run over it — you
should be able to write a review, re-run the audit to check a fix, and still have the review. Their
pins are then drawn dashed: the element index they were written with belongs to a capture that is
gone, so the position has to be found by searching the live page.

**Images attach to comments.** Choose files in the card, or paste a screenshot straight into the
panel when adding more to an existing comment. Every
image is decoded, scaled to at most 1600px on the long edge and re-encoded before anything is
written to disk — the original file is never kept, because a 5000px retina PNG is normal and six of
them is not a reasonable thing to leave in a browser database. Captions become the alt text.

Settings has the other end of this: how much is stored — audits, findings, screenshots, comments
and attached images, each counted separately — deletion per site, delete everything, and a switch
to keep no history at all.

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

## Thursday audits itself

Spec §38 says an accessibility tool that fails its own rules cannot ship, so the test suite serves
the real markup and real stylesheet of the panel, the popup, the settings page and the exported
report as pages, and runs the whole thirty-rule engine over them.

It works. The first run found **eighteen defects in Thursday's own UI** — severity labels at
3.33:1, five targets under the WCAG 24px floor, 11px metadata — and **two defects in the rules**
that would have fired on most real websites. All are fixed; what remains is a short, recorded list
of accepted `low` findings, and anything new fails the build.

## Run it

```bash
npm install
npm run build
```

Then in Chrome:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the `dist/` folder
3. Open any website, click the Thursday icon, then **Activate on this page** — or press
   <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>

The floating toolbar appears on the page and the audit panel opens beside it.

Nothing is injected until you ask, so the toolbar does not survive a reload — that is the cost of
asking for no host permissions, and it is deliberate. The keyboard shortcut makes restarting one
keystroke.

The page toolbar is icons rather than words, with the label shown on hover **and on keyboard
focus** — the second one is why it is a styled tooltip and not a `title` attribute, which appears
after a second, cannot be styled, and never appears at all for somebody arriving by keyboard. Every
button is a 30px target with a permanent accessible name, so what a screen reader announces never
depends on where the pointer is.

To build the store upload: `npm run package` writes `release/thursday-<version>.zip`.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Builds pages, content script and service worker into `dist/` |
| `npm run dev` | Rebuilds the extension pages on change (reload the extension to pick up changes) |
| `npm run typecheck` | TypeScript, strict, no emit |
| `npm run guard` | Static privacy guards (see below) |
| `npm run test:unit` | Vitest — pure logic |
| `npm run test:e2e` | Playwright — real Chromium with the extension loaded |
| `npm run size` | Bundle check: allowed files, size budgets, no network APIs in the shipped bytes |
| `npm run package` | Builds, checks, and zips `dist/` into `release/` |
| `npm run build:test` | Test-only build with wider host access (see below) |
| `npm test` | All of the above, in order |

First E2E run needs a browser: `npx playwright install chromium`.

## The privacy guards

Five checks turn the promises in PLAN.md section 1 into properties:

1. **No network APIs in `src/`** — `npm run guard` fails on `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `importScripts`.
2. **No form-value reads in `src/content/`** — the content script has no code path that can read what you typed.
3. **Manifest shape** — `tests/unit/manifest.test.ts` asserts exactly four permissions, no host permissions, no content scripts, no web-accessible resources, no external connectability.
4. **Zero requests at runtime** — `tests/e2e/network.spec.ts` exercises the whole extension in real Chromium — including storing an audit, writing all three file formats, reading one back with its comments and images, and comparing two audits — and asserts the browser made no request outside the local fixture, the extension's own pages, and object URLs on the extension's own origin (a `blob:` handle to memory in the panel, which is how an attached image is displayed).
5. **Nothing in the shipped bytes** — `npm run size` fails if any of those identifiers appears in the built bundle, dependencies included. Guards 1–3 are about our source; a dependency could have brought a network call with it. None does.

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
src/pdf/               the PDF writer: container, font metrics, layout, report
src/sidepanel/         React audit UI, owns audit state
src/popup/             activation entry point (the only place that can grant activeTab)
src/options/           settings and data management
src/shared/            types, message protocol, constants, utilities
src/storage/           settings, IndexedDB and its migrations, the audit file format
scripts/               icon generator, privacy guard, bundle check, packaging
tests/                 unit (Vitest) · fixtures · e2e (Playwright)
```

## Licence

All rights reserved — see [LICENSE](LICENSE).

The source is public so that "no account, no server, no network" is something you can verify
instead of something you have to believe. That is not the same as a grant to use it. To use, copy,
modify, redistribute or build on Thursday, ask first: **omarmahin0@gmail.com**, saying what you
would like to do.
