// Load .env via side-effect import BEFORE any other imports that depend on process.env
import 'dotenv/config';

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { ensureCsrfCookie, verifyCsrf } from './middleware/csrf.js';
import { authRoutes } from './routes/auth.js';
import { accountRoutes } from './routes/accounts.js';
import { transactionRoutes } from './routes/transactions.js';
import { summaryRoutes } from './routes/summary.js';
import { importRoutes } from './routes/imports.js';
import { exportRoutes } from './routes/exports.js';
import { deepseekRoutes } from './routes/deepseek.js';
import { aiParseQueueRoutes } from './routes/ai-parse-queue.js';
import { internalRoutes } from './routes/internal.js';
import cron from 'node-cron';
import { cleanupExpiredSessions } from './utils/session-cleanup.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) =>
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

app.use('/api/v1', (req, res) => {
  res.status(404).json({ error: { code: 'ERR0004', message: 'Not Found' } });
});

app.use(errorHandler);

const PORT = Number(process.env.PORT) || 3456;
// 显式绑 HOST（默认 127.0.0.1）：不裸 listen 到 0.0.0.0，避免局域网/公网暴露（最小权限，PRD §16.4/§16.8）。
const HOST = config.HOST || '127.0.0.1';

// Session 过期清理（PRD §16.5 P2）：node-cron 每小时跑一次，删除 expires_at < now 的过期 token。
const sessionCleanupJob = cron.schedule('0 * * * *', () => {
  try {
    cleanupExpiredSessions();
  } catch (err) {
    logger.error({ err }, 'Session cleanup failed');
  }
});

// 启动时立即跑一次（清理历史残留）。
cleanupExpiredSessions();

// Graceful shutdown：停 cron 后最后再清一次。
const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  sessionCleanupJob.stop();
  cleanupExpiredSessions();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.listen(PORT, HOST, () => {
  logger.info(`Server running on ${HOST}:${PORT}`);
});
