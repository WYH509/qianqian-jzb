# deploy/ 目录说明

## 文件说明

| 文件 | 用途 |
|---|---|
| `install.sh` | 首次部署（migrate + build + launchd load） |
| `restart.sh` | 重启 API |
| `backup.sh` | 数据库备份（7z 加密） |
| `migrate.sh` | 仅跑 migration（不依赖 launchd） |
| `process-ai-queue.sh` | crontab 触发，处理 AI 解析队列 |
| `com.qianqian-jzb.api.plist` | launchd plist（源文件，安装至 `~/Library/LaunchAgents/`） |

## 安装顺序

`install.sh` 会自动按这个顺序跑：

1. `npm install`
2. `npm run build`（apps/api + apps/web）
3. `cd apps/api && npm run migrate`
4. `launchctl load ~/Library/LaunchAgents/com.qianqian-jzb.api.plist`

## 不在 deploy/ 的配置

- `~/Library/LaunchAgents/com.qianqian-jzb.api.plist`（launchd plist 真实安装位置）
- `.env`（项目根，密钥）
- `backups/`（项目根，备份目录）

## Crontab

`process-ai-queue.sh` 由系统 crontab 触发（不通过 OpenClaw）：

```bash
crontab -e
# 每天 0/12/18 点各跑一次
0 0,12,18 * * * /Users/yuhai/Projects/qianqian-jzb/deploy/process-ai-queue.sh >> /Users/yuhai/Projects/qianqian-jzb/logs/cron-ai-queue.log 2>&1
```
