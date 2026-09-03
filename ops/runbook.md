# 钱钱家账本 — 运维手册（Runbook）

> 故障排查 + 监控指标 + 灾难恢复。生产部署方式见 `README.md`「## 部署」。

## 常见问题

### 1. API 起不来 / 端口冲突

- **症状**：`launchctl load` 失败 / `bind: EADDRINUSE`
- **查**：`lsof -i :3456`
- **修**：杀占用进程或改 `.env` 的 PORT

### 2. 数据库 migration 失败

- **症状**：install.sh 在 `npm run migrate` 报错
- **查**：`apps/api/qianqian-jzb.db` 文件权限 + `.env` 的 `DB_PASSPHRASE` 是否设了
- **修**：`chmod 600 apps/api/qianqian-jzb.db`，确认 .env 三个 secret 长度都是 64 字符

### 3. 登录失败 / token 过期

- **症状**：POST /auth/login 返 401
- **查**：`.env` 的 `JWT_SECRET` 是否被改过 / cookie 是否被禁用
- **修**：清浏览器 cookie 重试，或 `bash deploy/restart.sh`

### 4. launchd 频繁重启（KeepAlive 触发）

- **症状**：日志里看到反复 "restarted"
- **查**：`tail logs/api-stderr.log` 看错误堆栈
- **修**：ThrottleInterval 已 10s，正常应该不会频繁重启；如果还频繁，看 stderr 根因

### 5. 备份失败

- **症状**：backup.sh exit code 非零
- **查**：`$BACKUP_DIR` 是否存在 / 7z 是否装了 / `BACKUP_PASSPHRASE` 是否配了
- **修**：`brew install sevenzip` + 检查 .env

### 6. DeepSeek API 调用失败

- **症状**：`/api/v1/import/ai-parse` 返 content_reject / 401
- **查**：`.env` 的 `DEEPSEEK_API_KEY` 是不是 placeholder
- **修**：paste 真 key + `bash deploy/restart.sh`

### 7. 进程假死（端口在但 curl 无响应）

- **症状**：launchd 显示 running，但 HTTP 无响应
- **查**：`launchctl kill SIGTERM gui/$(id -u)/com.qianqian-jzb.api`
- **修**：launchd 10s 后自动重启；或 `launchctl kickstart -k ...` 强制重启

## 监控指标

| 指标 | 命令 |
|---|---|
| API 健康 | `curl http://localhost:3456/health` |
| 进程状态 | `launchctl list \| grep qianqian` |
| 数据库大小 | `ls -lh apps/api/qianqian-jzb.db` |
| 备份文件数 | `ls -1 backups/ \| wc -l` |
| AI 队列堆积 | `sqlite3 apps/api/qianqian-jzb.db "SELECT COUNT(*) FROM ai_parse_queue WHERE status='queued'"` |
| Cron 日志 | `tail -20 logs/cron-ai-queue.log` |

## 灾难恢复

### 数据库损坏

```bash
# 1. 停 API
launchctl unload ~/Library/LaunchAgents/com.qianqian-jzb.api.plist

# 2. 备份当前 db（防止恢复过程进一步损坏）
cp apps/api/qianqian-jzb.db apps/api/qianqian-jzb.db.damaged

# 3. 从最近的备份恢复
BACKUP=$(ls -t backups/qianqian-jzb-backup-*.7z | head -1)
7z x -p"$BACKUP_PASSPHRASE" -o/tmp/qianqian-restore "$BACKUP"
cp /tmp/qianqian-restore/apps/api/qianqian-jzb.db apps/api/

# 4. 跑 migrate（幂等，会跳过已应用的）
cd apps/api && npm run migrate

# 5. 启动 API
launchctl load ~/Library/LaunchAgents/com.qianqian-jzb.api.plist
```

### .env 丢失

```bash
# .env 不在 git（被 .gitignore 排除），必须手动重建
# 找最近的备份（备份里包含 .env）
BACKUP=$(ls -t backups/qianqian-jzb-backup-*.7z | head -1)
7z x -p"$OLD_BACKUP_PASSPHRASE" -o/tmp/qianqian-restore "$BACKUP"
cat /tmp/qianqian-restore/.env
# 用找到的 DEEPSEEK_API_KEY + 重新生成 3 个 passphrase
```
