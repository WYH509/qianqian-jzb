#!/bin/bash
# backup.sh - 每日数据库备份（PRD §17.4）
# 用法：bash deploy/backup.sh（可配 crontab；package.json: npm run backup）
set -euo pipefail

WORK_DIR=/Users/yuhai/Projects/qianqian-jzb
ENV_FILE="$WORK_DIR/.env"
BACKUP_RETENTION_DAYS=30

cd "$WORK_DIR"

# ---- 从 .env 读取配置（带默认值）----
BACKUP_DIR=$(grep -E '^BACKUP_DIR=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_PASSPHRASE=$(grep -E '^BACKUP_PASSPHRASE=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
SEVENZ_BIN=$(grep -E '^SEVENZ_BIN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
SEVENZ_BIN="${SEVENZ_BIN:-7z}"

if [ -z "$BACKUP_PASSPHRASE" ] || [ "$BACKUP_PASSPHRASE" = "__SET_AT_FIRST_DEPLOY__" ]; then
  echo "✗ BACKUP_PASSPHRASE 未设置或仍是占位符（见 $ENV_FILE）" >&2
  exit 1
fi

# 相对路径基于 WORK_DIR 解析
[[ "$BACKUP_DIR" != /* ]] && BACKUP_DIR="$WORK_DIR/$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

TS=$(date +%Y%m%d-%H%M%S)
BACKUP_PATH="$BACKUP_DIR/qianqian-jzb-backup-$TS.7z"

# ---- 加密备份（.env 含密钥，必须加密；package-lock.json 供复现构建）----
"$SEVENZ_BIN" a -t7z -mhe=on -p"$BACKUP_PASSPHRASE" "$BACKUP_PATH" \
  apps/api/qianqian-jzb.db .env package-lock.json

# ---- 清理超过 retention 的旧备份 ----
find "$BACKUP_DIR" -name "qianqian-jzb-backup-*.7z" -mtime +$BACKUP_RETENTION_DAYS -delete

echo "[$(date -Iseconds)] backup created: $BACKUP_PATH"
