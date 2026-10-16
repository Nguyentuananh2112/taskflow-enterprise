#!/usr/bin/env bash
# T-027b (chạy khi Tech Lead báo "máy rảnh"; cần image taskflow-api:load / taskflow-api-migrate:load — build bằng run.sh): (A) rebalance ĐƠN LẺ tuần tự trong lúc board chạy nền 50 RPS; (B) board 100→150 RPS + docker stats mỗi 2 s.
set -uo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.." || exit 1
export API_IMAGE=${API_IMAGE:-taskflow-api:load} MIGRATE_IMAGE=${MIGRATE_IMAGE:-taskflow-api-migrate:load}
dc() { docker compose -p taskflow-load -f load/compose.load.yml "$@"; }
cleanup() { dc --profile tools down --remove-orphans >/dev/null 2>&1; echo "[t027b] down $(date +%T)"; }
trap cleanup EXIT

echo "[t027b] up+seed $(date +%T)"
KEEP=1 SCENARIOS=" " bash load/run.sh || exit 1
# shellcheck disable=SC2012 # tên thư mục là timestamp
R=$(ls -d load/results/*/ | tail -1)
R=${R%/}
mkdir -p "$R/a-bg" "$R/a-rebal" "$R/b-board"
RESULTS=$(if command -v cygpath >/dev/null; then cygpath -w "$PWD/$R"; else echo "$PWD/$R"; fi)
export RESULTS
echo "[t027b] results $R"

k6run() { # $1 out subdir, $2 scenario, rest: -e KEY=VAL
  local out=$1 sc=$2
  shift 2
  dc --profile tools run --rm -e OUT_DIR="/out/$out" "$@" k6 run --quiet "/load/scenarios/$sc.js"
}

echo "[t027b] A: board nền 50 RPS 150 s + rebalance tuần tự 10 cột $(date +%T)"
k6run a-bg board -e STAGES=50 -e STAGE_SECONDS=150 > "$R/a-bg.log" 2>&1 &
BG=$!
sleep 30
k6run a-rebal rebalance -e REBAL_SERIAL=1 -e REBAL_COLUMNS=10 > "$R/a-rebal.log" 2>&1
echo "[t027b] A rebalance rc=$? $(date +%T)"
wait $BG
echo "[t027b] A bg rc=$? $(date +%T)"

echo "[t027b] B: board 100,150 RPS × 60 s + docker stats $(date +%T)"
IDS=$(dc ps -q api pg valkey | tr '\n' ' ')
(
  while :; do
    # shellcheck disable=SC2086
    docker stats --no-stream --format "$(date +%T) {{.Name}} CPU {{.CPUPerc}} MEM {{.MemUsage}}" $IDS
    sleep 2
  done
) > "$R/b-stats.txt" 2>&1 &
ST=$!
k6run b-board board -e STAGES=100,150 -e STAGE_SECONDS=60 > "$R/b-board.log" 2>&1
echo "[t027b] B rc=$? $(date +%T)"
kill $ST 2>/dev/null
echo "[t027b] xong $(date +%T)"
