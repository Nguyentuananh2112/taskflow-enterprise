#!/usr/bin/env bash
# Lát cắt VPS trên MÁY DEV (D3): chạy compose.prod.yml + Caddy + bootstrap/migrate của repo bằng image local, rồi smoke
# qua Caddy + TLS như từ Internet. CHỈ project `taskflow-d3-slice`; volume giữ lại (không bao giờ `down -v`).
#   SLICE_DIR=<thư mục NGOÀI repo> bash deploy/vps/slice/run-slice.sh init   # 1 lần: sinh .env/.env.api/cert (bootstrap.sh)
#   SLICE_DIR=… SLICE_API_IMAGE=… SLICE_WEB_IMAGE=… SLICE_MIGRATE_IMAGE=… bash deploy/vps/slice/run-slice.sh
#   ENVS="staging" …   # mặc định "production staging"; MIN_FREE_GB (mặc định 3) — cổng RAM trước MỖI bước
# Chỉ chạy khi Tech Lead báo "máy rảnh". Xem README.md cùng thư mục.
set -uo pipefail
export MSYS_NO_PATHCONV=1
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$REPO/deploy/vps/slice"
: "${SLICE_DIR:?đặt SLICE_DIR = thư mục làm việc NGOÀI repo (chứa .env/.env.api/cert sinh ra — secret)}"
mkdir -p "$SLICE_DIR"
SLICE_DIR="$(cd "$SLICE_DIR" && pwd)"
case "$SLICE_DIR/" in "$REPO/"*) echo "SLICE_DIR nằm trong repo — từ chối (secret sinh ra không được nằm trong repo public, ADR-072)" >&2; exit 2 ;; esac
host_path() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }

# Cấu hình lấy TỪ REPO mỗi lần chạy ⇒ lát cắt kiểm đúng bản đang có trên branch.
sync_config() {
  mkdir -p "$SLICE_DIR/postgres-init"
  cp "$REPO"/deploy/vps/{compose.prod.yml,Caddyfile,deploy.sh,bootstrap.sh,.env.example,.env.api.example,.env.backup.example} "$SLICE_DIR/"
  cp "$REPO/docker/postgres/init/01-roles.sh" "$SLICE_DIR/postgres-init/"
}

if [ "${1:-}" = init ]; then
  sync_config
  (cd "$SLICE_DIR" && APP_ENV=production APP_DOMAIN=app.localhost API_DOMAIN=api.localhost ACME_EMAIL=ops@example.test \
    GHCR_OWNER=local bash bootstrap.sh) || exit 1
  [ -f "$SLICE_DIR/.env.backup" ] || cp "$SLICE_DIR/.env.backup.example" "$SLICE_DIR/.env.backup"
  echo "[slice] init xong: $SLICE_DIR (giữ thư mục này — volume pgdata khởi tạo bằng mật khẩu trong .env của nó)"
  exit 0
fi

: "${SLICE_API_IMAGE:?}" "${SLICE_WEB_IMAGE:?}" "${SLICE_MIGRATE_IMAGE:?}"
export SLICE_API_IMAGE SLICE_WEB_IMAGE SLICE_MIGRATE_IMAGE
[ -f "$SLICE_DIR/.env" ] && [ -f "$SLICE_DIR/.env.api" ] || { echo "Chưa init: chạy '… run-slice.sh init' trước" >&2; exit 2; }
sync_config
cd "$SLICE_DIR" || exit 1
dc() { docker compose -f compose.prod.yml -f "$(host_path "$HERE/compose.slice.yml")" "$@"; }
# shellcheck disable=SC2329 # gọi qua trap EXIT
down() {
  dc --profile migrate down --remove-orphans >/dev/null 2>&1
  echo "[slice] down $(date +%T) · container còn: $(docker ps -a --filter label=com.docker.compose.project=taskflow-d3-slice -q | wc -l)"
}
trap down EXIT

free_gb() {
  if command -v powershell >/dev/null; then
    powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)" | tr -d '\r'
  else
    awk '/^MemAvailable:/ { printf "%.1f", $2 / 1048576 }' /proc/meminfo
  fi
}
gate() { # <bước> — RAM trống < MIN_FREE_GB ⇒ dừng (trap down dọn)
  local r
  r=$(free_gb)
  echo "[slice] $(date +%T) RAM trống ${r} GB — $1"
  if awk -v r="$r" -v m="${MIN_FREE_GB:-3}" 'BEGIN { exit !(r < m) }'; then
    echo "[slice] RAM < ${MIN_FREE_GB:-3} GB ⇒ DỪNG trước: $1"
    exit 3
  fi
}
set_app_env() {
  if grep -q '^APP_ENV=' .env; then sed -i "s/^APP_ENV=.*/APP_ENV=$1/" .env; else sed -i "1i APP_ENV=$1" .env; fi
}

smoke() { # <nhãn> — Node trong container trên network của project; api/app.localhost → IP Caddy; tin CA nội bộ Caddy
  local caddy_ip
  dc cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt >/dev/null || return 1
  caddy_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(dc ps -q caddy)")
  docker run --rm --network taskflow-d3-slice_default \
    --add-host "api.localhost:$caddy_ip" --add-host "app.localhost:$caddy_ip" \
    -e NODE_EXTRA_CA_CERTS=/ca/caddy-root.crt -v "$(host_path "$SLICE_DIR"):/ca:ro" -v "$(host_path "$HERE"):/smoke:ro" \
    --entrypoint node "$SLICE_API_IMAGE" /smoke/smoke.mjs | tee "smoke-$1.txt"
  return "${PIPESTATUS[0]}"
}

rc_all=0
for env in ${ENVS-production staging}; do # ENVS="" ⇒ không lượt nào (chỉ đồng bộ cấu hình)
  echo "===== APP_ENV=$env ====="
  set_app_env "$env"
  gate "postgres + valkey"
  dc up -d --wait postgres valkey >/dev/null || { rc_all=1; break; }
  gate "migrate"
  dc --profile migrate run --rm migrate 2>&1 | tail -2
  [ "${PIPESTATUS[0]}" -eq 0 ] || { rc_all=1; break; }
  gate "api + web + caddy"
  dc up -d --wait api web caddy >/dev/null || { dc logs --tail 30 api web; rc_all=1; break; }
  echo "[slice] appEnv trong log api:"
  dc logs api 2>&1 | grep -o '"appEnv":"[a-z]*"' | sort | uniq -c
  echo "[slice] env trong container — api (NODE_ENV APP_ENV): $(dc exec -T api printenv NODE_ENV APP_ENV | paste -sd' ') · web APP_ENV: $(dc exec -T web printenv APP_ENV)"
  gate "smoke $env"
  smoke "$env" || rc_all=1
  dc down --remove-orphans >/dev/null 2>&1 # giữa các lượt: down thường, volume giữ nguyên
done
set_app_env production
echo "[slice] TỔNG rc=$rc_all"
exit "$rc_all"
