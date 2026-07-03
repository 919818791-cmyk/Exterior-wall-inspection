#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="building-exterior-backend"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

cd "$ROOT_DIR"

require_cmd sudo
require_cmd docker

log "Stopping backend systemd service: $SERVICE_NAME"
if systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
  sudo systemctl stop "$SERVICE_NAME" || true
else
  log "Backend service not found, skip"
fi

log "Stopping Docker Compose services: postgres, minio, redis"
sudo docker compose stop postgres minio redis

log "Current Docker Compose status"
sudo docker compose ps

log "Shutdown complete"
