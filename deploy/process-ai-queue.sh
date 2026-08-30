#!/bin/bash
# process-ai-queue.sh（PRD §17.8）
# crontab 在 00:00 / 12:00 / 18:00 触发
# 处理 ai_parse_queue 表中 status='queued' 的任务

set -euo pipefail

WORK_DIR="/Users/yuhai/Projects/qianqian-jzb"
LOG_FILE="$WORK_DIR/logs/ai-queue-$(date +%Y%m%d-%H%M%S).log"
DB_PATH="$WORK_DIR/apps/api/qianqian-jzb.db"
API_URL="http://localhost:3456"

mkdir -p "$WORK_DIR/logs"
echo "[$(date -Iseconds)] process-ai-queue.sh start" >> "$LOG_FILE"

# 1. 查询所有 status='queued' 的任务
TASK_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM ai_parse_queue WHERE status='queued';")
echo "[$(date -Iseconds)] found $TASK_COUNT queued tasks" >> "$LOG_FILE"

if [ "$TASK_COUNT" -eq 0 ]; then
  echo "[$(date -Iseconds)] no queued tasks, exit" >> "$LOG_FILE"
  exit 0
fi

# 2. 调用 API endpoint 批量处理（详 §15.4.4 + §17.8）
# 注：实际处理在 apps/api 内 processQueuedTasks() 函数，shell 仅触发入口
RESPONSE=$(curl -s -X POST "$API_URL/api/v1/internal/process-queue" \
  -H "Content-Type: application/json" \
  -d '{}' 2>&1 || echo '{"error":"API not reachable"}')

echo "[$(date -Iseconds)] API response: $RESPONSE" >> "$LOG_FILE"

# 3. 飞书通知大海（按 §17.8 + §17.9）
PROCESSED=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('processed',0))" 2>/dev/null || echo 0)
COMPLETED=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('completed',0))" 2>/dev/null || echo 0)
FAILED=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('failed',0))" 2>/dev/null || echo 0)

NOTIFY_MSG="AI 队列处理完成：处理 $PROCESSED 条 / 完成 $COMPLETED 条 / 失败 $FAILED 条"

if [ "$PROCESSED" -gt 0 ]; then
  echo "[$(date -Iseconds)] notify: $NOTIFY_MSG" >> "$LOG_FILE"
  # 实际通知由 OpenClaw message tool 触发（不在脚本内）
fi

echo "[$(date -Iseconds)] process-ai-queue.sh done" >> "$LOG_FILE"