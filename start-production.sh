#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
SERVICE_NAME="building-exterior-backend"
NGINX_SITE_NAME="building-exterior"
APP_USER="${APP_USER:-$(id -un)}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
NGINX_ONLY=false

case "${1:-}" in
  "")
    ;;
  --nginx-only)
    NGINX_ONLY=true
    ;;
  *)
    echo "Usage: $0 [--nginx-only]" >&2
    exit 2
    ;;
esac

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
  local env_file

  # Keep production-only overrides (especially server-side credentials) out of
  # the shared .env file. Vite applies the same .env.local-over-.env priority.
  for env_file in "$ROOT_DIR/.env.local" "$ROOT_DIR/.env"; do
    if [ ! -f "$env_file" ]; then
      continue
    fi
    awk -F= -v key="$key" '
      $0 !~ /^[[:space:]]*#/ && $1 == key {
        sub(/^[^=]*=/, "")
        print
        exit
      }
    ' "$env_file" | sed 's/^["'\'']//; s/["'\'']$//'
    if grep -qE "^${key}=" "$env_file"; then
      return 0
    fi
  done
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
  local last_error=""

  for attempt in $(seq 1 30); do
    if last_error="$(curl --noproxy '*' -fsS "$url" 2>&1 >/dev/null)"; then
      return 0
    fi
    sleep 1
  done

  echo "Health check failed for $label: $url" >&2
  if [ -n "$last_error" ]; then
    echo "$last_error" >&2
  fi
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

require_production_value() {
  local key="$1"
  local value
  value="$(env_value "$key")"
  if [ -z "$value" ] || [[ "$value" == your-* ]] || [[ "$value" == change-this-* ]]; then
    echo "Missing secure production value: $key" >&2
    exit 1
  fi
}

has_production_value() {
  local value
  value="$(env_value "$1")"
  [ -n "$value" ] && [[ "$value" != your-* ]] && [[ "$value" != change-this-* ]]
}

validate_trial_inference_config() {
  if has_production_value DASHSCOPE_API_KEY || has_production_value ZHIPU_API_KEY; then
    return 0
  fi
  if has_production_value LOCAL_QWEN_API_BASE_URL && has_production_value LOCAL_QWEN_MODEL; then
    return 0
  fi
  echo "Configure DASHSCOPE_API_KEY, ZHIPU_API_KEY, or both LOCAL_QWEN_API_BASE_URL and LOCAL_QWEN_MODEL." >&2
  exit 1
}

validate_production_env() {
  if [ "$(env_value AUTH_SEED_DEMO_USERS)" != "false" ]; then
    echo "AUTH_SEED_DEMO_USERS must be false in production." >&2
    exit 1
  fi
  if [ "$(env_value SECURITY_STORE_BACKEND)" != "redis" ]; then
    echo "SECURITY_STORE_BACKEND must be redis in production." >&2
    exit 1
  fi
  if [ "$(env_value SECURITY_FAIL_CLOSED)" != "true" ]; then
    echo "SECURITY_FAIL_CLOSED must be true in production." >&2
    exit 1
  fi
  require_production_value AUTH_SECRET_KEY
  validate_trial_inference_config
  require_production_value VITE_AMAP_KEY
  require_production_value AMAP_SECURITY_JS_CODE
  require_production_value QWEATHER_API_HOST
  if ! has_production_value QWEATHER_API_KEY; then
    require_production_value QWEATHER_PROJECT_ID
    require_production_value QWEATHER_CREDENTIAL_ID
    require_production_value QWEATHER_PRIVATE_KEY_PATH
  fi
}

cd "$ROOT_DIR"

require_cmd sudo
require_cmd curl
require_cmd ip

if [ "$NGINX_ONLY" = false ]; then
  require_cmd docker
  require_cmd "$PYTHON_BIN"
  require_cmd npm
  if ! "$PYTHON_BIN" - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 11) else 1)
PY
  then
    echo "$PYTHON_BIN must be Python 3.11 or newer." >&2
    exit 1
  fi
fi

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
- set DASHSCOPE_API_KEY for the /trial Qwen detection flow
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
validate_production_env

sudo_keepalive

if [ "$NGINX_ONLY" = false ]; then
  log "Starting PostgreSQL, MinIO and Redis containers"
  sudo docker compose up -d postgres minio redis
  sudo docker compose ps

  log "Installing backend dependencies"
  cd "$BACKEND_DIR"
  venv_args=()
  if [ -x "$BACKEND_DIR/.venv/bin/python" ] && \
    ! "$BACKEND_DIR/.venv/bin/python" - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 11) else 1)
PY
  then
    log "Recreating backend virtual environment with $PYTHON_BIN"
    venv_args+=(--clear)
  fi
  "$PYTHON_BIN" -m venv "${venv_args[@]}" .venv
  # shellcheck disable=SC1091
  source "$BACKEND_DIR/.venv/bin/activate"
  pip install -r requirements.txt

  log "Running database migrations"
  alembic upgrade head
  python -m app.db.check_connection
  python -m app.db.harden_production_accounts

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
else
  log "Nginx-only mode: skipping containers, dependencies, migrations, frontend build and backend restart"
fi

log "Configuring Nginx"
SERVER_NAMES="$(detect_server_names)"
AMAP_SECURITY_JS_CODE="$(env_value AMAP_SECURITY_JS_CODE)"
NGINX_DNS_RESOLVER="$(awk '/^[[:space:]]*nameserver[[:space:]]+/{print $2; exit}' /etc/resolv.conf)"
NGINX_DNS_RESOLVER="${NGINX_DNS_RESOLVER:-127.0.0.53}"
MINIO_BUCKET="$(env_value MINIO_BUCKET)"
MINIO_BUCKET="${MINIO_BUCKET:-building-exterior}"
sudo rm -f "/etc/nginx/conf.d/building-exterior-rate-limits.conf"
sudo install -o root -g root -m 640 /dev/null "/etc/nginx/sites-available/$NGINX_SITE_NAME"
sudo tee "/etc/nginx/sites-available/$NGINX_SITE_NAME" >/dev/null <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $SERVER_NAMES;

    root $FRONTEND_DIR/dist;
    index index.html;
    client_max_body_size 105M;
    resolver $NGINX_DNS_RESOLVER valid=300s ipv6=off;
    resolver_timeout 5s;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 900s;
        proxy_read_timeout 900s;
        send_timeout 900s;
    }

    # Browser-facing S3 signed URLs use this public host while MinIO itself
    # remains bound to loopback. Preserve Host because it is part of SigV4.
    location /$MINIO_BUCKET/ {
        proxy_pass http://127.0.0.1:9002;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_request_buffering off;
    }

    # Official AMap JS API security proxy. The security code remains server-side.
    location = /_AMapService/v4/map/styles {
        set \$amap_styles_upstream webapi.amap.com;
        set \$args "\$args&jscode=$AMAP_SECURITY_JS_CODE";
        rewrite ^/_AMapService(/.*)\$ \$1 break;
        proxy_ssl_server_name on;
        proxy_ssl_name webapi.amap.com;
        proxy_set_header Host webapi.amap.com;
        proxy_pass https://\$amap_styles_upstream;
    }

    location /_AMapService/ {
        set \$amap_rest_upstream restapi.amap.com;
        set \$args "\$args&jscode=$AMAP_SECURITY_JS_CODE";
        rewrite ^/_AMapService/(.*)\$ /\$1 break;
        proxy_ssl_server_name on;
        proxy_ssl_name restapi.amap.com;
        proxy_set_header Host restapi.amap.com;
        proxy_pass https://\$amap_rest_upstream;
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
