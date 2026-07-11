#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
#  Vocab Agent — DuckDNS IP 定时更新脚本
#  VPS 公网 IP 可能变化，需定期通知 DuckDNS 更新解析
#
#  用法:
#    bash deploy-duckdns-update.sh              # 立即更新一次
#    bash deploy-duckdns-update.sh --install-cron  # 安装 cron 定时任务（每 5 分钟）
#    bash deploy-duckdns-update.sh --uninstall-cron # 卸载 cron 定时任务
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
ENV_FILE="${PROJECT_DIR}/.env.local"
DUCKDNS_CACHE="/tmp/vocab-agent-duckdns-ip"
CRON_MARKER="# vocab-agent-duckdns-update"

# 加载环境变量
if [ ! -f "$ENV_FILE" ]; then
  fail "未找到 .env.local，请先运行 deploy.sh"
fi

set -a
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  value="${value%\"}" ; value="${value#\"}"
  value="${value%\'}" ; value="${value#\'}"
  export "$key=$value"
done < "$ENV_FILE"
set +a

DUCKDNS_DOMAIN="${DUCKDNS_DOMAIN:-}"
DUCKDNS_TOKEN="${DUCKDNS_TOKEN:-}"

if [ -z "$DUCKDNS_DOMAIN" ] || [ -z "$DUCKDNS_TOKEN" ]; then
  fail ".env.local 中缺少 DUCKDNS_DOMAIN 或 DUCKDNS_TOKEN"
fi

# ── 更新函数 ─────────────────────────────────────────────────────────────────
update_duckdns() {
  # 获取公网 IP
  PUBLIC_IP=$(curl -4 -s --max-time 10 ifconfig.me 2>/dev/null \
    || curl -4 -s --max-time 10 icanhazip.com 2>/dev/null \
    || curl -4 -s --max-time 10 api.ipify.org 2>/dev/null)

  if [ -z "$PUBLIC_IP" ]; then
    warn "无法获取公网 IP，跳过本次更新"
    return 1
  fi

  # 检查 IP 是否变化（避免无谓请求）
  if [ -f "$DUCKDNS_CACHE" ]; then
    CACHED_IP=$(cat "$DUCKDNS_CACHE" 2>/dev/null)
    if [ "$CACHED_IP" = "$PUBLIC_IP" ]; then
      info "IP 未变化 (${PUBLIC_IP})，跳过更新"
      return 0
    fi
  fi

  # 调用 DuckDNS API
  info "更新 DuckDNS: ${DUCKDNS_DOMAIN}.duckdns.org -> ${PUBLIC_IP}"
  RESPONSE=$(curl -s "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=${PUBLIC_IP}")

  if [ "$RESPONSE" = "OK" ]; then
    echo "$PUBLIC_IP" > "$DUCKDNS_CACHE"
    ok "DuckDNS 更新成功: ${DUCKDNS_DOMAIN}.duckdns.org -> ${PUBLIC_IP}"
    return 0
  else
    warn "DuckDNS 更新失败: ${RESPONSE}"
    return 1
  fi
}

# ── 参数处理 ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  --install-cron)
    SCRIPT_PATH="$(readlink -f "$0")"
    CRON_LINE="*/5 * * * * ${SCRIPT_PATH} >> /var/log/duckdns-update.log 2>&1 ${CRON_MARKER}"

    # 检查是否已安装
    if crontab -l 2>/dev/null | grep -q "$CRON_MARKER"; then
      ok "Cron 任务已存在，无需重复安装"
    else
      # 添加到当前用户的 crontab
      (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
      ok "Cron 任务已安装: 每 5 分钟更新 DuckDNS"
      info "日志文件: /var/log/duckdns-update.log"
    fi
    ;;

  --uninstall-cron)
    if crontab -l 2>/dev/null | grep -q "$CRON_MARKER"; then
      crontab -l 2>/dev/null | grep -v "$CRON_MARKER" | crontab -
      ok "Cron 任务已卸载"
    else
      info "未找到 DuckDNS cron 任务"
    fi
    ;;

  *)
    # 默认：立即更新一次
    update_duckdns
    ;;
esac
