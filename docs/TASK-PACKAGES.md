# 任务包设计（v1 · 2026-08-27 14:40）

> 为今晚 18:10 起 spawn subagent 准备
> 总时长预算：18:10 - 08:00 = 13h50m（含 30m buffer）

## 全局约束（已锁）
- subagent 模型：deepseek-v4-flash（结构化任务）/ deepseek-v4-pro（debug / 多步推理 / 含图片 / AI 集成）
- 同时 ≤3 个 subagent 并行
- 高峰期前 30 分停止 spawn 新任务（08:30 / 13:30）
- main agent（M3）做测试 / 集成 / 验收；Debug 让 subagent 用 DeepSeek

## 任务包清单

| ID | 内容 | 模型 | 估时 | 依赖 |
|---|---|---|---|---|
| **TP-01** | monorepo 后端工程化（Express 骨架 + 中间件链） | Flash | 30m | — |
| **TP-02** | 数据库迁移系统（V001__init.sql + V003__ai_parse_queue + migrate.ts + 备份） | Flash | 45m | TP-01 |
| **TP-03** | 认证 API（bcrypt + JWT + sessions + 3 端点） | Flash | 45m | TP-02 |
| **TP-04** | 账户 API + 余额计算（5 端点 + Ch15.1 余额公式 + 转账联动） | Flash | 60m | TP-02 |
| **TP-05** | 交易 API + 转账双写（5 端点 + Ch15.2 事务原子性） | Flash | 60m | TP-02 |
| **TP-06** | 汇总 API（2 端点 + CTE 聚合） | Flash | 30m | TP-04,05 |
| **TP-07** | Excel 导入 / 导出（6 端点 + 7 种金额格式 + 6 种日期格式 + Flash AI 解析表头） | Flash | 90m | TP-03,05 |
| **TP-08** | **DeepSeek AI 集成**（决策树 §9.8 + 5 类兜底 §9.9 + 14.8/14.9 端点 + Flash/Pro 路由 + 队列管理） | **Pro** | 120m | TP-02 |
| **TP-09** | 前端 PWA 骨架（5 页面 + API client + 路由 + 认证 UI） | Flash | 120m | TP-03 |
| **TP-10** | crontab + 部署脚本（backup/restore/process-ai-queue.sh + Dockerfile + docker-compose + Tailscale Funnel） | Flash | 60m | TP-02,08 |
| **TP-11** | 审计 + 安全（audit_log 中间件 + 限流 + admin + Ch16 完整） | Flash | 60m | TP-03 |
| **TP-12** | 测试 + 集成（vitest 单测 + supertest 集成 + Playwright e2e + Ch18） | Flash | 60m | TP-04,05,07,08 |

## spawn 顺序（受 ≤3 并行约束）

### 第一批 18:10 起（基础三件套，必须先跑通）
1. **TP-01** monorepo 骨架（Flash，30m）→ 必须先完成
2. **TP-02** DB migrations（Flash，45m）→ 必须先完成
3. **TP-03** 认证 API（Flash，45m）→ 几乎独立

### 第二批 19:30 起（业务 API 集中）
1. **TP-04** 账户 + 余额（Flash，60m）
2. **TP-05** 交易 + 转账（Flash，60m）
3. **TP-11** 审计 + 安全（Flash，60m，可并行）

### 第三批 21:30 起（核心难点 + AI 集成）
1. **TP-08** **DeepSeek AI 集成（Pro，120m）—— 最关键**
2. **TP-07** Excel 导入（Flash，90m）
3. **TP-06** 汇总 API（Flash，30m，并行）

### 第四批 23:00 起（前端 + 部署）
1. **TP-09** 前端骨架（Flash，120m）
2. **TP-10** 部署脚本（Flash，60m）

### 第五批 02:00 起（验收 + 测试）
1. **TP-12** 测试 + 集成（Flash，60m）
2. main agent 做端到端验收

## 关键里程碑（汇报点）

| 时间 | 里程碑 | 汇报 |
|---|---|---|
| 18:40 | TP-01 完成 | 后端 Express 启动 + hello world |
| 19:30 | TP-02 完成 | 6 张表迁移成功 |
| 20:30 | TP-03/04/05 部分完成 | 认证 + 账户 + 交易 API 跑通 |
| 22:30 | TP-06/07/08 完成 | AI 集成 + Excel 解析完成 |
| 00:30 | TP-09/10 完成 | 前端 + 部署脚本就绪 |
| 02:30 | TP-12 完成 | 测试覆盖 |
| 08:00 | main agent 收尾 | 写汇报文档 + git commit |
| 09:00 | 飞书汇报 | 整体进展 + 明晚计划 |

## 决策点（执行中遇到要 main agent 拍板）
- 任何超出 PRD 的设计选择 → 暂停 subagent，问大海
- 任何对 PRD 章节的偏离 → 暂停 subagent，问大海
- 任何 Flash/Pro 模型选择存疑 → 默认 Pro（贵一点保质量）
- Debug 超 30 分钟未果 → spawn 新 subagent 接手