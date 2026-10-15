/* global __ENV, __VU, __ITER */
// T-027 bổ sung — "Move kích hoạt rebalance" (T-033): cột 500 task rank dài 64 ký tự liền kề (project R*, seed.sql).
// Chen một task vào giữa 2 task liền kề ⇒ rank mới 65 ký tự > ngưỡng 64 ⇒ move đó rebalance CẢ CỘT trong cùng
// transaction. Mỗi cột chỉ cho 1 mẫu (sau đó rank đã ngắn) ⇒ mỗi VU xử lý đúng 1 cột; số mẫu = số cột
// (WS × RPROJ × 4). Đo thêm 1 move thường ngay sau trong cùng cột để so sánh.
// Trước khi T-033 merge: không có rebalance — số đo là đường cơ sở "rank cứ dài thêm".
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import { API, STATUSES, headers, json, loginAll, pick } from '../lib/common.js';
import { summarize } from '../lib/summary.js';

const COLUMNS = Number(__ENV.REBAL_COLUMNS || Number(__ENV.WS || 5) * Number(__ENV.RPROJ || 2) * 4);
// REBAL_SERIAL=1 (T-027b): 1 VU rebalance lần lượt từng cột ⇒ mỗi lúc chỉ MỘT rebalance (đo đơn lẻ, có thể kèm tải nền).
const SERIAL = __ENV.REBAL_SERIAL === '1';
const rebalanceMove = new Trend('rebalance_move_ms', true);
const normalMove = new Trend('after_rebalance_move_ms', true);
const rankLength = new Trend('rank_length_after_move');

export const options = {
  setupTimeout: '5m',
  summaryTrendStats: ['count', 'avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    // NFR ghi 300 ms áp cho move thường; move kích hoạt rebalance chỉ ghi số (không có NFR riêng).
    after_rebalance_move_ms: ['p(95)<300'],
    rebalance_move_ms: ['p(95)>=0'],
    rank_length_after_move: ['max>=0'],
  },
  scenarios: {
    rebalance: SERIAL
      ? { executor: 'per-vu-iterations', vus: 1, iterations: COLUMNS, maxDuration: '10m' }
      : { executor: 'per-vu-iterations', vus: COLUMNS, iterations: 1, maxDuration: '10m' },
  },
};

export function setup() {
  const users = loginAll();
  const columns = [];
  for (const owner of users.filter((u) => u.u === 1)) {
    for (const projectId of owner.ws.rebalanceProjectIds) {
      for (const status of STATUSES)
        columns.push({ w: owner.w, wsId: owner.ws.id, projectId, status });
    }
  }
  return { users, columns };
}

function move(user, base, task, afterId, beforeId, name) {
  return http.patch(
    `${base}/${task.id}/move`,
    JSON.stringify({ expectedVersion: task.version, afterId, beforeId }),
    { headers: headers(user), tags: { name, kind: 'write' } },
  );
}

export default function (data) {
  const column = data.columns[SERIAL ? __ITER : __VU - 1];
  if (!column) return;
  const user = pick(data.users.filter((u) => u.w === column.w));
  const base = `${API}/workspaces/${column.wsId}/projects/${column.projectId}/tasks`;
  const read = () =>
    json(
      http.get(`${base}?status=${column.status}&limit=500`, {
        headers: headers(user),
        tags: { name: 'GET tasks (rebalance col)', kind: 'read' },
      }),
    )?.data ?? [];

  let tasks = read();
  if (tasks.length < 10) return;
  // Chen task ở cuối cột vào giữa 2 task liền kề ở giữa cột (khóa liền kề ⇒ rank mới phải dài thêm 1 ký tự).
  const k = Math.floor(tasks.length / 2);
  const mover = tasks[tasks.length - 1];
  const t0 = Date.now();
  const res = move(user, base, mover, tasks[k].id, tasks[k + 1].id, 'PATCH move (rebalance)');
  rebalanceMove.add(Date.now() - t0);
  check(res, { 'rebalance move 200': (r) => r.status === 200 });
  const moved = json(res)?.data;
  if (moved?.rank) rankLength.add(moved.rank.length);

  sleep(0.2);
  tasks = read();
  if (tasks.length < 4) return;
  const t1 = Date.now();
  const after = move(
    user,
    base,
    tasks[0],
    tasks[2].id,
    tasks[3].id,
    'PATCH move (after rebalance)',
  );
  normalMove.add(Date.now() - t1);
  check(after, { 'normal move 200': (r) => r.status === 200 });
  if (SERIAL) sleep(1); // tách các rebalance
}

export function handleSummary(data) {
  const v = (k) => data.metrics[k]?.values ?? {};
  const f = (x) => (typeof x === 'number' ? x.toFixed(1) : '—');
  const row = (label, k) =>
    `| ${label} | ${v(k).count ?? 0} | ${f(v(k).med)} | ${f(v(k)['p(95)'])} | ${f(v(k)['p(99)'])} | ${f(v(k).max)} |`;
  const extra = [
    '| Move | Mẫu | P50 | P95 | P99 | Max (ms) |',
    '|---|---|---|---|---|---|',
    row('kích hoạt rebalance (cột 500 task, rank 64 ký tự)', 'rebalance_move_ms'),
    row('move thường ngay sau rebalance', 'after_rebalance_move_ms'),
    '',
    `Độ dài rank sau move kích hoạt: max ${f(v('rank_length_after_move').max)} ký tự (≤ 64 ⇒ đã rebalance; 65 ⇒ chưa có T-033).`,
  ].join('\n');
  return summarize(data, {
    scenario: 'rebalance',
    outDir: __ENV.OUT_DIR || '/load/results',
    extra,
  });
}
