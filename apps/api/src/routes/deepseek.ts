import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  queueStatus,
  retryTask,
  testParse,
} from '../controllers/deepseek.js';

export const deepseekRoutes = Router();

deepseekRoutes.use(authMiddleware);

// --- GET /api/v1/deepseek/queue-status（PRD §14.8） ---
deepseekRoutes.get('/queue-status', queueStatus);

// --- POST /api/v1/deepseek/retry/:queueId（PRD §14.8） ---
deepseekRoutes.post('/retry/:queueId', retryTask);

// --- POST /api/v1/deepseek/test-parse（TP-08 smoke test 专用） ---
deepseekRoutes.post('/test-parse', testParse);