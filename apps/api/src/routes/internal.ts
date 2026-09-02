import { Router } from 'express';
import { processQueue } from '../controllers/internal.js';

export const internalRoutes = Router();

// 无 authMiddleware：仅 HOST=127.0.0.1 限制本机访问，crontab 同机调用。
internalRoutes.post('/process-queue', processQueue);
