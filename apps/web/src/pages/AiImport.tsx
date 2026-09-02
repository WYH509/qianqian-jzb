import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { aiParse } from '../api/imports';
import { getQueueStatus } from '../api/deepseek';
import type { QueueStatusSummary } from '../lib/types';

const STATUS_STATS: Array<{ key: keyof QueueStatusSummary; label: string }> = [
  { key: 'queued', label: '排队中' },
  { key: 'processing', label: '处理中' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
  { key: 'dead_letter', label: '死信' },
  { key: 'cancelled', label: '已取消' },
];

const REFRESH_MS = 5000;

export default function AiImport() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<QueueStatusSummary | null>(null);
  const [parsing, setParsing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(() => {
    getQueueStatus()
      .then(setStatus)
      .catch(() => {
        // 轮询失败静默，下次 5s 后再试
      });
  }, []);

  useEffect(() => {
    refreshStatus();
    const timer = window.setInterval(refreshStatus, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const first = e.target.files?.[0];
    setFile(first ?? null);
    setMessage(null);
    setError(null);
  }

  async function handleEnqueue(): Promise<void> {
    if (!file) return;
    setParsing(true);
    setMessage(null);
    setError(null);
    try {
      const task = await aiParse(file);
      const eta = task.estimated_process_at
        ? `，预计处理时间 ${task.estimated_process_at}`
        : '';
      setMessage(`任务已入队（task ${task.task_id}，状态 ${task.status}${eta}）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '入队失败，请稍后重试');
    } finally {
      setParsing(false);
    }
  }

  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">AI 导入</h1>

      <div className="mb-6 rounded-lg bg-white p-5 shadow">
        <p className="mb-3 text-sm text-gray-600">
          上传账单文件（PDF / 图片），系统将排队调用 AI 解析并预览结果。
        </p>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={handleFileChange}
            className="block w-full max-w-md text-sm text-gray-700 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
          />
          <button
            type="button"
            disabled={parsing || file === null}
            onClick={() => void handleEnqueue()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {parsing ? '入队中…' : '入队解析'}
          </button>
        </div>
        {message && (
          <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            {message}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
      </div>

      <div className="rounded-lg bg-white p-5 shadow">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-medium text-gray-900">队列状态</h2>
          <span className="text-xs text-gray-400">每 5 秒自动刷新</span>
        </div>
        {status === null ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {STATUS_STATS.map((stat) => (
              <div
                key={stat.key}
                className="rounded-md border border-gray-200 px-3 py-3 text-center"
              >
                <div className="text-xl font-semibold tabular-nums text-gray-900">
                  {status[stat.key]}
                </div>
                <div className="mt-1 text-xs text-gray-500">{stat.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
