import { randomUUID } from 'node:crypto';

import type { RawResponse } from './http-client';
import type { ApiUnderTest } from './suite';

/**
 * Dựng dữ liệu CHỈ qua API công khai (data-and-api.md §2) — không chọc DB. Viết theo contract
 * trước khi route tồn tại; các test dùng helper này hiện là PENDING-ROUTE.
 */
export type Role = 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER';

export interface Actor {
  userId: string;
  email: string;
  password: string;
  accessToken: string;
  /** Cặp `name=value` của cookie refresh (để gửi lại trong header Cookie). */
  refreshCookie: string;
  defaultWorkspaceId: string;
}

const PASSWORD = 'correct-horse-battery-staple-9';

/** IP ngẫu nhiên (10.x.y.z) cho request chưa xác thực — API chạy với TRUST_PROXY_HOPS=1 nên đây là IP client. */
const octet = () => 1 + Math.floor(Math.random() * 254);
export const randomIp = () => `10.${octet()}.${octet()}.${octet()}`;

function data<T>(res: RawResponse, expected: number, what = ''): T {
  if (res.status !== expected) {
    throw new Error(
      `${what} — mong đợi HTTP ${expected}, nhận ${res.status}: ${res.text.slice(0, 500)}`,
    );
  }
  return (res.json as { data: T }).data;
}

export function refreshCookieOf(res: RawResponse): string {
  const raw = res.headers['set-cookie'] ?? [];
  const cookie = raw.find((c) => /^(__Secure-|__Host-)?tf_rt=/.test(c));
  if (!cookie) throw new Error(`Không có cookie refresh trong response: ${JSON.stringify(raw)}`);
  return cookie.split(';')[0] ?? '';
}

export class Actors {
  constructor(private readonly api: ApiUnderTest) {}

  json(method: string, path: string, token: string | undefined, body?: unknown) {
    return this.api.request({
      method,
      path: `/api/v1${path}`,
      headers: {
        'content-type': body === undefined && method === 'GET' ? undefined : 'application/json',
        authorization: token ? `Bearer ${token}` : undefined,
        origin: this.api.webOrigin,
        'x-forwarded-for': token ? undefined : randomIp(),
      },
      body: body === undefined ? (method === 'GET' ? undefined : '') : JSON.stringify(body),
    });
  }

  async register(label: string): Promise<Actor> {
    const email = `${label}-${randomUUID()}@sec.example`;
    const res = await this.json('POST', '/auth/register', undefined, {
      email,
      password: PASSWORD,
      fullName: `Sec ${label}`,
    });
    const body = data<{ accessToken: string; user: { id: string }; defaultWorkspaceId: string }>(
      res,
      201,
      'POST /auth/register',
    );
    return {
      userId: body.user.id,
      email,
      password: PASSWORD,
      accessToken: body.accessToken,
      refreshCookie: refreshCookieOf(res),
      defaultWorkspaceId: body.defaultWorkspaceId,
    };
  }

  async addMember(owner: Actor, wsId: string, member: Actor, role: Role) {
    const res = await this.json('POST', `/workspaces/${wsId}/members`, owner.accessToken, {
      email: member.email,
      role,
    });
    return data<unknown>(res, 201, `POST /workspaces/${wsId}/members`);
  }

  async createProject(actor: Actor, wsId: string, keyPrefix: string) {
    const res = await this.json('POST', `/workspaces/${wsId}/projects`, actor.accessToken, {
      name: `Project ${keyPrefix}`,
      keyPrefix,
    });
    return data<{ id: string }>(res, 201, `POST /workspaces/${wsId}/projects`);
  }

  async createTask(actor: Actor, wsId: string, projectId: string, title = 'sec task') {
    const res = await this.json(
      'POST',
      `/workspaces/${wsId}/projects/${projectId}/tasks`,
      actor.accessToken,
      { title },
    );
    return data<{ id: string; version: number }>(res, 201, 'POST …/tasks');
  }

  /** `origin: null` ⇒ KHÔNG gửi header Origin (khác với bỏ trống = origin hợp lệ). */
  refresh(cookie: string, origin: string | null = this.api.webOrigin) {
    return this.api.request({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: origin ?? undefined,
        'x-forwarded-for': randomIp(),
      },
      body: '',
    });
  }
}

/**
 * Bối cảnh chuẩn của security.md §8: ws A (Alice OWNER, Pam PM, Mia MEMBER, Vic VIEWER), ws B
 * (Bob OWNER). Mỗi ws có 1 project. Task: `seedTasks`.
 */
export async function seedTenants(actors: Actors) {
  // Tuần tự có chủ đích: seed không phải nơi thử đồng thời (race có test riêng — SEC-40).
  const alice = await actors.register('alice');
  const pam = await actors.register('pam');
  const mia = await actors.register('mia');
  const vic = await actors.register('vic');
  const bob = await actors.register('bob');
  const wsA = alice.defaultWorkspaceId;
  const wsB = bob.defaultWorkspaceId;
  await actors.addMember(alice, wsA, pam, 'PM');
  await actors.addMember(alice, wsA, mia, 'MEMBER');
  await actors.addMember(alice, wsA, vic, 'VIEWER');
  const projectA = await actors.createProject(alice, wsA, 'SECA');
  const projectB = await actors.createProject(bob, wsB, 'SECB');
  return { alice, pam, mia, vic, bob, wsA, wsB, projectA, projectB };
}

export type Tenants = Awaited<ReturnType<typeof seedTenants>>;

/** Thêm task (cần module task — T-018): của Pam, của Mia (ws A) và của Bob (ws B). */
export async function seedTasks(actors: Actors, t: Tenants) {
  const pamTask = await actors.createTask(t.pam, t.wsA, t.projectA.id, 'task của Pam');
  const miaTask = await actors.createTask(t.mia, t.wsA, t.projectA.id, 'task của Mia');
  const bobTask = await actors.createTask(t.bob, t.wsB, t.projectB.id, 'task của Bob');
  return { ...t, pamTask, miaTask, bobTask };
}
