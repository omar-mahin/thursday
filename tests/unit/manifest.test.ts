import { describe, expect, it } from 'vitest';
import { manifest, REQUIRED_PERMISSIONS } from '../../manifest.config';
import { ACTIVATE_COMMAND, ACTIVATE_SHORTCUT } from '../../src/shared/constants/product';

/**
 * Guard 3 (PLAN.md section 7). The permission set is a product promise, so
 * widening it has to break a test and be argued for, not slip in.
 */
describe('manifest', () => {
  const record = manifest as unknown as Record<string, unknown>;

  it('requests exactly four permissions', () => {
    // `sidePanel` is back, along with the docked panel it exists for. It went
    // for a while when the panel floated, and the trade is worth naming: a
    // permission for the panel Chrome draws, or a web-accessible resource so
    // the page can frame our own. The permission is the narrower of the two.
    expect(manifest.permissions).toEqual(['storage', 'activeTab', 'scripting', 'sidePanel']);
    expect(REQUIRED_PERMISSIONS).toHaveLength(4);
  });

  it('requests no host access', () => {
    expect(record['host_permissions']).toBeUndefined();
    expect(record['optional_host_permissions']).toBeUndefined();
  });

  it('declares no content scripts, so nothing runs before the user asks', () => {
    expect(record['content_scripts']).toBeUndefined();
  });

  it('accepts no external messages', () => {
    expect(record['externally_connectable']).toBeUndefined();
  });

  it('exposes nothing to web pages', () => {
    /*
     * Nothing, not "one narrow thing".
     *
     * Framing the panel over the page required declaring panel.html
     * web-accessible, which is a URL any site can embed. The exposure was
     * genuinely small -- cross-origin, so a site could display the panel and
     * read nothing out of it -- but it was a widening of the manifest bought
     * for placement alone, and the docked panel needs no such thing.
     */
    expect(record['web_accessible_resources']).toBeUndefined();
  });

  it('declares the side panel it docks into', () => {
    expect(record['side_panel']).toEqual({ default_path: 'panel.html' });
  });

  it('is manifest v3 with a module service worker', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({ service_worker: 'service-worker.js', type: 'module' });
  });

  it('declares no remote code or CSP relaxation', () => {
    expect(record['content_security_policy']).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toMatch(/https?:\/\//);
  });
});

/**
 * The test build (dist-test/) deliberately widens host access so E2E can drive
 * production code paths. These assert the two builds cannot be confused: the
 * shipped one is the one with nothing extra in it.
 */
describe('the shipped build against the test build', () => {
  const shipped = manifest as unknown as Record<string, unknown>;

  it('never grants itself the capture permission the test build needs', () => {
    /*
     * scripts/build-test-extension.mjs adds <all_urls> to `host_permissions`
     * for captureVisibleTab. In the shipped build that call is authorised by
     * activeTab and nothing else.
     *
     * Checked on host_permissions specifically rather than on the whole
     * manifest text: the shipped manifest has no `<all_urls>` anywhere now,
     * but asserting the field says what is actually meant and keeps saying it
     * if some other field ever legitimately carries that pattern.
     */
    expect(shipped['host_permissions']).toBeUndefined();
    expect(shipped['optional_host_permissions']).toBeUndefined();
    expect(manifest.permissions).not.toContain('<all_urls>');
  });

  it('relies on activeTab for tab capture', () => {
    expect(manifest.permissions).toContain('activeTab');
  });
});

/**
 * The keyboard shortcut is the only activation path a keyboard user can reach
 * without a pointer, and it grants activeTab the same way the action click
 * does -- so it must not need a permission of its own.
 */
describe('the keyboard shortcut', () => {
  const commands = (manifest as unknown as Record<string, Record<string, unknown>>)['commands'];

  it('declares exactly one command', () => {
    expect(Object.keys(commands ?? {})).toEqual([ACTIVATE_COMMAND]);
  });

  it('suggests the shortcut the popup and options pages promise', () => {
    // Three copies of a key combination is three chances to describe a
    // shortcut the user does not actually have.
    const command = commands?.[ACTIVATE_COMMAND] as { suggested_key?: { default?: string } } | undefined;
    expect(command?.suggested_key?.default).toBe(ACTIVATE_SHORTCUT);
  });

  it('describes itself, because Chrome shows this in the shortcuts page', () => {
    const command = commands?.['activate-page'] as { description?: string } | undefined;
    expect(command?.description).toContain('Thursday');
  });

  it('adds no permission', () => {
    // The shortcut grants activeTab by being a user gesture, exactly as
    // clicking the action does, so it costs nothing in the manifest. Compared
    // against the same list the contract above asserts, so the two cannot
    // drift apart.
    expect(manifest.permissions).toEqual([...REQUIRED_PERMISSIONS]);
  });
});
