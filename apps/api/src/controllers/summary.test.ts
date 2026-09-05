// controllers/summary.ts 集成测试（DB 聚合 + 时间窗口，多账户 + 多流水）
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { buildApp, signToken, resetDb } from '../../tests/helpers.js';
import { getDb } from '../db/client.js';

const app: Express = buildApp();
const token = signToken();
const authHeaders = { Authorization: `Bearer ${token}` };

function seed(): { acc1: string; acc2: string } {
  const db = getDb();
  const now = Date.now();
  const acc1 = uuidv4();
  const acc2 = uuidv4();
  const insAcc = db.prepare(
    `INSERT INTO accounts (id,name,type,initial_balance,currency,archived,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  insAcc.run(acc1, '现金', 'cash', 1000, 'CNY', 0, now, now);
  insAcc.run(acc2, '银行卡', 'bank', 0, 'CNY', 0, now, now);

  const insTx = db.prepare(
    `INSERT INTO transactions (id,account_id,type,amount,category,note,date,transfer_group_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  insTx.run(uuidv4(), acc1, 'income', 5000, '工资', null, '2026-08-20', null, now, now);
  insTx.run(uuidv4(), acc1, 'expense', 50, '餐饮', null, '2026-08-21', null, now, now);
  insTx.run(uuidv4(), acc2, 'income', 100, '红包', null, '2026-08-22', null, now, now);
  const gid = uuidv4();
  insTx.run(uuidv4(), acc1, 'transfer_out', 200, null, null, '2026-08-23', gid, now, now);
  insTx.run(uuidv4(), acc2, 'transfer_in', 200, null, null, '2026-08-23', gid, now, now);
  return { acc1, acc2 };
}

beforeEach(() => resetDb());

describe('GET /api/v1/summary/accounts', () => {
  it('多账户汇总：income/expense/transfer/balance 正确', async () => {
    seed();
    const res = await request(app).get('/api/v1/summary/accounts').set(authHeaders);
    expect(res.status).toBe(200);

    const cash = res.body.data.find((a: { accountName: string }) => a.accountName === '现金');
    const bank = res.body.data.find((a: { accountName: string }) => a.accountName === '银行卡');

    expect(cash.income).toBe(5000);
    expect(cash.expense).toBe(50);
    expect(cash.transferNet).toBe(-200);
    expect(cash.balance).toBe(5750);
    expect(cash.archived).toBe(false);

    expect(bank.income).toBe(100);
    expect(bank.transferNet).toBe(200);
    expect(bank.balance).toBe(300);
  });

  it('时间窗口过滤（startDate/endDate）', async () => {
    seed();
    const res = await request(app)
      .get('/api/v1/summary/accounts')
      .query({ startDate: '2026-08-21', endDate: '2026-08-22' })
      .set(authHeaders);
    expect(res.status).toBe(200);
    const cash = res.body.data.find((a: { accountName: string }) => a.accountName === '现金');
    // 仅 expense 50 落在窗口内
    expect(cash.income).toBe(0);
    expect(cash.expense).toBe(50);
  });

  it('非法日期格式 → 400 ERR0001', async () => {
    const res = await request(app)
      .get('/api/v1/summary/accounts')
      .query({ startDate: 'not-a-date' })
      .set(authHeaders);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ERR0001');
  });
});

describe('GET /api/v1/summary/cashflow', () => {
  it('groupBy=month 默认聚合', async () => {
    seed();
    const res = await request(app).get('/api/v1/summary/cashflow').set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const row = res.body.data[0];
    expect(row.period).toBe('2026-08');
    expect(row.income).toBe(5100);
    expect(row.expense).toBe(50);
    expect(row.net).toBe(5050);
  });

  it('groupBy=day', async () => {
    seed();
    const res = await request(app)
      .get('/api/v1/summary/cashflow')
      .query({ groupBy: 'day' })
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { period: string }) => r.period)).toContain('2026-08-20');
  });

  it('groupBy=week', async () => {
    seed();
    const res = await request(app)
      .get('/api/v1/summary/cashflow')
      .query({ groupBy: 'week' })
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data[0].period).toMatch(/^2026-W\d+$/);
  });

  it('groupBy=quarter', async () => {
    seed();
    const res = await request(app)
      .get('/api/v1/summary/cashflow')
      .query({ groupBy: 'quarter' })
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data[0].period).toBe('2026-Q3');
  });

  it('groupBy=year', async () => {
    seed();
    const res = await request(app)
      .get('/api/v1/summary/cashflow')
      .query({ groupBy: 'year' })
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data[0].period).toBe('2026');
  });

  it('groupBy + 时间窗口过滤', async () => {
    seed();
    const res = await request(app)
      .get('/api/v1/summary/cashflow')
      .query({ groupBy: 'month', startDate: '2026-08-21', endDate: '2026-08-31' })
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data[0].income).toBe(100); // 只有 08-22 的红包 income
  });

  it('非法 groupBy → 400', async () => {
    const res = await request(app)
      .get('/api/v1/summary/cashflow')
      .query({ groupBy: 'foo' })
      .set(authHeaders);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ERR0001');
  });
});
