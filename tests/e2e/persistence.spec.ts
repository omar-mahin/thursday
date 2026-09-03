import { expect, test, testWithHostAccess } from './fixtures';

/**
 * IndexedDB, against real IndexedDB.
 *
 * There is no fake-indexeddb in this project on purpose: the store definitions,
 * the index lookups and the transaction boundaries are exactly the parts a mock
 * would get wrong, and the panel runs in Chrome anyway. So these drive the real
 * database inside a real extension page.
 */

test('the panel creates its stores and indexes on first open', async ({ extensionId, context }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  // Opening the panel opens the database (history is read for the active origin).
  await expect(panel.locator('.panel-head')).toBeVisible();

  const shape = await panel.evaluate(
    () =>
      new Promise<{ version: number; stores: string[]; auditIndexes: string[]; findingIndexes: string[] }>(
        (resolve, reject) => {
          const request = indexedDB.open('thursday');
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction([...db.objectStoreNames], 'readonly');
            resolve({
              version: db.version,
              stores: [...db.objectStoreNames].sort(),
              auditIndexes: [...transaction.objectStore('audits').indexNames].sort(),
              findingIndexes: [...transaction.objectStore('findings').indexNames].sort(),
            });
          };
          request.onerror = () => reject(request.error);
        },
      ),
  );

  expect(shape.version).toBe(1);
  expect(shape.stores).toEqual(['audits', 'blobs', 'findings']);
  expect(shape.auditIndexes).toEqual(['createdAt', 'origin']);
  expect(shape.findingIndexes).toEqual(['auditId']);
});

testWithHostAccess(
  'an audit is written to storage and survives the panel closing',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    // History appears without a reload, because the audit was just stored.
    await expect(panel.locator('.history-row').first()).toBeVisible();
    const listed = await panel.locator('.history-row').count();
    expect(listed).toBeGreaterThan(0);

    // Close the panel entirely: this is the state a browser restart leaves.
    await panel.close();

    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.bringToFront();
    await reopened.bringToFront();

    // The audit is still there, and it is the one just run.
    await expect(reopened.locator('.history-row').first()).toBeVisible();
    await expect(reopened.locator('.history-count').first()).toContainText('finding');
  },
);

testWithHostAccess(
  'a stored audit reopens with its findings and pins the live page',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    const firstTitle = await panel.locator('.finding-row .finding-title').first().innerText();
    await expect(panel.locator('.history-row').first()).toBeVisible();
    await panel.close();

    // A fresh panel with no audit of its own.
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(reopened.locator('.finding-row')).toHaveCount(0);

    await reopened.locator('.history-open').first().click();
    await expect(reopened.locator('.finding-row').first()).toBeVisible();
    await expect(reopened.locator('.finding-row .finding-title').first()).toHaveText(firstTitle);

    // It says out loud that this is not a fresh measurement.
    await expect(reopened.locator('.notice')).toContainText('Reopened from history');

    // And the page gets its pins back.
    await page.bringToFront();
    await expect(page.locator('thursday-root .pin').first()).toBeVisible();
    expect(await page.locator('thursday-root .pin').count()).toBeGreaterThan(0);
  },
);

testWithHostAccess(
  'a reopened audit keeps exact pins while the page it measured is still loaded',
  async ({ openFixture, activate, extensionId, context }) => {
    // The stored digest carries the snapshot id, and this page still holds the
    // elements from that snapshot -- so the fast path is genuinely valid and
    // the pins are measurements, not guesses.
    const page = await openFixture('accessibility.html');
    await activate(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await panel.close();

    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await reopened.locator('.history-open').first().click();
    await expect(reopened.locator('.finding-row').first()).toBeVisible();

    await page.bringToFront();
    await expect(page.locator('thursday-root .pin').first()).toBeVisible();
    const approximate = await page
      .locator('thursday-root .pin')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-approximate')));
    expect(approximate.some((value) => value === 'false')).toBe(true);
  },
);

testWithHostAccess(
  'a reopened audit draws approximate pins once the page has reloaded',
  async ({ openFixture, activate, extensionId, context }) => {
    // This is the state a restart leaves: the audit is on disk, but nothing in
    // the page remembers the elements it measured. Every pin is then a search
    // result, and is drawn as one.
    const page = await openFixture('accessibility.html');
    await activate(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await panel.close();

    await page.reload();
    await activate(page);

    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await reopened.locator('.history-open').first().click();
    await expect(reopened.locator('.finding-row').first()).toBeVisible();

    await page.bringToFront();
    await expect(page.locator('thursday-root .pin').first()).toBeVisible();
    const approximate = await page
      .locator('thursday-root .pin')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-approximate')));
    expect(approximate.length).toBeGreaterThan(0);
    expect(approximate.every((value) => value === 'true')).toBe(true);
  },
);

testWithHostAccess(
  'a status set on a finding is still set after reopening the audit',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.detail').first()).toBeVisible();

    const title = await panel.locator('.detail-title').innerText();
    await panel.locator('.detail').getByRole('button', { name: 'Accept' }).click();
    await panel.locator('.detail').getByRole('button', { name: 'Add to report' }).click();
    await panel.locator('.detail-note textarea').fill('Checked with the design team');
    // Blur, so the write is not racing an in-flight keystroke.
    await panel.locator('.detail-title').click();
    await expect(panel.locator('.detail').getByRole('button', { name: 'In report' })).toBeVisible();
    await panel.close();

    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await reopened.locator('.history-open').first().click();
    await expect(reopened.locator('.finding-row').first()).toBeVisible();

    const row = reopened.locator('.finding-row', { hasText: title }).first();
    await row.click();
    await expect(reopened.locator('.detail').getByRole('button', { name: 'In report' })).toBeVisible();
    await expect(reopened.locator('.detail-note textarea')).toHaveValue('Checked with the design team');
    await expect(reopened.locator('.detail .badge', { hasText: 'accepted' })).toBeVisible();
  },
);

testWithHostAccess(
  'deleting an audit removes it and its findings',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.history-row').first()).toBeVisible();

    await panel.locator('.history-row').first().getByRole('button', { name: /^Delete the audit/ }).click();
    await panel.locator('.history-row').first().getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(panel.locator('.history-row')).toHaveCount(0);

    // The findings went with it: no orphan rows left behind.
    const orphans = await panel.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('thursday');
          request.onsuccess = () => {
            const store = request.result.transaction('findings', 'readonly').objectStore('findings');
            const count = store.count();
            count.onsuccess = () => resolve(count.result);
            count.onerror = () => reject(count.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    expect(orphans).toBe(0);
  },
);

testWithHostAccess(
  'clearing everything from settings empties the database',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.history-row').first()).toBeVisible();

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    // The usage line is read from the database, not from a guess.
    await expect(options.locator('.origins li').first()).toBeVisible();
    await options.getByRole('button', { name: 'Clear' }).click();
    await expect(options.getByText('Cleared.')).toBeVisible();
    await expect(options.locator('.origins li')).toHaveCount(0);

    const remaining = await options.evaluate(
      () =>
        new Promise<number[]>((resolve, reject) => {
          const request = indexedDB.open('thursday');
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction(['audits', 'findings', 'blobs'], 'readonly');
            const counts = ['audits', 'findings', 'blobs'].map((name) =>
              transaction.objectStore(name).count(),
            );
            transaction.oncomplete = () => resolve(counts.map((request) => request.result));
            transaction.onerror = () => reject(transaction.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    expect(remaining).toEqual([0, 0, 0]);
  },
);
