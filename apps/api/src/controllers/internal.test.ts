// controllers/internal.ts 集成测试（loopback 白名单 + process-queue）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp, resetDb } from '../../tests/helpers.js';

vi.mock('../services/deepseek-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/deepseek-service.js')>();
  return { ...actual, processQueuedTasks: vi.fn() };
});

import { processQueuedTasks } from '../services/deepseek-service.js';
const processQueuedTasksMock = processQueuedTasks as unknown as ReturnType<typeof vi.fn>;

const app: Express = buildApp();

beforeEach(() => {
  resetDb();
  processQueuedTasksMock.mockReset();
});

describe('POST /api/v1/internal/process-queue', () => {
  it('loopback 访问 → 200 + 处理结果', async () => {
    processQueuedTasksMock.mockResolvedValue({ processed: 0, completed: 0, failed: 0 });
    const res = await request(app).post('/api/v1/internal/process-queue');
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(0);
  });
});
