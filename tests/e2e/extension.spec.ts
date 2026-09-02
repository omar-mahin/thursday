import { expect, test } from './fixtures';

test('the service worker registers and serves the built manifest', async ({ context, extensionId }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/);
  const page = await context.newPage();
  const response = await page.goto(`chrome-extension://${extensionId}/manifest.json`);
  const manifest = JSON.parse((await response?.text()) ?? '{}') as Record<string, unknown>;
  expect(manifest['permissions']).toEqual(['storage', 'activeTab', 'scripting', 'sidePanel']);
  expect(manifest['host_permissions']).toBeUndefined();
});

test('the popup offers activation and states the privacy posture', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByRole('heading', { name: 'Thursday' })).toBeVisible();
  await expect(page.getByText('Runs locally. No account, no network.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Activate on this page|Open audit panel/ })).toBeVisible();
});

test('the side panel connects a port and receives page status from the worker', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByText('Not running', { exact: true })).toBeVisible();
  // Proof the port round-trip works: the worker pushes PAGE_STATUS on connect,
  // and the dev message log records what actually arrived.
  await expect(page.locator('.log-row', { hasText: 'PAGE_STATUS' })).toBeVisible();
  await expect(page.getByText('Local only. Nothing leaves this browser.')).toBeVisible();
});

test('the options page explains every permission it asks for', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  for (const permission of ['storage', 'activeTab', 'scripting', 'sidePanel']) {
    await expect(page.getByText(permission, { exact: true })).toBeVisible();
  }
  await expect(page.getByLabel('Minimum touch target in CSS pixels')).toHaveValue('44');
});
