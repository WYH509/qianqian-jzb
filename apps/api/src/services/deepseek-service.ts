// DeepSeek 调度服务（PRD §6.5.4 + §9.8 决策树 + §9.9 5 类兜底 + §9.9.2 高峰期排队）
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import {
  callDeepSeek,
  callDeepSeek as _callDeepSeek,
  parseJsonFromResponse,
  getModelName,
  type DeepSeekModel,
  type DeepSeekRequest,
  type DeepSeekErrorKind,
} from '../utils/deepseek-client.js';
// 注：2026-09-10 起统一用 flash，Pro 路径全部下线。selectModel / processQueuedTasks 不再传 model 变体。
import { isOffPeak } from '../utils/time-window.js';

// --- 类型定义 ---
export interface AiParseTaskInput {
  taskType: 'bank_statement' | 'excel' | 'ocr';
  /** base64 编码的文件内容 */
  fileBase64: string;
  fileType: 'pdf' | 'image' | 'xlsx';
  /** 提示词上下文（如系统提示词）*/
  systemPrompt?: string;
  /** 用户消息 */
  userPrompt?: string;
  /** 强制模型（已废弃，2026-09-10 起统一 flash，保留字段向后兼容） */
  forceModel?: DeepSeekModel;
}

export interface AiParseTaskResult {
  ok: true;
  data: unknown;
  model: DeepSeekModel;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface AiParseTaskError {
  ok: false;
  kind: DeepSeekErrorKind | 'queued';
  message: string;
  queueId?: number;
  estimatedProcessAt?: string;
}

export type AiParseTaskOutcome = AiParseTaskResult | AiParseTaskError;

// --- 决策树（PRD §9.8.1，2026-09-10 简化为只 flash） ---
/**
 * 选模型（2026-09-10 起统一 flash，无 Pro 路径；forceModel 字段已废弃但保留兼容）
 * @returns 'flash'
 */
export function selectModel(_input: AiParseTaskInput): DeepSeekModel {
  // 历史 Pro 路由（image / pdf / bank_statement）全部并入 flash。
  // forceModel 字段忽略（不再支持强制走 Pro）。
  return 'flash';
}

// --- 系统 Prompt 模板（PRD §15.4.1 + §9.4.1） ---
const BANK_STATEMENT_SYSTEM_PROMPT = `你是银行流水解析助手。输入是银行流水的图片或 PDF，输出是 JSON 数组的标准化交易记录。
每条交易包含：date (YYYY-MM-DD), amount (正数), type (income/expense), bankName, accountTail, note。
严格按 JSON 输出，不要任何额外文字。`;

const BANK_STATEMENT_FEW_SHOT = `示例输出：
[
  { "date": "2026-08-20", "amount": 5000, "type": "income", "bankName": "招商银行", "accountTail": "8829", "note": "工资" },
  { "date": "2026-08-21", "amount": 50, "type": "expense", "bankName": "招商银行", "accountTail": "8829", "note": "午餐" }
]`;

/** 构造 DeepSeek 请求（含系统 Prompt + 用户消息） */
function buildRequest(
  input: AiParseTaskInput,
  model: DeepSeekModel
): DeepSeekRequest {
  const modelName = getModelName(model);
  const messages: DeepSeekRequest['messages'] = [];

  let systemContent: string;
  if (input.taskType === 'bank_statement') {
    systemContent = input.systemPrompt ?? `${BANK_STATEMENT_SYSTEM_PROMPT}\n\n${BANK_STATEMENT_FEW_SHOT}`;
  } else {
    systemContent = input.systemPrompt ?? '你是数据解析助手，严格按 JSON 输出。';
  }
  messages.push({ role: 'system', content: systemContent });

  // 用户消息：base64 图片/PDF 用 data URL
  if (input.fileType === 'image' || input.fileType === 'pdf') {
    const mime = input.fileType === 'image' ? 'image/png' : 'application/pdf';
    const dataUrl = `data:${mime};base64,${input.fileBase64}`;
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: input.userPrompt ?? '请解析这份银行流水' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] as unknown as string, // multipart content
    });
  } else {
    messages.push({
      role: 'user',
      content: input.userPrompt ?? `请解析以下数据：\n${input.fileBase64}`,
    });
  }

  return {
    model: modelName,
    messages,
    temperature: 0.1,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  };
}

// --- 5 类失败兜底（PRD §9.9.1） ---
/**
 * 执行单次 DeepSeek 任务：决策树选模型 + 调 API + 5 类失败兜底
 * 闲时段直接调；高峰期写入 ai_parse_queue 并返回 queued
 */
