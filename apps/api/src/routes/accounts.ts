import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import {
  createAccountSchema,
  updateAccountSchema,
  listAccounts,
  createAccount,
  getAccount,
  updateAccount,
  deleteAccount,
} from '../controllers/accounts.js';

export const accountRoutes = Router();

// 全部端点需登录（TP-03 authMiddleware，注入 req.user）
accountRoutes.use(authMiddleware);

// --- 请求体 zod 校验（对齐 TP-03 routes/auth.ts 风格） ---
function validateBody(schema: z.ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const err = result.error.errors[0];
      // PRD §14.7：账户类型无效 → ERR2003（HTTP 400）
      const code = err?.path[0] === 'type' ? 'ERR2003' : 'ERR0001';
      next(new AppError(400, code, err ? err.message : 'Invalid request body'));
      return;
    }
    req.body = result.data;
    next();
  };
}

// --- GET /api/v1/accounts（FR-ACC-001 列表，含余额） ---
accountRoutes.get('/', listAccounts);

// --- POST /api/v1/accounts（FR-ACC-002 创建） ---
accountRoutes.post('/', validateBody(createAccountSchema), createAccount);

// --- GET /api/v1/accounts/:id（FR-ACC-001 单个，含余额） ---
accountRoutes.get('/:id', getAccount);

// --- PUT /api/v1/accounts/:id（FR-ACC-003 更新） ---
// 注：PRD §14.3 原文写的是 PATCH，TP-04 任务表明确要求 PUT，按任务表实现（见回执 §7）
accountRoutes.put('/:id', validateBody(updateAccountSchema), updateAccount);

// --- DELETE /api/v1/accounts/:id（FR-ACC-004 删除） ---
accountRoutes.delete('/:id', deleteAccount);
