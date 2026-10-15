#!/usr/bin/env bash
# Chạy đo tải T-027 trên hạ tầng TẠM, RIÊNG (không đụng compose `taskflow` dùng chung — ADR-106), dọn khi xong.
#   bash load/run.sh                 # dựng → seed → board + realtime → phân tích → dọn
#   KEEP=1 bash load/run.sh          # giữ container để soi tiếp (tự dọn bằng: bash load/run.sh down)
# CHỈ chạy khi Tech Lead báo "máy rảnh" (số đo local chỉ để so sánh tương đối).
# Biến: STAGES, STAGE_SECONDS, RT_VUS, RT_SECONDS, API_IMAGE (mặc định build từ repo hiện tại).
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash trên Windows: không đổi đường dẫn /load, /docker-entrypoint-initdb.d

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NET=tf-load
PG=tf-load-pg
VK=tf-load-valkey
API=tf-load-api
PG_IMAGE='postgres:18.6-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c'
VK_IMAGE='valkey/valkey:9.1.2@sha256:418652cfb58ef879d4978c33553735d7147016032d5aefaa14c828e611eb9dfd'
K6_IMAGE='grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34'
API_IMAGE="${API_IMAGE:-taskflow-api:load}"
MIGRATE_IMAGE="${MIGRATE_IMAGE:-taskflow-api-migrate:load}"
# shellcheck disable=SC2016 # hash argon2id có ký tự $ — cố ý không expand
PW_HASH='$argon2id$v=19$m=47104,t=1,p=1$BPqjDkGQFpVDnTaU7BVg3A$FWRyFuMb/F0/RVsmVtIOMgGNgHroYtCd/KSlSvqX2TI'
RESULTS="$ROOT/load/results/$(date -u +%Y%m%dT%H%M%SZ)"
host_path() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }

down() {
  docker rm -f "$API" "$PG" "$VK" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
if [ "${1:-}" = down ]; then down; exit 0; fi
[ "${KEEP:-0}" = 1 ] || trap down EXIT

mkdir -p "$RESULTS"
{
  echo "# Môi trường đo $(date -u +%FT%TZ)"
  echo "- git: $(git -C "$ROOT" rev-parse --short HEAD) ($(git -C "$ROOT" log -1 --format=%s | cut -c1-80))"
  echo "- docker: $(docker info --format '{{.ServerVersion}} · {{.NCPU}} CPU · {{.MemTotal}} B RAM cho VM')"
  echo "- host: ${OS:-$(uname -s)} · $(nproc 2>/dev/null || echo ?) luồng"
  echo "- container đang chạy (tải nền): $(docker ps -q | wc -l)"
} > "$RESULTS/environment.md"

echo "[load] build image api + migrate từ repo hiện tại"
if [ "$API_IMAGE" = taskflow-api:load ]; then
  docker build -q -f "$ROOT/apps/api/Dockerfile" --target runtime --build-arg GIT_SHA=load -t "$API_IMAGE" "$ROOT" >/dev/null
  docker build -q -f "$ROOT/apps/api/Dockerfile" --target migrate -t "$MIGRATE_IMAGE" "$ROOT" >/dev/null
fi

echo "[load] hạ tầng tạm: Postgres 18 (pg_stat_statements) + Valkey 9 trên network $NET"
down
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_PASSWORD=load_only -e POSTGRES_DB=taskflow_load \
  -e TASKFLOW_MIGRATOR_PASSWORD=migrator_load_only -e TASKFLOW_APP_PASSWORD=app_load_only \
  -v "$(host_path "$ROOT/docker/postgres/init"):/docker-entrypoint-initdb.d:ro" \
  "$PG_IMAGE" -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=top \
  -c max_connections=200 >/dev/null
docker run -d --name "$VK" --network "$NET" "$VK_IMAGE" valkey-server --save '' --appendonly no >/dev/null
for _ in $(seq 1 90); do
  docker logs "$PG" 2>&1 | grep -q 'PostgreSQL init process complete' &&
    docker exec "$PG" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break
  sleep 2
done

echo "[load] migrate + seed"
docker run --rm --network "$NET" \
  -e DATABASE_URL="postgresql://taskflow_migrator:migrator_load_only@$PG:5432/taskflow_load" "$MIGRATE_IMAGE" >/dev/null
docker exec "$PG" psql -U postgres -d taskflow_load -qc 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
docker exec -i -e PGPASSWORD=migrator_load_only "$PG" psql -h 127.0.0.1 -U taskflow_migrator -d taskflow_load \
  -v ws="${WS:-5}" -v proj="${PROJ:-3}" -v tasks="${TASKS:-500}" -v users="${USERS:-20}" -v pw_hash="$PW_HASH" \
  -f - < "$ROOT/load/seed/seed.sql" | tee "$RESULTS/seed.txt"

echo "[load] API (image production, NODE_ENV=test để không đòi rediss/https; TRUST_PROXY_HOPS=1 như sau LB)"
docker run -d --name "$API" --network "$NET" \
  -e NODE_ENV=test -e APP_ENV=test -e GIT_SHA=load -e LOG_LEVEL=warn \
  -e DATABASE_URL="postgresql://taskflow_app:app_load_only@$PG:5432/taskflow_load" -e DATABASE_POOL_MAX=20 \
  -e REDIS_URL="redis://$VK:6379" -e JWT_ACCESS_SECRET=test-only-load-test-secret-0123456789abcdef \
  -e CORS_ORIGINS=http://localhost:3001 -e COOKIE_SECURE=false -e TRUST_PROXY_HOPS=1 \
  "$API_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$API" node -e "fetch('http://127.0.0.1:4000/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break
  sleep 2
done
docker exec "$PG" psql -U postgres -d taskflow_load -qc 'SELECT pg_stat_statements_reset()' >/dev/null

k6() {
  docker run --rm --network "$NET" -v "$(host_path "$ROOT/load"):/load" \
    -v "$(host_path "$RESULTS"):/out" -e OUT_DIR=/out -e BASE_URL="http://$API:4000" \
    -e WS="${WS:-5}" -e USERS="${USERS:-20}" -e STAGES="${STAGES:-}" -e STAGE_SECONDS="${STAGE_SECONDS:-}" \
    -e RT_VUS="${RT_VUS:-}" -e RT_SECONDS="${RT_SECONDS:-}" "$K6_IMAGE" run --quiet "/load/scenarios/$1.js"
}
set +e
echo "[load] k6 board (bậc RPS: ${STAGES:-mặc định})"; k6 board; BOARD_RC=$?
docker stats --no-stream --format '{{.Name}} CPU {{.CPUPerc}} MEM {{.MemUsage}}' "$API" "$PG" "$VK" > "$RESULTS/stats-after-board.txt"
echo "[load] k6 realtime"; k6 realtime; RT_RC=$?
set -e
echo "[load] phân tích truy vấn"
docker exec -i "$PG" psql -U postgres -d taskflow_load < "$ROOT/load/sql/analyze.sql" > "$RESULTS/analyze.txt" 2>&1
echo "[load] kết quả: $RESULTS (board rc=$BOARD_RC, realtime rc=$RT_RC — rc≠0 khi vượt threshold NFR, đó là dữ liệu cần đọc)"
