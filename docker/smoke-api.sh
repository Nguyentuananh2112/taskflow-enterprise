#!/usr/bin/env bash
# Smoke test image api trên Docker thật (CI job build + máy dev có Git Bash) — devops.md §6.2, §7.3.
#   bash docker/smoke-api.sh taskflow-api:dev
# Kiểm: chạy bằng user không phải root · /healthz 200 · /readyz 200 với Postgres 18 + Valkey 9 thật ·
#       Valkey chết ⇒ /readyz VẪN 200 + "degraded" (ADR-074) · `docker stop` (SIGTERM) ⇒ thoát mã 0, có log
#       shutdown.start/shutdown.complete, nhanh hơn hạn chót (graceful shutdown thật — không test được trên Windows).
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash trên Windows: không đổi đường dẫn kiểu /var/... trong tham số docker

IMAGE="${1:?Cách dùng: smoke-api.sh <image>}"
PG_IMAGE="${PG_IMAGE:-postgres:18.6-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c}"
VALKEY_IMAGE="${VALKEY_IMAGE:-valkey/valkey:9.1.2@sha256:418652cfb58ef879d4978c33553735d7147016032d5aefaa14c828e611eb9dfd}"
HOST_PORT="${SMOKE_PORT:-14000}"
STOP_BUDGET_S=15 # < SHUTDOWN_TIMEOUT_MS (20s) + drain; docker stop -t 30 như compose stop_grace_period
SUFFIX="$$"
NET="tf-smoke-${SUFFIX}"
API="tf-smoke-api-${SUFFIX}"
PG="tf-smoke-pg-${SUFFIX}"
VK="tf-smoke-valkey-${SUFFIX}"
BASE="http://127.0.0.1:${HOST_PORT}"

cleanup() {
  docker rm -f "$API" "$PG" "$VK" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail() {
  echo "SMOKE FAIL: $*" >&2
  docker logs "$API" 2>&1 | tail -30 >&2 || true
  exit 1
}

docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" -e POSTGRES_PASSWORD=smoke_only "$PG_IMAGE" >/dev/null
docker run -d --name "$VK" --network "$NET" "$VALKEY_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$PG" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$PG" pg_isready -U postgres -h 127.0.0.1 >/dev/null || fail "Postgres không sẵn sàng"

# Đủ biến bắt buộc của apps/api/src/config/env.ts; NODE_ENV=test để không đòi rediss/https/Sentry.
docker run -d --name "$API" --network "$NET" -p "127.0.0.1:${HOST_PORT}:4000" \
  -e NODE_ENV=test -e APP_ENV=test -e GIT_SHA=smoke \
  -e DATABASE_URL="postgresql://postgres:smoke_only@${PG}:5432/postgres" \
  -e REDIS_URL="redis://${VK}:6379" \
  -e JWT_ACCESS_SECRET=test-only-smoke-secret-at-least-32-bytes \
  -e COOKIE_SECURE=false -e TRUST_PROXY_HOPS=0 -e READINESS_DRAIN_MS=1000 \
  "$IMAGE" >/dev/null

[ "$(docker exec "$API" id -u)" != "0" ] || fail "container chạy bằng root"

for _ in $(seq 1 30); do
  curl -fsS "$BASE/healthz" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "$BASE/healthz" | grep -q '"status":"ok"' || fail "/healthz"
echo "ok  /healthz"

ready=""
for _ in $(seq 1 20); do
  ready="$(curl -sS "$BASE/readyz" || true)"
  echo "$ready" | grep -q '"db":"ok"' && echo "$ready" | grep -q '"valkey":"ok"' && break
  sleep 1
done
if ! { echo "$ready" | grep -q '"db":"ok"' && echo "$ready" | grep -q '"valkey":"ok"'; }; then
  fail "/readyz: $ready"
fi
echo "ok  /readyz $ready"

docker stop -t 30 "$VK" >/dev/null
# Không dùng file tạm (curl gốc Windows và Git Bash hiểu /tmp khác nhau): body + mã HTTP ở dòng cuối.
resp="$(curl -s -w '\n%{http_code}' "$BASE/readyz" || true)"
code="$(printf '%s\n' "$resp" | tail -n 1)"
body="$(printf '%s\n' "$resp" | sed '$d')"
if ! { [ "$code" = "200" ] && echo "$body" | grep -q '"valkey":"degraded"'; }; then
  fail "Valkey chết: /readyz $code $body"
fi
echo "ok  Valkey chết ⇒ /readyz 200 $body (ADR-074)"

start="$(date +%s)"
docker stop -t 30 "$API" >/dev/null
elapsed=$(($(date +%s) - start))
exit_code="$(docker inspect -f '{{.State.ExitCode}}' "$API")"
logs="$(docker logs "$API" 2>&1)"
[ "$exit_code" = "0" ] || fail "SIGTERM ⇒ exit $exit_code (mong đợi 0)"
echo "$logs" | grep -q 'shutdown.start' || fail "thiếu log shutdown.start"
echo "$logs" | grep -q 'shutdown.complete' || fail "thiếu log shutdown.complete"
[ "$elapsed" -le "$STOP_BUDGET_S" ] || fail "dừng mất ${elapsed}s > ${STOP_BUDGET_S}s"
echo "ok  docker stop ⇒ exit 0 sau ${elapsed}s, có shutdown.start/complete"
echo "SMOKE PASS ($IMAGE)"
