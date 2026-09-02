import { useEffect, useState } from 'react';
import { listAccounts } from '../api/accounts';
import type { Account, AccountType } from '../lib/types';

const TYPE_LABELS: Record<AccountType, string> = {
  cash: '现金',
  bank: '银行',
  investment: '投资',
  credit: '信用',
};

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAccounts()
      .then((data) => {
        if (!cancelled) setAccounts(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载账户列表失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">账户</h1>
      {error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}
      {accounts === null ? (
        <p className="text-sm text-gray-500">加载中…</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-gray-500">暂无账户</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-white shadow">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 text-right font-medium">余额</th>
                <th className="px-4 py-3 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc) => (
                <tr key={acc.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-4 py-3 text-gray-900">{acc.name}</td>
                  <td className="px-4 py-3 text-gray-700">{TYPE_LABELS[acc.type]}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                    {(acc.net ?? acc.initial_balance).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    {acc.is_archived ? (
                      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                        已归档
                      </span>
                    ) : (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                        使用中
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
