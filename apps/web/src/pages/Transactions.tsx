import { useEffect, useState } from 'react';
import { listTransactions } from '../api/transactions';
import type { Paginated, Transaction, TxnType } from '../lib/types';

const TYPE_LABELS: Record<TxnType, string> = {
  income: '收入',
  expense: '支出',
  transfer_in: '转入',
  transfer_out: '转出',
};

const PAGE_SIZE = 20;

export default function Transactions() {
  const [result, setResult] = useState<Paginated<Transaction> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listTransactions({ page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载流水失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  const pagination = result?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">流水</h1>
      {error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}
      {loading && result === null ? (
        <p className="text-sm text-gray-500">加载中…</p>
      ) : result === null ? null : result.data.length === 0 ? (
        <p className="text-sm text-gray-500">暂无流水</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-white shadow">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">日期</th>
                <th className="px-4 py-3 font-medium">账户</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 text-right font-medium">金额</th>
                <th className="px-4 py-3 font-medium">分类</th>
                <th className="px-4 py-3 font-medium">备注</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((txn) => (
                <tr key={txn.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-4 py-3 text-gray-700">{txn.date}</td>
                  <td className="px-4 py-3 text-gray-700">{txn.account_name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{TYPE_LABELS[txn.type]}</td>
                  <td
                    className={`px-4 py-3 text-right font-medium tabular-nums ${
                      txn.type === 'income' ? 'text-green-600' : 'text-gray-600'
                    }`}
                  >
                    {txn.type === 'expense' || txn.type === 'transfer_out' ? '-' : '+'}
                    {txn.amount.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{txn.category ?? '—'}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-gray-500" title={txn.note ?? ''}>
                    {txn.note ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>
            共 {pagination.total} 条（第 {pagination.page} / {totalPages} 页）
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
