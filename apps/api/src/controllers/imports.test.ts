// controllers/imports.ts 集成测试（multer 上传 + preview/confirm/rollback/history + ai-parse）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { buildApp, signToken, resetDb, withCsrf } from '../../tests/helpers.js';
import { getDb } from '../db/client.js';
import { sha256 } from '../utils/excel-parser.js';
import { makeStandardStatementXlsx } from '../../tests/fixtures/xlsx.js';

vi.mock('../services/deepseek-service.js', () => ({
  executeAiParseTask: vi.fn(),
}));
vi.mock('../utils/time-window.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/time-window.js')>();
  return { ...actual, getTimeWindow: vi.fn() };
});

import { executeAiParseTask } from '../services/deepseek-service.js';
import { getTimeWindow } from '../utils/time-window.js';

const executeAiParseTaskMock = executeAiParseTask as unknown as ReturnType<typeof vi.fn>;
const getTimeWindowMock = getTimeWindow as unknown as ReturnType<typeof vi.fn>;

const app: Express = buildApp();
const token = signToken();
const authHeaders = withCsrf({ Authorization: `Bearer ${token}` });

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function createAccount(name = '测试账户'): string {
  const id = uuidv4();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO accounts (id,name,type,initial_balance,currency,archived,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(id, name, 'cash', 0, 'CNY', 0, now, now);
  return id;
}

async function previewFile(): Promise<{ buffer: Buffer; res: request.Response }> {
  const buffer = await makeStandardStatementXlsx();
  const res = await request(app)
    .post('/api/v1/import/preview')
    .set(authHeaders)
    .attach('file', buffer, { filename: 'statement.xlsx', contentType: XLSX_MIME });
  return { buffer, res };
}

beforeEach(() => {
  resetDb();
  executeAiParseTaskMock.mockReset();
  getTimeWindowMock.mockReset();
});

describe('POST /api/v1/import/preview', () => {
  it('无文件 → 400', async () => {
    const res = await request(app).post('/api/v1/import/preview').set(authHeaders);
    expect(res.status).toBe(400);
  });

  it('正常 xlsx → 200 + detectedHeaders + preview', async () => {
    const { res } = await previewFile();
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.detectedHeaders.date).toBe('日期');
    expect(data.detectedHeaders.amount).toBe('金额');
    expect(data.detectedHeaders.type).toBe('类型');
    expect(data.totalRows).toBe(3);
    expect(data.preview[0].type).toBe('expense');
    expect(data.preview[0].amount).toBe(50);
    expect(data.fileHash).toBeTruthy();
  });

  it('重复文件（已 confirmed）→ 400', async () => {
    const { buffer, res } = await previewFile();
    expect(res.status).toBe(200);
    const fileHash = res.body.data.fileHash;
    // 直接置为 confirmed，再传同文件
    getDb()
      .prepare(`UPDATE import_history SET status = 'confirmed' WHERE file_hash = ?`)
      .run(fileHash);
    const dup = await request(app)
      .post('/api/v1/import/preview')
      .set(authHeaders)
      .attach('file', buffer, { filename: 'statement.xlsx', contentType: XLSX_MIME });
    expect(dup.status).toBe(400);
    expect(dup.body.error.message).toContain('已导入');
  });

  it('重复文件（pending）→ 删旧重插（仍 200）', async () => {
    const { buffer, res } = await previewFile();
    expect(res.status).toBe(200);
    const again = await request(app)
      .post('/api/v1/import/preview')
      .set(authHeaders)
      .attach('file', buffer, { filename: 'statement.xlsx', contentType: XLSX_MIME });
    expect(again.status).toBe(200);
  });

  it('表头无日期列 → 400', async () => {
    const buffer = await makeStandardStatementXlsx();
    // 用不含日期/金额列的 xlsx（这里通过 sha256 已存在与否无关；直接传无日期列文件）
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['分类', '备注']);
    ws.addRow(['餐饮', '午餐']);
    const badBuf = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await request(app)
      .post('/api/v1/import/preview')
      .set(authHeaders)
      .attach('file', badBuf, { filename: 'bad.xlsx', contentType: XLSX_MIME });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('日期');
  });
});

