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

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { json, headers: rawHeaders, body: rawBody, ...init } = options;

  const headers = new Headers(rawHeaders);
  headers.set('Accept', 'application/json');

  let body: BodyInit | null = rawBody ?? null;
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
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
