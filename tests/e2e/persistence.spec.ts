import {
  expect,
  extensionPage,
  openMore,
  openMoreIn,
  panelOf,
  panelReady,
  test,
  testWithHostAccess,
} from './fixtures';

/**
 * IndexedDB, against real IndexedDB.
 *
 * There is no fake-indexeddb in this project on purpose: the store definitions,
 * the index lookups and the transaction boundaries are exactly the parts a mock
 * would get wrong, and the panel runs in Chrome anyway. So these drive the real
 * database inside a real extension page.
 */

test('the panel creates its stores and indexes on first open', async ({ extensionId, context }) => {
  /*
   * Opened as its own document rather than as the frame on a page.
   *
   * This test is about the database, not the workflow: what matters is that
   * loading the panel creates the stores. Tests that press Audit must use the
   * floating frame -- two panel documents are two panels, and they audit twice.
   */
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await expect(panel.locator('.panel-head')).toBeVisible();

  const shape = await (await extensionPage(context, extensionId)).evaluate(
    () =>
      new Promise<{
        version: number;
        stores: string[];
        auditIndexes: string[];
        findingIndexes: string[];
        annotationIndexes: string[];
        attachmentIndexes: string[];
      }>((resolve, reject) => {
        const request = indexedDB.open('thursday');
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction([...db.objectStoreNames], 'readonly');
          resolve({
            version: db.version,
            stores: [...db.objectStoreNames].sort(),
            auditIndexes: [...transaction.objectStore('audits').indexNames].sort(),
            findingIndexes: [...transaction.objectStore('findings').indexNames].sort(),
            annotationIndexes: [...transaction.objectStore('annotations').indexNames].sort(),
            attachmentIndexes: [...transaction.objectStore('attachments').indexNames].sort(),
          });
        };
        request.onerror = () => reject(request.error);
      }),
  );

  expect(shape.version).toBe(2);
  expect(shape.stores).toEqual(['annotations', 'attachments', 'audits', 'blobs', 'findings']);
  expect(shape.auditIndexes).toEqual(['createdAt', 'origin']);
  expect(shape.findingIndexes).toEqual(['auditId']);
  expect(shape.annotationIndexes).toEqual(['auditId', 'createdAt']);
  // Both directions: deleting an audit sweeps attachments by audit, and
  // deleting one comment sweeps them by comment.
  expect(shape.attachmentIndexes).toEqual(['annotationId', 'auditId']);
});

/**
 * The migration runner, against a database that really is at version 1.
 *
 * Written the day version 2 arrived, because this is the moment the runner
 * stops being theoretical: a user who installed the previous build has audits
 * on disk, and an upgrade that dropped them would be unrecoverable. The v1
 * database is built here by hand rather than by checking out an old build, so
 * the test states the old shape explicitly instead of trusting git.
 */
