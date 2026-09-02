import { useState, type FormEvent } from 'react';
import { createTransaction, patchTransaction, updateTransaction } from '../api/transactions';
import type { Account, Transaction } from '../lib/types';

type FormType = 'income' | 'expense' | 'transfer';

interface TransactionFormProps {
  mode: 'create' | 'edit';
  accounts: Account[];
  initial?: Transaction;
  onSuccess: () => void;
  onCancel: () => void;
}

const TYPE_OPTIONS: Array<{ value: FormType; label: string }> = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'transfer', label: '转账' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const inputCls =
  'mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/** 列表类型 → 表单类型：转账两笔（transfer_in/out）落到普通收支表单（edit 不允许改类型，不展示转账模式） */
function toFormType(txnType: Transaction['type']): 'income' | 'expense' {
  return txnType === 'income' ? 'income' : 'expense';
}

/** 新建 / 编辑流水表单。create 支持 支出/收入/转账；edit 锁类型、金额默认锁定（PUT），可解锁走 PATCH */
export default function TransactionForm({
  mode,
  accounts,
  initial,
  onSuccess,
  onCancel,
}: TransactionFormProps) {
  const isEdit = mode === 'edit';

  const [type, setType] = useState<FormType>(() =>
    isEdit && initial ? toFormType(initial.type) : 'expense'
  );
  const [accountId, setAccountId] = useState<string>(
    () => initial?.account_id ?? accounts[0]?.id ?? ''
  );
  const [fromAccountId, setFromAccountId] = useState<string>(() => accounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState<string>(() => accounts[1]?.id ?? '');
  const [amount, setAmount] = useState<string>(() =>
    initial ? String(initial.amount) : ''
  );
  const [date, setDate] = useState<string>(() => initial?.date ?? todayISO());
  const [category, setCategory] = useState<string>(() => initial?.category ?? '');
  const [note, setNote] = useState<string>(() => initial?.note ?? '');
  const [allowAmountEdit, setAllowAmountEdit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // edit 模式账户也可能被归档而不在 accounts 里，补一个原账户选项避免 select 悬空
  const missingInitialAccount =
    isEdit && initial !== undefined && !accounts.some((a) => a.id === initial.account_id);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('金额必须大于 0');
      return;
    }
    if (!DATE_RE.test(date)) {
      setError('日期格式应为 YYYY-MM-DD');
      return;
    }
    if (type === 'transfer') {
      if (fromAccountId === '' || toAccountId === '') {
        setError('请选择转出与转入账户');
        return;
      }
      if (fromAccountId === toAccountId) {
        setError('转出与转入账户不能相同');
        return;
      }
    } else if (accountId === '') {
      setError('请选择账户');
      return;
    }

    // 空字段 omit 而不是传 null / ''（PatchTxnInput / UpdateTxnInput 不接受 null）
    const cleanCategory = category.trim();
    const cleanNote = note.trim();

    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'create') {
        if (type === 'transfer') {
          await createTransaction({
            type: 'transfer',
            fromAccountId,
            toAccountId,
            amount: numericAmount,
            date,
            ...(cleanNote ? { note: cleanNote } : {}),
          });
        } else {
          await createTransaction({
            type,
            accountId,
            amount: numericAmount,
            date,
            ...(cleanCategory ? { category: cleanCategory } : {}),
            ...(cleanNote ? { note: cleanNote } : {}),
          });
        }
      } else if (initial) {
        if (allowAmountEdit) {
          await patchTransaction(initial.id, {
            amount: numericAmount,
            date,
            ...(cleanCategory ? { category: cleanCategory } : {}),
            ...(cleanNote ? { note: cleanNote } : {}),
          });
        } else {
          await updateTransaction(initial.id, {
            date,
            ...(cleanCategory ? { category: cleanCategory } : {}),
            ...(cleanNote ? { note: cleanNote } : {}),
          });
        }
      }
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {!isEdit && (
        <div className="mb-4 flex gap-2">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setType(opt.value)}
              className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                type === opt.value
                  ? 'bg-indigo-600 font-medium text-white'
                  : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {type === 'transfer' ? (
        <div className="mb-4 grid grid-cols-2 gap-4">
          <label className="block text-sm font-medium text-gray-700">
            转出账户
            <select
              value={fromAccountId}
              onChange={(e) => setFromAccountId(e.target.value)}
              className={inputCls}
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-gray-700">
            转入账户
            <select
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
              className={inputCls}
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700">
            账户
            <select
              value={accountId}
              disabled={isEdit}
              onChange={(e) => setAccountId(e.target.value)}
              className={inputCls}
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
              {missingInitialAccount && (
                <option value={initial?.id ?? ''}>
                  {initial?.account_name ?? '原账户'}
                </option>
              )}
            </select>
          </label>
          {isEdit && (
            <p className="mt-1 text-xs text-gray-400">账户不可修改（PUT / PATCH 均不支持）</p>
          )}
        </div>
      )}

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700">
          金额
          {isEdit && !allowAmountEdit && (
            <button
              type="button"
              onClick={() => setAllowAmountEdit(true)}
              className="ml-2 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600 transition-colors hover:bg-indigo-100"
            >
              修改金额（PATCH）
            </button>
          )}
          <input
            type="number"
            min="0.01"
            step="0.01"
            required
            value={amount}
            disabled={isEdit && !allowAmountEdit}
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputCls} text-right tabular-nums`}
          />
        </label>
        {isEdit && !allowAmountEdit && (
          <p className="mt-1 text-xs text-gray-400">
            默认锁定金额（PUT 仅改 metadata），解锁后将通过 PATCH 修改
          </p>
        )}
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700">
          日期
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>

      {type !== 'transfer' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700">
            分类
            <input
              type="text"
              value={category}
              maxLength={30}
              placeholder="如 餐饮、工资（可留空）"
              onChange={(e) => setCategory(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>
      )}

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700">
          备注
          <input
            type="text"
            value={note}
            maxLength={200}
            placeholder="可留空"
            onChange={(e) => setNote(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>

      <div className="mt-2 flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? '保存中…' : '保存'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}
    </form>
  );
}
