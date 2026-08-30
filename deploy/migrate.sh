#!/bin/bash
# deploy/migrate.sh — 迁移前自动备份（PRD §17.4）
set -e

DATE=$(date +%Y-%m-%d)
DB_PATH="${DB_PATH:-./qianqian-jzb.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}"

mkdir -p "$BACKUP_DIR"

if [ -f "$DB_PATH" ]; then
  if [ -n "$BACKUP_PASSPHRASE" ]; then
    7z a -t7z -mhe=on -p"$BACKUP_PASSPHRASE" "$BACKUP_DIR/ledger-pre-migration-${DATE}.db.7z" "$DB_PATH"
    echo "✓ 加密备份完成: $BACKUP_DIR/ledger-pre-migration-${DATE}.db.7z"
  else
    cp "$DB_PATH" "$BACKUP_DIR/ledger-pre-migration-${DATE}.db"
    echo "✓ 明文备份完成: $BACKUP_DIR/ledger-pre-migration-${DATE}.db"
  fi
else
  echo "⚠ DB 文件不存在，跳过备份: $DB_PATH"
fi

echo "✓ 备份完成，开始执行迁移..."
cd "$(dirname "$0")/.."
npx tsx apps/api/scripts/migrate.ts
echo "✓ 迁移完成"