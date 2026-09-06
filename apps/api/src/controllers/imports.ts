import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';
import {
  identifyHeader,
  parseAmount,
  parseDate,
  normalizeType,
  sha256,
} from '../utils/excel-parser.js';
import { executeAiParseTask, type AiParseTaskInput } from '../services/deepseek-service.js';
import { getTimeWindow } from '../utils/time-window.js';

// --- audit_log 写入（对齐 accounts/transactions 本地 writeAudit 风格；补 model 列供 ai_parse） ---
// 注意：action 受表 CHECK 约束限制（create/update/delete/login/logout/export/ai_parse），
// 成功/失败用 error_category 区分（对齐 auth.ts 的 auth_failure 惯例），不新增 action 值。
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getUserId(req: Request): string {
  return req.user?.userId ?? 'unknown';
}

// Express 5 下 req.params 类型为 string | string[] | undefined（即使路由是 /:id 单段），
// 取单段 param 的字符串值，供 writeAudit 的 entityId: string | null | undefined 使用。
function firstParam(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

interface AuditParams {
  action: 'create' | 'delete' | 'ai_parse';
  userId: string;
  entityType: 'excel' | 'ai_call';
  entityId?: string | null;
  details?: unknown;
  errorCategory?: string | null;
  model?: string | null;
}

function writeAudit(params: AuditParams): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, error_category, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.userId,
    params.action,
    params.entityType,
    params.entityId,
    JSON.stringify(params.details),
    params.errorCategory,
    params.model,
    Date.now()
  );
}

// --- Row types ---
interface PreviewRow {
  rowIndex: number;
  date: string;
  amount: number;
  type: 'income' | 'expense';
  category: string | null;
  note: string | null;
  warnings: string[];
}

interface ImportRowInput {
  date: string;
  amount: number;
  type: 'income' | 'expense';
  category?: string | null;
  note?: string | null;
}

// --- Zod schemas ---
const confirmSchema = z.object({
  fileHash: z.string().min(1).max(128),
  accountId: z.string().uuid(),
  rows: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amount: z.number().finite('金额必须是有限数字').positive('金额必须大于 0'),
        type: z.enum(['income', 'expense']),
        category: z.string().max(50).optional().nullable(),
        note: z.string().max(500).optional().nullable(),
      })
    )
    .min(1)
    .max(10000),
});

// --- 解析 Excel 第一张表为表头 + 数据行 ---
async function parseExcel(buffer: Buffer): Promise<{
  headers: string[];
  rows: Record<string, unknown>[];
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new AppError(400, 'ERR0001', 'Excel 文件无数据表');

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? `列${colNumber}`);
  });

  const rows: Record<string, unknown>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // 跳过表头
    const obj: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      obj[header] = row.getCell(idx + 1).value;
    });
    rows.push(obj);
  });

  return { headers, rows };
}

