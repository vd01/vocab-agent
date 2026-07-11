#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
#  Vocab Agent — 更新部署脚本
#  拉取最新代码、重新构建、重启服务
#
#  用法:
#    bash deploy-update.sh              # 拉取代码 + 构建 + 重启
#    bash deploy-update.sh --no-pull    # 不拉取代码，仅构建 + 重启
#    bash deploy-update.sh --no-build   # 仅拉取 + 重启（不重新构建）
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="vocab-agent"

DO_PULL=true
DO_BUILD=true

for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=false ;;
    --no-build) DO_BUILD=false ;;
    *) warn "未知参数: $arg" ;;
  esac
done

cd "$PROJECT_DIR"

echo ""
echo -e "${CYAN}── Vocab Agent 更新 ──${NC}"
echo ""

# 1. 拉取代码
if [ "$DO_PULL" = true ]; then
  if [ -d ".git" ]; then
    info "拉取最新代码..."
    git pull --ff-only || fail "git pull 失败，可能有本地修改冲突"
    ok "代码已更新"
  else
    warn "非 git 仓库，跳过代码拉取"
  fi
else
  info "跳过代码拉取（--no-pull）"
fi

# 2. 安装依赖
info "检查依赖更新..."
npm install --legacy-peer-deps 2>&1 | tail -5
ok "依赖安装完成"

# 3. 构建
if [ "$DO_BUILD" = true ]; then
  info "构建项目..."
  npm run build 2>&1 | tail -10
  ok "项目构建完成"
else
  info "跳过构建（--no-build）"
fi

# 4. 数据库迁移
info "运行数据库迁移..."
npm run db:migrate 2>&1 | tail -5 || warn "数据库迁移可能有警告（表已存在属正常）"

# 5. 重启服务
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  info "重启 ${SERVICE_NAME}..."
  sudo systemctl restart "$SERVICE_NAME"
  sleep 3
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "${SERVICE_NAME} 已重启"
  else
    fail "服务重启失败，查看日志: journalctl -u ${SERVICE_NAME} -n 30"
  fi
else
  info "服务未运行，启动 ${SERVICE_NAME}..."
  sudo systemctl start "$SERVICE_NAME"
  sleep 3
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "${SERVICE_NAME} 已启动"
  else
    fail "服务启动失败，查看日志: journalctl -u ${SERVICE_NAME} -n 30"
  fi
fi

# 6. 验证
LOCAL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3088" 2>/dev/null || echo "000")
if [ "$LOCAL_STATUS" != "000" ]; then
  ok "服务响应正常: HTTP ${LOCAL_STATUS}"
else
  warn "服务暂无响应，可能正在启动中"
fi

echo ""
ok "更新完成!"
