import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/error-handler.js';

// --- 账户类型（对齐 V001__init.sql accounts.type CHECK 约束） ---
// PRD FR-ACC-005 定义了 7 种类型（CASH/BANK_CARD/ALIPAY/WECHAT/CREDIT_CARD/INVESTMENT/OTHER），
// 但 V001 表结构 CHECK 只允许 cash/bank/investment/credit。表结构已锁定（TP-02），实现以 V001 为准。
export const ACCOUNT_TYPES = ['cash', 'bank', 'investment', 'credit'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

// --- Zod schemas ---
export const createAccountSchema = z.object({
  name: z.string().min(1, '账户名称不能为空').max(20, '账户名称最长 20 字'),
  type: z.enum(ACCOUNT_TYPES, { errorMap: () => ({ message: '账户类型无效' }) }),
  initialBalance: z.number().finite('期初余额必须是有限数字').optional(),
  currency: z.string().min(1, '币种不能为空').max(10).optional(),
});

export const updateAccountSchema = z
  .object({
    name: z.string().min(1, '账户名称不能为空').max(20, '账户名称最长 20 字').optional(),
    type: z.enum(ACCOUNT_TYPES, { errorMap: () => ({ message: '账户类型无效' }) }).optional(),
    currency: z.string().min(1).max(10).optional(),
    archived: z.boolean().optional(),
    // FR-ACC-003：期初余额不可改。放入 schema 仅为透传给 controller 明确拒绝（否则 zod 剥掉后走 refine）
    initialBalance: z.number().finite('期初余额必须是有限数字').optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少提供一个待更新字段' });

// --- Row types（对齐 V001 accounts / transactions 列） ---
interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  initial_balance: number;
  currency: string;
  archived: number;
  created_at: number;
  updated_at: number;
}

interface AccountRowWithNet extends AccountRow {
  net: number;
}

// --- 余额计算（PRD §15.1.1） ---
// 公式：balance = initial_balance
//   + SUM(income) - SUM(expense) + SUM(transfer_in) - SUM(transfer_out)
// 单 SQL 聚合（无 N+1）；排除软删除（deleted_at IS NULL）。
// 与 PRD §15.1.1 差异：当前余额（FR-ACC-001「实时计算」）不加 date <= T 过滤，
// 即包含全部非删除交易；transfer 四项保留，TP-05 落地转账后余额自动正确。
const ACCOUNT_SELECT_COLS = `
  a.id, a.name, a.type, a.initial_balance, a.currency, a.archived,
  a.created_at, a.updated_at
`;

const NET_SQL = `
  COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0)
  + COALESCE(SUM(CASE WHEN t.type = 'transfer_in' THEN t.amount ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN t.type = 'transfer_out' THEN t.amount ELSE 0 END), 0)
`;

/** 单账户净变动（不含期初余额），单 SQL 查询 */
function getAccountNet(accountId: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT ${NET_SQL.replaceAll('t.', '')} AS net
       FROM transactions
       WHERE account_id = ? AND deleted_at IS NULL`
    )
    .get(accountId) as { net: number } | undefined;
  return Number(row?.net ?? 0);
}

function computeBalance(initialBalance: number, net: number): number {
  // PRD：金额保留 2 位小数
  return Math.round((initialBalance + net) * 100) / 100;
}

function toAccountDto(row: AccountRow, net: number) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    initialBalance: row.initial_balance,
    balance: computeBalance(row.initial_balance, net),
    currency: row.currency,
    archived: row.archived === 1,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

// --- audit_log 写入（对齐 TP-03 writeAudit 风格，补 entity_type/entity_id） ---
function writeAudit(
  action: 'create' | 'update' | 'delete',
  userId: string,
  entityId: string,
  details: unknown
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, 'account', ?, ?, ?)`
  ).run(userId, action, entityId, JSON.stringify(details), Date.now());
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

// --- 列表查询参数解析（PRD §14.1.4 分页排序约定 + FR-ACC-001 名称搜索） ---
const SORT_COLUMNS: Record<string, string> = {
  created_at: 'a.created_at',
  createdAt: 'a.created_at',
  updated_at: 'a.updated_at',
  updatedAt: 'a.updated_at',
  name: 'a.name',
  type: 'a.type',
  initial_balance: 'a.initial_balance',
  initialBalance: 'a.initial_balance',
};

function parseListQuery(query: Request['query']) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSizeRaw = Number(query.pageSize) || 20;
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
  const sortBy = SORT_COLUMNS[String(query.sortBy || 'created_at')] ?? 'a.created_at';

  let type: AccountType | undefined;
  if (query.type !== undefined) {
    if (!ACCOUNT_TYPES.includes(query.type as AccountType)) {
      throw new AppError(400, 'ERR2003', '账户类型无效');
    }
    type = query.type as AccountType;
  }

  let archived: boolean | undefined;
  if (query.archived !== undefined) {
    const v = String(query.archived).toLowerCase();
    if (v !== 'true' && v !== 'false') {
      throw new AppError(400, 'ERR0001', 'archived 参数必须是 true 或 false');
    }
    archived = v === 'true';
  }

  const search = typeof query.search === 'string' && query.search.trim() !== '' ? query.search.trim() : undefined;

  return { page, pageSize, sortBy, sortOrder, type, archived, search };
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// --- GET /api/v1/accounts（FR-ACC-001） ---
export async function listAccounts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDb();
    const { page, pageSize, sortBy, sortOrder, type, archived, search } = parseListQuery(req.query);

    const where: string[] = [];
    const params: unknown[] = [];
    if (type) {
      where.push('a.type = ?');
      params.push(type);
    }
    if (archived !== undefined) {
      where.push('a.archived = ?');
      params.push(archived ? 1 : 0);
    }
    if (search) {
      where.push(`a.name LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(search)}%`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM accounts a ${whereSql}`).get(...params) as {
      c: number;
    };
    const total = totalRow.c;

    // 单查询聚合余额（LEFT JOIN 一次拿全，避免 N+1）
    const rows = db
      .prepare(
        `SELECT ${ACCOUNT_SELECT_COLS}, (${NET_SQL}) AS net
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id AND t.deleted_at IS NULL
         ${whereSql}
         GROUP BY a.id
         ORDER BY ${sortBy} ${sortOrder}
         LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize) as AccountRowWithNet[];

    res.json({
      data: rows.map((r) => toAccountDto(r, r.net)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    next(err);
  }
}

// --- POST /api/v1/accounts（FR-ACC-002） ---
export async function createAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDb();
    const body = req.body as z.infer<typeof createAccountSchema>;
    const userId = req.user?.userId ?? 'unknown';

    const id = uuidv4();
    const name = body.name.trim();
    const type = body.type;
    const initialBalance = body.initialBalance ?? 0;
    const currency = body.currency ?? 'CNY';
    const now = Date.now();

    const existing = db.prepare('SELECT id FROM accounts WHERE name = ?').get(name);
    if (existing) {
      throw new AppError(409, 'ERR2001', '账户名已存在');
    }

    const txn = db.transaction(() => {
      db.prepare(
        `INSERT INTO accounts (id, name, type, initial_balance, currency, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(id, name, type, initialBalance, currency, now, now);
      writeAudit('create', userId, id, { name, type, initialBalance, currency });
    });
    txn();

    const row = db.prepare(`SELECT ${ACCOUNT_SELECT_COLS} FROM accounts a WHERE a.id = ?`).get(id) as AccountRow;
    logger.info({ accountId: id, name }, 'Account created');

    res.status(201).json({ data: toAccountDto(row, 0) });
  } catch (err) {
    if (isUniqueViolation(err)) {
      next(new AppError(409, 'ERR2001', '账户名已存在'));
      return;
    }
    next(err);
  }
}

// --- GET /api/v1/accounts/:id（FR-ACC-001） ---
export async function getAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDb();
    const { id } = req.params as { id: string };

    const row = db.prepare(`SELECT ${ACCOUNT_SELECT_COLS} FROM accounts a WHERE a.id = ?`).get(id) as
      | AccountRow
      | undefined;
    if (!row) {
      throw new AppError(404, 'ERR0004', '账户不存在');
    }

    res.json({ data: toAccountDto(row, getAccountNet(id)) });
  } catch (err) {
    next(err);
  }
}

// --- PUT /api/v1/accounts/:id（FR-ACC-003） ---
export async function updateAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDb();
    const { id } = req.params as { id: string };
    const body = req.body as z.infer<typeof updateAccountSchema> & { initialBalance?: number };
    const userId = req.user?.userId ?? 'unknown';

    // PRD FR-ACC-003：期初余额不可改（有误则删除重建）
    if (body.initialBalance !== undefined) {
      throw new AppError(400, 'ERR0001', '期初余额不可修改（如有误请删除账户重建）');
    }

    const existing = db.prepare(`SELECT ${ACCOUNT_SELECT_COLS} FROM accounts a WHERE a.id = ?`).get(id) as
      | AccountRow
      | undefined;
    if (!existing) {
      throw new AppError(404, 'ERR0004', '账户不存在');
    }

    // PRD §14.3：归档账户不能再编辑 name / type
    if (existing.archived === 1 && (body.name !== undefined || body.type !== undefined)) {
      throw new AppError(400, 'ERR0001', '归档账户不能修改名称或类型');
    }

    const nextName = body.name !== undefined ? body.name.trim() : existing.name;
    if (nextName !== existing.name) {
      const dup = db.prepare('SELECT id FROM accounts WHERE name = ? AND id != ?').get(nextName, id);
      if (dup) {
        throw new AppError(409, 'ERR2001', '账户名已存在');
      }
    }

    const nextType = body.type ?? existing.type;
    const nextCurrency = body.currency ?? existing.currency;
    const nextArchived = body.archived !== undefined ? (body.archived ? 1 : 0) : existing.archived;
    const now = Date.now();

    const txn = db.transaction(() => {
      db.prepare(
        `UPDATE accounts SET name = ?, type = ?, currency = ?, archived = ?, updated_at = ?
         WHERE id = ?`
      ).run(nextName, nextType, nextCurrency, nextArchived, now, id);
      writeAudit('update', userId, id, {
        before: {
          name: existing.name,
          type: existing.type,
          currency: existing.currency,
          archived: existing.archived === 1,
        },
        after: { name: nextName, type: nextType, currency: nextCurrency, archived: nextArchived === 1 },
      });
    });
    txn();

    const row = db.prepare(`SELECT ${ACCOUNT_SELECT_COLS} FROM accounts a WHERE a.id = ?`).get(id) as AccountRow;
    logger.info({ accountId: id }, 'Account updated');

    res.json({ data: toAccountDto(row, getAccountNet(id)) });
  } catch (err) {
    if (isUniqueViolation(err)) {
      next(new AppError(409, 'ERR2001', '账户名已存在'));
      return;
    }
    next(err);
  }
}

// --- DELETE /api/v1/accounts/:id（FR-ACC-004） ---
export async function deleteAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDb();
    const { id } = req.params as { id: string };
    const userId = req.user?.userId ?? 'unknown';

    const row = db.prepare('SELECT id, name FROM accounts WHERE id = ?').get(id) as
      | { id: string; name: string }
      | undefined;
    if (!row) {
      throw new AppError(404, 'ERR0004', '账户不存在');
    }

    // 2026-09-12 大海拍板：owner 是 admin，单用户本地记账 → 允许硬删（级联删该账户下所有 transactions）。
    // 注：V001__init.sql 的 import_history 表没有 account_id 列（只有 id/file_hash/file_name/row_count/status/error_message/created_at），
    //     之前那行 `UPDATE import_history SET account_id = NULL` 是错代码，跑就 SQLITE_ERROR → 事务回滚 → 500。
    //     2026-09-13 已删掉该错 UPDATE。import_history 不参与账户级联。
    const txn = db.transaction(() => {
      const txDel = db.prepare('DELETE FROM transactions WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      writeAudit('delete', userId, id, {
        name: row.name,
        cascaded_transactions: txDel.changes,
      });
    });
    txn();

    logger.info({ accountId: id, name: row.name }, 'Account hard-deleted (admin cascade)');
    res.status(204).end();
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
    ) {
      next(new AppError(409, 'ERR2002', '账户有交易，禁止删除'));
      return;
    }
    next(err);
  }
}
