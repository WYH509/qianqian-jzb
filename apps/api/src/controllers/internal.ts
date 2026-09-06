import type { Request, Response, NextFunction } from 'express';
import { processQueuedTasks } from '../services/deepseek-service.js';
import { getDb } from '../db/client.js';
import { logger } from '../utils/logger.js';

// --- audit_log 写入（对齐 accounts/transactions 本地 writeAudit 风格） ---
// crontab 同机调用，无登录用户上下文，user_id 记为 'system'。
function writeAudit(params: {
  action: 'ai_parse';
  userId: string;
  details?: unknown;
  errorCategory?: string | null;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity_type, details, error_category, created_at)
     VALUES (?, ?, 'ai_call', ?, ?, ?)`
  ).run(
    params.userId,
    params.action,
    JSON.stringify(params.details),
    params.errorCategory,
    Date.now()
  );
}

export async function processQueue(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await processQueuedTasks();
    logger.info({ ...result }, 'internal/process-queue tick');
    writeAudit({
      action: 'ai_parse',
      userId: 'system',
      details: {
        processed: result.processed,
        completed: result.completed,
        failed: result.failed,
      },
    });
    res.json({ data: result });
  } catch (err) {
    writeAudit({
      action: 'ai_parse',
      userId: 'system',
      details: { error: err instanceof Error ? err.message : String(err) },
      errorCategory: 'ai_parse_queue_failed',
    });
    next(err);
  }
}
