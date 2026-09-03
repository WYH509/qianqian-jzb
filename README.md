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

## 部署

钱钱家账本采用自托管部署。开发用 `npm run dev`（热重载），生产用 launchd + node dist/index.js。

### 系统要求

| 组件 | 版本 |
|---|---|
| macOS | 14+ (Apple Silicon) |
| Node.js | 20+ |
| npm | 10+ |
| Homebrew | latest |
| Tailscale | latest（可选，公网访问） |
| 7z | latest（备份） |

### 首次部署

```bash
# 1. 克隆仓库（假设还没 clone）
cd ~/Projects
git clone <repo-url> qianqian-jzb
cd qianqian-jzb

# 2. 配置 .env
cp .env.example .env
# 编辑 .env：
#   DEEPSEEK_API_KEY=<your key>
#   DB_PASSPHRASE=***
#   BACKUP_PASSPHRASE=***
#   JWT_SECRET=***
# （后 3 个可用 openssl rand -hex 32 生成）

# 3. 跑安装脚本（自动 migrate + build + launchd load）
bash deploy/install.sh

# 4. 验证
open http://localhost:3456
```

### 日常运维

```bash
# 重启 API
bash deploy/restart.sh

# 查看日志
tail -f /Users/yuhai/Projects/qianqian-jzb/logs/api-stdout.log
tail -f /Users/yuhai/Projects/qianqian-jzb/logs/api-stderr.log

# 手动备份（脚本默认 7z 加密）
bash deploy/backup.sh

# 查看 launchd 状态
launchctl list | grep qianqian
```

### 公网访问（Tailscale Funnel，可选）

```bash
tailscale funnel --bg --https=443 http://127.0.0.1:18789
tailscale funnel status
# 输出会显示 https://<hostname>.tail<hash>.ts.net
```

### 升级流程

```bash
cd ~/Projects/qianqian-jzb
git pull
bash deploy/restart.sh   # 重启会跑 npm install + build + 重启 API
```

### 卸载

```bash
launchctl unload ~/Library/LaunchAgents/com.qianqian-jzb.api.plist
rm ~/Library/LaunchAgents/com.qianqian-jzb.api.plist
# （数据库 + .env + 备份保留，看你要不要一起删）
```