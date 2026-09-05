// 预录 DeepSeek API 响应（成功 + 各类错误），供 deepseek-service / deepseek-client 测试复用
import type {
  DeepSeekCallResult,
  DeepSeekError,
  DeepSeekErrorKind,
  DeepSeekResponse,
} from '../../src/utils/deepseek-client.js';

/** 成功响应：content 为合法 JSON 数组 */
export function successResponse(content?: string): DeepSeekResponse {
  return {
    id: 'chatcmpl-test-0001',
    choices: [
      {
        message: {
          role: 'assistant',
          content:
            content ?? JSON.stringify([{ date: '2026-08-20', amount: 5000, type: 'income' }]),
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

/** 成功响应：content 为 ```json ... ``` 包裹 */
export function successResponseWrappedJson(): DeepSeekResponse {
  return successResponse(
    '```json\n[{"date":"2026-08-20","amount":5000,"type":"income"}]\n```'
  );
}

/** 成功响应：content 非法（非 JSON） */
export function invalidJsonResponse(): DeepSeekResponse {
  return successResponse('this is not json at all');
}

/** ok 结果 */
export function okResult(content?: string): DeepSeekCallResult {
  return { ok: true, response: successResponse(content) };
}

/** 错误结果 */
export function errorResult(kind: DeepSeekErrorKind, overrides?: Partial<DeepSeekError>): DeepSeekCallResult {
  const base: DeepSeekError = {
    kind,
    message: `${kind} error`,
  };
  if (kind === 'rate_limit') {
    base.statusCode = 429;
    base.retryAfterMs = 0; // 测试默认 0，避免真实 sleep
    base.message = 'DeepSeek 429 rate limited';
  }
  if (kind === 'server_error') {
    base.statusCode = 500;
    base.message = 'DeepSeek 500 server error';
  }
  if (kind === 'timeout') {
    base.message = 'DeepSeek timeout';
  }
  if (kind === 'content_reject') {
    base.statusCode = 400;
    base.message = 'content rejected';
  }
  return {
    ok: false,
    error: { ...base, ...overrides },
  };
}

/** 5 类失败兜底对应的错误 kind 集合 */
export const ALL_ERROR_KINDS: DeepSeekErrorKind[] = [
  'rate_limit',
  'timeout',
  'server_error',
  'content_reject',
  'json_invalid',
];
