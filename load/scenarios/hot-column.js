/* global __ENV */
// T-027 bổ sung — "Cột nóng": mọi user của workspace 1 cùng move trong CÙNG MỘT cột của CÙNG MỘT project.
// T-033 khóa advisory theo (project, status) ⇒ các move này xếp hàng; đo P95/P99 của move khi tranh chấp
// tăng dần (bậc HOT_STAGES move/giây) và tỉ lệ 409 VERSION_CONFLICT (optimistic lock vẫn bảo vệ).
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';

import { API, headers, json, loginAll, pick } from '../lib/common.js';
import { summarize } from '../lib/summary.js';

const STAGES = (__ENV.HOT_STAGES || '5,10,20,40').split(',').map(Number);
const STAGE_SECONDS = Number(__ENV.STAGE_SECONDS || 60);
const RAMP_SECONDS = 10;
const STATUS = __ENV.HOT_STATUS || 'TODO';

const versionConflicts = new Counter('version_conflicts');
const rateLimited = new Counter('rate_limited');

const thresholds = { 'http_req_duration{name:PATCH move (hot)}': ['p(95)<300'] };
for (const rps of STAGES) {
  thresholds[`http_req_duration{kind:write,stage:${rps}}`] = ['p(95)<300'];
  thresholds[`http_req_duration{kind:read,stage:${rps}}`] = ['p(95)<150'];
  thresholds[`http_reqs{stage:${rps}}`] = ['count>=0'];
  thresholds[`http_req_failed{stage:${rps}}`] = ['rate<0.01'];
}

export const options = {
  setupTimeout: '5m',
  summaryTrendStats: ['count', 'avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds,
  scenarios: {
    hot: {
      executor: 'ramping-arrival-rate',
      startRate: STAGES[0],
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 200,
      stages: STAGES.flatMap((rps) => [
        { target: rps, duration: `${RAMP_SECONDS}s` },
        { target: rps, duration: `${STAGE_SECONDS - RAMP_SECONDS}s` },
      ]),
    },
  },
};

export function setup() {
  const users = loginAll().filter((u) => u.w === 1);
  return { users, wsId: users[0].ws.id, projectId: users[0].ws.projectIds[0] };
}

function stage() {
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
  return STAGES[Math.min(STAGES.length - 1, Math.floor(elapsed / STAGE_SECONDS))];
}

export default function (data) {
  const user = pick(data.users);
  const s = String(stage());
  const base = `${API}/workspaces/${data.wsId}/projects/${data.projectId}/tasks`;
  const list = http.get(`${base}?status=${STATUS}&limit=200`, {
    headers: headers(user),
    tags: { name: 'GET tasks (hot)', kind: 'read', stage: s },
  });
  const tasks = json(list)?.data ?? [];
  if (tasks.length < 2) return;
  const task = pick(tasks);
  const after = pick(tasks.filter((t) => t.id !== task.id));
  const res = http.patch(
    `${base}/${task.id}/move`,
    JSON.stringify({ expectedVersion: task.version, afterId: after.id }),
    {
      headers: headers(user),
      tags: { name: 'PATCH move (hot)', kind: 'write', stage: s },
      responseCallback: http.expectedStatuses({ min: 200, max: 299 }, 409),
    },
  );
  if (res.status === 409) versionConflicts.add(1);
  if (res.status === 429) rateLimited.add(1);
  check(res, { 'hot move 200/409': (r) => r.status === 200 || r.status === 409 });
}

export function handleSummary(data) {
  return summarize(data, {
    scenario: 'hot-column',
    stages: STAGES,
    outDir: __ENV.OUT_DIR || '/load/results',
  });
}
