#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
#  Vocab Agent — 一键部署脚本
#  适用于 Ubuntu/Debian VPS，DuckDNS 免费域名 + Caddy 自动 HTTPS
#
#  用法:
#    sudo bash deploy.sh                    # 交互式，引导填写配置
#    sudo bash deploy.sh --skip-env         # 跳过环境变量配置（已有 .env.local）
#
#  前提:
#    - VPS 已开放 80/443 端口（云服务商安全组 + ufw）
#    - 已有 DuckDNS 子域名和 token
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── 颜色 ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

# ── 变量 ─────────────────────────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="vocab-agent"
SERVICE_PORT=3088
CADDYFILE="/etc/caddy/Caddyfile"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
ENV_FILE="${PROJECT_DIR}/.env.local"
MARKER_DIR="/opt/vocab-agent-deploy"
SKIP_ENV=false

# 解析参数
for arg in "$@"; do
  case "$arg" in
    --skip-env) SKIP_ENV=true ;;
    *) warn "未知参数: $arg" ;;
  esac
done

# ── 辅助函数 ─────────────────────────────────────────────────────────────────
command_exists() { command -v "$1" &>/dev/null; }

get_public_ip() {
  curl -4 -s --max-time 10 ifconfig.me 2>/dev/null \
    || curl -4 -s --max-time 10 icanhazip.com 2>/dev/null \
    || curl -4 -s --max-time 10 api.ipify.org 2>/dev/null
}

read_input() {
  local prompt="$1"
  local default="${2:-}"
  local var_name="$3"
  if [ -n "$default" ]; then
    read -rp "$(echo -e "${CYAN}${prompt}${NC} [${default}]: ")" value
    value="${value:-$default}"
  else
    read -rp "$(echo -e "${CYAN}${prompt}${NC}: ")" value
  fi
  eval "$var_name=\"\$value\""
}

read_secret() {
  local prompt="$1"
  local var_name="$2"
  read -rsp "$(echo -e "${CYAN}${prompt}${NC}: ")" value
  echo
  eval "$var_name=\"\$value\""
}

stage_header() {
  echo ""
  echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}  阶段 $1: $2${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
}

# ── 前置检查 ─────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  fail "请使用 sudo 运行此脚本: sudo bash deploy.sh"
fi

if [ ! -f "${PROJECT_DIR}/package.json" ]; then
  fail "未找到 package.json，请在项目根目录运行此脚本"
fi

# 获取实际运行用户（非 root）
SUDO_USER="${SUDO_USER:-$(whoami)}"
ACTUAL_USER="${SUDO_USER}"
ACTUAL_HOME=$(eval echo "~${ACTUAL_USER}")

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Vocab Agent 一键部署                                      ║${NC}"
echo -e "${GREEN}║  DuckDNS + Caddy 自动 HTTPS                                ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
info "项目目录: ${PROJECT_DIR}"
info "运行用户: ${ACTUAL_USER}"

# ══════════════════════════════════════════════════════════════════════════════
#  阶段 1: 环境检查 & 依赖安装
# ══════════════════════════════════════════════════════════════════════════════
stage_header 1 "环境检查 & 依赖安装"

# 检测 OS
if [ ! -f /etc/os-release ]; then
  fail "无法检测操作系统，仅支持 Ubuntu/Debian"
fi
source /etc/os-release
if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
  fail "当前系统为 $ID，仅支持 Ubuntu/Debian"
fi
ok "操作系统: $PRETTY_NAME"

# 更新 apt
info "更新软件包列表..."
apt-get update -qq

# 安装基础工具 + 构建工具链（Tailwind v4 / lightningcss 原生模块需要）
info "安装基础工具和构建依赖..."
apt-get install -y -qq curl git ca-certificates gnupg lsb-release \
  build-essential python3 pkg-config libssl-dev 2>/dev/null

# Node.js
if command_exists node; then
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -ge 20 ]; then
    ok "Node.js $(node -v) 已安装"
  else
    warn "Node.js $(node -v) 版本过低，需要 20+，正在升级..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
    ok "Node.js 已升级到 $(node -v)"
  fi
else
  info "安装 Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  ok "Node.js $(node -v) 已安装"
fi

# npm
if command_exists npm; then
  ok "npm $(npm -v) 已安装"
else
  fail "npm 未安装，请检查 Node.js 安装"
