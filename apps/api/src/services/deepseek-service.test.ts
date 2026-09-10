// services/deepseek-service.ts 单元测试（5 类兜底 / 决策树 / 闲时段 / 队列管理）
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../utils/deepseek-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/deepseek-client.js')>();
  return { ...actual, callDeepSeek: vi.fn() };
});
vi.mock('../utils/time-window.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/time-window.js')>();
  return { ...actual, isOffPeak: vi.fn() };
});

import { callDeepSeek } from '../utils/deepseek-client.js';
import { isOffPeak } from '../utils/time-window.js';
import {
  selectModel,
  executeAiParseTask,
  enqueueAiParse,
  getQueueStatus,
  requeueFailedTask,
  listQueueTasks,
  cancelQueueTask,
  processQueuedTasks,
  type AiParseTaskInput,
} from './deepseek-service.js';
import { okResult, errorResult } from '../../tests/fixtures/deepseek-responses.js';
import { getDb } from '../db/client.js';

const callDeepSeekMock = callDeepSeek as unknown as ReturnType<typeof vi.fn>;
const isOffPeakMock = isOffPeak as unknown as ReturnType<typeof vi.fn>;

const input: AiParseTaskInput = {
  taskType: 'excel',
  fileBase64: 'aGVsbG8=',
  fileType: 'xlsx',
};

function resetQueueDb(): void {
  getDb().exec(`
    DELETE FROM ai_parse_queue;
    DELETE FROM transactions;
    DELETE FROM accounts;
    DELETE FROM sessions;
    DELETE FROM audit_log;
    DELETE FROM import_history;
  `);
}

beforeEach(() => {
  resetQueueDb();
  callDeepSeekMock.mockReset();
  isOffPeakMock.mockReset();
  isOffPeakMock.mockReturnValue(true);
});

describe('selectModel — 决策树（PRD §9.8.1）', () => {
  it('forceModel 优先', () => {
    expect(selectModel({ ...input, forceModel: 'pro' })).toBe('pro');
    expect(selectModel({ ...input, forceModel: 'flash' })).toBe('flash');
  });
  it('excel 结构化解析 → flash', () => {
    expect(selectModel(input)).toBe('flash');
  });
  it('image 图片 → pro', () => {
    expect(selectModel({ ...input, taskType: 'ocr', fileType: 'image' })).toBe('pro');
  });
  it('pdf 扫描件 → pro', () => {
    expect(selectModel({ ...input, taskType: 'bank_statement', fileType: 'pdf' })).toBe('pro');
  });
  it('bank_statement 银行流水 → pro', () => {
    expect(selectModel({ ...input, taskType: 'bank_statement', fileType: 'xlsx' })).toBe('pro');
  });
  it('默认 → flash', () => {
    expect(selectModel({ ...input, taskType: 'ocr', fileType: 'xlsx' })).toBe('flash');
  });
});

