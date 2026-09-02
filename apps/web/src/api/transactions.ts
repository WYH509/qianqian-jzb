import { apiFetch } from './client';
import type { Paginated, Transaction, TxnType } from '../lib/types';

export interface ListTransactionsParams {
  accountId?: string;
  type?: TxnType | 'transfer';
  category?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
  includeDeleted?: boolean;
}

export interface CreateTxnInput {
  type: 'income' | 'expense';
  accountId: string;
  amount: number;
  date: string;
  category?: string;
  note?: string;
}

export interface CreateTransferInput {
  type: 'transfer';
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  note?: string;
}

export interface CreateTxnResponse {
  transferGroupId?: string;
  fromTransactionId?: string;
  toTransactionId?: string;
  from?: Transaction;
  to?: Transaction;
  data?: Transaction;
}

// PUT /:id — 仅 metadata（category / note / date），amount 不可改
export interface UpdateTxnInput {
  category?: string;
  note?: string;
  date?: string;
}

// PATCH /:id — 可改 amount / category / note / date
export interface PatchTxnInput {
  amount?: number;
  category?: string;
  note?: string;
  date?: string;
}

function buildQuery(params: ListTransactionsParams): string {
  const q = new URLSearchParams();
  if (params.accountId) q.set('accountId', params.accountId);
  if (params.type) q.set('type', params.type);
  if (params.category) q.set('category', params.category);
  if (params.startDate) q.set('startDate', params.startDate);
  if (params.endDate) q.set('endDate', params.endDate);
  if (params.page !== undefined) q.set('page', String(params.page));
  if (params.pageSize !== undefined) q.set('pageSize', String(params.pageSize));
  if (params.includeDeleted) q.set('includeDeleted', 'true');
  return q.toString();
}

// GET /api/v1/transactions — 分页列表
export async function listTransactions(
  params: ListTransactionsParams = {}
): Promise<Paginated<Transaction>> {
  const qs = buildQuery(params);
  return apiFetch<Paginated<Transaction>>(`/api/v1/transactions${qs ? `?${qs}` : ''}`);
}

// GET /api/v1/transactions/:id
export async function getTransaction(id: string): Promise<Transaction> {
  const res = await apiFetch<{ data: Transaction }>(`/api/v1/transactions/${encodeURIComponent(id)}`);
  return res.data;
}

// POST /api/v1/transactions — income / expense / transfer
export async function createTransaction(
  input: CreateTxnInput | CreateTransferInput
): Promise<CreateTxnResponse> {
  return apiFetch<CreateTxnResponse>('/api/v1/transactions', { method: 'POST', json: input });
}

// PUT /api/v1/transactions/:id — 仅 metadata
export async function updateTransaction(id: string, input: UpdateTxnInput): Promise<Transaction> {
  const res = await apiFetch<{ data: Transaction }>(
    `/api/v1/transactions/${encodeURIComponent(id)}`,
    { method: 'PUT', json: input }
  );
  return res.data;
}

// PATCH /api/v1/transactions/:id — 可改 amount
export async function patchTransaction(id: string, input: PatchTxnInput): Promise<Transaction> {
  const res = await apiFetch<{ data: Transaction }>(
    `/api/v1/transactions/${encodeURIComponent(id)}`,
    { method: 'PATCH', json: input }
  );
  return res.data;
}

// DELETE /api/v1/transactions/:id — 软删除（转账联动删两笔）
export async function deleteTransaction(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
