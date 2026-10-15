/* global __ENV, __VU */
// T-027 — Độ trễ realtime: move task qua HTTP ⇒ client khác (cùng project) nhận `task:moved` qua Socket.IO.
// NFR: WebSocket < 100 ms. k6 không có client Socket.IO ⇒ tự nói giao thức Engine.IO v4 trên WebSocket thuần
// (transport websocket-only như FE — ADR-074):
//   server "0{…}" (open) → client "40{auth}" (connect namespace) → server "40{sid}" →
//   client "42<ack>["project:join",{…}]" → server "43<ack>[{ok:true}]" → server "42["task:moved",{…}]";
//   ping "2" ⇒ trả "3".
// Mỗi VU: 1 socket của user A nghe project P + đóng vai user B (cùng workspace) move task trong P mỗi MOVE_EVERY_MS.
// Đo: realtime_e2e_ms = lúc nhận event − lúc bắt đầu gửi HTTP move (cùng đồng hồ của VU) — gồm cả thời gian HTTP;
//     realtime_push_ms = lúc nhận − `occurredAt` của server (cùng máy, đồng hồ chung) — riêng phần đẩy event.
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { clearInterval, setInterval, setTimeout } from 'k6/timers';
import { WebSocket } from 'k6/websockets';

import { API, BASE_URL, USERS_PER_WS, headers, json, loginAll, pick } from '../lib/common.js';
import { summarize } from '../lib/summary.js';

const VUS = Number(__ENV.RT_VUS || 20);
const DURATION_S = Number(__ENV.RT_SECONDS || 120);
const MOVE_EVERY_MS = Number(__ENV.MOVE_EVERY_MS || 1000);
const WS_URL = `${BASE_URL.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;

const e2e = new Trend('realtime_e2e_ms', true);
const push = new Trend('realtime_push_ms', true);
const lost = new Counter('realtime_events_lost');
const connectErrors = new Counter('realtime_connect_errors');

export const options = {
  setupTimeout: '5m',
  summaryTrendStats: ['count', 'avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    realtime_push_ms: ['p(95)<100'],
    realtime_e2e_ms: ['p(95)<400'], // gồm 1 lần PATCH move (NFR ghi 300) + đẩy event (100)
    realtime_connect_errors: ['count==0'],
    'http_req_duration{name:PATCH move}': ['p(95)<300'],
  },
  scenarios: {
    realtime: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: `${DURATION_S + 60}s`,
    },
  },
};

export function setup() {
  return { users: loginAll() };
}

export default function (data) {
  // Cặp người dùng cố định theo VU: listener = u, mover = u+1 trong cùng workspace (cả hai là thành viên).
  const listener = data.users[(__VU - 1) % data.users.length];
  const mover = data.users.find(
    (x) => x.w === listener.w && x.u === (listener.u % USERS_PER_WS) + 1,
  );
  const projectId = pick(listener.ws.projectIds);
  const base = `${API}/workspaces/${listener.ws.id}/projects/${projectId}/tasks`;
  const sent = new Map(); // taskId → thời điểm bắt đầu gửi move
  let column = [];
  let timer = null;

  const ws = new WebSocket(WS_URL, null, { headers: { 'X-Forwarded-For': listener.ip } });

  const moveOnce = () => {
    if (column.length < 2) {
      const res = http.get(`${base}?status=TODO&limit=200`, {
        headers: headers(mover),
        tags: { name: 'GET tasks', kind: 'read' },
      });
      column = json(res)?.data ?? [];
      if (column.length < 2) return;
    }
    const task = pick(column);
    const after = pick(column.filter((t) => t.id !== task.id));
    const t0 = Date.now();
    sent.set(task.id, t0);
    const res = http.patch(
      `${base}/${task.id}/move`,
      JSON.stringify({ expectedVersion: task.version, afterId: after.id }),
      {
        headers: headers(mover),
        tags: { name: 'PATCH move', kind: 'write' },
        responseCallback: http.expectedStatuses({ min: 200, max: 299 }, 409),
      },
    );
    const moved = json(res)?.data;
    if (res.status === 200 && moved) task.version = moved.version;
    else {
      sent.delete(task.id);
      column = []; // 409 hoặc lỗi ⇒ đọc lại cột lần sau
    }
  };

  ws.onmessage = (event) => {
    const msg = String(event.data);
    if (msg === '2') return ws.send('3');
    if (msg.startsWith('0'))
      return ws.send(`40${JSON.stringify({ token: listener.token, clientId: listener.clientId })}`);
    if (msg.startsWith('44')) {
      connectErrors.add(1);
      return ws.close();
    }
    if (msg.startsWith('40')) {
      return ws.send(
        `420${JSON.stringify(['project:join', { workspaceId: listener.ws.id, projectId }])}`,
      );
    }
    if (msg.startsWith('430')) {
      const ack = JSON.parse(msg.slice(3))[0];
      if (!check(ack, { 'project:join ok': (a) => a?.ok === true })) {
        connectErrors.add(1);
        return ws.close();
      }
      timer = setInterval(moveOnce, MOVE_EVERY_MS);
      return undefined;
    }
    if (msg.startsWith('42')) {
      const [type, payload] = JSON.parse(msg.slice(2));
      if (type !== 'task:moved') return undefined;
      const now = Date.now();
      const t0 = sent.get(payload?.data?.task?.id);
      if (t0 !== undefined) {
        e2e.add(now - t0);
        sent.delete(payload.data.task.id);
      }
      if (payload?.occurredAt) push.add(Math.max(0, now - Date.parse(payload.occurredAt)));
    }
    return undefined;
  };
  ws.onerror = () => connectErrors.add(1);

  setTimeout(() => {
    if (timer) clearInterval(timer);
    lost.add(sent.size); // move đã gửi mà không nhận event trước khi kết thúc
    ws.close();
  }, DURATION_S * 1000);
}

export function handleSummary(data) {
  const v = (k) => data.metrics[k]?.values ?? {};
  const f = (x) => (typeof x === 'number' ? x.toFixed(1) : '—');
  const extra = [
    '| Đo realtime | Mẫu | P50 | P95 | P99 | Max (ms) |',
    '|---|---|---|---|---|---|',
    `| realtime_push_ms (occurredAt → client nhận) | ${v('realtime_push_ms').count ?? 0} | ${f(v('realtime_push_ms').med)} | ${f(v('realtime_push_ms')['p(95)'])} | ${f(v('realtime_push_ms')['p(99)'])} | ${f(v('realtime_push_ms').max)} |`,
    `| realtime_e2e_ms (bắt đầu PATCH move → client nhận) | ${v('realtime_e2e_ms').count ?? 0} | ${f(v('realtime_e2e_ms').med)} | ${f(v('realtime_e2e_ms')['p(95)'])} | ${f(v('realtime_e2e_ms')['p(99)'])} | ${f(v('realtime_e2e_ms').max)} |`,
    '',
    `Event mất (move 200 mà không nhận task:moved): ${v('realtime_events_lost').count ?? 0} · lỗi kết nối: ${v('realtime_connect_errors').count ?? 0} · ${VUS} socket, move mỗi ${MOVE_EVERY_MS} ms`,
  ].join('\n');
  return summarize(data, { scenario: 'realtime', outDir: __ENV.OUT_DIR || '/load/results', extra });
}
