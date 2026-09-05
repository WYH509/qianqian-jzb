import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { processQueue } from '../controllers/internal.js';
import { AppError } from '../middleware/error-handler.js';

export const internalRoutes = Router();

// 仅允许本机 loopback 访问（crontab 同机 curl localhost 调用）。
// TP-11 修复：原注释声称「HOST=127.0.0.1 限制本机访问」，但 index.ts 未绑定 HOST
// （app.listen 监听 0.0.0.0），该无鉴权端点实际暴露在局域网，可被任意机器触发
// DeepSeek 队列处理（消耗外部 API 配额）。此处加显式 loopback 白名单。
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function loopbackOnly(req: Request, _res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  if (LOOPBACK_IPS.has(ip)) {
    next();
    return;
  }
  next(new AppError(403, 'ERR0002', 'Forbidden: internal endpoint is localhost-only'));
}

internalRoutes.use(loopbackOnly);

// 无 authMiddleware：loopbackOnly 已限制本机访问，crontab 同机调用。
internalRoutes.post('/process-queue', processQueue);
