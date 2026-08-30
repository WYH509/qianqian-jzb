import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/error-handler.js';

// ============================================================================
// 交易 API（TP-05）
// 对齐 V001__init.sql transactions 表实际列：
//   id / account_id / type / amount / category / note / date / transfer_group_id
//   / import_batch_id / deleted_at / created_at / updated_at
// 类型枚举（V001 CHECK）：income / expense / transfer_in / transfer_out
// 转账（PRD §15.2）：transfer_out（转出）+ transfer_in（转入）两笔，共享 transfer_group_id
// ============================================================================

// --- 类型常量（对齐 V001 transactions.type CHECK 约束） ---
export const TXN_TYPES = ['income', 'expense', 'transfer_in', 'transfer_out'] as const;
export type TxnType = (typeof TXN_TYPES)[number];

// POST 接受的用户侧类型：transfer 是语义类型，落地为 transfer_out + transfer_in 两笔
const USER_TXN_TYPES = ['income', 'expense', 'transfer'] as const;
type UserTxnType = (typeof USER_TXN_TYPES)[number];

// --- 日期工具（PRD §13.2.2：date 为 ISO 8601 'YYYY-MM-DD' 字符串） ---
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const parts = s.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 本地时区的今天（YYYY-MM-DD） */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// --- Zod schemas ---
// 说明：`description` 是 `note` 的别名（任务包验证脚本用 description）；account_id / from_account_id /
// to_account_id 是 PRD camelCase 的 snake_case 别名，controller 里归一化。.strict() 拒绝未知字段
// （PUT/PATCH 时 type / accountId / transferGroupId 等不允许改的字段会走 400）。
export const createTransactionSchema = z
  .object({
    accountId: z.string().min(1, '账户不能为空').optional(),
    account_id: z.string().min(1, '账户不能为空').optional(),
    type: z.enum(USER_TXN_TYPES, {
      errorMap: () => ({ message: '交易类型无效（income / expense / transfer）' }),
    }),
    amount: z.number({ invalid_type_error: '金额必须是数字' }).finite('金额必须是有限数字').positive('金额必须大于 0'),
    category: z.string().max(50, '分类最长 50 字').optional(),
    note: z.string().max(200, '备注最长 200 字').optional(),
    description: z.string().max(200, '备注最长 200 字').optional(),
    date: z.string().refine(isValidDateStr, { message: '日期格式错误，应为 YYYY-MM-DD' }).optional(),
    fromAccountId: z.string().min(1, '转出账户不能为空').optional(),
    from_account_id: z.string().min(1, '转出账户不能为空').optional(),
    toAccountId: z.string().min(1, '转入账户不能为空').optional(),
    to_account_id: z.string().min(1, '转入账户不能为空').optional(),
  })
  .strict();

// PUT /:id —— 仅 metadata（category / note / date），amount 不允许（任务包 TP-05 约束）
const updateFieldsBase = z
  .object({
    category: z.string().max(50, '分类最长 50 字').optional(),
    note: z.string().max(200, '备注最长 200 字').optional(),
    description: z.string().max(200, '备注最长 200 字').optional(),
    date: z.string().refine(isValidDateStr, { message: '日期格式错误，应为 YYYY-MM-DD' }).optional(),
  })
  .strict();

export const updateMetadataSchema = updateFieldsBase.refine((v) => Object.keys(v).length > 0, {
  message: '至少提供一个待更新字段',
});

// PATCH /:id —— PRD §14.4：可改 amount / category / note / date；type / accountId / transferGroupId 不可改
export const updateTransactionSchema = updateFieldsBase.extend({
  amount: z
    .number({ invalid_type_error: '金额必须是数字' })
    .finite('金额必须是有限数字')
    .positive('金额必须大于 0')
    .optional(),
}).refine((v) => Object.keys(v).length > 0, { message: '至少提供一个待更新字段' });

