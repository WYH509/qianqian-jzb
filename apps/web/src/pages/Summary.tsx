import { useEffect, useState } from 'react';
import { getAccountSummary, getCashflow } from '../api/summary';
import type {
  AccountSummaryRow,
  CashflowGroupBy,
  CashflowPoint,
} from '../lib/types';

type Tab = 'accounts' | 'cashflow';

const GROUP_OPTIONS: Array<{ key: CashflowGroupBy; label: string }> = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'quarter', label: '季' },
  { key: 'year', label: '年' },
];

export default function Summary() {
  const [tab, setTab] = useState<Tab>('accounts');
  const [groupBy, setGroupBy] = useState<CashflowGroupBy>('month');

  const [accountRows, setAccountRows] = useState<AccountSummaryRow[] | null>(null);
  const [cashflowRows, setCashflowRows] = useState<CashflowPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAccountSummary()
      .then((data) => {
        if (!cancelled) setAccountRows(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载账户汇总失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getCashflow({ groupBy })
      .then((data) => {
        if (!cancelled) setCashflowRows(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载收支流失败');
      });
    return () => {
      cancelled = true;
    };
  }, [groupBy]);

  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">汇总</h1>
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTab('accounts')}
          className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
            tab === 'accounts'
              ? 'bg-indigo-600 font-medium text-white'
              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
          }`}
        >
          按账户
        </button>
        <button
          type="button"
          onClick={() => setTab('cashflow')}
          className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
            tab === 'cashflow'
              ? 'bg-indigo-600 font-medium text-white'
              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
          }`}
        >
          收支流
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {tab === 'accounts' &&
        (accountRows === null ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : accountRows.length === 0 ? (
          <p className="text-sm text-gray-500">暂无数据</p>
        ) : (
          <div className="overflow-x-auto rounded-lg bg-white shadow">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">账户</th>
                  <th className="px-4 py-3 text-right font-medium">期初</th>
                  <th className="px-4 py-3 text-right font-medium">收入</th>
                  <th className="px-4 py-3 text-right font-medium">支出</th>
                  <th className="px-4 py-3 text-right font-medium">期末</th>
                </tr>
              </thead>
              <tbody>
                {accountRows.map((row) => (
                  <tr key={row.account_id} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-4 py-3 text-gray-900">{row.account_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {row.initial_balance.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-green-600">
                      {row.income.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-red-600">
                      {row.expense.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-gray-900">
                      {row.balance.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'cashflow' && (
        <>
          <div className="mb-4 flex gap-2">
            {GROUP_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setGroupBy(opt.key)}
                className={`rounded-md px-3 py-1 text-xs transition-colors ${
                  groupBy === opt.key
                    ? 'bg-gray-800 font-medium text-white'
                    : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {cashflowRows === null ? (
            <p className="text-sm text-gray-500">加载中…</p>
          ) : cashflowRows.length === 0 ? (
            <p className="text-sm text-gray-500">暂无数据</p>
          ) : (
            <div className="overflow-x-auto rounded-lg bg-white shadow">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">周期</th>
                    <th className="px-4 py-3 text-right font-medium">收入</th>
                    <th className="px-4 py-3 text-right font-medium">支出</th>
                    <th className="px-4 py-3 text-right font-medium">净流</th>
                  </tr>
                </thead>
                <tbody>
                  {cashflowRows.map((row) => (
                    <tr key={row.period} className="border-b border-gray-100 last:border-b-0">
                      <td className="px-4 py-3 text-gray-900">{row.period}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-green-600">
                        {row.income.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-red-600">
                        {row.expense.toFixed(2)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium tabular-nums ${
                          row.net >= 0 ? 'text-green-700' : 'text-red-700'
                        }`}
                      >
                        {row.net >= 0 ? '+' : ''}
                        {row.net.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
