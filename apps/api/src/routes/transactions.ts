import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import {
  createTransactionSchema,
  updateMetadataSchema,
  updateTransactionSchema,
  listTransactions,
  createTransaction,
  getTransaction,
  updateTransactionStrict,
  updateTransactionFull,
  deleteTransaction,
} from '../controllers/transactions.js';

export const transactionRoutes = Router();

// 全部端点需登录（TP-03 authMiddleware，注入 req.user）
transactionRoutes.use(authMiddleware);

// --- 请求体 zod 校验（对齐 TP-04 routes/accounts.ts 风格） ---
// 错误码映射（PRD §14.7）：amount → ERR3002，date → ERR3003，其余 → ERR0001
// .strict() 拒绝未知字段：PUT/PATCH 时 type / accountId / transferGroupId 等不可改字段 → 400
function validateBody(schema: z.ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const err = result.error.errors[0];
      let code = 'ERR0001';
      let message = err ? err.message : 'Invalid request body';
      if (err?.code === 'unrecognized_keys') {
        const keys: unknown[] = (err as { keys?: unknown[] }).keys ?? [];
        message = `不允许的字段: ${keys.join(', ')}`;
      } else if (err?.path[0] === 'amount') {
        code = 'ERR3002';
      } else if (err?.path[0] === 'date') {
        code = 'ERR3003';
      }
      next(new AppError(400, code, message));
      return;
    }
    req.body = result.data;
    next();
  };
}

// --- GET /api/v1/transactions（FR-TXN-001 列表，过滤 / 分页 / 排序） ---
transactionRoutes.get('/', listTransactions);

// --- POST /api/v1/transactions（FR-TXN-002：income / expense / transfer） ---
transactionRoutes.post('/', validateBody(createTransactionSchema), createTransaction);

// --- GET /api/v1/transactions/:id（FR-TXN-001 单笔） ---
transactionRoutes.get('/:id', getTransaction);

// --- PUT /api/v1/transactions/:id（任务包 TP-05：仅 metadata；amount 不允许改） ---
transactionRoutes.put('/:id', validateBody(updateMetadataSchema), updateTransactionStrict);

// --- PATCH /api/v1/transactions/:id（PRD §14.4：可改 amount/category/note/date） ---
transactionRoutes.patch('/:id', validateBody(updateTransactionSchema), updateTransactionFull);

// --- DELETE /api/v1/transactions/:id（FR-TXN-004：软删除；转账联动删两笔） ---
transactionRoutes.delete('/:id', deleteTransaction);
