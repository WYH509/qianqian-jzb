import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { exportTransactions } from '../controllers/exports.js';

export const exportRoutes = Router();

exportRoutes.use(authMiddleware);

// --- GET /api/v1/export/transactions（PRD §14.6） ---
exportRoutes.get('/transactions', exportTransactions);