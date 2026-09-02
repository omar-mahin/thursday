import { describe, expect, it } from 'vitest';
import { manifest, REQUIRED_PERMISSIONS } from '../../manifest.config';

/**
 * Guard 3 (PLAN.md section 7). The permission set is a product promise, so
 * widening it has to break a test and be argued for, not slip in.
 */
describe('manifest', () => {
  const record = manifest as unknown as Record<string, unknown>;

  it('requests exactly four permissions', () => {
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

  it('exposes nothing to web pages and accepts no external messages', () => {
    expect(record['web_accessible_resources']).toBeUndefined();
    expect(record['externally_connectable']).toBeUndefined();
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