fi

# git
if command_exists git; then
  ok "git $(git --version | awk '{print $3}') 已安装"
else
  info "安装 git..."
  apt-get install -y -qq git
  ok "git 已安装"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  阶段 2: 项目代码准备
# ══════════════════════════════════════════════════════════════════════════════
stage_header 2 "项目代码准备"

cd "$PROJECT_DIR"

# npm install
info "安装项目依赖..."
sudo -u "$ACTUAL_USER" npm install --legacy-peer-deps 2>&1 | tail -5
ok "依赖安装完成"

# npm run build
info "构建项目（webpack，可能需要几分钟）..."
sudo -u "$ACTUAL_USER" npm run build 2>&1 | tail -10
ok "项目构建完成"

# 确保数据目录存在
sudo -u "$ACTUAL_USER" mkdir -p "${PROJECT_DIR}/data"
ok "数据目录已就绪: ${PROJECT_DIR}/data/"

# ══════════════════════════════════════════════════════════════════════════════
#  阶段 3: 环境变量配置
# ══════════════════════════════════════════════════════════════════════════════
stage_header 3 "环境变量配置"

# 加载已有 .env.local
if [ -f "$ENV_FILE" ]; then
  info "检测到已有 .env.local，加载现有配置..."
  # 安全加载（忽略空行和注释）
  set -a
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    # 去除前后引号
    value="${value%\"}" ; value="${value#\"}"
    value="${value%\'}" ; value="${value#\'}"
    export "$key=$value"
  done < "$ENV_FILE"
  set +a
fi

if [ "$SKIP_ENV" = true ]; then
  info "跳过环境变量配置（--skip-env）"
else
  echo ""
  info "请配置以下环境变量（回车保留当前值）:"
  echo ""

  # 讯飞 MaaS API
  read_input "OPENAI_API_KEY (讯飞 MaaS)" "${OPENAI_API_KEY:-}" INPUT_API_KEY
  read_input "OPENAI_BASE_URL" "${OPENAI_BASE_URL:-https://maas-coding-api.cn-huabei-1.xf-yun.com/v2}" INPUT_BASE_URL
  read_input "TEACHER_MODEL" "${TEACHER_MODEL:-xminimaxm25}" INPUT_TEACHER_MODEL
  read_input "DEVELOPER_MODEL" "${DEVELOPER_MODEL:-xopglm5}" INPUT_DEVELOPER_MODEL

  # DuckDNS
  echo ""
  info "DuckDNS 配置（你的免费域名）:"
  read_input "DuckDNS 子域名（不含 .duckdns.org）" "${DUCKDNS_DOMAIN:-}" INPUT_DUCKDNS_DOMAIN
  read_input "DuckDNS Token" "${DUCKDNS_TOKEN:-}" INPUT_DUCKDNS_TOKEN

  # 写入 .env.local
  cat > "$ENV_FILE" << EOF
# 讯飞 MaaS API
OPENAI_API_KEY=${INPUT_API_KEY}
OPENAI_BASE_URL=${INPUT_BASE_URL}
TEACHER_MODEL=${INPUT_TEACHER_MODEL}
DEVELOPER_MODEL=${INPUT_DEVELOPER_MODEL}

# DuckDNS
DUCKDNS_DOMAIN=${INPUT_DUCKDNS_DOMAIN}
DUCKDNS_TOKEN=${INPUT_DUCKDNS_TOKEN}

# Upstash Vector (optional, for Phase 4 RAG)
UPSTASH_VECTOR_REST_URL=
UPSTASH_VECTOR_REST_TOKEN=

# Database path
DATABASE_URL=file:./data/vocab.db
EOF

  chown "$ACTUAL_USER:$ACTUAL_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok ".env.local 已写入（权限 600）"
fi

# 重新加载环境变量
if [ -f "$ENV_FILE" ]; then
  set -a
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    value="${value%\"}" ; value="${value#\"}"
    value="${value%\'}" ; value="${value#\'}"
    export "$key=$value"
  done < "$ENV_FILE"
  set +a
fi

# 验证必要变量
DUCKDNS_DOMAIN="${DUCKDNS_DOMAIN:-}"
DUCKDNS_TOKEN="${DUCKDNS_TOKEN:-}"
if [ -z "$DUCKDNS_DOMAIN" ] || [ -z "$DUCKDNS_TOKEN" ]; then
  fail "DUCKDNS_DOMAIN 和 DUCKDNS_TOKEN 不能为空，请重新运行脚本或手动编辑 .env.local"