// --- Row 类型（对齐 V001 transactions 列） ---
interface TransactionRow {
  id: string;
  account_id: string;
  type: TxnType;
  amount: number;
  category: string | null;
  note: string | null;
  date: string;
  transfer_group_id: string | null;
  import_batch_id: string | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

type TransactionRowWithAccount = TransactionRow & { account_name: string | null };

// --- 工具 ---
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function writeAudit(
  action: 'create' | 'update' | 'delete',
  userId: string,
  entityId: string,
  details: unknown
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, 'transaction', ?, ?, ?)`
  ).run(userId, action, entityId, JSON.stringify(details), Date.now());
}

function getRow(id: string): TransactionRowWithAccount {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT t.*, a.name AS account_name
       FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
       WHERE t.id = ?`
    )
    .get(id) as TransactionRowWithAccount | undefined;
  if (!row) throw new AppError(500, 'ERR0005', '交易数据异常');
  return row;
}

function toTransactionDto(r: TransactionRowWithAccount) {
  return {
    id: r.id,
    accountId: r.account_id,
    accountName: r.account_name,
    type: r.type,
    amount: r.amount,
    category: r.category,
    note: r.note,
    date: r.date,
    transferGroupId: r.transfer_group_id,
    importBatchId: r.import_batch_id,
    deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** 账户当前余额（PRD §15.1.1：initial_balance + income - expense + transfer_in - transfer_out），排除软删除 */
function getAccountBalance(accountId: string): number {
  const db = getDb();
  const acc = db
    .prepare('SELECT initial_balance FROM accounts WHERE id = ?')
    .get(accountId) as { initial_balance: number } | undefined;
  if (!acc) throw new AppError(404, 'ERR0004', '账户不存在');
  const net = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)
         + COALESCE(SUM(CASE WHEN type = 'transfer_in' THEN amount ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN type = 'transfer_out' THEN amount ELSE 0 END), 0) AS net
       FROM transactions
       WHERE account_id = ? AND deleted_at IS NULL`
    )
    .get(accountId) as { net: number };
  return round2(acc.initial_balance + Number(net.net ?? 0));
}

// --- 列表查询参数解析（PRD §14.4 + §14.1.4） ---
// 支持 camelCase（PRD）与 snake_case（任务包验证脚本）两种别名
const SORT_COLUMNS: Record<string, string> = {
  date: 't.date',
  created_at: 't.created_at',
  createdAt: 't.created_at',
  updated_at: 't.updated_at',
  updatedAt: 't.updated_at',
  amount: 't.amount',
  category: 't.category',
  type: 't.type',
};

function firstString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function parseListQuery(query: Request['query']) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
  // 默认按日期倒序（FR-TXN-001），排序列白名单，杜绝 SQL 注入
  const sortCol = SORT_COLUMNS[String(query.sortBy ?? 'date')] ?? 't.date';
  const sortBy = `${sortCol} ${sortOrder}`;

  const accountId = firstString(query.accountId) ?? firstString(query.account_id);
  const category = firstString(query.category);
  const typeParam = firstString(query.type);
  const startDate = firstString(query.startDate) ?? firstString(query.start_date);
  const endDate = firstString(query.endDate) ?? firstString(query.end_date);
  const includeDeleted = String(query.includeDeleted ?? '').toLowerCase() === 'true';

  if (typeParam !== undefined && typeParam !== 'transfer' && !TXN_TYPES.includes(typeParam as TxnType)) {
    throw new AppError(400, 'ERR0001', `type 参数无效：${typeParam}`);
  }
  if (startDate !== undefined && !isValidDateStr(startDate)) {
    throw new AppError(400, 'ERR3003', 'startDate 格式错误，应为 YYYY-MM-DD');
  }
  if (endDate !== undefined && !isValidDateStr(endDate)) {
    throw new AppError(400, 'ERR3003', 'endDate 格式错误，应为 YYYY-MM-DD');
  }

  return { page, pageSize, sortBy, sortOrder, accountId, category, typeParam, startDate, endDate, includeDeleted };
}

// ============================================================================
// GET /api/v1/transactions（FR-TXN-001 列表 + PRD §14.4 过滤 / 分页 / 排序）
// ============================================================================
export async function listTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDb();
    const { page, pageSize, sortBy, sortOrder, accountId, category, typeParam, startDate, endDate, includeDeleted } =
      parseListQuery(req.query);

    const where: string[] = [];
    const params: unknown[] = [];
    if (!includeDeleted) where.push('t.deleted_at IS NULL');
    if (accountId !== undefined) {
      where.push('t.account_id = ?');
      params.push(accountId);
    }
    if (category !== undefined && category !== '') {
      where.push('t.category = ?');
      params.push(category);
    }
    if (typeParam !== undefined) {
      if (typeParam === 'transfer') {
        // 用户侧 'transfer' 语义 = 转账两笔（transfer_in / transfer_out）
        where.push(`t.type IN ('transfer_in', 'transfer_out')`);
      } else {
        where.push('t.type = ?');
        params.push(typeParam);
      }
    }
    if (startDate !== undefined) {
      where.push('t.date >= ?');
      params.push(startDate);
    }
    if (endDate !== undefined) {
      where.push('t.date <= ?');
      params.push(endDate);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const total = (
      db.prepare(`SELECT COUNT(*) AS c FROM transactions t ${whereSql}`).get(...params) as { c: number }
    ).c;

    const rows = db
      .prepare(
        `SELECT t.*, a.name AS account_name
         FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
         ${whereSql}
         ORDER BY ${sortBy}, t.created_at DESC, t.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize) as TransactionRowWithAccount[];

    res.json({
      data: rows.map(toTransactionDto),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// POST /api/v1/transactions（FR-TXN-002：income / expense 单笔 + transfer 转账双写）
// ============================================================================
export async function createTransaction(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDb();
    const body = req.body as z.infer<typeof createTransactionSchema>;
    const userId = req.user?.userId ?? 'unknown';

    // 归一化别名（snake_case → camelCase，description → note）
    const accountId = body.accountId ?? body.account_id;
    const fromAccountId = body.fromAccountId ?? body.from_account_id;
    const toAccountId = body.toAccountId ?? body.to_account_id;
    const note = body.note ?? body.description ?? null;
    const category = body.category ?? null;
    const date = body.date ?? todayStr();
    const amount = round2(body.amount);
    const type = body.type;

    // ---- 转账双写（PRD §15.2.1，核心：事务原子性） ----
    if (type === 'transfer') {
      if (!fromAccountId || !toAccountId) {
        throw new AppError(400, 'ERR0001', '转账必须提供 fromAccountId 和 toAccountId');
      }
      if (fromAccountId === toAccountId) {
        throw new AppError(400, 'ERR0001', '转出账户与转入账户不能相同');
      }

      const fromAcc = db.prepare('SELECT id, archived FROM accounts WHERE id = ?').get(fromAccountId) as
        | { id: string; archived: number }
        | undefined;
      const toAcc = db.prepare('SELECT id, archived FROM accounts WHERE id = ?').get(toAccountId) as
        | { id: string; archived: number }
        | undefined;
      if (!fromAcc) throw new AppError(404, 'ERR0004', '转出账户不存在');
      if (!toAcc) throw new AppError(404, 'ERR0004', '转入账户不存在');
      // PRD §15.2.1 边界：to 账户被归档 → 422
      if (toAcc.archived === 1) throw new AppError(422, 'ERR0001', '目标账户已归档，不能转入');

      // PRD §15.2.1 前置校验：from 余额足够 → 不足则 422 + 余额快照（ERR3001）
      const balance = getAccountBalance(fromAccountId);
      if (balance < amount) {
        throw new AppError(422, 'ERR3001', '余额不足', { accountId: fromAccountId, balance, required: amount });
      }

      const transferGroupId = uuidv4();
      const fromTxId = uuidv4();
      const toTxId = uuidv4();
      const now = Date.now();

      // 事务：任一 INSERT / audit 失败 → 全部回滚
      const txn = db.transaction(() => {
        db.prepare(
          `INSERT INTO transactions (id, account_id, type, amount, category, note, date, transfer_group_id, created_at, updated_at)
           VALUES (?, ?, 'transfer_out', ?, ?, ?, ?, ?, ?, ?)`
        ).run(fromTxId, fromAccountId, amount, category, note, date, transferGroupId, now, now);
        db.prepare(
          `INSERT INTO transactions (id, account_id, type, amount, category, note, date, transfer_group_id, created_at, updated_at)
           VALUES (?, ?, 'transfer_in', ?, ?, ?, ?, ?, ?, ?)`
        ).run(toTxId, toAccountId, amount, category, note, date, transferGroupId, now, now);
        writeAudit('create', userId, transferGroupId, {
          transferGroupId,
          fromTransactionId: fromTxId,
          toTransactionId: toTxId,
          fromAccountId,
          toAccountId,
          amount,
          date,
          category,
          note,
          type: 'transfer',
        });
      });
      txn();

      logger.info({ transferGroupId, fromTxId, toTxId, amount }, 'Transfer created');

      res.status(201).json({
        data: {
          transferGroupId,
          fromTransactionId: fromTxId,
          toTransactionId: toTxId,
          from: toTransactionDto(getRow(fromTxId)),
          to: toTransactionDto(getRow(toTxId)),
        },
      });
      return;
    }

    // ---- 普通收支（income / expense） ----
    if (!accountId) {
      throw new AppError(400, 'ERR0001', '缺少 accountId');
    }
    const acc = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId);
    if (!acc) {
      throw new AppError(404, 'ERR0004', '账户不存在');
    }

    const id = uuidv4();
    const now = Date.now();
    const txn = db.transaction(() => {
      db.prepare(
        `INSERT INTO transactions (id, account_id, type, amount, category, note, date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, accountId, type, amount, category, note, date, now, now);
      writeAudit('create', userId, id, { type, amount, accountId, category, note, date });
    });
    txn();

    logger.info({ transactionId: id, type, amount, accountId }, 'Transaction created');

    res.status(201).json({ data: toTransactionDto(getRow(id)) });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// GET /api/v1/transactions/:id（FR-TXN-001 单笔）
// ============================================================================
export async function getTransaction(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDb();
    const { id } = req.params as { id: string };

    const row = db
      .prepare(
        `SELECT t.*, a.name AS account_name
         FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
         WHERE t.id = ? AND t.deleted_at IS NULL`
      )
      .get(id) as TransactionRowWithAccount | undefined;
    if (!row) {
      throw new AppError(404, 'ERR0004', '交易不存在');
    }
    res.json({ data: toTransactionDto(row) });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// PUT /api/v1/transactions/:id —— 任务包 TP-05：仅 metadata（category/note/date），
// amount / type / accountId / transferGroupId 不允许改（strict 模式，amount → 400）
// PATCH /api/v1/transactions/:id —— PRD §14.4：可改 amount / category / note / date
// 转账关联交易（transfer_group_id 非空）：改动同步到两笔（FR-TXN-003 AC）
// ============================================================================
async function updateTransaction(
  req: Request,
  res: Response,
  next: NextFunction,
  opts: { strict: boolean }
): Promise<void> {
  try {
    const db = getDb();
    const { id } = req.params as { id: string };
    const body = req.body as z.infer<typeof updateTransactionSchema>;
    const userId = req.user?.userId ?? 'unknown';

    if (opts.strict && body.amount !== undefined) {
      throw new AppError(400, 'ERR0001', 'PUT 不允许修改金额（如需改金额请用 PATCH）');
    }

    const existing = db
      .prepare('SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL')
      .get(id) as TransactionRow | undefined;
    if (!existing) {
      throw new AppError(404, 'ERR0004', '交易不存在');
    }

    const amount = body.amount !== undefined ? round2(body.amount) : existing.amount;
    const category = body.category !== undefined ? body.category : existing.category;
    const note = body.note !== undefined ? body.note : body.description !== undefined ? body.description : existing.note;
    const date = body.date ?? existing.date;
    const now = Date.now();

    const txn = db.transaction(() => {
      if (existing.transfer_group_id) {
        // 转账：两笔联动同步更新（FR-TXN-003：编辑后 2 笔关联交易同步更新）
        const r = db
          .prepare(
            `UPDATE transactions SET amount = ?, category = ?, note = ?, date = ?, updated_at = ?
             WHERE transfer_group_id = ? AND deleted_at IS NULL`
          )
          .run(amount, category, note, date, now, existing.transfer_group_id);
        if (r.changes !== 2) {
          throw new AppError(500, 'ERR0005', '转账记录不完整，无法更新');
        }
      } else {
        db.prepare(
          `UPDATE transactions SET amount = ?, category = ?, note = ?, date = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`
        ).run(amount, category, note, date, now, id);
      }
      writeAudit('update', userId, existing.transfer_group_id ?? id, {
        before: {
          amount: existing.amount,
          category: existing.category,
          note: existing.note,
          date: existing.date,
        },
        after: { amount, category, note, date },
      });
    });
    txn();

    logger.info({ transactionId: id }, 'Transaction updated');
    res.json({ data: toTransactionDto(getRow(id)) });
  } catch (err) {
    next(err);
  }
}

/** PUT：严格模式（仅 metadata） */
export async function updateTransactionStrict(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  return updateTransaction(req, res, next, { strict: true });
}

/** PATCH：PRD §14.4 完整编辑（含 amount） */
export async function updateTransactionFull(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  return updateTransaction(req, res, next, { strict: false });
}

// ============================================================================
// DELETE /api/v1/transactions/:id（FR-TXN-004 + PRD §14.4 / §15.2.2）
// 软删除（deleted_at = now）；转账删除联动删除同 transfer_group_id 两笔，事务包裹
// ============================================================================
export async function deleteTransaction(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDb();
    const { id } = req.params as { id: string };
    const userId = req.user?.userId ?? 'unknown';

    const row = db
      .prepare('SELECT id, transfer_group_id FROM transactions WHERE id = ? AND deleted_at IS NULL')
      .get(id) as { id: string; transfer_group_id: string | null } | undefined;
    if (!row) {
      throw new AppError(404, 'ERR0004', '交易不存在');
    }

    const now = Date.now();
    const txn = db.transaction(() => {
      if (row.transfer_group_id) {
        // PRD §15.2.2：删除转账 = 同时软删除两笔关联交易
        const ids = db
          .prepare('SELECT id FROM transactions WHERE transfer_group_id = ? AND deleted_at IS NULL')
          .all(row.transfer_group_id) as { id: string }[];
        if (ids.length !== 2) {
          throw new AppError(500, 'ERR0005', `转账记录不完整（期望 2 条，实际 ${ids.length} 条）`);
        }
        db.prepare('UPDATE transactions SET deleted_at = ? WHERE transfer_group_id = ? AND deleted_at IS NULL').run(
          now,
          row.transfer_group_id
        );
        writeAudit('delete', userId, row.transfer_group_id, {
          transferGroupId: row.transfer_group_id,
          transactionIds: ids.map((i) => i.id),
        });
      } else {
        db.prepare('UPDATE transactions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, id);
        writeAudit('delete', userId, id, {});
      }
    });
    txn();

    logger.info({ transactionId: id }, 'Transaction deleted');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
