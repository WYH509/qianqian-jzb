#!/bin/bash
# install.sh - 钱钱家账本 首次部署（PRD §17.3）
# 用法：bash deploy/install.sh
# 前置：com.qianqian-jzb.api.plist 已就位于 ~/Library/LaunchAgents/（本仓库 deploy/ 下有同名源文件）
set -euo pipefail

REPO_DIR="/Users/yuhai/Projects/qianqian-jzb"
PLIST="$HOME/Library/LaunchAgents/com.qianqian-jzb.api.plist"

# 1. 前置检查：OpenClaw 配置存在（API 依赖 OpenClaw 环境变量与密钥）
if [ ! -f "$HOME/.openclaw/openclaw.json" ]; then
  echo "✗ $HOME/.openclaw/openclaw.json 不存在（首次部署需要 OpenClaw）" >&2
  exit 1
fi

# 2. 前置检查：node >= 20
NODE_MAJOR="$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)"
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 20 ]; then
  echo "✗ 需要 node >= 20（当前：$(node --version 2>/dev/null || echo 未安装)）" >&2
  exit 1
fi

# 3. 拒绝覆盖：已存在的 launchd plist
if [ -e "$PLIST" ]; then
  echo "✗ $PLIST 已存在，拒绝覆盖。" >&2
  echo "  如需重装：先 launchctl unload $PLIST 并删除文件，再重跑本脚本" >&2
  exit 1
fi

# 3.5 plist 同步到 LaunchAgents（用 source 覆盖，避免 install.sh 之前的隐式假设）
mkdir -p "$HOME/Library/LaunchAgents"
if [ ! -e "$PLIST" ]; then
  echo "==> cp $REPO_DIR/deploy/com.qianqian-jzb.api.plist $PLIST"
  cp "$REPO_DIR/deploy/com.qianqian-jzb.api.plist" "$PLIST"
  chmod 644 "$PLIST"
  echo "  ✓ plist 复制 + 644 权限"
elif ! diff -q "$REPO_DIR/deploy/com.qianqian-jzb.api.plist" "$PLIST" > /dev/null 2>&1; then
  echo "==> 警告：$PLIST 与 source 不同步"
  echo "    源文件: $REPO_DIR/deploy/com.qianqian-jzb.api.plist"
  echo "    建议：rm '$PLIST' 然后重跑本脚本"
fi

# logs/ 目录（plist 的 StandardOutPath/StandardErrorPath 指向这里）

# 4. 依赖安装 + 构建（apps/api + apps/web）
cd "$REPO_DIR"
echo "==> npm install"
npm install
echo "==> npm run build"
npm run build

# 5. 数据库迁移（V001 + V002 + V003）
cd "$REPO_DIR/apps/api"
echo "==> npm run migrate"
npm run migrate

# 6. 加载 launchd 服务
echo "==> launchctl bootstrap $PLIST"
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo ""
# 验证 API 起来了（curl health 2s 后）
sleep 2
if curl -sf http://localhost:3456/health > /dev/null 2>&1 || curl -s http://localhost:3456/ > /dev/null 2>&1; then
  echo "✓ 部署完成（API 在 :3456 监听）"
  echo "  访问 http://localhost:3456 验证"
  echo "  日志：$REPO_DIR/logs/api-stdout.log / api-stderr.log"
else
  echo "✗ 部署失败：API 没起来"
  echo "  查：launchctl list | grep qianqian"
  echo "  查：tail $REPO_DIR/logs/api-stderr.log"
  exit 1
fi
