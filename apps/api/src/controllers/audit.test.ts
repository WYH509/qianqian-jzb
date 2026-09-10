// audit_log 覆盖集成测试（imports / exports / internal ai_parse 三个端点的 audit 写入）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { buildApp, signToken, resetDb, withCsrf } from '../../tests/helpers.js';
import { getDb } from '../db/client.js';
import { makeStandardStatementXlsx } from '../../tests/fixtures/xlsx.js';

vi.mock('../services/deepseek-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/deepseek-service.js')>();
  return { ...actual, executeAiParseTask: vi.fn(), processQueuedTasks: vi.fn() };
});
vi.mock('../utils/time-window.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/time-window.js')>();
  return { ...actual, getTimeWindow: vi.fn() };
});

import { executeAiParseTask, processQueuedTasks } from '../services/deepseek-service.js';
import { getTimeWindow } from '../utils/time-window.js';

const executeAiParseTaskMock = executeAiParseTask as unknown as ReturnType<typeof vi.fn>;
const processQueuedTasksMock = processQueuedTasks as unknown as ReturnType<typeof vi.fn>;
const getTimeWindowMock = getTimeWindow as unknown as ReturnType<typeof vi.fn>;

const app: Express = buildApp();
const token = signToken();
const authHeaders = withCsrf({ Authorization: `Bearer ${token}` });

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface AuditRow {
  id: number;
  user_id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: string | null;
  error_category: string | null;
  model: string | null;
  created_at: number;
}

function auditRows(): AuditRow[] {
  return getDb().prepare(`SELECT * FROM audit_log ORDER BY id`).all() as AuditRow[];
}

function lastAudit(): AuditRow | undefined {
  const rows = auditRows();
  return rows[rows.length - 1];
}

function auditsByAction(action: string): AuditRow[] {
  return auditRows().filter((r) => r.action === action);
}

function parseDetails(row: AuditRow): Record<string, unknown> {
  return row.details ? (JSON.parse(row.details) as Record<string, unknown>) : {};
}

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

