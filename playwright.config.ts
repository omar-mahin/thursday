import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Keeps dist-test/ in step with dist/ however the suite is invoked.
  globalSetup: './tests/e2e/global-setup.ts',
  // Each test drives its own persistent browser profile with the extension loaded.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  /**
   * A failure has to survive however the command's output was piped.
   *
   * A test failed once in six runs of the suite and its identity was lost to a
   * shell pipeline, which cost more time than the flake would have. The JSON
   * file makes the next one recoverable from disk, and the trace makes it
   * diagnosable rather than a one-line "not visible".
   *
   * Deliberately no `retries`: retrying would turn an unreliable test into
   * silence, which is the opposite of what a suite this size needs.
   */
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
