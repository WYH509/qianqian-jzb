// 统一 fetch 封装：JSON 序列化 + cookie 凭证 + 结构化错误解析。

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** 传入后自动 JSON.stringify 并设置 Content-Type: application/json */
  json?: unknown;
  /** 原始 body（multipart FormData 等）。FormData 时勿手动设 Content-Type（浏览器自动加 boundary） */
  body?: BodyInit | null;
}

interface ApiErrorEnvelope {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractError(data: unknown, status: number): ApiRequestError {
  if (data !== null && typeof data === 'object') {
    const body = data as ApiErrorEnvelope;
    const err = body.error;
    if (err !== null && typeof err === 'object') {
      const code = typeof err.code === 'string' && err.code !== '' ? err.code : 'ERR0000';
      const message =
        typeof err.message === 'string' && err.message !== ''
          ? err.message
          : `请求失败 (HTTP ${status})`;
      return new ApiRequestError(message, code, status, err.details);
    }
  }
  return new ApiRequestError(`请求失败 (HTTP ${status})`, 'ERR0000', status);
}

/**
 * 读浏览器 cookie 的 helper（document.cookie 是 "k1=v1; k2=v2" 格式）。
 * 用于拿 csrf 值塞 X-CSRF-Token header。
 */
function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('(?:^|;\\s*)' + escaped + '=([^;]*)').exec(document.cookie);
  return match ? decodeURIComponent(match[1]!) : undefined;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { json, headers: rawHeaders, body: rawBody, ...init } = options;

  const headers = new Headers(rawHeaders);
  headers.set('Accept', 'application/json');

  let body: BodyInit | null = rawBody ?? null;
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
    // 有 body（json 或 rawBody）且 caller 没显式设 method → 默认 POST
    // 否则 fetch 默认 GET + body → Express 报 "Request has method 'GET' and cannot have a body"
    if (init.method === undefined) {
      (init as RequestInit).method = 'POST';
    }
  }

  // CSRF 保护：双提交 cookie 模式 — 非安全方法必须带 X-CSRF-Token header（值等于 csrf cookie）
  // 后端 verifyCsrf middleware 要求这个 header，否则返回 401 ERR0007
  const method = (init.method ?? (json !== undefined ? 'POST' : 'GET')).toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const csrf = readCookie('csrf');
    if (csrf && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', csrf);
    }
  }

  const res = await fetch(path, { ...init, headers, body, credentials: 'include' });

  // 204 No Content → undefined
  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const data = safeJsonParse(text);

  if (!res.ok) {
    throw extractError(data, res.status);
  }

  if (data === null) {
    return undefined as T;
  }
  return data as T;
}
