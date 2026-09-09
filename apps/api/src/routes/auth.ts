import { Router } from 'express';
import { z } from 'zod';
import { login, logout } from '../controllers/auth.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';

export const authRoutes = Router();

// --- POST /api/v1/auth/login ---
// PRD V2 §16.1 原本要求 5 次/分钟/IP 限流，但本项目是单用户本地记账（大海自用），
// 不需要防爆破。TP-11 commit 3118f88 加的 loginLimiter 已移除。
// （代码层面：移除中间件引用 + 移除 import，rate-limit.ts 文件保留以便回滚）
// Zod validation inline
authRoutes.post('/login', (req, res, next) => {
  const result = z
    .object({
      username: z.string().min(1, 'username is required').max(50),
      password: z.string().min(1, 'password is required').max(200),
    })
    .safeParse(req.body);

  if (!result.success) {
    const err = result.error.errors[0];
    next(new AppError(400, 'ERR0001', err ? err.message : 'Invalid request body'));
    return;
  }

  next();
}, login);

// --- POST /api/v1/auth/logout (protected) ---
authRoutes.post('/logout', authMiddleware, logout);