// --- POST /api/v1/import/preview（PRD §14.6 + §15.3） ---
export async function importPreview(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = getUserId(req);
  try {
    if (!req.file) {
      throw new AppError(400, 'ERR0001', '未上传文件');
    }
    const buffer = req.file.buffer;
    const fileHash = sha256(buffer);
    const fileName = req.file.originalname;

    const db = getDb();

    // 查重（file_hash UNIQUE，PRD §13.2.3）
    const existing = db
      .prepare(
        `SELECT id, status FROM import_history WHERE file_hash = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(fileHash) as { id: string; status: string } | undefined;

    if (existing && existing.status === 'confirmed') {
      throw new AppError(400, 'ERR0001', '该文件已导入完成，请勿重复导入');
    }
    if (existing && existing.status === 'pending') {
      // 删旧 pending 再插入新（让用户重新预览编辑）
      db.prepare(`DELETE FROM import_history WHERE id = ?`).run(existing.id);
    }
    // rolled_back 状态允许重导（file_hash 已不 UNIQUE 冲突）

    const { headers, rows } = await parseExcel(buffer);

    // 表头识别
    const detectedHeaders: Record<string, string> = {};
    const headerMap = new Map<number, string>(); // column index -> field name
    headers.forEach((h, idx) => {
      const match = identifyHeader(h);
      if (match.field) {
        detectedHeaders[match.field] = h;
        headerMap.set(idx, match.field);
      }
    });

    // 校验必填字段
    let dateCol: number | null = null;
    let amountCol: number | null = null;
    for (const [col, field] of headerMap) {
      if (field === 'date') dateCol = col;
      if (field === 'amount') amountCol = col;
    }
    if (dateCol === null) {
      throw new AppError(400, 'ERR0001', '未识别到日期列，请检查表头');
    }
    if (amountCol === null) {
      throw new AppError(400, 'ERR0001', '未识别到金额列，请检查表头');
    }

    // 逐行解析
    const preview: PreviewRow[] = [];
    const warnings: string[] = [];

    rows.forEach((row, rowIdx) => {
      const rowWarnings: string[] = [];
      const fieldVals: Record<string, unknown> = {};
      for (const [col, field] of headerMap) {
        const headerName = headers[col];
        if (headerName !== undefined) {
          fieldVals[field] = row[headerName];
        }
      }

      const date = parseDate(fieldVals.date);
      const amount = parseAmount(fieldVals.amount);

      if (!date) rowWarnings.push('日期格式无法识别');
      if (amount === null) rowWarnings.push('金额格式无法识别');

      // 类型：优先用 type 字段，否则按 amount 正负推断
      let normalizedType: 'income' | 'expense' | null = null;
      if (fieldVals.type !== undefined) {
        const nt = normalizeType(fieldVals.type);
        if (nt === 'income' || nt === 'expense') {
          normalizedType = nt;
        }
      }
      if (!normalizedType && amount !== null) {
        normalizedType = amount >= 0 ? 'income' : 'expense';
      }
      const finalAmount = amount === null ? 0 : Math.abs(amount);

      // 跳过无效行（warnings 记录）
      if (rowWarnings.length > 0) {
        warnings.push(`行 ${rowIdx + 2}: ${rowWarnings.join('; ')}`);
        return;
      }

      preview.push({
        rowIndex: rowIdx + 2, // Excel 行号（含表头）
        date: date!,
        amount: finalAmount,
        type: normalizedType!,
        category: fieldVals.category ? String(fieldVals.category) : null,
        note: fieldVals.note ? String(fieldVals.note) : null,
        warnings: rowWarnings,
      });
    });

    // 写入 import_history (status=pending)
    const id = uuidv4();
    db.prepare(
      `INSERT INTO import_history (id, file_hash, file_name, row_count, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    ).run(id, fileHash, fileName, preview.length, Date.now());

    writeAudit({
      action: 'create',
      userId,
      entityType: 'excel',
      entityId: id,
      details: { file_name: fileName, row_count: preview.length },
    });

    res.json({
      data: {
        batchId: id,
        fileHash,
        fileName,
        detectedHeaders,
        preview,
        totalRows: preview.length,
        warnings,
      },
    });
  } catch (err) {
    writeAudit({
      action: 'create',
      userId,
      entityType: 'excel',
      details: { file_name: req.file?.originalname ?? null, error: errMsg(err) },
      errorCategory: 'import_preview_failed',
    });
    next(err);
  }
}

// --- POST /api/v1/import/confirm（PRD §14.6 + §15.3） ---
export async function importConfirm(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = getUserId(req);
  try {
    const result = confirmSchema.safeParse(req.body);
    if (!result.success) {
      const firstErr = result.error.errors[0];
      throw new AppError(400, 'ERR0001', firstErr?.message ?? 'Invalid body');
    }
    const { fileHash, accountId, rows } = result.data;

    const db = getDb();

    // 验证账户存在
    const account = db
      .prepare('SELECT id FROM accounts WHERE id = ? AND archived = 0')
      .get(accountId);
    if (!account) {
      throw new AppError(404, 'ERR0004', '账户不存在或已归档');
    }

    // 验证 fileHash 匹配 pending 批次
    const batch = db
      .prepare(
        `SELECT id, status FROM import_history WHERE file_hash = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(fileHash) as { id: string; status: string } | undefined;

    if (!batch) {
      throw new AppError(404, 'ERR0004', '未找到对应批次，请先预览');
    }
    if (batch.status !== 'pending') {
      throw new AppError(
        400,
        'ERR0001',
        `批次状态为 ${batch.status}，不能确认导入`
      );
    }

    // 事务批量写入
    const insert = db.prepare(
      `INSERT INTO transactions (id, account_id, date, type, amount, category, note, import_batch_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const now = Date.now();

    const insertedIds: string[] = [];
    const skippedIndexes: number[] = [];

    const tx = db.transaction(() => {
      for (const row of rows) {
        try {
          const id = uuidv4();
          insert.run(
            id,
            accountId,
            row.date,
            row.type,
            row.amount,
            row.category ?? null,
            row.note ?? null,
            batch.id,
            now,
            now
          );
          insertedIds.push(id);
        } catch (err) {
          logger.warn({ row, err }, 'insert failed');
          skippedIndexes.push(rows.indexOf(row));
        }
      }
    });
    tx();

    // 更新 batch 状态
    db.prepare(
      `UPDATE import_history SET status = 'confirmed' WHERE id = ?`
    ).run(batch.id);

    writeAudit({
      action: 'create',
      userId,
      entityType: 'excel',
      entityId: batch.id,
      details: {
        account_id: accountId,
        imported_count: insertedIds.length,
        skipped_count: skippedIndexes.length,
      },
    });

    res.status(201).json({
      data: {
        batchId: batch.id,
        importedCount: insertedIds.length,
        skippedCount: skippedIndexes.length,
      },
    });
  } catch (err) {
    writeAudit({
      action: 'create',
      userId,
      entityType: 'excel',
      details: { file_hash: req.body?.fileHash, error: errMsg(err) },
      errorCategory: 'import_confirm_failed',
    });
    next(err);
  }
}

// --- GET /api/v1/import/history（PRD §14.6） ---
export function listImportHistory(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const status = req.query.status as string | undefined;

    const offset = (page - 1) * pageSize;
    const db = getDb();

    let whereClause = '';
    const params: unknown[] = [];
    if (status) {
      whereClause = 'WHERE status = ?';
      params.push(status);
    }

    const rows = db
      .prepare(
        `SELECT id, file_hash, file_name, row_count, status, error_message, created_at
         FROM import_history ${whereClause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, offset) as Array<{
      id: string;
      file_hash: string;
      file_name: string;
      row_count: number;
      status: string;
      error_message: string | null;
      created_at: number;
    }>;

    const total = (db
      .prepare(`SELECT COUNT(*) AS cnt FROM import_history ${whereClause}`)
      .get(...params) as { cnt: number }).cnt;

    res.json({
      data: rows.map((r) => ({
        id: r.id,
        fileHash: r.file_hash,
        fileName: r.file_name,
        rowCount: r.row_count,
        status: r.status,
        errorMessage: r.error_message,
        createdAt: r.created_at,
      })),
      pagination: { page, pageSize, total },
    });
  } catch (err) {
    next(err);
  }
}

// --- POST /api/v1/import/:id/rollback（PRD §14.6） ---
export function rollbackImport(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const userId = getUserId(req);
  try {
    const id = firstParam(req.params.id);
    if (!id) throw new AppError(400, 'ERR0001', '缺少批次 ID');

    const db = getDb();
    const batch = db
      .prepare(`SELECT id, status FROM import_history WHERE id = ?`)
      .get(id) as { id: string; status: string } | undefined;

    if (!batch) throw new AppError(404, 'ERR0004', '批次不存在');
    if (batch.status !== 'confirmed') {
      throw new AppError(400, 'ERR0001', '仅 confirmed 状态可回滚');
    }

    // 软删除该批次导入的所有交易
    const result = db
      .prepare(
        `UPDATE transactions SET deleted_at = ?, updated_at = ?
         WHERE import_batch_id = ?
           AND deleted_at IS NULL`
      )
      .run(Date.now(), Date.now(), id);

    db.prepare(
      `UPDATE import_history SET status = 'rolled_back' WHERE id = ?`
    ).run(id);

    writeAudit({
      action: 'delete',
      userId,
      entityType: 'excel',
      entityId: id,
      details: { rolled_back_count: result.changes },
    });

    res.json({ data: { rolledBackCount: result.changes } });
  } catch (err) {
    writeAudit({
      action: 'delete',
      userId,
      entityType: 'excel',
      entityId: firstParam(req.params.id),
      details: { error: errMsg(err) },
      errorCategory: 'import_rollback_failed',
    });
    next(err);
  }
}

// --- POST /api/v1/import/ai-parse（PRD §14.6 + §15.4 完整实现） ---
export async function aiParse(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = getUserId(req);
  const startedAt = Date.now();
  try {
    if (!req.file) {
      throw new AppError(400, 'ERR0001', '未上传文件');
    }
    const buffer = req.file.buffer;
    const fileType: 'pdf' | 'image' =
      req.file.mimetype === 'application/pdf' ? 'pdf' : 'image';

    const input: AiParseTaskInput = {
      taskType: 'bank_statement',
      fileBase64: buffer.toString('base64'),
      fileType,
    };

    const outcome = await executeAiParseTask(input);
    const latencyMs = Date.now() - startedAt;
    const timeWindow = getTimeWindow();

    if (outcome.ok) {
      writeAudit({
        action: 'ai_parse',
        userId,
        entityType: 'ai_call',
        details: {
          file_type: fileType,
          tokens_in: outcome.usage.prompt_tokens,
          tokens_out: outcome.usage.completion_tokens,
          tokens_total: outcome.usage.total_tokens,
          latency_ms: latencyMs,
        },
        model: outcome.model,
      });
      // 200 + completed
      res.json({
        status: 'completed',
        model: outcome.model,
        usage: outcome.usage,
        transactions: outcome.data,
      });
    } else if (outcome.kind === 'queued') {
      writeAudit({
        action: 'ai_parse',
        userId,
        entityType: 'ai_call',
        entityId: outcome.queueId ? String(outcome.queueId) : null,
        details: { file_type: fileType, latency_ms: latencyMs },
        errorCategory: 'ai_parse_queued',
      });
      // 202 + queued
      res.status(202).json({
        status: 'queued',
        queueId: outcome.queueId,
        estimatedProcessAt: new Date(
          timeWindow.nextOffPeakAt
        ).toISOString(),
        message: outcome.message,
      });
    } else {
      writeAudit({
        action: 'ai_parse',
        userId,
        entityType: 'ai_call',
        details: {
          file_type: fileType,
          kind: outcome.kind,
          error: outcome.message,
          latency_ms: latencyMs,
        },
        errorCategory: 'ai_parse_failed',
      });
      // 转人工（4 类失败转人工）
      res.status(503).json({
        status: 'failed',
        kind: outcome.kind,
        message: outcome.message,
      });
    }
  } catch (err) {
    writeAudit({
      action: 'ai_parse',
      userId,
      entityType: 'ai_call',
      details: { error: errMsg(err), latency_ms: Date.now() - startedAt },
      errorCategory: 'ai_parse_failed',
    });
    next(err);
  }
}