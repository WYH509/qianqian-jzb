# 钱钱家账本（Qianqian Jia Zhang Ben）

> 单人本地记账应用 · PRD V2 已完稿 · 2026-08-27 启动开发

## 📚 PRD
- 主文件：`~/Documents/Obsidian/工作/PRD/钱钱家账本/钱钱家账本-PRD.md`（6750 行 / 19 章）
- Plan v2：`~/Documents/Obsidian/工作/PRD/钱钱家账本/钱钱家账本-PRD-Chapter1-17-Plan.md`

## 🚀 快速开始（开发完成后填写）
```bash
cp .env.example .env
# 填入 DEEPSEEK_API_KEY / DB_PASSPHRASE / BACKUP_PASSPHRASE
npm install
npm run migrate          # V001__init.sql → ...
npm run dev              # 本地 dev server @ http://127.0.0.1:3456
```

## 🏗️ 技术栈
- 后端：Node.js v24 + Express + TypeScript
- 数据库：SQLite 3.51（无 ORM，原生 better-sqlite3）
- AI：DeepSeek V4 Flash / V4 Pro（按 PRD §9.8 决策树选型）
- 部署：Tailscale Funnel + 7z 加密备份 + crontab

## 📁 目录结构
```
src/
  db/        数据库连接 + migrations loader
  api/       Express routes
  ai/        DeepSeek 客户端 + §9.8 决策树 + 失败兜底
  utils/     工具函数
  types/     TypeScript 类型定义
db/migrations/   V001__init.sql ...
tests/      unit / integration / e2e
scripts/    部署 / 备份 / 迁移脚本
deploy/     Dockerfile / Tailscale 配置
docs/       PROJECT-STATUS / 变更日志
```

## 🌙 DeepSeek 闲时段策略（PRD §1.7）
| 时段 | 策略 |
|---|---|
| 工作日 00:00-09:00 / 12:00-14:00 / 18:00-24:00 | ✅ 直调 |
| 工作日 09:00-12:00 / 14:00-18:00 | ❌ 入 ai_parse_queue |
| 周末全天 24h | ✅ 直调（v2 新增）|