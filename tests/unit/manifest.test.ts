import { describe, expect, it } from 'vitest';
import { manifest, REQUIRED_PERMISSIONS } from '../../manifest.config';
import { ACTIVATE_COMMAND, ACTIVATE_SHORTCUT } from '../../src/shared/constants/product';

/**
 * Guard 3 (PLAN.md section 7). The permission set is a product promise, so
 * widening it has to break a test and be argued for, not slip in.
 */
describe('manifest', () => {
  const record = manifest as unknown as Record<string, unknown>;

  it('requests exactly three permissions', () => {
    // Was four. `sidePanel` went when the panel became a floating frame the
    // content script mounts itself -- a capability removed by a redesign
    // rather than kept in case.
    expect(manifest.permissions).toEqual(['storage', 'activeTab', 'scripting']);
    expect(REQUIRED_PERMISSIONS).toHaveLength(3);
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

  it('exposes exactly one resource to web pages', () => {
    /*
     * The panel is an extension document -- it needs the extension origin to
     * reach IndexedDB at all -- so floating it over the page means framing it,
     * and framing an extension page inside a web page requires that page to be
     * web-accessible. This is the one deliberate widening in the manifest.
     *
     * Asserted field by field rather than as "something is declared", because
     * the whole value is in the narrowness: one file, and nothing else.
     *
     * No `use_dynamic_url`, and that is deliberate rather than forgotten. It
     * was set, and it broke the panel in a real browser: getURL() returns the
     * static path, which a dynamic URL makes unloadable from a page, so the
     * frame showed Chrome's "blocked" screen. The frame is cross-origin to its
     * host page either way, so a site can embed it and read nothing out of it.
     */
    expect(record['web_accessible_resources']).toEqual([
      { resources: ['panel.html'], matches: ['<all_urls>'] },
    ]);
  });

  it('no longer declares a side panel', () => {
    expect(record['side_panel']).toBeUndefined();
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
     * manifest text, because `<all_urls>` now legitimately appears in
     * web_accessible_resources -- and a grep of the whole file would pass for
     * the wrong reason or fail for the wrong one.
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
    expect(manifest.permissions).toEqual(['storage', 'activeTab', 'scripting']);
  });
});
