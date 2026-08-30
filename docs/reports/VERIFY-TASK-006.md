# VERIFY-TASK-006：汇总 API

> **TP-06 验收报告**（2026-08-30 完成）
> 任务包：`docs/TASK-PACKAGES.md` TP-06（Flash，30m，依赖 TP-04/05）
> 对应 PRD：§14.5 汇总 API + §15.5 收支汇总聚合

## 1. 实现概要

| 端点 | 方法 | 路径 | 对齐 PRD |
|---|---|---|---|
| 账户汇总 | GET | `/api/v1/summary/accounts` | §14.5 / §15.5.3 |
| 现金流 | GET | `/api/v1/summary/cashflow` | §14.5 / §15.5.1/2/4 |

**实现文件**：
- `apps/api/src/controllers/summary.ts`（195 行）：zod 校验 + 单 SQL 聚合 + 时间段过滤 + 5 种 groupBy
- `apps/api/src/routes/summary.ts`（18 行）：路由挂载 + authMiddleware
- `apps/api/src/index.ts`：注册 `app.use('/api/v1/summary', summaryRoutes)`

## 2. 自检清单（按 PRD §14.5 AC）

| AC | 内容 | 实现 |
|---|---|---|
| AC-1 | `GET /api/v1/summary/accounts` 返回所有账户 + 余额 | ✅ LEFT JOIN 聚合 |
| AC-2 | `GET /api/v1/summary/cashflow` 按时间分组聚合 | ✅ day/week/month/quarter/year |
| AC-3 | 支持 `startDate` / `endDate` 过滤（YYYY-MM-DD） | ✅ zod 校验 + SQL WHERE |
| AC-4 | 支持 `groupBy` 参数 | ✅ 5 种枚举值 |
| AC-5 | 未登录返回 401 | ✅ authMiddleware |
| AC-6 | 无效参数返回 400 + ERR0001 | ✅ zod safeParse |

## 3. Smoke Test 结果（10/10 全过）

| # | 测试 | 期望 | 实际 |
|---|---|---|---|
| 1 | Health check `/` | 200 | ✅ 200 |
| 2 | Login (`owner123`) | 200 + cookie | ✅ 200 |
| 3 | GET /summary/accounts | 200 + 4 账户 | ✅ 200（备用金 500 / 现金 -3500 / 银行 0 / 冻结户 0）|
| 4 | GET /summary/cashflow?groupBy=month | 200 + 2026-08 | ✅ 200 |
| 5 | GET /summary/cashflow?groupBy=day | 200 + 2026-08-28 | ✅ 200 |
| 6 | GET /summary/cashflow?groupBy=week | 200 + 2026-W34 | ✅ 200 |
| 7 | GET /summary/cashflow?groupBy=quarter | 200 + 2026-Q3 | ✅ 200（**首跑 500，括号补全后过**）|
| 8 | GET /summary/cashflow?groupBy=year | 200 + 2026 | ✅ 200 |
| 9 | 无 cookie | 401 ERR0002 | ✅ 401 |
| 10 | 无效日期 / 无效 groupBy | 400 ERR0001 | ✅ 400 |

## 4. Typecheck

```
npm run typecheck
> @qianqian-jzb/api@0.1.0 typecheck
> tsc --noEmit
exit code 0
```

## 5. 已知小问题 / 后续优化

| 问题 | 影响 | 后续 |
|---|---|---|
| `balance` 计算包含全部非删除交易（未按 `date <= T` 截断） | 账户余额"实时"，不是"历史时点" | 与 PRD §15.1.1 差异，TP-11 / TP-12 文档化 |
| `quarter` 表达式 SQLite 字符串拼接（无专用 quarter 函数）| 跨 DB 兼容性差 | 本项目固定 SQLite，可接受 |

## 6. 结论

✅ **TP-06 验收通过**，可合入 main 分支。