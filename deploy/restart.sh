#!/bin/bash
# restart.sh - 重启 API（PRD §17.5）
# 用法：bash deploy/restart.sh
set -euo pipefail

LABEL="gui/$(id -u)/com.qianqian-jzb.api"
PLIST="$HOME/Library/LaunchAgents/com.qianqian-jzb.api.plist"
HEALTH_URL="http://localhost:3456/health"

# 1. launchd reload：优先 kickstart -k，失败则回退 unload + load
if ! launchctl kickstart -k "$LABEL" 2>/dev/null; then
  echo "==> kickstart 失败，回退 unload + load"
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
fi

# 2. 等 2 秒后做 health check
sleep 2
if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
  echo "✓ API 已重启，health check 通过：$HEALTH_URL"
  exit 0
else
  echo "✗ API 启动失败或未就绪：$HEALTH_URL 无响应" >&2
  echo "  查看日志：/Users/yuhai/Projects/qianqian-jzb/logs/api-stderr.log" >&2
  exit 1
fi