describe('executeAiParseTask — 闲时段 + 5 类兜底', () => {
  it('高峰期 → queued（不入队不调 API）', async () => {
    isOffPeakMock.mockReturnValue(false);
    const r = await executeAiParseTask(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('queued');
      expect(r.queueId).toBeGreaterThan(0);
    }
    expect(callDeepSeekMock).not.toHaveBeenCalled();
  });

  it('闲时段成功 → ok（excel 走 flash）', async () => {
    callDeepSeekMock.mockResolvedValue(okResult());
    const r = await executeAiParseTask(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.model).toBe('flash');
  });

  it('content_reject（4xx）→ 转人工，不重试', async () => {
    callDeepSeekMock.mockResolvedValue(errorResult('content_reject'));
    const r = await executeAiParseTask({ ...input, forceModel: 'pro' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('content_reject');
    expect(callDeepSeekMock).toHaveBeenCalledTimes(1);
  });

  it('rate_limit 重试后仍失败 → queued', async () => {
    callDeepSeekMock.mockResolvedValue(errorResult('rate_limit', { retryAfterMs: 0 }));
    const r = await executeAiParseTask(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('queued');
  });

  it('timeout 重试后仍失败 → queued', async () => {
    callDeepSeekMock.mockResolvedValue(errorResult('timeout'));
    const r = await executeAiParseTask(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('queued');
  });

  it('server_error 重试后仍失败 → queued', async () => {
    callDeepSeekMock.mockResolvedValue(errorResult('server_error'));
    const r = await executeAiParseTask(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('queued');
  });

  it('json_invalid（flash）→ 切 Pro 成功', async () => {
    callDeepSeekMock
      .mockResolvedValueOnce(errorResult('json_invalid'))
      .mockResolvedValueOnce(okResult());
    const r = await executeAiParseTask(input); // flash
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.model).toBe('pro');
  });

  it('json_invalid（flash）→ 切 Pro 也失败 → json_invalid', async () => {
    callDeepSeekMock
      .mockResolvedValueOnce(errorResult('json_invalid'))
      .mockResolvedValueOnce(errorResult('json_invalid'));
    const r = await executeAiParseTask(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('json_invalid');
  });

  it('```json 代码块包裹的内容也能解析成功', async () => {
    callDeepSeekMock.mockResolvedValue(
      okResult('```json\n[{"date":"2026-08-20","amount":5000}]\n```')
    );
    const r = await executeAiParseTask(input);
    expect(r.ok).toBe(true);
  });
});

describe('队列管理（PRD §9.9.3）', () => {
  it('enqueueAiParse 写入 queued 任务', () => {
    const id = enqueueAiParse(input);
    expect(id).toBeGreaterThan(0);
    const row = getDb()
      .prepare('SELECT status, task_type FROM ai_parse_queue WHERE id = ?')
      .get(id) as { status: string; task_type: string };
    expect(row.status).toBe('queued');
    expect(row.task_type).toBe('excel');
  });

  it('getQueueStatus 统计各状态', () => {
    const db = getDb();
    const id1 = enqueueAiParse(input);
    enqueueAiParse({ ...input, taskType: 'bank_statement' });
    db.prepare(`UPDATE ai_parse_queue SET status = 'completed', processed_at = ? WHERE id = ?`).run(
      Date.now(),
      id1
    );
    const s = getQueueStatus();
    expect(s.queued).toBe(1);
    expect(s.completed_today).toBe(1);
    expect(s.oldest_queued_at).toBeTruthy();
  });

  it('requeueFailedTask 仅 failed 可重试', () => {
    const db = getDb();
    const id = enqueueAiParse(input);
    expect(requeueFailedTask(id)).toBe(false); // 仍是 queued
    db.prepare(`UPDATE ai_parse_queue SET status = 'failed' WHERE id = ?`).run(id);
    expect(requeueFailedTask(id)).toBe(true);
    expect(requeueFailedTask(999999)).toBe(false);
  });

  it('listQueueTasks 分页 + status/taskType 过滤', () => {
    enqueueAiParse({ ...input, taskType: 'excel' });
    enqueueAiParse({ ...input, taskType: 'bank_statement' });
    const r = listQueueTasks({ page: 1, pageSize: 10 });
    expect(r.pagination.total).toBe(2);
    const filtered = listQueueTasks({ status: 'queued', taskType: 'excel', page: 1, pageSize: 10 });
    expect(filtered.pagination.total).toBe(1);
    expect(filtered.data[0]?.taskType).toBe('excel');
    expect(filtered.data[0]?.status).toBe('queued');
  });

  it('cancelQueueTask 仅 queued 可取消', () => {
    const db = getDb();
    const id = enqueueAiParse(input);
    expect(cancelQueueTask(id).deleted).toBe(true);
    expect(cancelQueueTask(id).deleted).toBe(false); // 已删除
    expect(cancelQueueTask(999999).deleted).toBe(false);
    const id2 = enqueueAiParse(input);
    db.prepare(`UPDATE ai_parse_queue SET status = 'processing' WHERE id = ?`).run(id2);
    const r = cancelQueueTask(id2);
    expect(r.deleted).toBe(false);
    expect(r.reason).toContain('queued');
  });

  it('processQueuedTasks 成功批处理', async () => {
    callDeepSeekMock.mockResolvedValue(okResult());
    enqueueAiParse(input);
    const r = await processQueuedTasks();
    expect(r.processed).toBe(1);
    expect(r.completed).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('processQueuedTasks 失败计数', async () => {
    callDeepSeekMock.mockResolvedValue(errorResult('content_reject'));
    enqueueAiParse(input);
    const r = await processQueuedTasks();
    expect(r.failed).toBe(1);
  });
});
