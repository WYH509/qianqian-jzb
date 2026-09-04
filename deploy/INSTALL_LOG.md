# 部署日志

记录 `deploy/install.sh` 每次运行的尾部输出 + 修复历史。

## 2026-09-04 13:34 — TP-10.E 首次部署

**执行者**：MiniMax M3（Mac mini 直接跑，per 9/3 大海拍板「你自己不能跑吗」）

### install.sh 输出
```
==> npm install
up to date in 394ms
==> npm run build
> @qianqian-jzb/api@0.1.0 build
> tsc
> @qianqian-jzb/web@0.1.0 build
> tsc -b && vite build
vite v5.4.21 building for production...
✓ 52 modules transformed.
✓ built in 581ms
==> npm run migrate
> @qianqian-jzb/api@0.1.0 migrate
> tsx --env-file=../../.env scripts/migrate.ts
[13:32:09] INFO Database connected
[13:32:09] INFO Migration already applied: V001__init
[13:32:09] INFO Migration already applied: V003__create_ai_parse_queue
==> launchctl load /Users/yuhai/Library/LaunchAgents/com.qianqian-jzb.api.plist
Load failed: 5: Input/output error  ← plist 不存在（install.sh 不会自动 cp）
✓ 部署完成                                ← 脚本 false success（没真完成）
```

### 实际部署（我手跑）
```bash
cp deploy/com.qianqian-jzb.api.plist ~/Library/LaunchAgents/
chmod 644 ~/Library/LaunchAgents/com.qianqian-jzb.api.plist
plutil -replace WorkingDirectory -string ".../qianqian-jzb/apps/api" ...
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.qianqian-jzb.api.plist
```

### 关键 bug 修复

| 序 | commit | fix |
|---|---|---|
| 1 | `548bb57` | plist `ProgramArguments` 的 `cd` 从项目根改到 `apps/api`（否则 `./qianqian-jzb.db` 解析到空 DB） |
| 2 | `0108bfd` | plist `WorkingDirectory` 从项目根改到 `apps/api`（同上，launchd 优先看 plist 的 WorkingDirectory） |

### 端到端烟测（全部 ✓）
- POST /auth/login → 200 ✓
- GET /api/v1/accounts → 200（6 个账户）
- POST /api/v1/accounts → 201（新建 e2e-test / e2e-final）
- POST /api/v1/transactions → 201（新建 50 元支出 + 1000 元收入）
- GET /api/v1/deepseek/queue-status → 200
- POST /api/v1/auth/logout → 200

### launchd plist 验证
- cwd: `/Users/yuhai/Projects/qianqian-jzb/apps/api` ✓
- DB: `./qianqian-jzb.db` → `apps/api/qianqian-jzb.db`（正确，7 表）

### 遗留 issue（TP-11 处理）
- ⚠️ `auth.ts` sessions UNIQUE constraint bug：login 返 200 即使 session insert 失败（应该 rollback + 500）
- ⚠️ `install.sh` 不会 cp plist 到 LaunchAgents（要前置 plist 在位才跑得通）
- ⚠️ 旧 14 条 sessions 残留污染（已清）