export async function executeAiParseTask(
  input: AiParseTaskInput
): Promise<AiParseTaskOutcome> {
  // Step 1: 时段检查（PRD §6.5.4 + §9.9.2）
  if (!isOffPeak()) {
    const queueId = enqueueAiParse(input);
    return {
      ok: false,
      kind: 'queued',
      message: '高峰期任务已入队，等待闲时段处理',
      queueId,
    };
  }

  // Step 2: 决策树选模型
  const model = selectModel(input);

  // Step 3: 调用 + 重试（按 §9.9.1 5 类）
  const result = await callWithRetry(input, model);

  // Step 4: 失败兜底
  if (!result.ok) {
    if (result.error.kind === 'content_reject') {
      // 内容拒绝（4xx）→ 立即转人工，不重试
      logger.error({ taskType: input.taskType, err: result.error }, 'DeepSeek content reject');
      return {
        ok: false,
        kind: 'content_reject',
        message: `内容拒绝：${result.error.message}`,
      };
    }
    if (result.error.kind === 'json_invalid') {
      // JSON 无效：2026-09-10 起仅 flash，不升级 Pro，直接转人工
      return {
        ok: false,
        kind: 'json_invalid',
        message: 'JSON 解析失败，请手动导入',
      };
    }
    // 其他失败（限流 / 超时 / 5xx）已重试过，最终失败 → 入队
    const queueId = enqueueAiParse(input);
    return {
      ok: false,
      kind: 'queued',
      message: 'DeepSeek 调用失败，已加入重试队列',
      queueId,
    };
  }

  // 成功：解析 JSON 校验
  const jsonResult = parseJsonFromResponse(result.response.choices[0]?.message.content ?? '');
  if (!jsonResult.ok) {
    // 200 但 JSON 无效 → JSON_INVALID（2026-09-10 起仅 flash，无 Pro 升级）
    return {
      ok: false,
      kind: 'json_invalid',
      message: '返回内容无法解析为 JSON',
    };
  }

  return {
    ok: true,
    data: jsonResult.data,
    model,
    usage: result.response.usage,
  };
}

/** 调用 + 重试（限流 / 超时 / 5xx） */
async function callWithRetry(
  input: AiParseTaskInput,
  model: DeepSeekModel,
  maxRetries: number = config.DEEPSEEK_MAX_RETRIES
): Promise<Awaited<ReturnType<typeof callDeepSeek>>> {
  const req = buildRequest(input, model);
  let lastResult = await callDeepSeek(req);

  for (let attempt = 1; attempt <= maxRetries && !lastResult.ok; attempt++) {
    const err = lastResult.error;
    if (err.kind === 'content_reject') break; // 不重试 4xx
    if (err.kind === 'json_invalid') break; // 不重试 JSON 错

    // 限流：等 Retry-After
    if (err.kind === 'rate_limit' && err.retryAfterMs) {
      await sleep(Math.min(err.retryAfterMs, 30000));
    } else {
      // 超时 / 5xx：指数退避 1s / 2s
      await sleep(1000 * attempt);
    }
    lastResult = await callDeepSeek(req);
  }

  return lastResult;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- 队列管理（PRD §9.9.3 + §15.4.4） ---
/** 写入 ai_parse_queue（高峰期） */
export function enqueueAiParse(input: AiParseTaskInput): number {
  const db = getDb();
  const taskData = JSON.stringify(input);
  const result = db
    .prepare(
      `INSERT INTO ai_parse_queue (status, task_type, task_data, requested_at)
       VALUES ('queued', ?, ?, ?)`
    )
    .run(input.taskType, taskData, Date.now());
  return Number(result.lastInsertRowid);
}

/** 查询队列状态（PRD §14.8 GET /deepseek/queue-status） */
export function getQueueStatus(): {
  queued: number;
  processing: number;
  completed_today: number;
  failed_today: number;
  oldest_queued_at: string | null;
} {
  const db = getDb();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const queued = (db
    .prepare(`SELECT COUNT(*) AS cnt FROM ai_parse_queue WHERE status = 'queued'`)
    .get() as { cnt: number }).cnt;
  const processing = (db
    .prepare(`SELECT COUNT(*) AS cnt FROM ai_parse_queue WHERE status = 'processing'`)
    .get() as { cnt: number }).cnt;
  const completed_today = (db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM ai_parse_queue WHERE status = 'completed' AND processed_at >= ?`
    )
    .get(todayMs) as { cnt: number }).cnt;
  const failed_today = (db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM ai_parse_queue WHERE status = 'failed' AND processed_at >= ?`
    )
    .get(todayMs) as { cnt: number }).cnt;

  const oldest = db
    .prepare(
      `SELECT MIN(requested_at) AS oldest FROM ai_parse_queue WHERE status = 'queued'`
    )
    .get() as { oldest: number | null };

  return {
    queued,
    processing,
    completed_today,
    failed_today,
    oldest_queued_at: oldest.oldest ? new Date(oldest.oldest).toISOString() : null,
  };
}

