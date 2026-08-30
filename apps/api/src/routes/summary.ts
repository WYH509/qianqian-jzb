import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  listAccountSummary,
  listCashflow,
} from '../controllers/summary.js';

export const summaryRoutes = Router();

// 全部端点需登录（TP-03 authMiddleware，注入 req.user）
summaryRoutes.use(authMiddleware);

// --- GET /api/v1/summary/accounts（PRD §14.5 / §15.5.3 按账户汇总） ---
summaryRoutes.get('/accounts', listAccountSummary);

// --- GET /api/v1/summary/cashflow（PRD §14.5 / §15.5.1/2/4 时间段聚合） ---
summaryRoutes.get('/cashflow', listCashflow);