test('upgrading from version 1 adds the new stores and keeps the old rows', async ({
  extensionId,
  context,
}) => {
  /*
   * Seeded from the popup, not from the panel.
   *
   * The panel opens the database as soon as it mounts -- history, crops and
   * comments are all read on load -- and a `deleteDatabase` against a live
   * connection is blocked until that connection closes. The product handles
   * that correctly: `db.onversionchange` closes the handle and the next read
   * reopens it. Which is exactly the problem for a test: the delete succeeds,
   * the panel immediately reopens at the current version, and the seeding open
   * at version 1 loses the race with a VersionError.
   *
   * The popup shares the extension origin and never touches IndexedDB, so it
   * can lay down a version 1 database with nothing competing for it. It is
   * then closed before the panel is opened, so nothing holds the connection
   * when the migration runs.
   */
  const seeder = await context.newPage();
  await seeder.goto(`chrome-extension://${extensionId}/popup.html`);

  const seeded = await seeder.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        const wipe = indexedDB.deleteDatabase('thursday');
        wipe.onerror = () => reject(wipe.error);
        // Nothing should be holding it open here; if something is, say so
        // rather than hanging until the test times out.
        wipe.onblocked = () => reject(new Error('deleteDatabase was blocked: something still has it open'));
        wipe.onsuccess = () => {
          const open = indexedDB.open('thursday', 1);
          open.onupgradeneeded = () => {
            const db = open.result;
            const audits = db.createObjectStore('audits', { keyPath: 'id' });
            audits.createIndex('origin', 'origin');
            audits.createIndex('createdAt', 'createdAt');
            const findings = db.createObjectStore('findings', { keyPath: 'id' });
            findings.createIndex('auditId', 'auditId');
            db.createObjectStore('blobs', { keyPath: 'findingId' });
          };
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const write = db.transaction(['audits', 'findings'], 'readwrite');
            write.objectStore('audits').put({
              id: 'legacy-audit',
              origin: 'https://example.test',
              url: 'https://example.test/',
              title: 'Before comments existed',
              createdAt: 1,
              updatedAt: 1,
              findingIds: ['legacy-finding'],
              categories: ['a11y'],
              status: 'completed',
              truncated: false,
              elementsScanned: 10,
              viewportWidth: 1280,
              viewportHeight: 720,
              framesNotInspected: { crossOrigin: 0, sameOrigin: 0 },
              digest: { snapshotId: 's', locations: [] },
            });
            write.objectStore('findings').put({ id: 'legacy-finding', auditId: 'legacy-audit', ruleId: 'A11Y-001' });
            write.oncomplete = () => {
              db.close();
              resolve(true);
            };
            write.onerror = () => reject(write.error);
          };
        };
      }),
  );
  expect(seeded).toBe(true);
  await seeder.close();

  // Opening the panel opens the database at the version this build wants,
  // which is what runs the migration. Its own document again: this is about
  // storage, not about driving an audit.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await expect(panel.locator('.panel-head')).toBeVisible();
  await openMoreIn(panel);
  await expect(panel.locator('.history-row')).toHaveCount(1);

  const after = await (await extensionPage(context, extensionId)).evaluate(
    () =>
      new Promise<{ version: number; stores: string[]; audits: number; findings: number }>(
        (resolve, reject) => {
          const request = indexedDB.open('thursday');
          request.onsuccess = () => {
            const db = request.result;
            const read = db.transaction(['audits', 'findings'], 'readonly');
            const audits = read.objectStore('audits').count();
            const findings = read.objectStore('findings').count();
            read.oncomplete = () =>
              resolve({
                version: db.version,
                stores: [...db.objectStoreNames].sort(),
                audits: audits.result,
                findings: findings.result,
              });
            read.onerror = () => reject(read.error);
          };
          request.onerror = () => reject(request.error);
        },
      ),
  );

  expect(after.version).toBe(2);
  expect(after.stores).toEqual(['annotations', 'attachments', 'audits', 'blobs', 'findings']);
  expect(after.audits).toBe(1);
  expect(after.findings).toBe(1);
});

testWithHostAccess(
  'an audit is written to storage and survives the panel closing',
  async ({ openFixture, activate, context, extensionId }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);

    await panelReady(page);
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    // History appears without a reload, because the audit was just stored.
    await openMore(page);
    await expect(panel.locator('.history-row').first()).toBeVisible();
    const listed = await panel.locator('.history-row').count();
    expect(listed).toBeGreaterThan(0);

    /*
     * The panel below is a different panel entirely -- its own document, which
     * never saw this audit run. That is the claim: the findings come out of
     * storage rather than out of the memory of the thing that produced them.
     */

    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/panel.html`);

    // The audit is still there, and it is the one just run.
    await openMoreIn(reopened);
    await expect(reopened.locator('.history-row').first()).toBeVisible();
    await expect(reopened.locator('.history-count').first()).toContainText('finding');
  },
);

testWithHostAccess(
  'a stored audit reopens with its findings and pins the live page',
  async ({ openFixture, activate, context, extensionId }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);

    await panelReady(page);
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    const firstTitle = await panel.locator('.finding-row .finding-title').first().innerText();
    await openMore(page);
    await expect(panel.locator('.history-row').first()).toBeVisible();
    // A different panel below: its own document, which never saw this audit run.

    // A fresh panel with no audit of its own.
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/panel.html`);
    await expect(reopened.locator('.finding-row')).toHaveCount(0);

    await openMoreIn(reopened);
    await reopened.locator('.history-open').first().click();
    await expect(reopened.locator('.finding-row').first()).toBeVisible();
    await expect(reopened.locator('.finding-row .finding-title').first()).toHaveText(firstTitle);

    // It says out loud that this is not a fresh measurement.
    await expect(reopened.locator('.notice')).toContainText('Reopened from history');

    // And the page gets its pins back.
    await expect(page.locator('thursday-root .pin').first()).toBeVisible();
    expect(await page.locator('thursday-root .pin').count()).toBeGreaterThan(0);
  },
);

