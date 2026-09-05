// csrf.ts 单元/集成测试（TP-11 P1#3：double-submit cookie CSRF）
import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { ensureCsrfCookie, verifyCsrf } from './csrf.js';
import { buildApp, resetDb } from '../../tests/helpers.js';

// 最小 app：只挂 CSRF middleware，隔离验证 verifyCsrf 的豁免 / 拒绝 / 放行逻辑。
function csrfOnlyApp(): express.Express {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.get('/protected', verifyCsrf, (_req, res) => res.json({ ok: true }));
  app.post('/protected', verifyCsrf, (_req, res) => res.json({ ok: true }));
  return app;
}

// 只挂 ensureCsrfCookie，验证 GET 时种 cookie。
function ensureApp(): express.Express {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(ensureCsrfCookie);
  app.get('/', (_req, res) => res.json({ ok: true }));
  return app;
}

function hasCsrfCookie(headers: unknown): boolean {
  const arr = Array.isArray(headers) ? headers : [headers];
  return arr.some((c): c is string => typeof c === 'string' && c.startsWith('csrf='));
}

describe('csrf.ts（TP-11 P1#3 double-submit cookie）', () => {
  it('GET 请求自动豁免（无 header/cookie 也放行）', async () => {
    const res = await request(csrfOnlyApp()).get('/protected');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST 无 X-CSRF-Token header → 401 ERR0007', async () => {
    const res = await request(csrfOnlyApp()).post('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR0007');
  });

  it('POST 有 header 但无 cookie → 401 ERR0007', async () => {
    const res = await request(csrfOnlyApp()).post('/protected').set('X-CSRF-Token', 'tok');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR0007');
  });

  it('POST header 与 cookie 不匹配 → 401 ERR0007', async () => {
    const res = await request(csrfOnlyApp())
      .post('/protected')
      .set('X-CSRF-Token', 'aaa')
      .set('Cookie', 'csrf=bbb');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR0007');
  });

  it('POST header 与 cookie 匹配 → next()（200）', async () => {
    const res = await request(csrfOnlyApp())
      .post('/protected')
      .set('X-CSRF-Token', 'tok')
      .set('Cookie', 'csrf=tok');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('ensureCsrfCookie：无 csrf cookie 的请求会种 Set-Cookie: csrf=...', async () => {
    const res = await request(ensureApp()).get('/');
    expect(res.status).toBe(200);
    const csrfCookie = hasCsrfCookie(res.headers['set-cookie']);
    expect(csrfCookie).toBe(true);
  });

  it('login 响应包含 Set-Cookie: csrf=...（登录后立即有 CSRF cookie）', async () => {
    resetDb();
    const res = await request(buildApp())
      .post('/api/v1/auth/login')
      .send({ username: 'owner', password: 'owner123' });
    expect(res.status).toBe(200);
    const csrfCookie = hasCsrfCookie(res.headers['set-cookie']);
    expect(csrfCookie).toBe(true);
  });
});