function seedTx(): string {
  const db = getDb();
  const acc = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO accounts (id,name,type,initial_balance,currency,archived,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(acc, '现金', 'cash', 0, 'CNY', 0, now, now);
  db.prepare(
    `INSERT INTO transactions (id,account_id,type,amount,category,note,date,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(uuidv4(), acc, 'expense', 50, '餐饮', '午餐', '2026-08-25', now, now);
  return acc;
}

async function previewFile(): Promise<request.Response> {
  const buffer = await makeStandardStatementXlsx();
  return request(app)
    .post('/api/v1/import/preview')
    .set(authHeaders)
    .attach('file', buffer, { filename: 'statement.xlsx', contentType: XLSX_MIME });
}

// 二进制响应收集器（xlsx 非 JSON）；res 类型与 superagent 的 .parse() 签名对齐，用 any 避免与 @types/supertest 的 ReadableStream 签名冲突
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function binaryParser(res: any, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
  res.on('error', (e: Error) => cb(e, Buffer.alloc(0)));
}

beforeEach(() => {
  resetDb();
  executeAiParseTaskMock.mockReset();
  getTimeWindowMock.mockReset();
  processQueuedTasksMock.mockReset();
});

describe('imports audit_log 覆盖', () => {
  it('preview 成功 → audit action=create entity_type=excel', async () => {
    const res = await previewFile();
    expect(res.status).toBe(200);
    const row = lastAudit();
    expect(row?.action).toBe('create');
    expect(row?.entity_type).toBe('excel');
    expect(row?.entity_id).toBe(res.body.data.batchId);
    expect(row?.error_category).toBeNull();
    const d = parseDetails(row!);
    expect(d.file_name).toBe('statement.xlsx');
    expect(d.row_count).toBe(3);
  });

  it('preview 失败（无文件）→ error_category=import_preview_failed', async () => {
    const res = await request(app).post('/api/v1/import/preview').set(authHeaders);
    expect(res.status).toBe(400);
    const row = lastAudit();
    expect(row?.action).toBe('create');
    expect(row?.error_category).toBe('import_preview_failed');
  });

  it('confirm 成功 → audit action=create entity_id=batchId', async () => {
    const { body } = await previewFile();
    const accountId = createAccount();
    const res = await request(app)
      .post('/api/v1/import/confirm')
      .set(authHeaders)
      .send({
        fileHash: body.data.fileHash,
        accountId,
        rows: [{ date: '2026-08-25', amount: 50, type: 'expense' }],
      });
    expect(res.status).toBe(201);
    const row = lastAudit();
    expect(row?.action).toBe('create');
    expect(row?.entity_id).toBe(body.data.batchId);
    expect(row?.error_category).toBeNull();
    const d = parseDetails(row!);
    expect(d.imported_count).toBe(1);
  });

  it('confirm 失败（账户不存在）→ error_category=import_confirm_failed', async () => {
    const { body } = await previewFile();
    const res = await request(app)
      .post('/api/v1/import/confirm')
      .set(authHeaders)
      .send({
        fileHash: body.data.fileHash,
        accountId: uuidv4(),
        rows: [{ date: '2026-08-25', amount: 50, type: 'expense' }],
      });
    expect(res.status).toBe(404);
    const row = lastAudit();
    expect(row?.action).toBe('create');
    expect(row?.error_category).toBe('import_confirm_failed');
  });

  it('rollback 成功 → audit action=delete', async () => {
    const { body } = await previewFile();
    const accountId = createAccount();
    await request(app)
      .post('/api/v1/import/confirm')
      .set(authHeaders)
      .send({ fileHash: body.data.fileHash, accountId, rows: [{ date: '2026-08-25', amount: 50, type: 'expense' }] });
    const res = await request(app)
      .post(`/api/v1/import/${body.data.batchId}/rollback`)
      .set(authHeaders);
    expect(res.status).toBe(200);
    const row = lastAudit();
    expect(row?.action).toBe('delete');
    expect(row?.entity_id).toBe(body.data.batchId);
    expect(parseDetails(row!).rolled_back_count).toBe(1);
  });
});

describe('ai_parse audit_log 覆盖', () => {
  it('ai-parse 成功 → action=ai_parse + model + tokens', async () => {
    executeAiParseTaskMock.mockResolvedValue({
      ok: true,
      model: 'flash',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      data: [{ date: '2026-08-20', amount: 5000, type: 'income' }],
    });
    const res = await request(app)
      .post('/api/v1/import/ai-parse')
      .set(authHeaders)
      .attach('file', Buffer.from('%PDF'), { filename: 's.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    const row = lastAudit();
    expect(row?.action).toBe('ai_parse');
    expect(row?.entity_type).toBe('ai_call');
    expect(row?.model).toBe('flash');
    expect(row?.error_category).toBeNull();
    const d = parseDetails(row!);
    expect(d.tokens_in).toBe(10);
    expect(d.tokens_out).toBe(20);
    expect(typeof d.latency_ms).toBe('number');
  });

  it('ai-parse queued → error_category=ai_parse_queued', async () => {
    executeAiParseTaskMock.mockResolvedValue({ ok: false, kind: 'queued', queueId: 7, message: '高峰期' });
    getTimeWindowMock.mockReturnValue({ isOffPeak: false, window: 'peak', nextOffPeakAt: 1788600000000 });
    const res = await request(app)
      .post('/api/v1/import/ai-parse')
      .set(authHeaders)
      .attach('file', Buffer.from('%PDF'), { filename: 's.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(202);
    const row = lastAudit();
    expect(row?.action).toBe('ai_parse');
    expect(row?.error_category).toBe('ai_parse_queued');
    expect(row?.entity_id).toBe('7');
  });

  it('ai-parse 转人工 → error_category=ai_parse_failed', async () => {
    executeAiParseTaskMock.mockResolvedValue({ ok: false, kind: 'content_reject', message: '内容拒绝' });
    const res = await request(app)
      .post('/api/v1/import/ai-parse')
      .set(authHeaders)
      .attach('file', Buffer.from('%PDF'), { filename: 's.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(503);
    const row = lastAudit();
    expect(row?.action).toBe('ai_parse');
    expect(row?.error_category).toBe('ai_parse_failed');
    const d = parseDetails(row!);
    expect(d.kind).toBe('content_reject');
  });

  it('ai-parse 抛非 Error 异常 → error_msg 走 String 分支', async () => {
    executeAiParseTaskMock.mockRejectedValue('boom');
    const res = await request(app)
      .post('/api/v1/import/ai-parse')
      .set(authHeaders)
      .attach('file', Buffer.from('%PDF'), { filename: 's.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(500);
    const row = lastAudit();
    expect(row?.action).toBe('ai_parse');
    expect(row?.error_category).toBe('ai_parse_failed');
    expect(parseDetails(row!).error).toBe('boom');
  });

  it('ai-parse queued 无 queueId → entity_id 为 NULL', async () => {
    executeAiParseTaskMock.mockResolvedValue({ ok: false, kind: 'queued', message: '高峰期' });
    getTimeWindowMock.mockReturnValue({ isOffPeak: false, window: 'peak', nextOffPeakAt: 1788600000000 });
    const res = await request(app)
      .post('/api/v1/import/ai-parse')
      .set(authHeaders)
      .attach('file', Buffer.from('%PDF'), { filename: 's.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(202);
    const row = lastAudit();
    expect(row?.action).toBe('ai_parse');
    expect(row?.error_category).toBe('ai_parse_queued');
    expect(row?.entity_id).toBeNull();
  });
});

describe('exports audit_log 覆盖', () => {
  it('export 成功 → action=export entity_type=excel + row_count', async () => {
    seedTx();
    const res = await request(app)
      .get('/api/v1/export/transactions')
      .set(authHeaders)
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);
    const row = lastAudit();
    expect(row?.action).toBe('export');
    expect(row?.entity_type).toBe('excel');
    expect(row?.error_category).toBeNull();
    const d = parseDetails(row!);
    expect(d.row_count).toBe(1);
    expect(d.format).toBe('xlsx');
  });

  it('export 失败（非法 format）→ error_category=export_failed', async () => {
    const res = await request(app)
      .get('/api/v1/export/transactions')
      .query({ format: 'csv' })
      .set(authHeaders);
    expect(res.status).toBe(500);
    const row = lastAudit();
    expect(row?.action).toBe('export');
    expect(row?.error_category).toBe('export_failed');
  });
});

describe('internal ai_parse 队列 audit_log 覆盖', () => {
  it('process-queue 成功 → action=ai_parse user_id=system', async () => {
    processQueuedTasksMock.mockResolvedValue({ processed: 3, completed: 2, failed: 1 });
    const res = await request(app).post('/api/v1/internal/process-queue');
    expect(res.status).toBe(200);
    const rows = auditsByAction('ai_parse');
    const row = rows[rows.length - 1];
    expect(row?.user_id).toBe('system');
    expect(row?.entity_type).toBe('ai_call');
    expect(row?.error_category).toBeNull();
    const d = parseDetails(row!);
    expect(d.processed).toBe(3);
    expect(d.completed).toBe(2);
    expect(d.failed).toBe(1);
  });

  it('process-queue 失败 → error_category=ai_parse_queue_failed', async () => {
    processQueuedTasksMock.mockRejectedValue(new Error('queue boom'));
    const res = await request(app).post('/api/v1/internal/process-queue');
    expect(res.status).toBe(500);
    const row = lastAudit();
    expect(row?.action).toBe('ai_parse');
    expect(row?.user_id).toBe('system');
    expect(row?.error_category).toBe('ai_parse_queue_failed');
    expect(parseDetails(row!).error).toBe('queue boom');
  });
});
