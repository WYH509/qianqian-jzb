import { useEffect, useState } from 'react';
import Modal from '../components/Modal';
import AccountForm from '../components/AccountForm';
import { archiveAccount, listAccounts } from '../api/accounts';
import type { Account, AccountType } from '../lib/types';

const TYPE_LABELS: Record<AccountType, string> = {
  cash: '现金',
  bank: '银行',
  investment: '投资',
  credit: '信用',
};

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setAccounts(null);
    listAccounts({ includeArchived })
      .then((data) => {
        if (!cancelled) {
          setAccounts(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载账户列表失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [includeArchived, reloadTick]);

  const handleArchive = (acc: Account) => {
    if (archivingId !== null) return;
    if (!window.confirm(`确定归档「${acc.name}」？`)) return;
    setArchivingId(acc.id);
    archiveAccount(acc.id)
      .then(() => setReloadTick((t) => t + 1))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '归档账户失败');
      })
      .finally(() => setArchivingId(null));
  };

  const closeCreate = () => setShowCreate(false);
  const closeEdit = () => setEditing(null);

  const handleFormSuccess = () => {
    setShowCreate(false);
    setEditing(null);
    setReloadTick((t) => t + 1);
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">账户</h1>
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            显示已归档
          </label>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            新建账户
          </button>
        </div>
      </div>

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
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc) => (
                <tr
                  key={acc.id}
                  className={`border-b border-gray-100 last:border-b-0 ${
                    acc.archived ? 'bg-gray-50' : ''
                  }`}
                >
                  <td
                    className={`px-4 py-3 ${
                      acc.archived ? 'text-gray-400' : 'text-gray-900'
                    }`}
                  >
                    {acc.name}
                  </td>
                  <td
                    className={`px-4 py-3 ${
                      acc.archived ? 'text-gray-400' : 'text-gray-700'
                    }`}
                  >
                    {TYPE_LABELS[acc.type]}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      acc.archived ? 'text-gray-400' : 'text-gray-900'
                    }`}
                  >
                    {acc.balance.toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    {acc.archived ? (
                      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                        已归档
                      </span>
                    ) : (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                        使用中
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setEditing(acc)}
                        className="text-indigo-600 transition-colors hover:text-indigo-800"
                      >
                        编辑
                      </button>
                      {!acc.archived && (
                        <button
                          type="button"
                          disabled={archivingId !== null}
                          onClick={() => handleArchive(acc)}
                          className="text-red-600 transition-colors hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {archivingId === acc.id ? '归档中…' : '归档'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showCreate} onClose={closeCreate} title="新建账户">
        <AccountForm
          mode="create"
          onSuccess={handleFormSuccess}
          onCancel={closeCreate}
        />
      </Modal>

      <Modal isOpen={editing !== null} onClose={closeEdit} title="编辑账户">
        {editing && (
          <AccountForm
            mode="edit"
            initial={editing}
            onSuccess={handleFormSuccess}
            onCancel={closeEdit}
          />
        )}
      </Modal>
    </section>
  );
}
