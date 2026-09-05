import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
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

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/accounts', accountRoutes);
  app.use('/api/v1/transactions', transactionRoutes);
  app.use('/api/v1/summary', summaryRoutes);
  app.use('/api/v1/import', importRoutes);
  app.use('/api/v1/export', exportRoutes);
  app.use('/api/v1/deepseek', deepseekRoutes);
  app.use('/api/v1/ai-parse-queue', aiParseQueueRoutes);
  app.use('/api/v1/internal', internalRoutes);

  app.use('/api/v1', (_req, res) => {
    res.status(404).json({ error: { code: 'ERR0004', message: 'Not Found' } });
  });

  app.use(errorHandler);

  return app;
}

/** 直接签发 owner 的 JWT（与 authMiddleware 用同一 config.JWT_SECRET），绕过登录限流。 */
export function signToken(userId = 'owner'): string {
  return jwt.sign({ userId }, config.JWT_SECRET, { expiresIn: '7d' });
}

/** 清空所有业务表（每个 golden case 前调用，保证隔离）。 */
export function resetDb(): void {
  const db = getDb();
  db.exec(`
    DELETE FROM transactions;
    DELETE FROM accounts;
    DELETE FROM sessions;
    DELETE FROM audit_log;
    DELETE FROM import_history;
    DELETE FROM ai_parse_queue;
    DELETE FROM schema_migrations;
  `);
}
