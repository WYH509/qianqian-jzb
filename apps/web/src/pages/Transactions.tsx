import { useCallback, useEffect, useState } from 'react';
import Modal from '../components/Modal';
import TransactionForm from '../components/TransactionForm';
import { listAccounts } from '../api/accounts';
import {
  deleteTransaction,
  listTransactions,
  type ListTransactionsParams,
} from '../api/transactions';
import type { Account, Paginated, Transaction, TxnType } from '../lib/types';

const PAGE_SIZE = 20;

const TYPE_LABELS: Record<TxnType, string> = {
  income: '收入',
  expense: '支出',
  transfer_in: '转入',
  transfer_out: '转出',
};

type TypeFilter = '' | TxnType | 'transfer';

const TYPE_FILTER_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
  { value: '', label: '全部' },
  { value: 'income', label: '收入' },
  { value: 'expense', label: '支出' },
  { value: 'transfer', label: '转账' },
];

const controlCls =
  'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none';

export default function Transactions() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [result, setResult] = useState<Paginated<Transaction> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 筛选条件
  const [accountId, setAccountId] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 新建 / 编辑 / 删除
  const [showCreate, setShowCreate] = useState(false);
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // 账户列表（筛选下拉 + 表单共用），mount 时加载一次
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

  // filter / page / reloadTick 变化时重新拉取流水
  const loadTransactions = useCallback(() => {
    const params: ListTransactionsParams = { page, pageSize: PAGE_SIZE };
    if (accountId) params.accountId = accountId;
    if (typeFilter) params.type = typeFilter;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    let cancelled = false;
    setLoading(true);
    listTransactions(params)
      .then((res) => {
        if (!cancelled) {
          setResult(res);
          setError(null);
        }
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
  }, [page, accountId, typeFilter, startDate, endDate, reloadTick]);

  useEffect(() => loadTransactions(), [loadTransactions]);

  // 筛选条件变化时回到第一页
  useEffect(() => {
    setPage(1);
  }, [accountId, typeFilter, startDate, endDate]);

  const handleDelete = (txn: Transaction) => {
    if (deletingId !== null) return;
    setDeletingId(txn.id);
    deleteTransaction(txn.id)
      .then(() => setReloadTick((t) => t + 1))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '删除流水失败');
      })
      .finally(() => setDeletingId(null));
  };

  const closeCreate = () => setShowCreate(false);
  const closeEdit = () => setEditingTxn(null);

  const handleFormSuccess = () => {
    setShowCreate(false);
    setEditingTxn(null);
    setReloadTick((t) => t + 1);
  };

  const handleClearFilters = () => {
    setAccountId('');
    setTypeFilter('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const pagination = result?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">流水</h1>
        <button
          type="button"
          disabled={accounts.length === 0}
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          title={accounts.length === 0 ? '请先创建账户' : undefined}
        >
          新建流水
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-white p-3 shadow">
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          开始日期
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={controlCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          结束日期
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={controlCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          账户
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={controlCls}
          >
            <option value="">全部账户</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          类型
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className={controlCls}
          >
            {TYPE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleClearFilters}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-100"
        >
          清空筛选
        </button>
      </div>

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
                <th className="px-4 py-3 font-medium">操作</th>
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
                  <td className="px-4 py-3">
                    <div className="flex gap-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setEditingTxn(txn)}
                        className="text-indigo-600 transition-colors hover:text-indigo-800"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        disabled={deletingId !== null}
                        onClick={() => handleDelete(txn)}
                        className="text-red-600 transition-colors hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingId === txn.id ? '删除中…' : '删除'}
                      </button>
                    </div>
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

      <Modal isOpen={showCreate} onClose={closeCreate} title="新建流水">
        <TransactionForm
          mode="create"
          accounts={accounts}
          onSuccess={handleFormSuccess}
          onCancel={closeCreate}
        />
      </Modal>

      <Modal isOpen={editingTxn !== null} onClose={closeEdit} title="编辑流水">
        {editingTxn && (
          <TransactionForm
            mode="edit"
            accounts={accounts}
            initial={editingTxn}
            onSuccess={handleFormSuccess}
            onCancel={closeEdit}
          />
        )}
      </Modal>
    </section>
  );
}
