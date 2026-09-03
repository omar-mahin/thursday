import { execFileSync } from 'node:child_process';

/**
 * Rebuilds the test extension before any test runs.
 *
 * `dist-test/` is a copy of `dist/`, and running Playwright directly rather
 * than through `npm run test:e2e` used to skip the copy -- so the suite would
 * quietly test the previous build. That has now cost real time twice, once
 * chasing a CSS fix that was already correct. A stale artifact should not be
 * something anyone has to remember.
 */
export default function globalSetup(): void {
  execFileSync('node', ['scripts/build-test-extension.mjs'], { stdio: 'inherit' });
}
