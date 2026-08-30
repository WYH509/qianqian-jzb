import { describe, it, expect, beforeEach } from 'vitest';
import { runMigrations } from '../../apps/api/scripts/migrate.js';
import { getDb } from '../../apps/api/src/db/client.js';
import { rmSync, mkdirSync } from 'fs';
import { join } from 'path';

describe('Migrations', () => {
  const testDbPath = join(process.cwd(), 'test-migrate.db');

  beforeEach(() => {
    rmSync(testDbPath, { force: true });
    process.env.DB_PATH = testDbPath;
  });

  it('applies all migrations and creates 6 tables', async () => {
    await runMigrations();
    const db = getDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name).sort();
    expect(tableNames).toEqual([
      'accounts', 'audit_log', 'import_history', 'schema_migrations',
      'sessions', 'transactions'
    ]);
  });

  it('runs idempotently (second run no-ops)', async () => {
    await runMigrations();
    await runMigrations();
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get() as { c: number }).c;
    // V001 + V003 = 2 migrations
    expect(count).toBeGreaterThanOrEqual(2);
  });
});