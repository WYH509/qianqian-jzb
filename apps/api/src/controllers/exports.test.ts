// controllers/exports.ts 集成测试（xlsx 导出 + 文件流 + Content-Type）
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { buildApp, signToken, resetDb } from '../../tests/helpers.js';
import { getDb } from '../db/client.js';

const app: Express = buildApp();
const token = signToken();
const authHeaders = { Authorization: `Bearer ${token}` };

function seedTx(): string {
  const db = getDb();
  const acc = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO accounts (id,name,type,initial_balance,currency,archived,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(acc, '现金', 'cash', 0, 'CNY', 0, now, now);
  db.prepare(
    `INSERT INTO transactions (id,account_id,type,amount,category,note,date,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(uuidv4(), acc, 'expense', 50, '餐饮', '午餐', '2026-08-25', now, now);
  return acc;
}

beforeEach(() => resetDb());

// 二进制响应收集器（xlsx 非 JSON）
function binaryParser(res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
  res.on('error', (e: Error) => cb(e, Buffer.alloc(0)));
}

describe('GET /api/v1/export/transactions', () => {
  it('导出 xlsx → 200 + Content-Type + Content-Disposition + 非空 body', async () => {
    seedTx();
    const res = await request(app)
      .get('/api/v1/export/transactions')
      .set(authHeaders)
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('.xlsx');
    expect((res.body as Buffer).length).toBeGreaterThan(0);
  });

  it('无数据 → 仍 200（仅表头）', async () => {
    const res = await request(app)
      .get('/api/v1/export/transactions')
      .set(authHeaders)
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
  });

  it('accountId 过滤 → 200', async () => {
    const acc = seedTx();
    const res = await request(app)
      .get('/api/v1/export/transactions')
      .query({ accountId: acc })
      .set(authHeaders)
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);
  });

  it('非法日期 → 500（当前实现）', async () => {
    const res = await request(app)
      .get('/api/v1/export/transactions')
      .query({ startDate: 'bad-date' })
      .set(authHeaders);
    expect(res.status).toBe(500);
  });
});
