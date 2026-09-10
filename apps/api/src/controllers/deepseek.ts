// DeepSeek 管理端点（PRD §14.8 + §14.9）
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/error-handler.js';
import {
  getQueueStatus,
  requeueFailedTask,
  listQueueTasks,
  cancelQueueTask,
  executeAiParseTask,
  type AiParseTaskInput,
} from '../services/deepseek-service.js';

// --- GET /api/v1/deepseek/queue-status（PRD §14.8） ---
export function queueStatus(_req: Request, res: Response, _next: NextFunction): void {
  const status = getQueueStatus();
  res.json({ data: status });
}

// --- POST /api/v1/deepseek/retry/:queueId（PRD §14.8） ---
export function retryTask(req: Request, res: Response, next: NextFunction): void {
  const queueId = Number(req.params.queueId);
  if (!Number.isFinite(queueId) || queueId <= 0) {
    throw new AppError(400, 'ERR0001', 'queueId 必须为正整数');
  }
  const ok = requeueFailedTask(queueId);
  if (!ok) {
    throw new AppError(400, 'ERR0001', '任务不存在或状态非 failed（仅 failed 可重试）');
  }
  res.json({ data: { queueId, status: 're-queued' } });
}

// --- GET /api/v1/ai-parse-queue（PRD §14.9） ---
const listQueueQuerySchema = z.object({
  status: z.enum(['queued', 'processing', 'completed', 'failed']).optional(),
  taskType: z.enum(['excel', 'bank_statement', 'ocr']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function listQueue(req: Request, res: Response, next: NextFunction): void {
  const result = listQueueQuerySchema.safeParse(req.query);
  if (!result.success) {
    const firstErr = result.error.errors[0];
    throw new AppError(400, 'ERR0001', firstErr?.message ?? 'Invalid query');
  }
  const { status, taskType, page, pageSize } = result.data;
  const data = listQueueTasks({ status, taskType, page, pageSize });
  res.json(data);
}

// --- DELETE /api/v1/ai-parse-queue/:id（PRD §14.9） ---
export function cancelQueue(req: Request, res: Response, next: NextFunction): void {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new AppError(400, 'ERR0001', 'id 必须为正整数');
  }
  const result = cancelQueueTask(id);
  if (!result.deleted) {
    throw new AppError(400, 'ERR0001', result.reason ?? '取消失败');
  }
  res.status(204).send();
}

// --- POST /api/v1/deepseek/test-parse（内部测试用，PRD 未定义但 TP-08 smoke test 需要） ---
const testParseSchema = z.object({
  taskType: z.enum(['bank_statement', 'excel', 'ocr']),
  fileBase64: z.string().min(1),
  fileType: z.enum(['pdf', 'image', 'xlsx']),
});

export async function testParse(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const result = testParseSchema.safeParse(req.body);
  if (!result.success) {
    const firstErr = result.error.errors[0];
    throw new AppError(400, 'ERR0001', firstErr?.message ?? 'Invalid body');
  }
  const input: AiParseTaskInput = result.data;
  const outcome = await executeAiParseTask(input);
  res.json({ data: outcome });
}