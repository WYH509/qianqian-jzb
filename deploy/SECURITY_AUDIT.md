# TP-11 安全审计（2026-09-05）

> 执行者：DeepSeek V4 Pro（TP-10.F 决策加入 modelPolicy）
> 基线：HEAD `fd5e90d`（auth.ts sessions 修复完）
> 审计对象：`apps/api/`（PRD §16 安全方案 8 节）

## 审计范围

8 节 / 27 个源文件（`apps/api/src/` 全部 `.ts`）+ 2 个 migration（`db/migrations/`）+ `.env` / `.env.example`。

图例：✓ 已实现 / ✗ 缺失 / N/A 不适用。

---

## 1. 认证与授权

- [✓] JWT 鉴权中间件，cookie 或 `Authorization: Bearer` 取 token，`jwt.verify` 验签（`apps/api/src/middleware/auth.ts:21-33`）
- [✓] 所有业务路由挂 `authMiddleware`（accounts/transactions/summary/import/export/deepseek/ai-parse-queue 各 `routes/*.ts` 均 `use(authMiddleware)`）
- [✓] 单用户 `username=owner` + `OWNER_PASSWORD` 校验（`apps/api/src/controllers/auth.ts:72-83`）
- [✓] 认证 cookie `httpOnly` + `sameSite: strict` + `secure`（生产）（`apps/api/src/controllers/auth.ts:23-31`）
- [✗] **CSRF 保护缺失**（cookie 鉴权 + 状态变更端点，仅靠 `sameSite: strict` 缓解，无 CSRF token）→ P1
- [✗] **`authMiddleware` 只验 JWT 签名，不校验 sessions 表**（logout 删 session 后 token 仍有效直到 JWT 7d 过期；`middleware/auth.ts:20` 仍有 TODO 标记）→ P1（约束：本任务不改 auth.ts，留待后续）
- [✗] **`/api/v1/internal/process-queue` 无鉴权**（原 `routes/internal.ts:6` 注释声称「HOST=127.0.0.1 限制本机访问」，但实际未实现）→ **P0，已修复**（见 §9）
- [✗] **`index.ts` 未绑定 HOST**（`app.listen(PORT)` 监听 `0.0.0.0`，`.env` 的 `HOST=127.0.0.1` 被忽略）→ P1

## 2. 输入验证

- [✓] 请求体 Zod 校验：accounts（`createAccountSchema`/`updateAccountSchema`）、transactions（`createTransactionSchema`/`updateTransactionSchema`）、imports（`confirmSchema`）、exports/summary/deepseek（query/body schema）
- [✓] 数值范围：`amount > 0`（transactions `.positive()`，`transactions.ts:58`；imports confirm 已补 `.positive()`，`imports.ts:45`）
- [✓] 字符串长度：`name ≤ 20`（`accounts.ts:16`）、`category ≤ 50` / `note ≤ 200`（`transactions.ts:59-61`）、`note ≤ 500`（imports）
- [✓] 日期格式：`YYYY-MM-DD`（transactions `isValidDateStr`、summary/imports/exports regex）
- [✓] 枚举值：`type` enum（accounts `ACCOUNT_TYPES`、transactions `USER_TXN_TYPES`、imports `income|expense`）
- [✓] 未知字段拒绝：transactions `.strict()`、accounts `.refine`（至少一字段）
- [✓] 分页上限：`pageSize` 手动 clamp `≤ 100`（accounts/transactions/imports history）
- [✓] 文件上传大小限制：multer `fileSize: 10MB`（`routes/imports.ts:17-20`）
- [N/A] 无路径参数长度/格式校验（`:id` 用参数化 SQL，无注入风险）

## 3. 输出编码

- [N/A] 纯 JSON API，`res.json` 序列化，无 HTML 模板拼接 → 无反射型 XSS 面
- [✓] xlsx 导出设置正确 `Content-Type` + `Content-Disposition`（`exports.ts:97-105`）
- [N/A] 无 CSV 导出 → 无 CSV 公式注入风险
- [✓] DeepSeek 返回内容仅作数据解析，不回显为 HTML

## 4. 加密传输

- [N/A] 本地单机应用，HTTP `localhost`（无公网监听）；Tailscale Funnel 可提供 TLS，当前 `TAILSCALE_FUNNEL_ENABLED=false`
- [✓] cookie `secure` 标志生产环境开启（`auth.ts:28`）
- [✓] DeepSeek API 走 HTTPS（`https://api.deepseek.com`，`utils/deepseek-client.ts:75`）
- [✓] DB 备份 7z + passphrase 加密（`deploy/backup.sh` + `.env BACKUP_PASSPHRASE`）
- [✗] 无强制 HTTPS 重定向（N/A：本地应用无公网暴露时可不做）→ P3

## 5. 会话管理

- [✓] sessions 表存 `token_hash`（sha256）+ UNIQUE 索引（`db/migrations/V001__init.sql:54-63`）
- [✓] login 写 session / logout 删 session（`controllers/auth.ts:89-114`、`143-156`）
- [✓] JWT `7d` 过期 + cookie `maxAge 7d`（`auth.ts:29`、`87`）
- [✗] **authMiddleware 不校验 sessions 表**（已注销 token 仍有效，与 §1 同源）→ P1
- [✗] 无 session 过期后台清理（`expires_at` 无清理任务）→ P2
- [✗] `SESSION_TTL` 硬编码 7d，无 env 配置（`config.ts` 无 `SESSION_TTL` 项）→ P2

