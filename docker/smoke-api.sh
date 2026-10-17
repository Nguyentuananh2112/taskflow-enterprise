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
# Thời gian shutdown đo bằng timestamp log của app (shutdown.start → shutdown.complete), không bằng đồng hồ
# `docker stop` (Docker Desktop đang tải nặng có thể trễ hàng chục giây). Phải < SHUTDOWN_TIMEOUT_MS (20s).
SHUTDOWN_BUDGET_MS=15000
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
# Runtime không mang trình quản lý gói (Dockerfile gỡ npm/npx/corepack/yarn — bề mặt tấn công + Trivy).
for tool in npm npx corepack yarn; do
  ! docker exec "$API" sh -c "command -v $tool" >/dev/null 2>&1 || fail "runtime còn $tool"
done

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

vk_stop_ms="$(date +%s%3N)"
docker stop -t 30 "$VK" >/dev/null
echo "..  Valkey dừng sau $(($(date +%s%3N) - vk_stop_ms))ms (docker stop)"
# /readyz cache kết quả probe READINESS_CACHE_MS (1 s — T-031, 6945d14) ⇒ ngay sau khi Valkey dừng có thể còn nhận
# "ok" cũ (runner GitHub dừng container < 1 s; Docker Desktop chậm hơn nên local không lộ). Hỏi lại tới 10 lần × 1 s
# (giới hạn /readyz 60/phút — vòng trên tối đa 20 lần). Không dùng file tạm (curl gốc Windows và Git Bash hiểu /tmp
# khác nhau): body + mã HTTP ở dòng cuối.
code="" body="" tries=0
for _ in $(seq 1 10); do
  tries=$((tries + 1))
  resp="$(curl -s -w '\n%{http_code}' "$BASE/readyz" || true)"
  code="$(printf '%s\n' "$resp" | tail -n 1)"
  body="$(printf '%s\n' "$resp" | sed '$d')"
  [ "$code" = "200" ] && echo "$body" | grep -q '"valkey":"degraded"' && break
  sleep 1
done
if ! { [ "$code" = "200" ] && echo "$body" | grep -q '"valkey":"degraded"'; }; then
  fail "Valkey chết: /readyz $code $body"
fi
echo "ok  Valkey chết ⇒ /readyz 200 $body (ADR-074) — thấy degraded sau $(($(date +%s%3N) - vk_stop_ms))ms, lần hỏi thứ $tries"

start="$(date +%s)"
docker stop -t 30 "$API" >/dev/null
elapsed=$(($(date +%s) - start))
exit_code="$(docker inspect -f '{{.State.ExitCode}}' "$API")"
logs="$(docker logs "$API" 2>&1)"
[ "$exit_code" = "0" ] || fail "SIGTERM ⇒ exit $exit_code (mong đợi 0)"
echo "$logs" | grep -q 'shutdown.start' || fail "thiếu log shutdown.start"
echo "$logs" | grep -q 'shutdown.complete' || fail "thiếu log shutdown.complete"
log_ms() { # mili-giây epoch của dòng log đầu tiên có msg = $1 (GNU date: Linux và Git Bash)
  date -d "$(echo "$logs" | grep "\"msg\":\"$1\"" | head -n 1 | sed -E 's/.*"time":"([^"]+)".*/\1/')" +%s%3N
}
shutdown_ms=$(($(log_ms shutdown.complete) - $(log_ms shutdown.start)))
[ "$shutdown_ms" -le "$SHUTDOWN_BUDGET_MS" ] || fail "shutdown mất ${shutdown_ms}ms > ${SHUTDOWN_BUDGET_MS}ms"
echo "ok  SIGTERM ⇒ exit 0, shutdown.start→complete ${shutdown_ms}ms (docker stop tổng ${elapsed}s)"
echo "SMOKE PASS ($IMAGE)"
