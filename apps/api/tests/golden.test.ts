import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp, signToken, resetDb } from './helpers.js';

// PRD §10.8 关键路径 golden cases（auth / accounts / transactions / transfer / logout）
// 端点前缀为 /api/v1（对齐 src/index.ts 挂载），「健康检查」对应根路由 GET /（status:ok）。
const app: Express = buildApp();

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function firstCookie(headers: unknown, prefix: string): string | undefined {
  const arr = Array.isArray(headers) ? headers : [headers];
  return arr.find((c): c is string => typeof c === 'string' && c.startsWith(prefix));
}

beforeEach(() => {
  resetDb();
});

describe('TP-12 golden cases', () => {
  it('1. 健康检查 GET / → 200 + status:ok', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('2. 登录（owner/owner123）→ 200 + Set-Cookie token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'owner', password: 'owner123' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const tokenCookie = firstCookie(res.headers['set-cookie'], 'token=');
    expect(tokenCookie).toBeDefined();
  });

  it('3. 登录失败（错密码）→ 401 + ERR0003', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'owner', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR0003');
  });

  it('4. 未登录访问需鉴权端点 → 401 + ERR0002', async () => {
    const res = await request(app).get('/api/v1/accounts');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR0002');
  });

  it('5. 创建现金账户 → 201 + Account JSON', async () => {
    const token = signToken();
    const res = await request(app)
      .post('/api/v1/accounts')
      .set(authHeaders(token))
      .send({ name: '现金', type: 'cash', initialBalance: 1000 });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('现金');
    expect(res.body.data.type).toBe('cash');
    expect(res.body.data.balance).toBe(1000);
  });

  it('6. 创建重复名账户 → 409 + ERR2001', async () => {
    const token = signToken();
    await request(app)
      .post('/api/v1/accounts')
      .set(authHeaders(token))
      .send({ name: '现金', type: 'cash' });
    const res = await request(app)
      .post('/api/v1/accounts')
      .set(authHeaders(token))
      .send({ name: '现金', type: 'bank' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ERR2001');
  });

  it('7. 创建支出流水 → 201 + 影响余额', async () => {
    const token = signToken();
    const acc = await request(app)
      .post('/api/v1/accounts')
      .set(authHeaders(token))
      .send({ name: '现金', type: 'cash', initialBalance: 1000 });
    const accountId = acc.body.data.id as string;

    const res = await request(app)
      .post('/api/v1/transactions')
      .set(authHeaders(token))
      .send({ accountId, type: 'expense', amount: 50, category: '餐饮' });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('expense');

    const got = await request(app)
      .get(`/api/v1/accounts/${accountId}`)
      .set(authHeaders(token));
    expect(got.body.data.balance).toBe(950);
  });

  it('8. 转账（from→to 充足）→ 201 + 2 笔流水 + 双账户余额变', async () => {
    const token = signToken();
    const from = await request(app)
      .post('/api/v1/accounts')
      .set(authHeaders(token))
      .send({ name: 'A', type: 'cash', initialBalance: 1000 });
    const to = await request(app)
      .post('/api/v1/accounts')
      .set(authHeaders(token))
      .send({ name: 'B', type: 'bank', initialBalance: 0 });
    const fromId = from.body.data.id as string;
    const toId = to.body.data.id as string;

    const res = await request(app)
      .post('/api/v1/transactions')
      .set(authHeaders(token))
      .send({ type: 'transfer', fromAccountId: fromId, toAccountId: toId, amount: 300 });
    expect(res.status).toBe(201);
    expect(res.body.data.fromTransactionId).toBeDefined();
    expect(res.body.data.toTransactionId).toBeDefined();

    const fromGot = await request(app).get(`/api/v1/accounts/${fromId}`).set(authHeaders(token));
    const toGot = await request(app).get(`/api/v1/accounts/${toId}`).set(authHeaders(token));
    expect(fromGot.body.data.balance).toBe(700);
    expect(toGot.body.data.balance).toBe(300);
  });

  it('9. 转账余额不足 → 422 + ERR3001', async () => {
    const token = signToken();
    const from = await request(app)
      .post('/api/v1/accounts')
      .set(authHeaders(token))
      .send({ name: 'A', type: 'cash', initialBalance: 100 });
    const to = await request(app)
      .post('/api/v1/accounts')
      .set(authHeaders(token))
      .send({ name: 'B', type: 'bank', initialBalance: 0 });

    const res = await request(app)
      .post('/api/v1/transactions')
      .set(authHeaders(token))
      .send({
        type: 'transfer',
        fromAccountId: from.body.data.id,
        toAccountId: to.body.data.id,
        amount: 300,
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ERR3001');
  });

  it('10. 注销 → 200 + 清 cookie（旧 token 彻底失效需 middleware 加 sessions 校验后落地）', async () => {
    const token = signToken();
    const res = await request(app).post('/api/v1/auth/logout').set(authHeaders(token));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const clearCookie = firstCookie(res.headers['set-cookie'], 'token=');
    expect(clearCookie).toBeDefined();
  });
});