## 6. 审计日志

- [✓] `audit_log` 表（`V001__init.sql:66-82`）：action CHECK、`entity_type/entity_id`、`ip/user_agent`、`created_at`
- [✓] login success / fail（`controllers/auth.ts:121`、`74`、`81`）
- [✓] logout（`controllers/auth.ts:162`、`164`）
- [✓] accounts create/update/delete（`controllers/accounts.ts:240`、`319`、`368`）
- [✓] transactions create/update/delete（`controllers/transactions.ts:348`、`393`、`482`、`550`、`556`）
- [✓] **unauthorized access（本次新增）**：缺失/无效 token 的 401 写审计（`middleware/auth.ts` 两条 401 分支，`error_category='unauthorized_access'`，带 ip/user_agent）
- [✗] `export` 操作未写审计（action `'export'` 在表 CHECK 中但代码未使用）→ P2
- [✗] `ai_parse` 操作未写审计（action `'ai_parse'` 在表 CHECK 中但代码未使用）→ P2
- [✗] import confirm / rollback 未写审计（无 `'import'` action，需迁移，本任务不改 schema）→ P2
- [✗] login/logout 审计的 `ip`/`user_agent` 恒为 null（`controllers/auth.ts:56-57`）→ P3

## 7. 依赖安全

- [✗] 无 `npm audit` 流水线 / 定期依赖扫描 → P2
- [⚠] `xlsx@0.18.5` 为已知有漏洞的旧版本（`apps/api/package.json`），建议升级或评估 → P2
- [N/A] 未引入第三方认证/SDK；依赖面小（express/better-sqlite3/zod/bcrypt/jwt 等主流库）

## 8. 部署安全

- [✓] `.env` gitignored（`.gitignore`）；`.env.example` 不含真实密钥
- [✓] `JWT_SECRET` 64 字符（≥ 32，`config.ts:8` 有 `min(32)` 校验）
- [✓] `DB_PASSPHRASE` 64 字符；备份 7z 加密
- [✗] **`OWNER_PASSWORD` 仅 8 字符（弱口令）** → P1（改长需同步 `.env` 并告知用户新密码）
- [✗] `index.ts` 未绑定 HOST（`0.0.0.0` 暴露，`.env HOST` 被忽略）→ P1
- [✓] `better-sqlite3` 开 `foreign_keys = ON` + WAL（`db/client.ts:10-11`）

---

## 9. 优先级缺口

| 缺口 | 风险 | 优先级 | 状态 |
|---|---|---|---|
| `/api/v1/internal/process-queue` 无鉴权（0.0.0.0 暴露，可触发 DeepSeek 队列消耗配额） | 高 | **P0** | ✅ 已修复（loopback 白名单） |
| 登录无速率限制（口令爆破） | 高 | **P0** | ✅ 已修复（express-rate-limit 5/min/IP） |
| helmet 安全头 | 中 | P0 | ✅ 已有（`index.ts:23`，无需改） |
| 审计日志缺 unauthorized access | 中 | P0 | ✅ 已补（`middleware/auth.ts`） |
| `OWNER_PASSWORD` 8 字符弱口令 | 高 | P1 | ⏳ 待用户改 `.env` |
| authMiddleware 不校验 sessions 表（登出后 token 仍有效） | 中 | P1 | ⏳ 约束不动 auth.ts，留后续 |
| CSRF 保护 | 中 | P1 | ⏳ sameSite=strict 缓解，建议后续加 token |
| `index.ts` 未绑定 HOST（0.0.0.0 暴露） | 中 | P1 | ⏳ 需部署决策（是否仅本机监听） |
| export / ai_parse / import 无审计 | 低 | P2 | ⏳ 待后续 |
| session 过期清理缺失 | 低 | P2 | ⏳ 待后续 |
| 无 npm audit 流水线 / xlsx 旧版本 | 低 | P2 | ⏳ 待后续 |

---

## 本次实现清单（TP-11 P0）

1. **helmet**：已存在（`index.ts:23`），无需改动。
2. **速率限制**：新增 `apps/api/src/middleware/rate-limit.ts`，`/auth/login` 限 5 次/分钟/IP（`express-rate-limit@8.7.0`），挂载于 `routes/auth.ts`。
3. **审计日志**：新增 `apps/api/src/utils/audit.ts` 共享写入器；`middleware/auth.ts` 两条 401 分支补 unauthorized access 审计（带 ip / user_agent）。
4. **internal 端点**：`routes/internal.ts` 加 loopback 白名单（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`），修复无鉴权暴露。
5. **输入验证**：`controllers/imports.ts` confirm schema 的 `amount` 补 `.positive()`（对齐 DB `CHECK (amount > 0)`）。

## 未做（按约束）

- 未改 `controllers/auth.ts`（sessions bug 昨修，不动）。
- 未改 `middleware/auth.ts` 的会话校验逻辑（只加审计写入）。
- 未改 DB schema / migrations / deploy 脚本 / plist。
- 未 commit（main agent review + commit）。
