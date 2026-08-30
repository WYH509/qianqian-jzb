import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { listQueue, cancelQueue } from '../controllers/deepseek.js';

export const aiParseQueueRoutes = Router();

aiParseQueueRoutes.use(authMiddleware);

// --- GET /api/v1/ai-parse-queue（PRD §14.9） ---
aiParseQueueRoutes.get('/', listQueue);

// --- DELETE /api/v1/ai-parse-queue/:id（PRD §14.9） ---
aiParseQueueRoutes.delete('/:id', cancelQueue);