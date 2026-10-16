#!/usr/bin/env bash
# Chạy đo tải T-027 trên hạ tầng TẠM, RIÊNG — compose project `taskflow-load` (load/compose.load.yml; không đụng
# compose `taskflow` dùng chung — ADR-106; network khai trong file, không map cổng ra host), dọn khi xong.
#   bash load/run.sh                 # build → dựng → seed → board + realtime + cột nóng + rebalance → phân tích → dọn
#   KEEP=1 bash load/run.sh          # giữ container để soi tiếp (tự dọn bằng: bash load/run.sh down)
# CHỈ chạy khi Tech Lead báo "máy rảnh" (số đo local chỉ để so sánh tương đối).
# Biến: STAGES, STAGE_SECONDS, RT_VUS, RT_SECONDS, HOT_STAGES, RPROJ/RTASKS (cột rebalance),
#       API_IMAGE/MIGRATE_IMAGE (đặt ⇒ dùng image có sẵn, không build), SCENARIOS (mặc định cả 4: "board realtime hot-column rebalance"),
#       INSTANCES=1|2 (T-027c: k6 → LB Caddy → 1 hoặc 2 bản API, SOCKET_REDIS_ADAPTER=true; trống ⇒ k6 → api trực tiếp như T-027),
#       CPU_PROF=1 (node --cpu-prof cho mọi bản API, file vào <kết quả>/prof/<service>/), RESULTS_DIR (thư mục kết quả).
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash trên Windows: không đổi đường dẫn /load, /docker-entrypoint-initdb.d

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC2016 # hash argon2id có ký tự $ — cố ý không expand
PW_HASH='$argon2id$v=19$m=47104,t=1,p=1$BPqjDkGQFpVDnTaU7BVg3A$FWRyFuMb/F0/RVsmVtIOMgGNgHroYtCd/KSlSvqX2TI'
host_path() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }
COMPOSE_FILES=(-f "$(host_path "$ROOT/load/compose.load.yml")")
case "${INSTANCES:-}" in
  '') API_SERVICES=(api) ;;
  1) API_SERVICES=(api) ;;
  2) API_SERVICES=(api api2) ;;
  *) echo "INSTANCES phải là 1 hoặc 2 (nhận '${INSTANCES}')" >&2; exit 2 ;;
esac
if [ -n "${INSTANCES:-}" ]; then
  COMPOSE_FILES+=(-f "$(host_path "$ROOT/load/compose.lb.yml")")
  export UPSTREAMS
  UPSTREAMS=$(printf '%s:4000 ' "${API_SERVICES[@]}")
fi
dc() { docker compose -p taskflow-load "${COMPOSE_FILES[@]}" "$@"; }

# Không `--volumes`: compose không có volume nào (tmpfs) — down thường đã dọn sạch. Dừng êm các bản API TRƯỚC
# (SIGTERM ⇒ graceful shutdown ⇒ Node ghi .cpuprofile khi CPU_PROF=1).
down() {
  dc stop -t 30 "${API_SERVICES[@]}" >/dev/null 2>&1 || true
  dc --profile tools down --remove-orphans >/dev/null 2>&1 || true
}
if [ "${1:-}" = down ]; then down; exit 0; fi
[ "${KEEP:-0}" = 1 ] || trap down EXIT

RESULTS_DIR="${RESULTS_DIR:-$ROOT/load/results/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$RESULTS_DIR"
export RESULTS PROF_DIR API_NODE_OPTIONS
RESULTS="$(host_path "$RESULTS_DIR")"
PROF_DIR="$(host_path "$RESULTS_DIR/prof")"
if [ "${CPU_PROF:-0}" = 1 ]; then
  for svc in "${API_SERVICES[@]}"; do mkdir -p "$RESULTS_DIR/prof/$svc"; done
  API_NODE_OPTIONS='--cpu-prof --cpu-prof-dir=/prof'
else
  API_NODE_OPTIONS=''
