# Chrome Web Store listing

Everything the submission form asks for, kept in the repository so the claims on
the listing and the claims in the code can be checked against each other. The
permission justifications below are the same ones `src/options/Options.tsx`
shows the user, and `tests/unit/manifest.test.ts` asserts the permission list
they refer to.

---

## Single purpose

Thursday audits the web page the user is looking at for accessibility, UI,
usability, content, conversion and responsive-layout problems, and reports what
it measured. It does one thing: examine the current page on request and explain
what it found.

## Name

Thursday

## Short description (132 characters max)

> Audit any live website for accessibility and UX problems. Runs entirely on
> your machine — no account, no server, no network.

## Detailed description

> Thursday audits the page you are looking at and tells you what is wrong with
> it, with the measurements to back it up.
>
> Click the icon, activate it on a page, and Thursday reads the page once and
> runs thirty deterministic rules over what it read: colour contrast, missing
> labels, target sizes, heading order, spacing that misses the page's own scale,
> reading level, calls to action competing with each other, layouts that
> overflow on a phone. Every finding names what was measured, why it matters and
> what to do about it — and says which are measurements and which are judgement
> calls.
>
> Findings are pinned onto the page itself, numbered to match the list, so you
> can see where each problem is. Open one and you get the evidence, the impact,
> the recommendation, and a note field for whoever reads it next. Mark findings
> as accepted, resolved or dismissed as you work through them.
>
> Audit again after you have made changes and Thursday tells you what is fixed,
> what is still open and what is new — and anything you dismissed stays
> dismissed.
>
> Add your own comments too. Click any element and write what you think, attach
> screenshots to it, or leave a note about the page as a whole. The card opens
> on the page next to what you picked, and each comment carries your name and a
> priority you set yourself. Comments are
> kept separate from findings everywhere they appear — lettered rather than
> numbered, in their own section of the report, labelled as opinions — because
> what you think and what was measured are different kinds of claim and should
> never be mistaken for each other.
>
> Keep audits as files: a .thursday.json reopens with every finding, comment,
> status, note and image intact; a single self-contained HTML report that opens
> offline in any browser; or a PDF for the ticket, the print-out and anyone who
> will not open an HTML attachment.
>
> WHAT IT DOES NOT DO
>
> There is no account, no sign-in and no server. Thursday has no network access
> at all: it cannot send your page anywhere, and the build is tested for that
> rather than only claiming it. Audits are stored on your own machine and you
> can delete them, per site or all at once, from settings.
>
> It never reads what you type. Password, payment and similar fields are left
> out of everything it collects, and there is no code path in the extension that
> can read a form value. Audits do photograph their findings, and every password
> or payment field on screen is painted out of every picture -- including
> pictures taken for something else beside it. You can turn photographs off
> entirely.
>
> It also does not guess. If a colour sits on a background image, Thursday says
> the contrast could not be verified instead of inventing a number. If a page is
> too large to examine in one pass, it says how much it examined. If it had to
> search for an element rather than measure it, the pin says so.
>
> Thursday's source is published so anyone can check these claims for
> themselves: https://github.com/omar-mahin/thursday — it is readable rather
> than open source, and using it needs permission.

## Licence

All rights reserved. The source is published for inspection, not for reuse: see
`LICENSE`. Any use needs written permission, requested at omarmahin0@gmail.com.

This is worth stating on the listing because the repository is public, and a
public repository with no licence is routinely read as an invitation to reuse.

## Category

Developer Tools

## Language

English

---

## Permission justifications

Four permissions, no host permissions. Each is requested because a specific
feature cannot work without it.

| Permission | Justification |
|---|---|
| `activeTab` | Thursday reads the page the user explicitly activates it on. This is requested instead of host permissions so the extension has no standing access to any site: access is granted by the user's own click or keyboard shortcut, for that one tab, and nothing runs on any page until then. Also authorises photographing the visible tab, which is how each finding gets a picture of where it is. |
| `scripting` | Injects the on-page toolbar, the element highlighter and the finding pins at the moment the user activates Thursday. There is no declared content script, so nothing is injected in advance. |
| `sidePanel` | The audit panel is a side panel, so findings sit beside the page being audited rather than covering it. |
| `storage` | Remembers the user's settings, and stores audits on the user's own machine so they survive closing the browser. Nothing stored is ever transmitted. |

