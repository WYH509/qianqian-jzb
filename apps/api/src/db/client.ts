import Database from 'better-sqlite3';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (db === undefined) {
    db = new Database(config.DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    logger.info({ path: config.DB_PATH }, 'Database connected');
  }
  return db;
}

process.on('exit', () => db?.close());
process.on('SIGINT', () => {
  db?.close();
  process.exit(0);
});
