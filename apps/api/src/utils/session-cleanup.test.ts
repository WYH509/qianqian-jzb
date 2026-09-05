// utils/session-cleanup.ts 单元测试（PRD §16.5 P2：过期 session 清理）
import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/client.js';
import { cleanupExpiredSessions } from './session-cleanup.js';

function insertSession(expiresAt: number): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(uuidv4(), 'owner', `hash-${uuidv4()}`, expiresAt, Date.now(), Date.now());
}

function sessionCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
  return Number(row.n);
}

beforeEach(() => {
  getDb().exec('DELETE FROM sessions;');
});

describe('cleanupExpiredSessions（PRD §16.5 P2）', () => {
  it('删除已过期 session（expires_at < now）', () => {
    insertSession(Date.now() - 1000);
    expect(sessionCount()).toBe(1);

    const deleted = cleanupExpiredSessions();
    expect(deleted).toBe(1);
    expect(sessionCount()).toBe(0);
  });

  it('保留未过期 session（expires_at >= now）', () => {
    insertSession(Date.now() + 60 * 1000);
    const deleted = cleanupExpiredSessions();
    expect(deleted).toBe(0);
    expect(sessionCount()).toBe(1);
  });

  it('空表不报错，返回 0', () => {
    expect(sessionCount()).toBe(0);
    expect(cleanupExpiredSessions()).toBe(0);
  });

  it('返回删除数量（2 条过期 + 1 条有效 → 删 2）', () => {
    insertSession(Date.now() - 2000);
    insertSession(Date.now() - 1000);
    insertSession(Date.now() + 60 * 1000);
    expect(sessionCount()).toBe(3);

    const deleted = cleanupExpiredSessions();
    expect(deleted).toBe(2);
    expect(sessionCount()).toBe(1);
  });
});
