#!/usr/bin/env bash
# Deploy theo DIGEST trên VPS (devops.md §5.2–5.3): ghi digest mới → pull → MIGRATE (job riêng, lỗi ⇒ dừng, bản cũ
# vẫn chạy) → rollout api/web → chờ /readyz → smoke qua Caddy → lỗi ⇒ tự ROLLBACK về digest trước (.env.previous).
#   bash deploy.sh <git_sha> <api_digest> <web_digest> <migrate_digest> [backup_digest]
#   bash deploy.sh --rollback          # quay về lần deploy trước
# Migration theo expand/contract (§4.2) ⇒ rollback app không cần rollback DB.
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE=(docker compose -f compose.prod.yml)
log() { echo "[deploy $(date -u +%FT%TZ)] $*"; }

# APP_ENV (admin đặt trong .env, bootstrap.sh ghi) quyết nhãn môi trường của api + web. Web không có kiểm như
# env.ts của api; compose chỉ báo THIẾU, không kiểm giá trị ⇒ kiểm ở đây TRƯỚC mọi rollout/rollback.
app_env=$(sed -n 's/^APP_ENV=//p' .env | tail -1)
case "$app_env" in
  staging | production) ;;
  *) echo "APP_ENV trong .env phải là staging|production (nhận: '$app_env')" >&2; exit 2 ;;
esac

set_digests() { # sha api web migrate
  sed -i -e "s|^GIT_SHA=.*|GIT_SHA=$1|" -e "s|^API_DIGEST=.*|API_DIGEST=$2|" \
    -e "s|^WEB_DIGEST=.*|WEB_DIGEST=$3|" -e "s|^MIGRATE_DIGEST=.*|MIGRATE_DIGEST=$4|" .env
  if [ -n "${5:-}" ]; then # image backup (B2) tùy chọn — trống ⇒ giữ digest đang có
    if grep -q '^BACKUP_DIGEST=' .env; then sed -i "s|^BACKUP_DIGEST=.*|BACKUP_DIGEST=$5|" .env; else echo "BACKUP_DIGEST=$5" >> .env; fi
  fi
}

wait_ready() {
  for _ in $(seq 1 60); do
    if "${COMPOSE[@]}" exec -T api node -e \
      "fetch('http://127.0.0.1:4000/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

smoke() { # qua Caddy + HTTPS thật (đúng đường người dùng đi)
  # shellcheck disable=SC1091
  . ./.env
  curl -fsS --max-time 10 "https://$API_DOMAIN/healthz" >/dev/null &&
    curl -fsS --max-time 10 "https://$API_DOMAIN/readyz" | grep -q '"db":"ok"' &&
    curl -fsS --max-time 10 -o /dev/null "https://$APP_DOMAIN/" &&
    curl -fsS --max-time 10 "https://$APP_DOMAIN/api/healthz" >/dev/null
}

rollout() {
  "${COMPOSE[@]}" pull api web migrate
  log 'migrate (job riêng)'
  "${COMPOSE[@]}" --profile migrate run --rm migrate
  log 'rollout api + web'
  "${COMPOSE[@]}" up -d --no-deps api web
  wait_ready && smoke
}

if [ "${1:-}" = --rollback ]; then
  [ -f .env.previous ] || { echo 'Không có .env.previous' >&2; exit 1; }
  cp .env.previous .env
  "${COMPOSE[@]}" up -d --no-deps api web && wait_ready && smoke && log 'rollback xong' && exit 0
  log 'ROLLBACK THẤT BẠI — xem docs/runbook/deploy.md §Sự cố'
  exit 1
fi

[ $# -ge 4 ] || { echo 'Cách dùng: deploy.sh <git_sha> <api_digest> <web_digest> <migrate_digest> [backup_digest]' >&2; exit 2; }
for d in "$2" "$3" "$4" ${5:+"$5"}; do [[ "$d" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Digest sai: $d" >&2; exit 2; }; done
[[ "$1" =~ ^[0-9a-f]{40}$ ]] || { echo "git_sha phải là 40 ký tự hex: $1" >&2; exit 2; } # G1 Low: chặn ký tự lạ vào sed/.env

cp .env .env.previous
set_digests "$@"
"${COMPOSE[@]}" up -d postgres valkey caddy # lần đầu / hạ tầng chưa chạy
if rollout; then
  log "OK — $1 đang chạy"
else
  log 'deploy LỖI ⇒ rollback về bản trước'
  cp .env.previous .env
  "${COMPOSE[@]}" up -d --no-deps api web
  if wait_ready && smoke; then log 'đã rollback'; else log 'ROLLBACK cũng lỗi — xử lý tay (runbook deploy §Sự cố)'; fi
  exit 1
fi
