import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { AppError } from '../middleware/error-handler.js';

// --- Query schemas ---
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式 YYYY-MM-DD');

export const summaryAccountsQuerySchema = z.object({
  startDate: dateString.optional(),
  endDate: dateString.optional(),
});

export const cashflowQuerySchema = z.object({
  groupBy: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('month'),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
});

// --- Row types ---
interface AccountSummaryRow {
  account_id: string;
  account_name: string;
  type: string;
  currency: string;
  archived: number;
  income: number;
  expense: number;
  transfer_in: number;
  transfer_out: number;
  initial_balance: number;
  balance: number;
}

interface CashflowRow {
  period: string;
  income: number;
  expense: number;
  net: number;
}

// --- Helpers ---
function buildDateFilter(
  startDate: string | undefined,
  endDate: string | undefined
): { whereClause: string; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (startDate) {
    conditions.push('date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    conditions.push('date <= ?');
    params.push(endDate);
  }
  const whereClause = conditions.length > 0
    ? `AND ${conditions.join(' AND ')}`
    : '';
  return { whereClause, params };
}

/**
 * GET /api/v1/summary/accounts
 * PRD §14.5 / §15.1.2 / §15.5.3 — 按账户汇总（多账户 + 时间段）
 */
export function listAccountSummary(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const result = summaryAccountsQuerySchema.safeParse(req.query);
  if (!result.success) {
    const firstErr = result.error.errors[0];
    next(new AppError(400, 'ERR0001', firstErr?.message ?? 'Invalid query'));
    return;
  }
  const { startDate, endDate } = result.data;
  const { whereClause, params } = buildDateFilter(startDate, endDate);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
        a.id AS account_id,
        a.name AS account_name,
        a.type,
        a.currency,
        a.archived,
        a.initial_balance,
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense,
        COALESCE(SUM(CASE WHEN t.type = 'transfer_in' THEN t.amount ELSE 0 END), 0) AS transfer_in,
        COALESCE(SUM(CASE WHEN t.type = 'transfer_out' THEN t.amount ELSE 0 END), 0) AS transfer_out
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id AND t.deleted_at IS NULL ${whereClause}
      GROUP BY a.id
      ORDER BY a.archived, a.name`
    )
    .all(...params) as Array<Omit<AccountSummaryRow, 'balance'>>;

  const data = rows.map((r) => ({
    accountId: r.account_id,
    accountName: r.account_name,
    type: r.type,
    currency: r.currency,
    archived: r.archived === 1,
    initialBalance: r.initial_balance,
    income: r.income,
    expense: r.expense,
    transferNet: r.transfer_in - r.transfer_out,
    balance:
      r.initial_balance + r.income - r.expense + r.transfer_in - r.transfer_out,
  }));

  res.json({ data });
}

/**
 * GET /api/v1/summary/cashflow
 * PRD §14.5 / §15.5.1 / §15.5.2 / §15.5.4 — 按时间段聚合现金流
 */
export function listCashflow(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const result = cashflowQuerySchema.safeParse(req.query);
  if (!result.success) {
    const firstErr = result.error.errors[0];
    next(new AppError(400, 'ERR0001', firstErr?.message ?? 'Invalid query'));
    return;
  }
  const { groupBy, startDate, endDate } = result.data;

  // strftime format for each groupBy
  let periodExpr: string;
  switch (groupBy) {
    case 'day':
      periodExpr = "strftime('%Y-%m-%d', date)";
      break;
    case 'week':
      periodExpr = "strftime('%Y-W%W', date)";
      break;
    case 'month':
      periodExpr = "strftime('%Y-%m', date)";
      break;
    case 'quarter':
      // SQLite strftime 没有 %q，用表达式构造 YYYY-QN
      periodExpr =
        "(strftime('%Y', date) || '-Q' || ((CAST(strftime('%m', date) AS INTEGER) + 2) / 3))";
      break;
    case 'year':
      periodExpr = "strftime('%Y', date)";
      break;
  }

  const dateFilters: string[] = ['deleted_at IS NULL'];
  const params: (string | number)[] = [];
  if (startDate) {
    dateFilters.push('date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    dateFilters.push('date <= ?');
    params.push(endDate);
  }
  const whereClause = `WHERE ${dateFilters.join(' AND ')}`;

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
        ${periodExpr} AS period,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS net
      FROM transactions
      ${whereClause}
      GROUP BY period
      ORDER BY period`
    )
    .all(...params) as CashflowRow[];

  const data = rows.map((r) => ({
    period: r.period,
    income: r.income,
    expense: r.expense,
    net: r.net,
  }));

  res.json({ data });
}