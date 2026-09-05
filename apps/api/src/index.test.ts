// index.ts 测试（TP-11 P1#4：显式绑 HOST）
// 不真 listen 端口：mock express，拦截 app.listen 并断言 HOST 参数被正确传递。
import { describe, it, expect, vi } from 'vitest';

const { appMock } = vi.hoisted(() => {
  const appMock = {
    use: vi.fn(),
    get: vi.fn(),
    listen: vi.fn(),
  };
  return { appMock };
});

vi.mock('express', async (importOriginal) => {
  const actual: any = await importOriginal();
  // 只替换默认导出（express()）为 mock app，其余命名导出（Router/json 等）保留原实现，
  // 避免 routes 里 `import { Router } from 'express'` 报错。
  const express: any = () => appMock;
  express.json = actual.json;
  return { ...actual, default: express };
});

describe('index.ts（TP-11 P1#4：显式绑 HOST）', () => {
  it('app.listen 显式传入 HOST=127.0.0.1（不裸 listen 到 0.0.0.0）', async () => {
    // import 触发模块顶层的 app.listen(...)，mock 拦截，不占端口。
    await import('./index.js');

    expect(appMock.listen).toHaveBeenCalledTimes(1);
    const [port, host, callback] = appMock.listen.mock.calls[0];
    expect(port).toBe(3456);
    expect(host).toBe('127.0.0.1');
    expect(callback).toBeTypeOf('function');
  });
});
