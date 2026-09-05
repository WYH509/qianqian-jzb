import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../src/config.js';
import { getDb } from '../src/db/client.js';
import { authRoutes } from '../src/routes/auth.js';
import { accountRoutes } from '../src/routes/accounts.js';
import { transactionRoutes } from '../src/routes/transactions.js';
import { summaryRoutes } from '../src/routes/summary.js';
import { importRoutes } from '../src/routes/imports.js';
import { exportRoutes } from '../src/routes/exports.js';
import { deepseekRoutes } from '../src/routes/deepseek.js';
import { aiParseQueueRoutes } from '../src/routes/ai-parse-queue.js';
import { internalRoutes } from '../src/routes/internal.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { ensureCsrfCookie, verifyCsrf } from '../src/middleware/csrf.js';

/**
 * 构造与 src/index.ts 完全一致的 Express app（不含 app.listen），
 * 供 supertest 直接注入请求，避免测试时占用端口。
 */
export function buildApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));

  app.get('/', (_req, res) =>
    res.json({
      status: 'ok',
      name: 'qianqian-jzb-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    })
  );

  // CSRF：先种 cookie（所有请求，含 GET），再验证状态变更请求。
  // 豁免路径（verifyCsrf 之前挂载）：login / logout（authRoutes）与 internal/process-queue（loopback 白名单）。
  app.use(ensureCsrfCookie);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/internal', internalRoutes);
  app.use('/api/v1', verifyCsrf);

  app.use('/api/v1/accounts', accountRoutes);
  app.use('/api/v1/transactions', transactionRoutes);
  app.use('/api/v1/summary', summaryRoutes);
  app.use('/api/v1/import', importRoutes);
  app.use('/api/v1/export', exportRoutes);
  app.use('/api/v1/deepseek', deepseekRoutes);
  app.use('/api/v1/ai-parse-queue', aiParseQueueRoutes);

  app.use('/api/v1', (_req, res) => {
    res.status(404).json({ error: { code: 'ERR0004', message: 'Not Found' } });
  });

  app.use(errorHandler);

  return app;
}

/** 直接签发 owner 的 JWT（与 authMiddleware 用同一 config.JWT_SECRET），绕过登录限流。
 *  同时写入 sessions 表（绕过 middleware 的 session check，对齐 login 行为）。 */
export function signToken(userId = 'owner'): string {
  // jti 保证每次签发的 token 唯一（避免同秒签发出相同 JWT，token_hash 冲突）
  const token = jwt.sign({ userId, jti: uuidv4() }, config.JWT_SECRET, { expiresIn: '7d' });
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      uuidv4(),
      userId,
      createHash('sha256').update(token).digest('hex'),
      now + 7 * 24 * 60 * 60 * 1000,
      now,
      now
    );
  return token;
}

/** 只签发 owner 的 JWT，不写 sessions 表（用于验证 session check 的拒绝路径）。 */
export function signTokenOnly(userId = 'owner'): string {
  return jwt.sign({ userId, jti: uuidv4() }, config.JWT_SECRET, { expiresIn: '7d' });
}

/** 清空所有业务表（每个 golden case 前调用，保证隔离）。 */
export function resetDb(): void {
  const db = getDb();
  db.exec(`
    DELETE FROM transactions;
    DELETE FROM accounts;
    DELETE FROM audit_log;
    DELETE FROM import_history;
    DELETE FROM ai_parse_queue;
    DELETE FROM schema_migrations;
  `);
}

// --- CSRF 测试辅助（TP-11 P1#3：double-submit cookie） ---
// 测试用固定 token：verifyCsrf 只校验 cookie===header 字符串相等，不校验 token 格式。
export const TEST_CSRF = 'test-csrf-token';

/** 返回带 CSRF 校验通过的 header（Cookie: csrf=... + X-CSRF-Token: ...）。
 *  与 Authorization（Bearer）等既有 header 合并，供 POST/PUT/DELETE 测试自动携带。 */
export function withCsrf(headers: Record<string, string> = {}): Record<string, string> {
  return {
    'X-CSRF-Token': TEST_CSRF,
    Cookie: `csrf=${TEST_CSRF}`,
    ...headers,
  };
}
