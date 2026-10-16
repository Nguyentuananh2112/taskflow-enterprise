#!/usr/bin/env bash
# Chạy MỘT LẦN trên VPS mới, trong /opt/taskflow (đã copy deploy/vps/* + docker/postgres/init/01-roles.sh vào
# postgres-init/). Sinh .env + .env.api với secret ngẫu nhiên và CA/cert TLS cho Valkey. Không đè file đã có.
#   APP_DOMAIN=app.<domain> API_DOMAIN=api.<domain> ACME_EMAIL=… GHCR_OWNER=… bash bootstrap.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${APP_DOMAIN:?}" "${API_DOMAIN:?}" "${ACME_EMAIL:?}" "${GHCR_OWNER:?}"
command -v openssl >/dev/null || { echo 'Cần openssl' >&2; exit 1; }
[ -f postgres-init/01-roles.sh ] || { echo 'Thiếu postgres-init/01-roles.sh (copy từ docker/postgres/init/)' >&2; exit 1; }

rand() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"${1:-40}"; }
umask 077

if [ ! -f .env ]; then
  sed -e "s|^APP_DOMAIN=.*|APP_DOMAIN=$APP_DOMAIN|" -e "s|^API_DOMAIN=.*|API_DOMAIN=$API_DOMAIN|" \
    -e "s|^ACME_EMAIL=.*|ACME_EMAIL=$ACME_EMAIL|" -e "s|^GHCR_OWNER=.*|GHCR_OWNER=$GHCR_OWNER|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand)|" \
    -e "s|^TASKFLOW_MIGRATOR_PASSWORD=.*|TASKFLOW_MIGRATOR_PASSWORD=$(rand)|" \
    -e "s|^TASKFLOW_APP_PASSWORD=.*|TASKFLOW_APP_PASSWORD=$(rand)|" \
    -e "s|^VALKEY_PASSWORD=.*|VALKEY_PASSWORD=$(rand)|" .env.example > .env
  echo '[bootstrap] .env đã sinh'
fi
# .env sinh lúc chạy (không có trong repo)
set -a
# shellcheck disable=SC1091
. ./.env
set +a

if [ ! -f .env.api ]; then
  sed -e "s|__TASKFLOW_APP_PASSWORD__|$TASKFLOW_APP_PASSWORD|" -e "s|__VALKEY_PASSWORD__|$VALKEY_PASSWORD|" \
    -e "s|__JWT_ACCESS_SECRET__|$(rand 64)|" -e "s|__METRICS_TOKEN__|$(rand 48)|" \
    -e "s|__APP_DOMAIN__|$APP_DOMAIN|" .env.api.example > .env.api
  echo '[bootstrap] .env.api đã sinh (điền SENTRY_DSN nếu dùng)'
fi

# CA + cert cho Valkey TLS nội bộ (env.ts bắt buộc rediss:// ở production). Hạn 10 năm — chỉ trong mạng docker.
TLS=secrets/valkey-tls
if [ ! -f "$TLS/valkey.crt" ]; then
  mkdir -p "$TLS"
  openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -subj '/CN=taskflow-valkey-ca' \
    -keyout "$TLS/ca.key" -out "$TLS/ca.crt" 2>/dev/null
  openssl req -newkey rsa:3072 -nodes -subj '/CN=valkey' -keyout "$TLS/valkey.key" -out "$TLS/valkey.csr" 2>/dev/null
  printf 'subjectAltName=DNS:valkey,DNS:localhost,IP:127.0.0.1\n' > "$TLS/san.ext"
  openssl x509 -req -in "$TLS/valkey.csr" -CA "$TLS/ca.crt" -CAkey "$TLS/ca.key" -CAcreateserial \
    -days 3650 -extfile "$TLS/san.ext" -out "$TLS/valkey.crt" 2>/dev/null
  rm -f "$TLS/valkey.csr" "$TLS/san.ext"
  # User valkey/node trong container phải đọc được; bảo vệ thật là /opt/taskflow (700, chỉ root).
  chmod 755 secrets "$TLS" && chmod 644 "$TLS/ca.crt" "$TLS/valkey.crt" "$TLS/valkey.key" && chmod 600 "$TLS/ca.key"
  echo '[bootstrap] CA + cert TLS Valkey đã sinh'
fi
echo '[bootstrap] xong — tiếp: bash deploy.sh <git_sha> <api_digest> <web_digest> <migrate_digest>'
