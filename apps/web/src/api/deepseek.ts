import { apiFetch } from './client';
import type { AiParseQueueItem, Paginated, QueueStatus, QueueStatusSummary } from '../lib/types';

// GET /api/v1/deepseek/queue-status
export async function getQueueStatus(): Promise<QueueStatusSummary> {
  const res = await apiFetch<{ data: QueueStatusSummary }>('/api/v1/deepseek/queue-status');
  return res.data;
}

// POST /api/v1/deepseek/retry/:queueId — 重试 failed 任务
export async function retryQueueTask(queueId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/deepseek/retry/${encodeURIComponent(queueId)}`, {
    method: 'POST',
  });
}

// POST /api/v1/deepseek/test-parse — DeepSeek 解析冒烟测试
export async function testDeepseekParse(input: {
  rows: unknown[];
}): Promise<{ model: string; result: unknown }> {
  const res = await apiFetch<{ data: { model: string; result: unknown } }>(
    '/api/v1/deepseek/test-parse',
    { method: 'POST', json: input }
  );
  return res.data;
}

export interface ListQueueParams {
  status?: QueueStatus;
  page?: number;
  pageSize?: number;
}

// GET /api/v1/ai-parse-queue — AI 解析队列（分页）
export async function listAiParseQueue(
  params: ListQueueParams = {}
): Promise<Paginated<AiParseQueueItem>> {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.page !== undefined) q.set('page', String(params.page));
  if (params.pageSize !== undefined) q.set('pageSize', String(params.pageSize));
  const qs = q.toString();
  return apiFetch<Paginated<AiParseQueueItem>>(`/api/v1/ai-parse-queue${qs ? `?${qs}` : ''}`);
}

// DELETE /api/v1/ai-parse-queue/:id — 取消队列任务
export async function cancelQueueItem(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/ai-parse-queue/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
