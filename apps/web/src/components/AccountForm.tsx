import { useState, type FormEvent } from 'react';
import { createAccount, updateAccount } from '../api/accounts';
import type { Account, AccountType } from '../lib/types';

interface AccountFormProps {
  mode: 'create' | 'edit';
  initial?: Account;
  onSuccess: () => void;
  onCancel: () => void;
}

const accountTypes: Array<{ value: AccountType; label: string }> = [
  { value: 'cash', label: '现金' },
  { value: 'bank', label: '银行' },
  { value: 'investment', label: '投资' },
  { value: 'credit', label: '信用' },
];

const inputCls =
  'mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500';

/** 新建 / 编辑账户表单。type 创建后不可改（PRD §14.2 约束），edit 模式锁住下拉 */
export default function AccountForm({ mode, initial, onSuccess, onCancel }: AccountFormProps) {
  const isEdit = mode === 'edit';

  const [name, setName] = useState<string>(() => initial?.name ?? '');
  const [type, setType] = useState<AccountType>(() => initial?.type ?? 'cash');
  const [initialBalance, setInitialBalance] = useState<string>(() =>
    initial ? String(initial.initial_balance) : ''
  );
  const [currency, setCurrency] = useState<string>(() =>
    isEdit && initial ? initial.currency : 'CNY'
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const trimmedName = name.trim();
    if (trimmedName === '') {
      setError('名称不能为空');
      return;
    }
    if (trimmedName.length > 20) {
      setError('名称不能超过 20 字');
      return;
    }
    const trimmedCurrency = currency.trim();
    if (trimmedCurrency.length < 1 || trimmedCurrency.length > 8) {
      setError('币种需 1-8 个字符');
      return;
    }
    const balance = initialBalance.trim() === '' ? 0 : Number(initialBalance);
    if (!Number.isFinite(balance)) {
      setError('期初余额必须是数字');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await createAccount({
          name: trimmedName,
          type,
          initial_balance: balance,
          currency: trimmedCurrency,
        });
      } else if (initial) {
        await updateAccount(initial.id, {
          name: trimmedName,
          initial_balance: balance,
          currency: trimmedCurrency,
        });
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
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700">
          名称
          <input
            type="text"
            value={name}
            maxLength={20}
            placeholder="如 招商银行储蓄卡"
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700">
          类型
          <select
            value={type}
            disabled={isEdit}
            onChange={(e) => setType(e.target.value as AccountType)}
            className={inputCls}
          >
            {accountTypes.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {isEdit && <p className="mt-1 text-xs text-gray-400">类型创建后不可修改（PRD §14.2）</p>}
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700">
          期初余额
          <input
            type="number"
            step="0.01"
            value={initialBalance}
            onChange={(e) => setInitialBalance(e.target.value)}
            className={`${inputCls} text-right tabular-nums`}
          />
        </label>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700">
          币种
          <input
            type="text"
            value={currency}
            maxLength={8}
            placeholder="如 CNY"
            onChange={(e) => setCurrency(e.target.value)}
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
