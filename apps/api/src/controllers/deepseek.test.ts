// controllers/deepseek.ts 集成测试（queue-status / retry / list / cancel / test-parse）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp, signToken, resetDb } from '../../tests/helpers.js';
import { getDb } from '../db/client.js';

vi.mock('../services/deepseek-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/deepseek-service.js')>();
  return { ...actual, executeAiParseTask: vi.fn() };
});

import { executeAiParseTask } from '../services/deepseek-service.js';
const executeAiParseTaskMock = executeAiParseTask as unknown as ReturnType<typeof vi.fn>;

const app: Express = buildApp();
const token = signToken();
const authHeaders = { Authorization: `Bearer ${token}` };

function enqueue(status: string, taskType = 'excel'): number {
  return Number(
    getDb()
      .prepare(
        `INSERT INTO ai_parse_queue (status, task_type, task_data, requested_at) VALUES (?,?,?,?)`
      )
      .run(status, taskType, '{}', Date.now()).lastInsertRowid
  );
}

beforeEach(() => {
  resetDb();
  executeAiParseTaskMock.mockReset();
});

describe('DeepSeek 管理端点', () => {
  it('GET /deepseek/queue-status → 200', async () => {
    const res = await request(app).get('/api/v1/deepseek/queue-status').set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data.queued).toBe(0);
  });

  it('POST /deepseek/retry/:id 非法 id → 400', async () => {
    const res = await request(app).post('/api/v1/deepseek/retry/abc').set(authHeaders);
    expect(res.status).toBe(400);
  });

  it('POST /deepseek/retry/:id 任务不存在 → 400', async () => {
    const res = await request(app).post('/api/v1/deepseek/retry/999').set(authHeaders);
    expect(res.status).toBe(400);
  });

  it('POST /deepseek/retry/:id failed 任务 → 200 re-queued', async () => {
    const id = enqueue('failed');
    const res = await request(app).post(`/api/v1/deepseek/retry/${id}`).set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('re-queued');
  });

  it('GET /ai-parse-queue → 200 分页', async () => {
    enqueue('queued');
    const res = await request(app).get('/api/v1/ai-parse-queue').set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
  });

  it('GET /ai-parse-queue 非法 status → 400', async () => {
    const res = await request(app)
      .get('/api/v1/ai-parse-queue')
      .query({ status: 'bad' })
      .set(authHeaders);
    expect(res.status).toBe(400);
  });

  it('DELETE /ai-parse-queue/:id → 204', async () => {
    const id = enqueue('queued');
    const res = await request(app).delete(`/api/v1/ai-parse-queue/${id}`).set(authHeaders);
    expect(res.status).toBe(204);
  });

  it('DELETE /ai-parse-queue/:id 不存在 → 400', async () => {
    const res = await request(app).delete('/api/v1/ai-parse-queue/999').set(authHeaders);
    expect(res.status).toBe(400);
  });

  it('POST /deepseek/test-parse → 200', async () => {
    executeAiParseTaskMock.mockResolvedValue({
      ok: true,
      model: 'flash',
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      data: [],
    });
    const res = await request(app)
      .post('/api/v1/deepseek/test-parse')
      .set(authHeaders)
      .send({ taskType: 'excel', fileBase64: 'aGk=', fileType: 'xlsx' });
    expect(res.status).toBe(200);
  });
});
