// DeepSeek API HTTP client（PRD §15.4.0 + §9.8）
// 最小实现：POST /v1/chat/completions，含超时 + Retry-After 解析
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export type DeepSeekModel = 'flash' | 'pro';

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeepSeekRequest {
  model: string;
  messages: DeepSeekMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
}

export interface DeepSeekResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export type DeepSeekErrorKind =
  | 'rate_limit' // 429
  | 'timeout' // timeout
  | 'server_error' // 5xx
  | 'content_reject' // 4xx (其他)
  | 'json_invalid'; // 200 但 JSON 无效

export interface DeepSeekError {
  kind: DeepSeekErrorKind;
  statusCode?: number;
  retryAfterMs?: number;
  message: string;
  response?: unknown;
}

export interface DeepSeekResult {
  ok: true;
  response: DeepSeekResponse;
}

export interface DeepSeekFail {
  ok: false;
  error: DeepSeekError;
}

export type DeepSeekCallResult = DeepSeekResult | DeepSeekFail;

/** DeepSeek API 模型名映射 */
export function getModelName(model: DeepSeekModel): string {
  return model === 'pro'
    ? config.DEEPSEEK_MODEL_PRO
    : config.DEEPSEEK_MODEL_FLASH;
}

/**
 * 调 DeepSeek chat completions（带超时）
 */
export async function callDeepSeek(
  req: DeepSeekRequest,
  timeoutMs: number = config.DEEPSEEK_TIMEOUT_MS
): Promise<DeepSeekCallResult> {
  const url = `${config.DEEPSEEK_BASE_URL.replace(/\/$/, '')}/v1/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after');
      const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 5000;
      return {
        ok: false,
        error: {
          kind: 'rate_limit',
          statusCode: 429,
          retryAfterMs,
          message: `DeepSeek 429 rate limited, retry after ${retryAfterMs}ms`,
        },
      };
    }

    if (res.status >= 500) {
      return {
        ok: false,
        error: {
          kind: 'server_error',
          statusCode: res.status,
          message: `DeepSeek ${res.status} server error`,
        },
      };
    }

    if (res.status >= 400) {
      const text = await res.text();
      return {
        ok: false,
        error: {
          kind: 'content_reject',
          statusCode: res.status,
          message: `DeepSeek ${res.status} content rejected: ${text.slice(0, 200)}`,
          response: text,
        },
      };
    }

    // 200 OK
    const data = (await res.json()) as DeepSeekResponse;
    return { ok: true, response: data };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        ok: false,
        error: {
          kind: 'timeout',
          message: `DeepSeek timeout after ${timeoutMs}ms`,
        },
      };
    }
    logger.warn({ err }, 'DeepSeek call unexpected error');
    return {
      ok: false,
      error: {
        kind: 'server_error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
    };
  }
}

/**
 * 从 DeepSeek 响应提取 JSON（带 JSON 校验）
 */
export function parseJsonFromResponse(content: string): {
  ok: true;
  data: unknown;
} | {
  ok: false;
  rawContent: string;
} {
  // 尝试直接 parse
  try {
    return { ok: true, data: JSON.parse(content) };
  } catch {
    // 尝试提取 ```json ... ``` 块
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match && match[1]) {
      try {
        return { ok: true, data: JSON.parse(match[1].trim()) };
      } catch {
        return { ok: false, rawContent: content };
      }
    }
    return { ok: false, rawContent: content };
  }
}