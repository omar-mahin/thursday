import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Each test drives its own persistent browser profile with the extension loaded.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: process.env['CI'] ? 'list' : [['list']],
  use: { trace: 'off' },
});