/** 重试某个失败队列任务（PRD §14.8 POST /deepseek/retry/:queueId） */
export function requeueFailedTask(queueId: number): boolean {
  const db = getDb();
  const task = db
    .prepare(`SELECT id, status FROM ai_parse_queue WHERE id = ?`)
    .get(queueId) as { id: number; status: string } | undefined;
  if (!task) return false;
  if (task.status !== 'failed') return false;

  db.prepare(
    `UPDATE ai_parse_queue SET status = 'queued', retry_count = retry_count + 1, error_log = NULL WHERE id = ?`
  ).run(queueId);
  return true;
}

/** 列出队列任务（PRD §14.9 GET /ai-parse-queue） */
export function listQueueTasks(filters: {
  status?: string;
  taskType?: string;
  page: number;
  pageSize: number;
}): {
  data: Array<{
    id: number;
    status: string;
    taskType: string;
    modelAttempted: string | null;
    requestedAt: string;
    processedAt: string | null;
    retryCount: number;
    errorLog: string | null;
  }>;
  pagination: { page: number; pageSize: number; total: number };
} {
  const { status, taskType, page, pageSize } = filters;
  const offset = (page - 1) * pageSize;
  const db = getDb();

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (taskType) {
    conditions.push('task_type = ?');
    params.push(taskType);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT id, status, task_type, model_attempted, requested_at, processed_at, retry_count, error_log
       FROM ai_parse_queue ${whereClause}
       ORDER BY requested_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as Array<{
    id: number;
    status: string;
    task_type: string;
    model_attempted: string | null;
    requested_at: number;
    processed_at: number | null;
    retry_count: number;
    error_log: string | null;
  }>;

  const total = (db
    .prepare(`SELECT COUNT(*) AS cnt FROM ai_parse_queue ${whereClause}`)
    .get(...params) as { cnt: number }).cnt;

  return {
    data: rows.map((r) => ({
      id: r.id,
      status: r.status,
      taskType: r.task_type,
      modelAttempted: r.model_attempted,
      requestedAt: new Date(r.requested_at).toISOString(),
      processedAt: r.processed_at ? new Date(r.processed_at).toISOString() : null,
      retryCount: r.retry_count,
      errorLog: r.error_log,
    })),
    pagination: { page, pageSize, total },
  };
}

/** 取消队列任务（PRD §14.9 DELETE /ai-parse-queue/:id） */
export function cancelQueueTask(id: number): { deleted: boolean; reason?: string } {
  const db = getDb();
  const task = db
    .prepare(`SELECT id, status FROM ai_parse_queue WHERE id = ?`)
    .get(id) as { id: number; status: string } | undefined;
  if (!task) return { deleted: false, reason: '任务不存在' };
  if (task.status !== 'queued') return { deleted: false, reason: `仅 queued 可取消，当前 ${task.status}` };

  db.prepare(`DELETE FROM ai_parse_queue WHERE id = ?`).run(id);
  return { deleted: true };
}

/** crontab 调用的批量处理（PRD §17.8 process-ai-queue.sh 内部调用） */
export async function processQueuedTasks(): Promise<{
  processed: number;
  completed: number;
  failed: number;
}> {
  const db = getDb();
  const tasks = db
    .prepare(
      `SELECT id, task_type, task_data FROM ai_parse_queue WHERE status = 'queued' ORDER BY requested_at ASC LIMIT 50`
    )
    .all() as Array<{ id: number; task_type: string; task_data: string }>;

  let completed = 0;
  let failed = 0;

  for (const t of tasks) {
    db.prepare(`UPDATE ai_parse_queue SET status = 'processing' WHERE id = ?`).run(t.id);
    try {
      const input = JSON.parse(t.task_data) as AiParseTaskInput;
      const result = await executeAiParseTask(input);

      if (result.ok) {
        db.prepare(
          `UPDATE ai_parse_queue SET status = 'completed', result = ?, processed_at = ? WHERE id = ?`
        ).run(JSON.stringify(result.data), Date.now(), t.id);
        completed++;
      } else {
        db.prepare(
          `UPDATE ai_parse_queue SET status = 'failed', error_log = ?, processed_at = ? WHERE id = ?`
        ).run(`${result.kind}: ${result.message}`, Date.now(), t.id);
        failed++;
      }
    } catch (err) {
      logger.error({ taskId: t.id, err }, 'queue task error');
      db.prepare(
        `UPDATE ai_parse_queue SET status = 'failed', error_log = ?, processed_at = ? WHERE id = ?`
      ).run(err instanceof Error ? err.message : String(err), Date.now(), t.id);
      failed++;
    }
  }

  return { processed: tasks.length, completed, failed };
}