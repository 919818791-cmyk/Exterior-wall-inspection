#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
SERVICE_NAME="building-exterior-backend"
APP_USER="${APP_USER:-$(id -un)}"
BACKEND_WORKERS="${BACKEND_WORKERS:-2}"
SUDO_KEEPALIVE_PID=""

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

die() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

cleanup() {
  if [ -n "$SUDO_KEEPALIVE_PID" ]; then
    kill "$SUDO_KEEPALIVE_PID" 2>/dev/null || true
  fi
}

keep_sudo_alive() {
  if [ "$(id -u)" -eq 0 ]; then
    return
  fi

  # Dependency installation and frontend builds can outlive sudo's normal
  # credential timeout. Refresh only the already-authorized timestamp.
  (
    while true; do
      sleep 50
      sudo -n true 2>/dev/null || exit
    done
  ) &
  SUDO_KEEPALIVE_PID="$!"
}

wait_for_backend() {
  local attempt
  for attempt in $(seq 1 60); do
    if curl --noproxy '*' -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

cd "$ROOT_DIR"
trap cleanup EXIT

require_cmd curl
require_cmd docker
require_cmd npm
require_cmd python3
require_cmd systemctl
if [ "$(id -u)" -ne 0 ]; then
  require_cmd sudo
  sudo -v
  keep_sudo_alive
fi

[ -f "$ROOT_DIR/.env" ] || die "缺少 $ROOT_DIR/.env，请先从 .env.example 创建并填写配置。"
[ -f "$BACKEND_DIR/requirements.txt" ] || die "缺少 backend/requirements.txt。"
[ -f "$FRONTEND_DIR/package-lock.json" ] || die "缺少 frontend/package-lock.json。"

log "启动 PostgreSQL、MinIO 和 Redis"
docker compose up -d --wait --wait-timeout 90 postgres minio redis

if [ ! -x "$BACKEND_DIR/.venv/bin/python" ]; then
  log "创建后端 Python 虚拟环境"
  python3 -m venv "$BACKEND_DIR/.venv"
fi

log "同步后端依赖"
"$BACKEND_DIR/.venv/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"

log "同步前端依赖并构建生产静态文件"
(
  cd "$FRONTEND_DIR"
  npm ci
  npm run build
)

log "安装或更新后端 systemd 服务"
as_root tee "/etc/systemd/system/$SERVICE_NAME.service" >/dev/null <<EOF
[Unit]
Description=Building Exterior Backend
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$BACKEND_DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=$BACKEND_DIR/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers $BACKEND_WORKERS
Restart=always
RestartSec=5
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
EOF
as_root systemctl daemon-reload
as_root systemctl enable "$SERVICE_NAME.service" >/dev/null

log "执行数据库迁移和连接检查"
# Keep the currently running backend online until migrations have succeeded.
# If a migration fails, set -e stops here and the old process remains usable.
(
  cd "$BACKEND_DIR"
  "$BACKEND_DIR/.venv/bin/alembic" upgrade head
  "$BACKEND_DIR/.venv/bin/python" -m app.db.check_connection
)

if command -v nginx >/dev/null 2>&1; then
  log "在重启后端前检查 Nginx 配置、临时目录和静态文件权限"
  as_root python3 "$ROOT_DIR/deploy/check-nginx.py"
fi

log "重启后端以加载最新版代码"
as_root systemctl restart "$SERVICE_NAME.service"

if command -v nginx >/dev/null 2>&1 && systemctl list-unit-files nginx.service >/dev/null 2>&1; then
  log "检查并重载 Nginx"
  as_root nginx -t
  as_root systemctl enable --now nginx.service >/dev/null
  as_root systemctl reload nginx.service
else
  log "未检测到 Nginx；后端仍可通过 http://127.0.0.1:8000 访问"
fi

log "等待后端健康检查"
if ! wait_for_backend; then
  as_root systemctl status "$SERVICE_NAME.service" --no-pager || true
  die "后端健康检查超时，请查看：sudo journalctl -u $SERVICE_NAME -n 100 --no-pager"
fi

log "启动完成"
docker compose ps postgres minio redis
printf '\n后端健康检查：http://127.0.0.1:8000/api/health\n'
if systemctl is-active --quiet nginx.service 2>/dev/null; then
  printf '前端入口：http://127.0.0.1/\n'
fi
