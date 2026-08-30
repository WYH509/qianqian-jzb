// dotenv loaded via tsx --env-file=../../.env in package.json
import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tsx --env-file handles loading; dotenv.config as fallback for non-tsx callers
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { readFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '../src/db/client.js';
import { logger } from '../src/utils/logger.js';

const migrationsDir = join(__dirname, '../../../db/migrations');

interface Migration {
  version: string;
  appliedAt?: number;
}

export async function runMigrations(): Promise<void> {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Migration[];
  const appliedSet = new Set(applied.map(m => m.version));

  const { readdirSync } = await import('fs');
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    const version = file.replace('.sql', '');
    if (appliedSet.has(version)) {
      logger.info({ version }, 'Migration already applied, skipping');
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    logger.info({ version, file }, 'Applying migration');

    const transaction = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now());
    });

    transaction();
    appliedCount++;
    logger.info({ version }, 'Migration applied successfully');
  }

  logger.info({ appliedCount, total: files.length }, 'Migrations complete');
}

runMigrations().catch(err => {
  logger.error({ err }, 'Migration failed');
  process.exit(1);
});
