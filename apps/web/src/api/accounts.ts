import { apiFetch } from './client';
import type { Account } from '../lib/types';

// GET /api/v1/accounts — 账户列表（含余额）。默认不含已归档账户。
export async function listAccounts(params?: { includeArchived?: boolean }): Promise<Account[]> {
  const query = new URLSearchParams();
  if (params?.includeArchived !== true) {
    query.set('archived', 'false');
  }
  const qs = query.toString();
  const res = await apiFetch<{ data: Account[] }>(`/api/v1/accounts${qs ? `?${qs}` : ''}`);
  return res.data;
}

// GET /api/v1/accounts/:id
export async function getAccount(id: string): Promise<Account> {
  const res = await apiFetch<{ data: Account }>(`/api/v1/accounts/${encodeURIComponent(id)}`);
  return res.data;
}

// POST /api/v1/accounts
export async function createAccount(input: {
  name: string;
  type: Account['type'];
  initial_balance?: number;
  currency?: string;
}): Promise<Account> {
  const res = await apiFetch<{ data: Account }>('/api/v1/accounts', {
    method: 'POST',
    json: input,
  });
  return res.data;
}

// PUT /api/v1/accounts/:id — 名称 / 期初余额 / 币种（type 不可改）
export async function updateAccount(
  id: string,
  input: { name?: string; initial_balance?: number; currency?: string }
): Promise<Account> {
  const res = await apiFetch<{ data: Account }>(`/api/v1/accounts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    json: input,
  });
  return res.data;
}

// DELETE /api/v1/accounts/:id — 归档（软删除）
export async function archiveAccount(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
