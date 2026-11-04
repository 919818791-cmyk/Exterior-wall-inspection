#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="building-exterior-backend"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

die() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

cd "$ROOT_DIR"

command -v docker >/dev/null 2>&1 || die "缺少命令：docker"
command -v systemctl >/dev/null 2>&1 || die "缺少命令：systemctl"
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "缺少命令：sudo"
  sudo -v
fi

log "停止本项目后端服务"
if systemctl list-unit-files "$SERVICE_NAME.service" --no-legend 2>/dev/null | grep -q "$SERVICE_NAME.service"; then
  as_root systemctl stop "$SERVICE_NAME.service"
else
  log "未安装 $SERVICE_NAME.service，跳过"
fi

log "停止 PostgreSQL、MinIO 和 Redis 容器"
docker compose stop postgres minio redis

log "停止完成"
docker compose ps postgres minio redis
printf '\nNginx 未停止，避免影响同机其他站点。\n'