fi

ok "环境变量配置完成"
ok "  域名: ${DUCKDNS_DOMAIN}.duckdns.org"

# ══════════════════════════════════════════════════════════════════════════════
#  阶段 4: DuckDNS IP 更新
# ══════════════════════════════════════════════════════════════════════════════
stage_header 4 "DuckDNS IP 更新"

PUBLIC_IP=$(get_public_ip)
if [ -z "$PUBLIC_IP" ]; then
  fail "无法获取 VPS 公网 IP，请检查网络连接"
fi
ok "VPS 公网 IP: ${PUBLIC_IP}"

info "更新 DuckDNS 记录: ${DUCKDNS_DOMAIN}.duckdns.org -> ${PUBLIC_IP}"
DUCKDNS_RESPONSE=$(curl -s "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=${PUBLIC_IP}")
if [ "$DUCKDNS_RESPONSE" = "OK" ]; then
  ok "DuckDNS 更新成功"
else
  warn "DuckDNS 更新返回: ${DUCKDNS_RESPONSE}（可能是 token 无效或域名不存在）"
  warn "继续部署，但 HTTPS 证书可能无法获取"
fi

# 等待 DNS 传播
info "等待 DNS 传播（10 秒）..."
sleep 10

# 验证 DNS 解析
DNS_IP=$(dig +short "${DUCKDNS_DOMAIN}.duckdns.org" A 2>/dev/null | tail -1)
if [ -z "$DNS_IP" ]; then
  # 尝试 nslookup
  DNS_IP=$(nslookup "${DUCKDNS_DOMAIN}.duckdns.org" 2>/dev/null | grep -A1 "Name:" | grep "Address:" | awk '{print $2}')
fi
if [ "$DNS_IP" = "$PUBLIC_IP" ]; then
  ok "DNS 解析验证通过: ${DUCKDNS_DOMAIN}.duckdns.org -> ${DNS_IP}"
else
  warn "DNS 解析结果: ${DNS_IP:-未解析}，期望: ${PUBLIC_IP}"
  warn "DNS 传播可能需要几分钟，Caddy 会在证书获取时重试"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  阶段 5: Caddy 安装 & HTTPS 配置
# ══════════════════════════════════════════════════════════════════════════════
stage_header 5 "Caddy 安装 & HTTPS 配置"

if command_exists caddy; then
  ok "Caddy $(caddy version 2>/dev/null || echo '已安装') 已安装"
else
  info "安装 Caddy..."
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
  ok "Caddy 已安装: $(caddy version 2>/dev/null)"
fi

# 写入 Caddyfile
info "配置 Caddyfile..."
cat > "$CADDYFILE" << EOF
${DUCKDNS_DOMAIN}.duckdns.org {
    reverse_proxy localhost:${SERVICE_PORT}

    # 压缩
    encode gzip

    # 安全头
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        X-XSS-Protection "1; mode=block"
        Referrer-Policy strict-origin-when-cross-origin
    }

    # WebSocket 支持（AI SDK 流式响应）
    # Caddy 默认支持 WebSocket 透传，无需额外配置
}
EOF

ok "Caddyfile 已写入: ${CADDYFILE}"

# 验证 Caddyfile 语法
info "验证 Caddyfile 语法..."
caddy validate --config "$CADDYFILE" --adapter caddyfile 2>&1 | tail -3
ok "Caddyfile 语法验证通过"

# 检查端口占用
if ss -tlnp | grep -q ":80 " && ! ss -tlnp | grep -q "caddy"; then
  warn "80 端口被其他程序占用，Caddy 可能无法获取 HTTPS 证书"
  warn "占用程序: $(ss -tlnp | grep ':80 ' | head -1)"
  warn "请停止占用 80 端口的程序后重新运行: systemctl restart caddy"
fi

# 启动 Caddy
info "启动 Caddy..."
systemctl enable caddy
systemctl restart caddy
sleep 3

if systemctl is-active --quiet caddy; then
  ok "Caddy 运行中"
else
  warn "Caddy 启动异常，查看日志:"
  journalctl -u caddy --no-pager -n 20
  warn "常见原因: 80/443 端口未开放，或 DNS 未解析到本机"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  阶段 6: Next.js 服务配置
