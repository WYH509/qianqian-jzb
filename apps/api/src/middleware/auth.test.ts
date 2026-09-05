// middleware/auth.ts 单元/集成测试（TP-11 P1#2：JWT 验签后必须查 sessions 表）
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Express } from 'express';
import { buildApp, signToken, signTokenOnly, resetDb } from '../../tests/helpers.js';
import { config } from '../config.js';
import { getDb } from '../db/client.js';

const app: Express = buildApp();

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

beforeEach(() => {
  resetDb();
});

describe('authMiddleware session check（TP-11 P1#2）', () => {
  it('valid token + 有 session → next() 调用（200）', async () => {
    const token = signToken();
    const res = await request(app).get('/api/v1/accounts').set(bearer(token));
    expect(res.status).toBe(200);
  });

  it('JWT 签名错 → 401 + ERR0002', async () => {
    const bad = jwt.sign({ userId: 'owner' }, 'wrong-secret-wrong-secret-wrong-secret-wrong', {
      expiresIn: '7d',
    });
    const res = await request(app).get('/api/v1/accounts').set(bearer(bad));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR0002');
  });

  it('JWT 过期 → 401 + ERR0002', async () => {
    const expired = jwt.sign({ userId: 'owner' }, config.JWT_SECRET, { expiresIn: '-1s' });
    const res = await request(app).get('/api/v1/accounts').set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR0002');
  });

  it('JWT 通过但 sessions 表没记录 → 401 + ERR0002', async () => {
    const token = signTokenOnly();
    const res = await request(app).get('/api/v1/accounts').set(bearer(token));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR0002');
  });

  it('JWT 通过但 sessions.expires_at 已过期 → 401 + ERR0002', async () => {
    const token = signTokenOnly();
    const now = Date.now();
    getDb()
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(uuidv4(), 'owner', tokenHash(token), now - 1000, now - 1000, now - 1000);

    const res = await request(app).get('/api/v1/accounts').set(bearer(token));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR0002');
  });
});
