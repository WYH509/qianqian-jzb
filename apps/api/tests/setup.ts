import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../src/db/client.js';

// DB_PATH 已在 vitest.config.ts 的 `test.env` 中设为 ':memory:'，
// config.ts 在 import 时即解析为内存库。此处应用真实迁移 SQL，
// 保证测试表结构与生产一致（避免硬编码 schema 漂移）。
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../db/migrations');

const db = getDb();
for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  db.exec(readFileSync(join(migrationsDir, file), 'utf-8'));
}
