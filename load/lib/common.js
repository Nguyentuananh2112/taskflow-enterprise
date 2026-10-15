/* global __ENV */
// Hàm dùng chung cho kịch bản k6 (T-027). Chạy bằng image grafana/k6 — không cài k6 vào máy.
import http from 'k6/http';
import { check, fail } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://api:4000';
export const API = `${BASE_URL}/api/v1`;
export const WS_COUNT = Number(__ENV.WS || 5);
export const USERS_PER_WS = Number(__ENV.USERS || 20);
/** Mật khẩu test chung của user seed (load/seed/seed.sql) — không phải secret. */
export const PASSWORD = __ENV.LOAD_PASSWORD || 'load-test-only-Kanban-2026';
export const STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];

export const emailOf = (w, u) => `load.w${w}.u${u}@example.test`;

/**
 * IP giả lập theo user (API chạy với TRUST_PROXY_HOPS=1 như sau load balancer): mỗi người dùng một IP,
 * giống thực tế — tránh mọi VU dồn vào giới hạn theo IP (1000/phút) của một máy k6.
 */
export function ipOf(index) {
  return `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255 || 1}`;
}

/** uuid v4 (định dạng hợp lệ cho X-Client-Id / clientId của socket). */
export function uuid() {
  const h = [];
  for (let i = 0; i < 16; i += 1) h.push(Math.floor(Math.random() * 256));
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = h.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export function headers(user, extra = {}) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${user.token}`,
    'X-Forwarded-For': user.ip,
    'X-Client-Id': user.clientId,
    ...extra,
  };
}

const json = (res) => {
  try {
    return res.json();
  } catch {
    return null;
  }
};

/**
 * Đăng nhập toàn bộ user seed (gọi trong setup(); argon2id ~30–50 ms/lần — ADR-030 KHÔNG đo login) rồi
 * lấy workspace/project của từng người. Access token sống 15 phút ⇒ mỗi lần chạy phải < 15 phút.
 */
export function loginAll() {
  const users = [];
  let index = 0;
  for (let w = 1; w <= WS_COUNT; w += 1) {
    for (let u = 1; u <= USERS_PER_WS; u += 1) {
      index += 1;
      const ip = ipOf(index);
      const res = http.post(
        `${API}/auth/login`,
        JSON.stringify({ email: emailOf(w, u), password: PASSWORD }),
        {
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
          tags: { kind: 'setup' },
        },
      );
      const body = json(res);
      if (!check(res, { 'login 200': (r) => r.status === 200 }) || !body?.data?.accessToken) {
        fail(`login ${emailOf(w, u)} thất bại: ${res.status} ${res.body}`);
      }
      users.push({ w, u, ip, token: body.data.accessToken, clientId: uuid() });
    }
  }
  // Workspace + project: hỏi bằng user OWNER (u=1) của mỗi workspace.
  const workspaces = [];
  for (const owner of users.filter((x) => x.u === 1)) {
    const me = json(
      http.get(`${API}/auth/me`, { headers: headers(owner), tags: { kind: 'setup' } }),
    );
    const wsId = me?.data?.memberships?.[0]?.workspaceId;
    if (!wsId) fail(`không lấy được workspace của user w${owner.w}`);
    const pj = json(
      http.get(`${API}/workspaces/${wsId}/projects`, {
        headers: headers(owner),
        tags: { kind: 'setup' },
      }),
    );
    const projects = pj?.data ?? [];
    // P* = project board thường; R* = project rank dài cho kịch bản rebalance (seed.sql).
    const projectIds = projects.filter((p) => p.keyPrefix.startsWith('P')).map((p) => p.id);
    const rebalanceProjectIds = projects
      .filter((p) => p.keyPrefix.startsWith('R'))
      .map((p) => p.id);
    if (projectIds.length === 0) fail(`workspace ${wsId} không có project P*`);
    workspaces.push({ w: owner.w, id: wsId, projectIds, rebalanceProjectIds });
  }
  for (const user of users) user.ws = workspaces.find((x) => x.w === user.w);
  return users;
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export { json };