fi
{
  echo "# Môi trường đo $(date -u +%FT%TZ)"
  # MSYS_NO_PATHCONV=1 ⇒ git.exe không tự đổi /d/… ⇒ đưa đường dẫn Windows.
  echo "- git (script đo): $(git -C "$(host_path "$ROOT")" rev-parse --short HEAD) ($(git -C "$(host_path "$ROOT")" log -1 --format=%s | cut -c1-80))"
  echo "- image API: ${API_IMAGE:-taskflow-api:load (build từ repo này)} · migrate: ${MIGRATE_IMAGE:-taskflow-api-migrate:load}"
  echo "- docker: $(docker info --format '{{.ServerVersion}} · {{.NCPU}} CPU · {{.MemTotal}} B RAM cho VM')"
  echo "- host: ${OS:-$(uname -s)} · $(nproc 2>/dev/null || echo ?) luồng"
  echo "- container đang chạy (tải nền): $(docker ps -q | wc -l)"
  if [ -n "${INSTANCES:-}" ]; then
    echo "- API: ${INSTANCES} bản sau LB Caddy (SOCKET_REDIS_ADAPTER=true, TRUST_PROXY_HOPS=2) · cpu-prof: ${CPU_PROF:-0}"
  else
    echo "- API: 1 bản, k6 gọi trực tiếp (không LB) · cpu-prof: ${CPU_PROF:-0}"
  fi
} > "$RESULTS_DIR/environment.md"

if [ -z "${API_IMAGE:-}" ]; then
  echo "[load] build image api + migrate từ repo hiện tại"
  dc --profile tools build api migrate
fi

echo "[load] hạ tầng tạm: Postgres 18 (pg_stat_statements) + Valkey 9"
down
dc up -d --wait pg valkey

echo "[load] migrate + seed"
dc --profile tools run --rm migrate >/dev/null
dc exec -T pg psql -U postgres -d taskflow_load -qc 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
dc exec -T -e PGPASSWORD=migrator_load_only pg psql -h 127.0.0.1 -U taskflow_migrator -d taskflow_load \
  -v ws="${WS:-5}" -v proj="${PROJ:-3}" -v tasks="${TASKS:-500}" -v users="${USERS:-20}" \
  -v rproj="${RPROJ:-2}" -v rtasks="${RTASKS:-500}" -v pw_hash="$PW_HASH" \
  -f - < "$ROOT/load/seed/seed.sql" | tee "$RESULTS_DIR/seed.txt"

if [ -n "${INSTANCES:-}" ]; then
  echo "[load] ${API_SERVICES[*]} + LB Caddy (UPSTREAMS=${UPSTREAMS})"
  dc up -d --wait "${API_SERVICES[@]}" lb
else
  echo "[load] API (image production, NODE_ENV=test; TRUST_PROXY_HOPS=1 như sau LB)"
  dc up -d --wait api
fi
dc exec -T pg psql -U postgres -d taskflow_load -qc 'SELECT pg_stat_statements_reset()' >/dev/null

k6() { dc --profile tools run --rm k6 run --quiet "/load/scenarios/$1.js"; }
SCENARIOS="${SCENARIOS:-board realtime hot-column rebalance}"
BOARD_RC=- RT_RC=- HOT_RC=- REBAL_RC=-
set +e
for sc in $SCENARIOS; do
  echo "[load] k6 $sc"
  k6 "$sc"
  rc=$?
  case "$sc" in
    board)
      BOARD_RC=$rc
      # shellcheck disable=SC2046 # danh sách id container, tách theo khoảng trắng là đúng ý
      docker stats --no-stream --format '{{.Name}} CPU {{.CPUPerc}} MEM {{.MemUsage}}' $(dc ps -q) \
        > "$RESULTS_DIR/stats-after-board.txt"
      ;;
    realtime) RT_RC=$rc ;;
    hot-column) HOT_RC=$rc ;;
    rebalance) REBAL_RC=$rc ;;
  esac
done
set -e
echo "[load] phân tích truy vấn"
dc exec -T pg psql -U postgres -d taskflow_load < "$ROOT/load/sql/analyze.sql" > "$RESULTS_DIR/analyze.txt" 2>&1
echo "[load] kết quả: $RESULTS_DIR (board rc=$BOARD_RC, realtime rc=$RT_RC, hot rc=$HOT_RC, rebalance rc=$REBAL_RC — rc≠0 khi vượt threshold NFR, đó là dữ liệu cần đọc)"
