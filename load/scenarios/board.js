/* global __ENV */
// T-027 — Tải HTTP Kanban: đọc board · tạo · move (expectedVersion) · cập nhật, tăng RPS theo bậc tới khi P95
// vượt NFR (đọc < 150 ms, ghi < 300 ms — ADR-030; login/register KHÔNG đo). Điểm gãy = bậc đầu tiên vượt ngưỡng.
//   docker run --rm --network tf-load -v "$PWD/load:/load" grafana/k6:2.3.0 run /load/scenarios/board.js
// Biến: BASE_URL, STAGES ("10,25,50,…" RPS), STAGE_SECONDS (mặc định 60), WS, USERS.
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';

import { API, STATUSES, headers, json, loginAll, pick } from '../lib/common.js';
import { summarize } from '../lib/summary.js';

const STAGES = (__ENV.STAGES || '10,25,50,75,100,150,200,300').split(',').map(Number);
const STAGE_SECONDS = Number(__ENV.STAGE_SECONDS || 60);
const RAMP_SECONDS = 10;
const MIX = { read: 0.6, move: 0.2, update: 0.1, create: 0.1 };

const versionConflicts = new Counter('version_conflicts');
const rateLimited = new Counter('rate_limited');

// Ngưỡng NFR tổng + submetric theo bậc (để handleSummary tìm điểm gãy) và theo endpoint (P95/P99).
const thresholds = {
  'http_req_duration{kind:read}': ['p(95)<150'],
  'http_req_duration{kind:write}': ['p(95)<300'],
  'http_req_failed{kind:read}': ['rate<0.01'],
};
for (const rps of STAGES) {
  thresholds[`http_req_duration{kind:read,stage:${rps}}`] = ['p(95)<150'];
  thresholds[`http_req_duration{kind:write,stage:${rps}}`] = ['p(95)<300'];
  thresholds[`http_reqs{stage:${rps}}`] = ['count>=0'];
  thresholds[`http_req_failed{stage:${rps}}`] = ['rate<0.01'];
}
for (const name of ['GET tasks', 'POST tasks', 'PATCH task', 'PATCH move']) {
  thresholds[`http_req_duration{name:${name}}`] = [
    name === 'GET tasks' ? 'p(95)<150' : 'p(95)<300',
  ];
}

export const options = {
  setupTimeout: '5m',
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds,
  scenarios: {
    board: {
      executor: 'ramping-arrival-rate',
      startRate: STAGES[0],
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: STAGES.flatMap((rps) => [
        { target: rps, duration: `${RAMP_SECONDS}s` },
        { target: rps, duration: `${STAGE_SECONDS - RAMP_SECONDS}s` },
      ]),
    },
  },
};

export function setup() {
  return { users: loginAll() };
}

/** Bậc RPS hiện tại theo thời gian đã chạy của scenario (mỗi bậc STAGE_SECONDS). */
function currentStage() {
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
  return STAGES[Math.min(STAGES.length - 1, Math.floor(elapsed / STAGE_SECONDS))];
}

function call(method, url, body, user, name, kind, stage) {
  const res = http.request(method, url, body ? JSON.stringify(body) : null, {
    headers: headers(user),
    tags: { name, kind, stage: String(stage) },
    // 409 (VERSION_CONFLICT do tranh chấp) là kết quả nghiệp vụ hợp lệ, không phải lỗi hệ thống.
    responseCallback: http.expectedStatuses({ min: 200, max: 299 }, 409),
  });
  if (res.status === 409) versionConflicts.add(1, { name });
  if (res.status === 429) rateLimited.add(1, { name });
  return res;
}

function readColumn(user, projectId, stage) {
  const status = pick(STATUSES);
  const res = call(
    'GET',
    `${API}/workspaces/${user.ws.id}/projects/${projectId}/tasks?status=${status}&limit=200`,
    null,
    user,
    'GET tasks',
    'read',
    stage,
  );
  check(res, { 'read 200': (r) => r.status === 200 });
  return json(res)?.data ?? [];
}

export default function (data) {
  const user = pick(data.users);
  const projectId = pick(user.ws.projectIds);
  const base = `${API}/workspaces/${user.ws.id}/projects/${projectId}/tasks`;
  const stage = currentStage();
  const r = Math.random();

  if (r < MIX.read) {
    readColumn(user, projectId, stage);
    return;
  }
  if (r < MIX.read + MIX.create) {
    const res = call(
      'POST',
      base,
      { title: `k6 ${Date.now()}`, priority: 'MEDIUM' },
      user,
      'POST tasks',
      'write',
      stage,
    );
    check(res, { 'create 201': (x) => x.status === 201 || x.status === 200 });
    return;
  }
  // move / update cần task + version hiện tại ⇒ đọc cột trước (lần đọc này cũng được đo như đọc board).
  const tasks = readColumn(user, projectId, stage);
  if (tasks.length < 2) return;
  const task = pick(tasks);
  if (r < MIX.read + MIX.create + MIX.move) {
    const after = pick(tasks.filter((t) => t.id !== task.id));
    const res = call(
      'PATCH',
      `${base}/${task.id}/move`,
      { expectedVersion: task.version, afterId: after.id },
      user,
      'PATCH move',
      'write',
      stage,
    );
    check(res, { 'move 200/409': (x) => x.status === 200 || x.status === 409 });
  } else {
    const res = call(
      'PATCH',
      `${base}/${task.id}`,
      { expectedVersion: task.version, title: `k6 sửa ${Date.now()}` },
      user,
      'PATCH task',
      'write',
      stage,
    );
    check(res, { 'update 200/409': (x) => x.status === 200 || x.status === 409 });
  }
}

export function handleSummary(data) {
  return summarize(data, {
    scenario: 'board',
    stages: STAGES,
    outDir: __ENV.OUT_DIR || '/load/results',
  });
}