### Remote code

None. No `eval`, no remotely-hosted scripts, no CDN references, no
`content_security_policy` relaxation. Everything the extension runs is in the
package that was reviewed.

---

## Data-use disclosures

The store asks what is collected. The honest answer is nothing, and the details
are these:

| Category | Collected? | Notes |
|---|---|---|
| Personally identifiable information | No | Thursday has no account and no identity of any kind. |
| Health information | No | |
| Financial and payment information | No | Payment fields are excluded from collection entirely (see below). |
| Authentication information | No | Password fields are excluded from collection entirely. |
| Personal communications | No | |
| Location | No | |
| Web history | No | Audits record the URL of pages the user chose to audit, on the user's own machine only, and can be deleted from settings. Nothing is transmitted. |
| User activity | No | |
| Website content | No | Page structure and measurements are read into memory to produce an audit, and stored locally only if the user keeps history. Pictures of findings and images the user attaches to their own comments are stored locally too. Sensitive fields are painted out of every picture before it is stored. None of it leaves the machine. |

### Required certifications

- **I do not sell or transfer user data to third parties**, outside of the
  approved use cases. — True. There is no transfer of any kind.
- **I do not use or transfer user data for purposes unrelated to my item's
  single purpose.** — True.
- **I do not use or transfer user data to determine creditworthiness or for
  lending purposes.** — True.

### Why these answers can be checked rather than trusted

The repository enforces them:

1. A static check fails the build if `fetch`, `XMLHttpRequest`, `WebSocket`,
   `EventSource`, `sendBeacon`, `importScripts` or native messaging appears
   anywhere in the source (`scripts/guard.mjs`).
2. The same check fails if any code in the injected content script can read a
   form value.
3. A test asserts the manifest's exact permission list, and that it declares no
   host permissions, no content scripts, no web-accessible resources and no
   external connectability.
4. A test drives the whole extension in a real browser and asserts that no
   network request was made — including while storing an audit, exporting both
   file formats, importing one back and comparing two audits.
5. A check on the built package fails if any of those network identifiers
   appears in the shipped bytes, dependencies included
   (`scripts/check-bundle.mjs`).

---

## Privacy policy

Thursday collects no data, transmits no data and has no server, so there is
nothing to disclose about handling, retention or sharing. The full statement:

> Thursday runs entirely on your computer. It has no account system, no
> analytics and no network access. It cannot send the pages you audit, or
> anything derived from them, anywhere.
>
> Audits you choose to keep are stored in your browser's local storage on your
> own machine. You can delete them for one site or all at once from Thursday's
> settings, and uninstalling the extension removes them with it. Files you
> export are written where you tell your browser to put them and are not
> touched again.
>
> Thursday never reads the contents of form fields. Password, payment and
> similar fields are excluded from everything it collects. Screenshots are
> disabled until you enable them, and are refused for anything containing a
> sensitive field.

---

## Screenshots and assets to prepare

Not in the repository; produced at submission time.

- 1280×800 or 640×400, at least one, at most five.
- Suggested set: the panel with findings and pins on a real page; an open
  finding showing evidence, impact and recommendation; a comment with an
  attached screenshot beside its pin; the comparison after a re-audit; an
  exported report (HTML or the PDF).
- 128×128 store icon (`public/icons/icon128.png` is the extension icon and can
  be reused).
- Screenshots must be of real audits of real pages. A mocked-up finding on a
  listing for a tool about honest measurement would be a poor start.

## Before submitting

- [ ] `npm test` green
- [ ] `npm run package` and upload `release/thursday-<version>.zip`
- [ ] Version bumped in `manifest.config.ts` (`PRODUCT_VERSION`)
- [x] A licence chosen for the public repository (`LICENSE`: all rights
      reserved, permission by request)
- [ ] End-user terms settled — see the note under **Licence** above; store
      users currently receive no terms with the package
- [ ] Manual pass on five real sites, including one behind a login and one
      heavy single-page app
