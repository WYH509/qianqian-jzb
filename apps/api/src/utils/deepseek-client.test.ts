// utils/deepseek-client.ts 单元测试（mock global fetch：retry / 5 类错误分类 / JSON 提取）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getModelName,
  callDeepSeek,
  parseJsonFromResponse,
} from './deepseek-client.js';
import { successResponse } from '../../tests/fixtures/deepseek-responses.js';

function mockResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers: {
      get: (k: string) => headers[k.toLowerCase()] ?? null,
    },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const req = {
  model: 'deepseek-v4-flash',
  messages: [{ role: 'user' as const, content: 'hello' }],
};

describe('getModelName', () => {
  it('flash / pro 映射', () => {
    expect(getModelName('flash')).toBe('deepseek-v4-flash');
    expect(getModelName('pro')).toBe('deepseek-v4-pro');
  });
});

describe('callDeepSeek — 错误分类', () => {
  it('200 成功 → ok + response', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, successResponse()));
    const res = await callDeepSeek(req);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.response.choices[0]?.message.content).toContain('income');
    }
  });

  it('429 → rate_limit（含 retry-after 头）', async () => {
    fetchMock.mockResolvedValue(mockResponse(429, {}, { 'retry-after': '2' }));
    const res = await callDeepSeek(req);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('rate_limit');
      expect(res.error.retryAfterMs).toBe(2000);
    }
  });

  it('429 无 retry-after 头 → 默认 5000ms', async () => {
    fetchMock.mockResolvedValue(mockResponse(429, {}));
    const res = await callDeepSeek(req);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.retryAfterMs).toBe(5000);
    }
  });

  it('5xx → server_error', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, {}));
    const res = await callDeepSeek(req);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('server_error');
      expect(res.error.statusCode).toBe(500);
    }
  });

  it('4xx（非 429）→ content_reject', async () => {
    fetchMock.mockResolvedValue(mockResponse(400, 'bad request'));
    const res = await callDeepSeek(req);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('content_reject');
      expect(res.error.statusCode).toBe(400);
    }
  });

  it('AbortError → timeout', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const res = await callDeepSeek(req);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('timeout');
    }
  });

  it('网络异常 → server_error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await callDeepSeek(req);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('server_error');
    }
  });
});

describe('parseJsonFromResponse', () => {
  it('直接 JSON', () => {
    expect(parseJsonFromResponse('{"a":1}')).toEqual({ ok: true, data: { a: 1 } });
  });

  it('```json 代码块包裹', () => {
    expect(parseJsonFromResponse('```json\n{"a":1}\n```')).toEqual({ ok: true, data: { a: 1 } });
  });

  it('``` 无语言标注代码块', () => {
    expect(parseJsonFromResponse('```\n[1,2,3]\n```')).toEqual({ ok: true, data: [1, 2, 3] });
  });

  it('非法 JSON → ok:false + rawContent', () => {
    const r = parseJsonFromResponse('not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rawContent).toBe('not json');
  });

  it('代码块内仍是非法 JSON → ok:false', () => {
    const r = parseJsonFromResponse('```json\nnot-json\n```');
    expect(r.ok).toBe(false);
  });
});
