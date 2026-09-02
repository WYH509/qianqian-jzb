import type { Request, Response, NextFunction } from 'express';
import { processQueuedTasks } from '../services/deepseek-service.js';
import { logger } from '../utils/logger.js';

export async function processQueue(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await processQueuedTasks();
    logger.info({ ...result }, 'internal/process-queue tick');
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}
