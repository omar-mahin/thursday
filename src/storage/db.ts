import { DB_NAME } from '../shared/constants/product';

/**
 * IndexedDB, opened through a migration runner from the first version.
 *
 * Version 1 only creates the stores, so the runner buys nothing today. That is
 * the point: the moment a shipped user has data, "add a field" has to be a
 * migration, and a runner that already exists is a five-line addition instead
 * of a rewrite under pressure. Migrations run inside the upgrade transaction,
 * in order, and only the ones the open actually crosses.
 */
export const STORE_AUDITS = 'audits';
export const STORE_FINDINGS = 'findings';
export const STORE_BLOBS = 'blobs';

export const DB_VERSION = 1;

export type Migration = {
  /** The version this migration produces. */
  to: number;
  describe: string;
  run(db: IDBDatabase, transaction: IDBTransaction): void;
};

export const MIGRATIONS: readonly Migration[] = [
  {
    to: 1,
    describe: 'create the audits, findings and blobs stores',
    run(db) {
      const audits = db.createObjectStore(STORE_AUDITS, { keyPath: 'id' });
      // History is read per origin, newest first; both indexes serve that.
      audits.createIndex('origin', 'origin');
      audits.createIndex('createdAt', 'createdAt');

      const findings = db.createObjectStore(STORE_FINDINGS, { keyPath: 'id' });
      findings.createIndex('auditId', 'auditId');

      // Screenshot crops, keyed by the finding they belong to. Separate store
      // so listing history never has to page Blobs into memory.
      db.createObjectStore(STORE_BLOBS, { keyPath: 'findingId' });
    },
  },
];

/** The migrations an upgrade from `from` to `to` must run, in order. */
export function migrationsFor(
  from: number,
  to: number,
  migrations: readonly Migration[] = MIGRATIONS,
): Migration[] {
  return migrations
    .filter((migration) => migration.to > from && migration.to <= to)
    .sort((a, b) => a.to - b.to);
}

/**
 * A version we do not recognise means the user has a newer Thursday installed
 * elsewhere, or downgraded. Refusing is the only honest option: the alternative
 * is writing v1-shaped records into a v2 store and corrupting both.
 */
export class DatabaseTooNewError extends Error {
  constructor(readonly found: number) {
    super(`This browser holds Thursday data from a newer version (v${found}). Update Thursday to read it.`);
    this.name = 'DatabaseTooNewError';
  }
}

let cached: Promise<IDBDatabase> | null = null;

export function openDatabase(
  name: string = DB_NAME,
  version: number = DB_VERSION,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, version);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('IndexedDB is unavailable'));
      return;
    }

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const transaction = request.transaction;
      if (!transaction) return;
      for (const migration of migrationsFor(event.oldVersion, event.newVersion ?? version, migrations)) {
        migration.run(db, transaction);
      }
    };

    request.onblocked = () => {
      reject(new Error('Another Thursday window is upgrading this data. Close it and try again.'));
    };

    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgraded underneath us: drop the handle rather than write
      // through a connection whose stores may no longer match.
      db.onversionchange = () => {
        cached = null;
        db.close();
      };
      resolve(db);
    };

    request.onerror = () => {
      const error = request.error;
      if (error?.name === 'VersionError') {
        reject(new DatabaseTooNewError(version));
        return;
      }
      reject(error ?? new Error('Could not open local storage'));
    };
  });
}

/** The shared connection. Reopened automatically if it was closed under us. */
export function database(): Promise<IDBDatabase> {
  if (!cached) {
    cached = openDatabase().catch((error: unknown) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

export function resetConnection(): void {
  cached = null;
}

export function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local storage request failed'));
  });
}

/**
 * Runs work in one transaction and resolves when it commits -- not when the
 * last request succeeds. A multi-store write that resolved early would let the
 * caller report "saved" for a transaction that then aborted.
 *
 * `work` may await the requests it issues: resolving an IndexedDB request runs
 * in a microtask, so the next request is issued before the transaction can
 * commit. It must not await anything else.
 */
export async function transact<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await database();
  const transaction = db.transaction(stores, mode);
  const committed = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Local write was rolled back'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Local write failed'));
  });
  // Claimed unconditionally: an unobserved rejection here would surface as an
  // unhandled promise error in the panel even when the caller handled the throw.
  const settled = committed.catch(() => undefined);

  try {
    const result = await work(transaction);
    await committed;
    return result;
  } catch (error) {
    await settled;
    throw error;
  }
}
