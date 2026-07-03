#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
SERVICE_NAME="building-exterior-backend"
NGINX_SITE_NAME="building-exterior"
APP_USER="${APP_USER:-$(id -un)}"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

sudo_keepalive() {
  sudo -v
  while true; do
    sudo -n true
    sleep 60
    kill -0 "$$" 2>/dev/null || exit
  done 2>/dev/null &
}

detect_server_names() {
  local ips
  ips="$(
    ip -4 addr show scope global \
      | awk '/inet / {print $2}' \
      | cut -d/ -f1 \
      | grep -Ev '^(127\.|172\.18\.|172\.19\.|198\.18\.)' \
      | tr '\n' ' ' \
      | sed 's/[[:space:]]*$//'
  )"

  if [ -z "$ips" ]; then
    printf '_'
  else
    printf '%s _' "$ips"
  fi
}

env_value() {
  local key="$1"
  if [ ! -f "$ROOT_DIR/.env" ]; then
    return 0
  fi
  awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      print
      exit
    }
  ' "$ROOT_DIR/.env" | sed 's/^["'\'']//; s/["'\'']$//'
}

set_env_value() {
  local key="$1"
  local value="$2"
  local escaped_value
  escaped_value="$(printf '%s' "$value" | sed 's/[&/\]/\\&/g')"

  if grep -qE "^${key}=" "$ROOT_DIR/.env"; then
    sed -i "s/^${key}=.*/${key}=${escaped_value}/" "$ROOT_DIR/.env"
  else
    printf '\n%s=%s\n' "$key" "$value" >>"$ROOT_DIR/.env"
  fi
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempt

  for attempt in $(seq 1 30); do
    if curl --noproxy '*' -fsS "$url" >/dev/null; then
      return 0
    fi
    sleep 1
  done

  echo "Health check failed for $label: $url" >&2
  return 1
}

ensure_frontend_api_base_url() {
  local value
  value="$(env_value VITE_API_BASE_URL)"

  case "$value" in
    ""|"http://127.0.0.1:8000/api"|"http://localhost:8000/api"|"https://127.0.0.1:8000/api"|"https://localhost:8000/api")
      log "Setting VITE_API_BASE_URL=/api for production frontend build"
      set_env_value VITE_API_BASE_URL "/api"
      ;;
    */api|/api)
      log "Using VITE_API_BASE_URL=$value"
      ;;
    *)
      log "Using custom VITE_API_BASE_URL=$value"
      ;;
  esac
}

cd "$ROOT_DIR"

require_cmd sudo
require_cmd docker
require_cmd python3
require_cmd npm
require_cmd curl
require_cmd ip

if [ ! -f "$ROOT_DIR/.env" ]; then
  if [ -f "$ROOT_DIR/.env.example" ]; then
    log "Creating .env from .env.example"
    cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
    set_env_value APP_ENV "production"
    set_env_value DEBUG "false"
    set_env_value VITE_API_BASE_URL "/api"
    cat >&2 <<'EOF'

.env has been created with production-safe frontend defaults.
Please edit /opt/building-exterior/.env before running this script again:

- replace database, MinIO, worker and auth secrets
- set BACKEND_CORS_ORIGINS to your domain or server IP
- set MINIO_ENDPOINT and MINIO_PUBLIC_URL to a browser-accessible address

EOF
    exit 1
  else
    echo "Missing .env and .env.example" >&2
    exit 1
  fi
fi

ensure_frontend_api_base_url

sudo_keepalive

log "Starting PostgreSQL, MinIO and Redis containers"
sudo docker compose up -d postgres minio redis
sudo docker compose ps

log "Installing backend dependencies"
cd "$BACKEND_DIR"
python3 -m venv .venv
# shellcheck disable=SC1091
source "$BACKEND_DIR/.venv/bin/activate"
pip install -r requirements.txt

log "Running database migrations"
alembic upgrade head
python -m app.db.check_connection

log "Installing frontend dependencies and building static assets"
cd "$FRONTEND_DIR"
npm ci
npm run build

log "Installing systemd service: $SERVICE_NAME"
sudo tee "/etc/systemd/system/$SERVICE_NAME.service" >/dev/null <<EOF
[Unit]
Description=Building Exterior Backend
After=network.target docker.service

[Service]
User=$APP_USER
WorkingDirectory=$BACKEND_DIR
ExecStart=$BACKEND_DIR/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

log "Configuring Nginx"
SERVER_NAMES="$(detect_server_names)"
sudo tee "/etc/nginx/sites-available/$NGINX_SITE_NAME" >/dev/null <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $SERVER_NAMES;

    root $FRONTEND_DIR/dist;
    index index.html;
    client_max_body_size 50M;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

sudo ln -sf "/etc/nginx/sites-available/$NGINX_SITE_NAME" "/etc/nginx/sites-enabled/$NGINX_SITE_NAME"
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

log "Opening firewall ports if UFW is active"
if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q '^Status: active'; then
  sudo ufw allow 80/tcp
  sudo ufw allow 9002/tcp
fi

log "Health checks"
wait_for_http http://127.0.0.1:8000/api/health "backend"
wait_for_http http://127.0.0.1/api/health "nginx"

FIRST_IP="$(printf '%s\n' $SERVER_NAMES | grep -Ev '^_$' | head -1 || true)"
if [ -n "$FIRST_IP" ]; then
  wait_for_http "http://$FIRST_IP/api/health" "server IP"
  log "Startup complete: http://$FIRST_IP/"
else
  log "Startup complete: http://127.0.0.1/"
fi