# ══════════════════════════════════════════════════════════════════════════════
stage_header 6 "Next.js 服务配置"

# 运行数据库迁移
info "运行数据库迁移..."
cd "$PROJECT_DIR"
sudo -u "$ACTUAL_USER" -- bash -c "cd ${PROJECT_DIR} && npm run db:migrate" 2>&1 | tail -5
ok "数据库迁移完成"

# 创建 systemd service
info "配置 systemd 服务..."
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Vocab Agent - 自进化英语学习 AI
After=network.target

[Service]
Type=simple
User=${ACTUAL_USER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=$(which node) node_modules/.bin/next start -p ${SERVICE_PORT}
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=${ENV_FILE}

# 安全限制
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${PROJECT_DIR}/data ${PROJECT_DIR}/generated ${PROJECT_DIR}/src/components/generated ${PROJECT_DIR}/src/app/api

[Install]
WantedBy=multi-user.target
EOF

ok "systemd 服务文件已写入: ${SERVICE_FILE}"

# 重载 systemd
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# 停止旧实例（如有）
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  info "停止旧服务..."
  systemctl stop "$SERVICE_NAME"
fi

# 启动服务
info "启动 ${SERVICE_NAME}..."
systemctl start "$SERVICE_NAME"
sleep 5

if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "${SERVICE_NAME} 运行中 (PID: $(systemctl show --property=MainPID --value ${SERVICE_NAME}))"
else
  warn "服务启动异常，查看日志:"
  journalctl -u "$SERVICE_NAME" --no-pager -n 30
  fail "服务启动失败，请检查上方日志"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  部署验证
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  部署验证${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"

FULL_DOMAIN="${DUCKDNS_DOMAIN}.duckdns.org"

# 检查本地服务
info "检查本地服务..."
LOCAL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${SERVICE_PORT}" 2>/dev/null || echo "000")
if [ "$LOCAL_STATUS" != "000" ]; then
  ok "本地服务响应: HTTP ${LOCAL_STATUS}"
else
  warn "本地服务无响应，Next.js 可能还在启动中"
fi

# 检查 HTTPS
info "检查 HTTPS 访问..."
HTTPS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://${FULL_DOMAIN}" --max-time 15 2>/dev/null || echo "000")
if [ "$HTTPS_STATUS" != "000" ]; then
  ok "HTTPS 访问成功: HTTP ${HTTPS_STATUS}"
else
  warn "HTTPS 暂时不可用（证书申请可能需要 1-2 分钟）"
  warn "请稍后手动检查: curl -I https://${FULL_DOMAIN}"
fi

# 检查证书
info "检查 SSL 证书..."
CERT_INFO=$(echo | openssl s_client -servername "$FULL_DOMAIN" -connect "$FULL_DOMAIN:443" 2>/dev/null | openssl x509 -noout -subject -dates 2>/dev/null || echo "")
if [ -n "$CERT_INFO" ]; then
  ok "SSL 证书信息:"
  echo "$CERT_INFO" | sed 's/^/  /'
else
  warn "SSL 证书尚未就绪，Caddy 正在自动申请中..."
  warn "查看 Caddy 日志: journalctl -u caddy -f"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  部署完成
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  部署完成!                                                  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  访问地址: ${CYAN}https://${FULL_DOMAIN}${NC}"
echo ""
echo -e "  ${YELLOW}常用命令:${NC}"
echo "    查看服务状态:  systemctl status ${SERVICE_NAME}"
echo "    查看服务日志:  journalctl -u ${SERVICE_NAME} -f"
echo "    查看 Caddy 日志: journalctl -u caddy -f"
echo "    重启服务:      systemctl restart ${SERVICE_NAME}"
echo "    更新代码:      bash deploy-update.sh"
echo ""
echo -e "  ${YELLOW}注意事项:${NC}"
echo "    1. 首次访问可能需要 1-2 分钟等待 HTTPS 证书签发"
echo "    2. 如果浏览器提示不安全，请等待 1 分钟后刷新"
echo "    3. VPS IP 变化时运行: bash deploy-duckdns-update.sh"
echo "    4. 建议设置 cron 定时更新 DuckDNS: bash deploy-duckdns-update.sh --install-cron"
echo ""
