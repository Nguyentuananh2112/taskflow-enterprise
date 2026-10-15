#!/usr/bin/env bash
# Chạy đo tải T-027 trên hạ tầng TẠM, RIÊNG — compose project `taskflow-load` (load/compose.load.yml; không đụng
# compose `taskflow` dùng chung — ADR-106; network khai trong file, không map cổng ra host), dọn khi xong.
#   bash load/run.sh                 # build → dựng → seed → board + realtime + cột nóng + rebalance → phân tích → dọn
#   KEEP=1 bash load/run.sh          # giữ container để soi tiếp (tự dọn bằng: bash load/run.sh down)
# CHỈ chạy khi Tech Lead báo "máy rảnh" (số đo local chỉ để so sánh tương đối).
# Biến: STAGES, STAGE_SECONDS, RT_VUS, RT_SECONDS, HOT_STAGES, RPROJ/RTASKS (cột rebalance),
#       API_IMAGE/MIGRATE_IMAGE (đặt ⇒ dùng image có sẵn, không build), SCENARIOS (mặc định cả 4: "board realtime hot-column rebalance").
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash trên Windows: không đổi đường dẫn /load, /docker-entrypoint-initdb.d

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC2016 # hash argon2id có ký tự $ — cố ý không expand
PW_HASH='$argon2id$v=19$m=47104,t=1,p=1$BPqjDkGQFpVDnTaU7BVg3A$FWRyFuMb/F0/RVsmVtIOMgGNgHroYtCd/KSlSvqX2TI'
host_path() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }
dc() { docker compose -p taskflow-load -f "$(host_path "$ROOT/load/compose.load.yml")" "$@"; }

# Không `--volumes`: compose không có volume nào (tmpfs) — down thường đã dọn sạch.
down() { dc --profile tools down --remove-orphans >/dev/null 2>&1 || true; }
if [ "${1:-}" = down ]; then down; exit 0; fi
[ "${KEEP:-0}" = 1 ] || trap down EXIT

RESULTS_DIR="$ROOT/load/results/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RESULTS_DIR"
export RESULTS
RESULTS="$(host_path "$RESULTS_DIR")"
{
  echo "# Môi trường đo $(date -u +%FT%TZ)"
  echo "- git: $(git -C "$ROOT" rev-parse --short HEAD) ($(git -C "$ROOT" log -1 --format=%s | cut -c1-80))"
  echo "- docker: $(docker info --format '{{.ServerVersion}} · {{.NCPU}} CPU · {{.MemTotal}} B RAM cho VM')"
  echo "- host: ${OS:-$(uname -s)} · $(nproc 2>/dev/null || echo ?) luồng"
  echo "- container đang chạy (tải nền): $(docker ps -q | wc -l)"
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

echo "[load] API (image production, NODE_ENV=test; TRUST_PROXY_HOPS=1 như sau LB)"
dc up -d --wait api
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
      docker stats --no-stream --format '{{.Name}} CPU {{.CPUPerc}} MEM {{.MemUsage}}' $(dc ps -q api pg valkey) \
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
