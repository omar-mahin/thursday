/**
 * Builds a test-only copy of the extension with one extra host permission.
 *
 * Why: Playwright cannot click a browser-chrome extension action, and that
 * click is what grants activeTab -- so without this, E2E can never exercise the
 * real injection and messaging path. The copy adds host access to the fake
 * fixture origin ONLY, so tests drive production code over production plumbing.
 *
 * The shipped build in dist/ is never touched, and tests/unit/manifest.test.ts
 * keeps asserting that it asks for no host permissions at all.
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const FIXTURE_ORIGIN_PATTERN = 'https://fixture.thursday.test/*';

rmSync('dist-test', { recursive: true, force: true });
cpSync('dist', 'dist-test', { recursive: true });

const manifest = JSON.parse(readFileSync('dist-test/manifest.json', 'utf8'));
manifest.host_permissions = [FIXTURE_ORIGIN_PATTERN];
manifest.name = `${manifest.name} (test)`;
writeFileSync('dist-test/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`dist-test: host_permissions = ${FIXTURE_ORIGIN_PATTERN}`);
