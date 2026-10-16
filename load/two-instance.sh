#!/usr/bin/env bash
# T-027c (A3 §6 mục 6): thông lượng 1 vs 2 bản API sau LB Caddy — CHỈ chạy khi Tech Lead báo "máy rảnh".
# Mỗi lượt dựng + seed LẠI từ đầu (board tạo task ⇒ dữ liệu phải như nhau), chạy board 8 bậc (STAGES mặc định
# của board.js: 10…300 RPS), lấy mẫu `docker stats` mỗi ~2 s, dọn; cuối cùng in bảng so sánh.
#   bash load/two-instance.sh                       # 1 rồi 2 bản
#   ORDER="2 1" CPU_PROF=1 bash load/two-instance.sh  # đổi thứ tự (loại trừ hiệu ứng máy nóng dần), kèm cpu-prof
# Cần image taskflow-api:load / taskflow-api-migrate:load (build bằng run.sh) hoặc đặt API_IMAGE/MIGRATE_IMAGE.
set -uo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.." || exit 1
export API_IMAGE=${API_IMAGE:-taskflow-api:load} MIGRATE_IMAGE=${MIGRATE_IMAGE:-taskflow-api-migrate:load}
host_path() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }
dc() { docker compose -p taskflow-load -f load/compose.load.yml -f load/compose.lb.yml "$@"; }

TOP="$PWD/load/results/$(date -u +%Y%m%dT%H%M%SZ)-instances"
mkdir -p "$TOP"
echo "[t027c] kết quả: $TOP"

for n in ${ORDER:-1 2}; do
  R="$TOP/n$n"
  export INSTANCES=$n RESULTS_DIR="$R" UPSTREAMS
  UPSTREAMS=$([ "$n" = 2 ] && echo 'api:4000 api2:4000' || echo 'api:4000')
  echo "[t027c] n=$n: dựng + seed $(date +%T)"
  if ! KEEP=1 SCENARIOS=" " bash load/run.sh > "$TOP/n$n-setup.log" 2>&1; then
    echo "[t027c] n=$n: dựng lỗi — xem $TOP/n$n-setup.log" >&2
    bash load/run.sh down
    exit 1
  fi
  IDS=$(dc ps -q | tr '\n' ' ')
  (
    while :; do
      # shellcheck disable=SC2086 # danh sách id container
      docker stats --no-stream --format "$(date +%T) {{.Name}} CPU {{.CPUPerc}} MEM {{.MemUsage}}" $IDS
      sleep 2
    done
  ) > "$R/stats.txt" 2>&1 &
  ST=$!
  echo "[t027c] n=$n: board $(date +%T)"
  # RESULTS nội suy vào mount /out của k6 (compose) ⇒ phải là env của lệnh docker compose, không phải `-e`.
  RESULTS="$(host_path "$R")" dc --profile tools run --rm k6 run --quiet /load/scenarios/board.js \
    > "$R/board.log" 2>&1
  echo "[t027c] n=$n: board rc=$? (≠0 khi vượt NFR — vẫn là dữ liệu) $(date +%T)"
  kill "$ST" 2>/dev/null
  bash load/run.sh down # dừng êm API (cpu-prof ghi file) rồi down
done

node --input-type=module - "$TOP" <<'EOF'
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const top = process.argv[2];
const runs = {};
for (const n of ['1', '2']) {
  const f = `${top}/n${n}/board-summary.json`;
  if (existsSync(f)) runs[n] = JSON.parse(readFileSync(f, 'utf8'));
}
const fmt = (v) => (v == null ? '—' : Number(v).toFixed(1));
const lines = [
  '# Board: 1 vs 2 bản API sau LB (T-027c)',
  '',
  `Điểm gãy NFR: 1 bản = ${runs['1']?.breakingRps ?? 'không gãy'} · 2 bản = ${runs['2']?.breakingRps ?? 'không gãy'} RPS`,
  '',
  '| RPS mục tiêu | Request 1 | Request 2 | Đọc P95 1 | Đọc P95 2 | Ghi P95 1 | Ghi P95 2 | Lỗi 1 | Lỗi 2 |',
  '|---|---|---|---|---|---|---|---|---|',
];
for (const row of runs['1']?.stages ?? runs['2']?.stages ?? []) {
  const a = runs['1']?.stages.find((r) => r.rps === row.rps) ?? {};
  const b = runs['2']?.stages.find((r) => r.rps === row.rps) ?? {};
  lines.push(
    `| ${row.rps} | ${a.requests ?? '—'} | ${b.requests ?? '—'} | ${fmt(a.readP95)} | ${fmt(b.readP95)} | ${fmt(a.writeP95)} | ${fmt(b.writeP95)} | ${fmt((a.failedRate ?? 0) * 100)}% | ${fmt((b.failedRate ?? 0) * 100)}% |`,
  );
}
lines.push('', 'CPU theo container: `n1/stats.txt`, `n2/stats.txt` (mẫu ~2 s). Môi trường: `n*/environment.md`.');
writeFileSync(`${top}/compare.md`, `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
EOF
