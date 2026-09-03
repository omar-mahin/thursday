import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Keeps dist-test/ in step with dist/ however the suite is invoked.
  globalSetup: './tests/e2e/global-setup.ts',
  // Each test drives its own persistent browser profile with the extension loaded.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: process.env['CI'] ? 'list' : [['list']],
  use: { trace: 'off' },
});
