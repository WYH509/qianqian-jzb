import { apiFetch } from './client';
import type { AccountSummaryRow, CashflowGroupBy, CashflowPoint } from '../lib/types';

// GET /api/v1/summary/accounts — 按账户汇总
export async function getAccountSummary(params?: {
  startDate?: string;
  endDate?: string;
}): Promise<AccountSummaryRow[]> {
  const q = new URLSearchParams();
  if (params?.startDate) q.set('startDate', params.startDate);
  if (params?.endDate) q.set('endDate', params.endDate);
  const qs = q.toString();
  const res = await apiFetch<{ data: AccountSummaryRow[] }>(
    `/api/v1/summary/accounts${qs ? `?${qs}` : ''}`
  );
  return res.data;
}

// GET /api/v1/summary/cashflow — 按时间段聚合收支流
export async function getCashflow(params: {
  groupBy: CashflowGroupBy;
  startDate?: string;
  endDate?: string;
}): Promise<CashflowPoint[]> {
  const q = new URLSearchParams();
  q.set('groupBy', params.groupBy);
  if (params.startDate) q.set('startDate', params.startDate);
  if (params.endDate) q.set('endDate', params.endDate);
  const qs = q.toString();
  const res = await apiFetch<{ data: CashflowPoint[] }>(
    `/api/v1/summary/cashflow${qs ? `?${qs}` : ''}`
  );
  return res.data;
}
