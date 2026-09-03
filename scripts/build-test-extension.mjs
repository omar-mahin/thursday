/**
 * Builds a test-only copy of the extension with extra host access.
 *
 * Why: Playwright cannot click a browser-chrome extension action, and that
 * click is what grants activeTab -- so without this, E2E can never exercise the
 * real injection and messaging path.
 *
 * Two grants, for two reasons:
 *
 *  - the fake fixture origin, which is what makes injection and messaging
 *    drivable at all;
 *  - `<all_urls>`, which Chrome demands specifically for
 *    `chrome.tabs.captureVisibleTab`: a narrow host permission is refused with
 *    "Either the '<all_urls>' or 'activeTab' permission is required". Without
 *    it the screenshot pipeline could not be tested end to end at all, and an
 *    untested pipeline that writes images to disk is the wrong trade.
 *
 * In the shipped build that same call is authorised by `activeTab`, granted by
 * the click the user makes. dist/ is never touched, and
 * tests/unit/manifest.test.ts keeps asserting it asks for no host access.
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const FIXTURE_ORIGIN_PATTERN = 'https://fixture.thursday.test/*';
const CAPTURE_PATTERN = '<all_urls>';

rmSync('dist-test', { recursive: true, force: true });
cpSync('dist', 'dist-test', { recursive: true });

const manifest = JSON.parse(readFileSync('dist-test/manifest.json', 'utf8'));
manifest.host_permissions = [FIXTURE_ORIGIN_PATTERN, CAPTURE_PATTERN];
manifest.name = `${manifest.name} (test)`;
writeFileSync('dist-test/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`dist-test: host_permissions = ${manifest.host_permissions.join(', ')}`);
