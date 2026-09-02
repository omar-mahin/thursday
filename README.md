# Thursday

A local-first website audit tool for Chrome. Select any element on a live site and get
evidence-backed UX/UI/accessibility findings.

**No account. No server. No network.** Thursday cannot send your page anywhere — and the build is
tested for it, not just documented.

See [PLAN.md](PLAN.md) for the full engineering plan.

---

## Status

Sprint 1 of 6 is complete: extension foundation, on-demand injection, shadow-DOM toolbar, typed
messaging, and the four privacy guards. There is no audit engine yet (Sprint 3).

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
| `npm test` | All of the above, in order |

First E2E run needs a browser: `npx playwright install chromium`.

## The privacy guards

Four checks turn the promises in PLAN.md section 1 into properties:

1. **No network APIs in `src/`** — `npm run guard` fails on `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `importScripts`.
2. **No form-value reads in `src/content/`** — the content script has no code path that can read what you typed.
3. **Manifest shape** — `tests/unit/manifest.test.ts` asserts exactly four permissions, no host permissions, no content scripts, no web-accessible resources, no external connectability.
4. **Zero requests at runtime** — `tests/e2e/network.spec.ts` exercises the whole extension in real Chromium and asserts the browser made no request outside the local fixture and the extension's own pages.

Widening any of these has to break a test.

## Layout

```
manifest.config.ts     typed manifest, the single source for permissions
src/background/        service worker: router only, holds no state
src/content/           injected on demand: shadow host, toolbar, (Sprint 2) snapshot
src/sidepanel/         React audit UI, owns audit state
src/popup/             activation entry point (the only place that can grant activeTab)
src/options/           settings and data management
src/shared/            types, message protocol, constants, utilities
src/storage/           chrome.storage settings, (Sprint 5) IndexedDB
scripts/               icon generator, privacy guard
tests/                 unit (Vitest) · fixtures · e2e (Playwright)
```