describe('POST /api/v1/import/confirm', () => {
  it('预览后确认 → 201 + 写入流水', async () => {
    const { res } = await previewFile();
    const { fileHash } = res.body.data;
    const accountId = createAccount();

    const confirm = await request(app)
      .post('/api/v1/import/confirm')
      .set(authHeaders)
      .send({
        fileHash,
        accountId,
        rows: [
          { date: '2026-08-25', amount: 50, type: 'expense', category: '餐饮', note: '午餐' },
          { date: '2026-08-26', amount: 5000, type: 'income', category: '工资', note: null },
        ],
      });
    expect(confirm.status).toBe(201);
    expect(confirm.body.data.importedCount).toBe(2);

    const cnt = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM transactions WHERE account_id = ?`)
      .get(accountId) as { c: number };
    expect(cnt.c).toBe(2);
  });

  it('账户不存在 → 404', async () => {
    const { res } = await previewFile();
    const confirm = await request(app)
      .post('/api/v1/import/confirm')
      .set(authHeaders)
      .send({
        fileHash: res.body.data.fileHash,
        accountId: uuidv4(),
        rows: [{ date: '2026-08-25', amount: 50, type: 'expense' }],
      });
    expect(confirm.status).toBe(404);
  });

  it('未找到批次 → 404', async () => {
    const accountId = createAccount();
    const confirm = await request(app)
      .post('/api/v1/import/confirm')
      .set(authHeaders)
      .send({
        fileHash: sha256('unknown'),
        accountId,
        rows: [{ date: '2026-08-25', amount: 50, type: 'expense' }],
      });
    expect(confirm.status).toBe(404);
  });

  it('批次非 pending（已 confirmed）→ 400', async () => {
    const { res } = await previewFile();
    const { fileHash } = res.body.data;
    const accountId = createAccount();
    const rows = [{ date: '2026-08-25', amount: 50, type: 'expense' }];
    await request(app).post('/api/v1/import/confirm').set(authHeaders).send({ fileHash, accountId, rows });
    const again = await request(app)
      .post('/api/v1/import/confirm')
      .set(authHeaders)
      .send({ fileHash, accountId, rows });
    expect(again.status).toBe(400);
    expect(again.body.error.message).toContain('confirmed');
  });

  it('非法 body（rows 为空）→ 400', async () => {
    const accountId = createAccount();
    const confirm = await request(app)
      .post('/api/v1/import/confirm')
      .set(authHeaders)
      .send({ fileHash: 'x', accountId, rows: [] });
    expect(confirm.status).toBe(400);
  });
});

describe('POST /api/v1/import/:id/rollback', () => {
  it('确认后回滚 → 软删除流水 + rolled_back', async () => {
    const { res } = await previewFile();
    const { fileHash, batchId } = res.body.data;
    const accountId = createAccount();
    await request(app)
      .post('/api/v1/import/confirm')
      .set(authHeaders)
      .send({ fileHash, accountId, rows: [{ date: '2026-08-25', amount: 50, type: 'expense' }] });

    const rollback = await request(app)
      .post(`/api/v1/import/${batchId}/rollback`)
      .set(authHeaders);
    expect(rollback.status).toBe(200);
    expect(rollback.body.data.rolledBackCount).toBe(1);

    const batch = getDb()
      .prepare(`SELECT status FROM import_history WHERE id = ?`)
      .get(batchId) as { status: string };
    expect(batch.status).toBe('rolled_back');
  });

  it('批次不存在 → 404', async () => {
    const res = await request(app)
      .post(`/api/v1/import/${uuidv4()}/rollback`)
      .set(authHeaders);
    expect(res.status).toBe(404);
  });

  it('批次非 confirmed → 400', async () => {
    const { res } = await previewFile();
    const rollback = await request(app)
      .post(`/api/v1/import/${res.body.data.batchId}/rollback`)
      .set(authHeaders);
    expect(rollback.status).toBe(400);
  });
});

describe('GET /api/v1/import/history', () => {
  it('列出历史 + 分页', async () => {
    await previewFile();
    const res = await request(app).get('/api/v1/import/history').set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].status).toBe('pending');
  });
});

describe('POST /api/v1/import/ai-parse', () => {
  it('无文件 → 400', async () => {
    const res = await request(app).post('/api/v1/import/ai-parse').set(authHeaders);
    expect(res.status).toBe(400);
  });

  it('completed → 200 + transactions', async () => {
    executeAiParseTaskMock.mockResolvedValue({
      ok: true,
      model: 'pro',
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      data: [{ date: '2026-08-20', amount: 5000, type: 'income' }],
    });
    const res = await request(app)
      .post('/api/v1/import/ai-parse')
      .set(authHeaders)
      .attach('file', Buffer.from('%PDF'), { filename: 's.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.model).toBe('pro');
  });

  it('queued → 202 + queueId', async () => {
    executeAiParseTaskMock.mockResolvedValue({
      ok: false,
      kind: 'queued',
      queueId: 42,
      message: '高峰期任务已入队',
    });
    getTimeWindowMock.mockReturnValue({ isOffPeak: false, window: 'peak', nextOffPeakAt: 1788600000000 });
    const res = await request(app)
      .post('/api/v1/import/ai-parse')
      .set(authHeaders)
      .attach('file', Buffer.from('%PDF'), { filename: 's.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('queued');
    expect(res.body.queueId).toBe(42);
  });

  it('failed → 503 转人工', async () => {
    executeAiParseTaskMock.mockResolvedValue({
      ok: false,
      kind: 'content_reject',
      message: '内容拒绝',
    });
    const res = await request(app)
      .post('/api/v1/import/ai-parse')
      .set(authHeaders)
      .attach('file', Buffer.from('%PDF'), { filename: 's.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('failed');
    expect(res.body.kind).toBe('content_reject');
  });
});
