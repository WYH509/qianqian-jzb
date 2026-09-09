import { apiFetch } from './client';
import type { ImportHistoryItem, ImportPreviewResponse } from '../lib/types';

export interface ConfirmImportInput {
  fileHash: string;
  accountId: string;
  rows: Array<{
    rowIndex: number;
    date: string;
    amount: number;
    type: 'income' | 'expense';
    category?: string;
    note?: string;
  }>;
}

export interface ConfirmImportResponse {
  imported: number;
  skipped: number;
  batch_id: string;
}

export interface AiParseTaskResponse {
  task_id: string;
  status: 'queued';
  estimated_process_at: string | null;
}

function fileForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

// POST /api/v1/import/preview — 上传 Excel 预览解析结果（multipart）
export async function previewImport(file: File): Promise<ImportPreviewResponse> {
  // 注意：FormData 勿手动设置 Content-Type（浏览器自动加 boundary）
  const res = await apiFetch<{ data: ImportPreviewResponse }>('/api/v1/import/preview', {
    method: 'POST',
    body: fileForm(file),
  });
  return res.data;
}

// POST /api/v1/import/confirm — 确认导入
export async function confirmImport(input: ConfirmImportInput): Promise<ConfirmImportResponse> {
  const res = await apiFetch<{ data: ConfirmImportResponse }>('/api/v1/import/confirm', {
    method: 'POST',
    json: input,
  });
  return res.data;
}

// GET /api/v1/import/history
export async function listImportHistory(): Promise<ImportHistoryItem[]> {
  const res = await apiFetch<{ data: ImportHistoryItem[] }>('/api/v1/import/history');
  return res.data;
}

// POST /api/v1/import/:id/rollback — 回滚批次导入
export async function rollbackImport(batchId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/import/${encodeURIComponent(batchId)}/rollback`, {
    method: 'POST',
  });
}

// POST /api/v1/import/ai-parse — AI 解析入队（multipart）
export async function aiParse(file: File): Promise<AiParseTaskResponse> {
  return apiFetch<AiParseTaskResponse>('/api/v1/import/ai-parse', {
    method: 'POST',
    body: fileForm(file),
  });
}