testWithHostAccess(
  'a reopened audit keeps exact pins while the page it measured is still loaded',
  async ({ openFixture, activate, context, extensionId }) => {
    // The stored digest carries the snapshot id, and this page still holds the
    // elements from that snapshot -- so the fast path is genuinely valid and
    // the pins are measurements, not guesses.
    const page = await openFixture('accessibility.html');
    await activate(page);

    await panelReady(page);
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    // A different panel below: its own document, which never saw this audit run.

    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/panel.html`);
    await openMoreIn(reopened);
    await reopened.locator('.history-open').first().click();
    await expect(reopened.locator('.finding-row').first()).toBeVisible();

    await expect(page.locator('thursday-root .pin').first()).toBeVisible();
    const approximate = await page
      .locator('thursday-root .pin')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-approximate')));
    expect(approximate.some((value) => value === 'false')).toBe(true);
  },
);

testWithHostAccess(
  'a reopened audit draws approximate pins once the page has reloaded',
  async ({ openFixture, activate, context, extensionId }) => {
    // This is the state a restart leaves: the audit is on disk, but nothing in
    // the page remembers the elements it measured. Every pin is then a search
    // result, and is drawn as one.
    const page = await openFixture('accessibility.html');
    await activate(page);

    await panelReady(page);
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    // A different panel below: its own document, which never saw this audit run.

    await page.reload();
    await activate(page);

    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/panel.html`);
    await openMoreIn(reopened);
    await reopened.locator('.history-open').first().click();
    await expect(reopened.locator('.finding-row').first()).toBeVisible();

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
  async ({ openFixture, activate, context, extensionId }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);

    await panelReady(page);
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.detail').first()).toBeVisible();

    const title = await panel.locator('.detail-title').innerText();
    await panel.locator('.detail').getByRole('button', { name: 'Accept' }).click();
    await panel.locator('.detail').getByRole('button', { name: 'Add to report' }).click();
    await panel.locator('.detail-note textarea').fill('Checked with the design team');
    // Blur, so the write is not racing an in-flight keystroke.
    await panel.locator('.detail-title').click();
    await expect(panel.locator('.detail').getByRole('button', { name: 'In report' })).toBeVisible();
    // A different panel below: its own document, which never saw this audit run.

    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/panel.html`);
    await openMoreIn(reopened);
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
  async ({ openFixture, activate, context, extensionId }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);

    await panelReady(page);
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    // Wait for the audit before reaching into history: the row only exists
    // once the audit has been stored.
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await openMore(page);
    await expect(panel.locator('.history-row').first()).toBeVisible();

    await panel.locator('.history-row').first().getByRole('button', { name: /^Delete the audit/ }).click();
    await panel.locator('.history-row').first().getByRole('button', { name: 'Delete', exact: true }).click();

    await openMore(page);
    await expect(panel.locator('.history-row')).toHaveCount(0);

    // The findings went with it: no orphan rows left behind.
    const orphans = await (await extensionPage(context, extensionId)).evaluate(
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
  async ({ openFixture, activate, context, extensionId }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);

    await panelReady(page);
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    // Wait for the audit before reaching into history: the row only exists
    // once the audit has been stored.
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await openMore(page);
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
