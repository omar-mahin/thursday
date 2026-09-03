import { describe, expect, it } from 'vitest';
import { DB_VERSION, MIGRATIONS, migrationsFor, type Migration } from '../../src/storage/db';

const fake = (to: number): Migration => ({ to, describe: `v${to}`, run: () => undefined });
const plan = [fake(1), fake(2), fake(3)];

describe('migration planning', () => {
  it('runs every migration a fresh install crosses', () => {
    expect(migrationsFor(0, 3, plan).map((migration) => migration.to)).toEqual([1, 2, 3]);
  });

  it('runs only the migrations after the version already on disk', () => {
    expect(migrationsFor(1, 3, plan).map((migration) => migration.to)).toEqual([2, 3]);
  });

  it('runs nothing when the version has not moved', () => {
    expect(migrationsFor(3, 3, plan)).toEqual([]);
  });

  it('never runs a migration beyond the version being opened', () => {
    // A build that knows about v3 but opens v2 must not create v3 stores.
    expect(migrationsFor(0, 2, plan).map((migration) => migration.to)).toEqual([1, 2]);
  });

  it('applies migrations in order regardless of declaration order', () => {
    const shuffled = [fake(3), fake(1), fake(2)];
    expect(migrationsFor(0, 3, shuffled).map((migration) => migration.to)).toEqual([1, 2, 3]);
  });

  it('has a migration for the current version', () => {
    // Otherwise an upgrade would silently create no stores.
    expect(MIGRATIONS.some((migration) => migration.to === DB_VERSION)).toBe(true);
    expect(migrationsFor(0, DB_VERSION)).toHaveLength(DB_VERSION);
  });

  it('declares each version exactly once', () => {
    const versions = MIGRATIONS.map((migration) => migration.to);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
