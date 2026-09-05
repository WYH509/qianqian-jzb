import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { getDb } from '../db/client.js';

// --- audit_log 写入（对齐 accounts/transactions 本地 writeAudit 风格） ---
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function writeAudit(params: {
  action: 'export';
  userId: string;
  entityId?: string | null;
  details?: unknown;
  errorCategory?: string | null;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, error_category, created_at)
     VALUES (?, ?, 'excel', ?, ?, ?, ?)`
  ).run(
    params.userId,
    params.action,
    params.entityId,
    JSON.stringify(params.details),
    params.errorCategory,
    Date.now()
  );
}

// --- Query schema ---
const exportQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  format: z.enum(['xlsx']).default('xlsx'),
  accountId: z.string().uuid().optional(),
});

// --- GET /api/v1/export/transactions（PRD §14.6） ---
export async function exportTransactions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.userId ?? 'unknown';
  try {
    const result = exportQuerySchema.safeParse(req.query);
    if (!result.success) {
      const firstErr = result.error.errors[0];
      throw new Error(firstErr?.message ?? 'Invalid query');
    }
    const { startDate, endDate, accountId } = result.data;

    const conditions: string[] = ['deleted_at IS NULL'];
    const params: (string | number)[] = [];
    if (startDate) {
      conditions.push('date >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('date <= ?');
      params.push(endDate);
    }
    if (accountId) {
      conditions.push('account_id = ?');
      params.push(accountId);
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const db = getDb();
    const rows = db
      .prepare(
        `SELECT
          t.id, t.date, t.type, t.amount, t.category, t.note, t.import_batch_id,
          a.name AS account_name, a.type AS account_type
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        ${whereClause}
        ORDER BY t.date DESC, t.created_at DESC`
      )
      .all(...params) as Array<{
      id: string;
      date: string;
      type: string;
      amount: number;
      category: string | null;
      note: string | null;
      import_batch_id: string | null;
      account_name: string | null;
      account_type: string | null;
    }>;

    // 生成 xlsx
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'qianqian-jzb';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('交易明细');
    sheet.columns = [
      { header: '日期', key: 'date', width: 12 },
      { header: '账户', key: 'account', width: 15 },
      { header: '类型', key: 'type', width: 10 },
      { header: '金额', key: 'amount', width: 14 },
      { header: '分类', key: 'category', width: 12 },
      { header: '备注', key: 'note', width: 30 },
      { header: '来源', key: 'source', width: 10 },
    ];

    // 表头加粗
    sheet.getRow(1).font = { bold: true };

    rows.forEach((r) => {
      sheet.addRow({
        date: r.date,
        account: r.account_name ?? '',
        type: r.type,
        amount: r.amount,
        category: r.category ?? '',
        note: r.note ?? '',
        source: r.import_batch_id ? 'import' : 'manual',
      });
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    const fileName = `qianqian-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`
    );

    writeAudit({
      action: 'export',
      userId,
      entityId: fileName,
      details: {
        row_count: rows.length,
        format: result.data.format,
        start_date: startDate ?? null,
        end_date: endDate ?? null,
        account_id: accountId ?? null,
      },
    });

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    writeAudit({
      action: 'export',
      userId,
      details: { error: errMsg(err) },
      errorCategory: 'export_failed',
    });
    next(err);
  }
}