import { randomUUID } from 'node:crypto';

import type {
  ActivateResponse,
  CompanyGrant,
  HireEmployeeResponse,
  OffboardingResponse,
  ReissueActivationResponse,
} from '@taskflow/contracts/company';
import { beforeAll } from 'vitest';

import { Actors, refreshCookieOf, type Role } from './actors';
import { runBootstrap, type BootstrapResult } from './company-bootstrap';
import type { RawResponse } from './http-client';
import { useApi, type ApiUnderTest, type PendingStartup } from './suite';
import { flushRateLimitCounters } from './valkey';

/**
 * Harness Mốc 3.5 "cấp công ty" (ADR-140, docs/design/test-spec-company.md §1). Không còn tự đăng ký: mọi
 * người do Admin (Ada, tạo bằng `admin:bootstrap`) thêm qua `POST hr/employees` rồi tự kích hoạt. Chỉ API
 * công khai + CLI — không route test-only, không chèn DB.
 */

const PASSWORD = 'correct-horse-battery-staple-9';

/** Người thuộc công ty — không có `defaultWorkspaceId` (workspace tạo tường minh bằng `newWorkspace`). */
export interface CompanyActor {
  userId: string;
  email: string;
  password: string;
  accessToken: string;
  refreshCookie: string;
}

/** Người chờ kích hoạt (`createUser(…, { pending: true })`) — ca kích hoạt tự gọi `activate`. */
export interface PendingEmployee {
  userId: string;
  email: string;
  token: string;
  version: number;
}

function data<T>(res: RawResponse, expected: readonly number[], what: string): T {
  if (!expected.includes(res.status)) {
    throw new Error(
      `${what} — mong đợi HTTP ${expected.join('|')}, nhận ${res.status}: ${res.text.slice(0, 500)}`,
    );
  }
  return (res.json as { data: T }).data;
}

export interface CreateUserOptions {
  grants?: CompanyGrant[];
  admin?: boolean;
  /** Dừng trước `activate`. */
  pending?: boolean;
  startDate?: string;
}

interface NotificationRow {
  id: string;
  type: string;
  refId: string;
}

export { DAY_MS, shiftIso, tokenOfLink, type BootstrapResult } from './company-bootstrap';

export class CompanyActors extends Actors {
  constructor(
    api: ApiUnderTest,
    private readonly boot: () => BootstrapResult,
  ) {
    super(api);
  }

  /** Admin đầu tiên do bootstrap tạo (thiết lập trong `useCompanyApi`). */
  ada!: CompanyActor;

  get bootstrap(): BootstrapResult {
    return this.boot();
  }

  /** `POST auth/activate` ⇒ phiên mới như đăng nhập (không login lại). */
  async activate(
    who: { userId: string; email: string; token: string },
    password = PASSWORD,
  ): Promise<CompanyActor> {
    const res = await this.json('POST', '/auth/activate', undefined, {
      token: who.token,
      password,
    });
    const body = data<ActivateResponse>(res, [200, 201], 'POST /auth/activate');
    return {
      userId: body.user.id,
      email: who.email,
      password,
      accessToken: body.accessToken,
      refreshCookie: refreshCookieOf(res),
    };
  }

  async login(actor: Pick<CompanyActor, 'email' | 'password'>): Promise<CompanyActor> {
    const res = await this.json('POST', '/auth/login', undefined, {
      email: actor.email,
      password: actor.password,
    });
    const body = data<{ accessToken: string; user: { id: string } }>(
      res,
      [200],
      'POST /auth/login',
    );
    return {
      userId: body.user.id,
      email: actor.email,
      password: actor.password,
      accessToken: body.accessToken,
      refreshCookie: refreshCookieOf(res),
    };
  }

  hire(hr: CompanyActor, body: { email: string; fullName: string; startDate?: string }) {
    return this.json('POST', '/hr/employees', hr.accessToken, body);
  }

  async setAccess(
    admin: CompanyActor,
    userId: string,
    access: { role: 'ADMIN' | 'EMPLOYEE'; grants: CompanyGrant[]; expectedVersion: number },
  ) {
    const res = await this.json('PUT', `/admin/access/${userId}`, admin.accessToken, access);
    return data<unknown>(res, [200], `PUT /admin/access/${userId}`);
  }

  /**
   * Ada thêm nhân viên ⇒ kích hoạt ⇒ (tuỳ chọn) đổi role/grant. Đổi quyền có thể thu hồi phiên (ADR-105) ⇒
   * đăng nhập lại để có phiên mang quyền mới. Xóa bộ đếm hạn mức trước (thêm nhân viên 30/giờ/actor — §0.5).
   */
  async createUser(
    label: string,
    opts: { pending: true } & CreateUserOptions,
  ): Promise<PendingEmployee>;
  async createUser(label: string, opts?: CreateUserOptions): Promise<CompanyActor>;
  async createUser(
    label: string,
    opts: CreateUserOptions = {},
  ): Promise<CompanyActor | PendingEmployee> {
    await flushRateLimitCounters();
    const email = `${label}-${randomUUID()}@sec.example`;
    const hired = data<HireEmployeeResponse>(
      await this.hire(this.ada, {
        email,
        fullName: `Sec ${label}`,
        ...(opts.startDate ? { startDate: opts.startDate } : {}),
      }),
      [201],
      'POST /hr/employees',
    );
    const { userId, version } = hired.employee;
    if (!hired.activation)
      throw new Error(`POST /hr/employees ${email}: email mới mà activation null`);
    const token = hired.activation.token;
    if (opts.pending) {
      if (opts.admin || opts.grants?.length) {
        throw new Error('createUser: pending không kèm admin/grants (đổi quyền sau khi kích hoạt)');
      }
      return { userId, email, token, version };
    }
    const actor = await this.activate({ userId, email, token });
    if (!opts.admin && !opts.grants?.length) return actor;
    await this.setAccess(this.ada, userId, {
      role: opts.admin ? 'ADMIN' : 'EMPLOYEE',
      grants: opts.admin ? [] : (opts.grants ?? []),
      expectedVersion: version,
    });
    return this.login(actor);
  }

  async newWorkspace(owner: CompanyActor, name = `Sec WS ${randomUUID().slice(0, 8)}`) {
    const res = await this.json('POST', '/workspaces', owner.accessToken, { name });
    return data<{ id: string; slug: string }>(res, [201], 'POST /workspaces');
  }

  async addToWorkspace(owner: CompanyActor, wsId: string, userId: string, role: Role) {
    const res = await this.json('POST', `/workspaces/${wsId}/members`, owner.accessToken, {
      userId,
      role,
    });
    return data<unknown>(res, [201], `POST /workspaces/${wsId}/members`);
  }

  offboardRaw(hr: CompanyActor, userId: string, lastDay: string, reason?: string) {
    return this.json('PUT', `/hr/employees/${userId}/offboarding`, hr.accessToken, {
      lastDay,
      ...(reason ? { reason } : {}),
    });
  }

  async offboard(hr: CompanyActor, userId: string, lastDay: string, reason?: string) {
    return data<OffboardingResponse>(
      await this.offboardRaw(hr, userId, lastDay, reason),
      [200],
      `PUT /hr/employees/${userId}/offboarding`,
    );
  }

  async reissueActivation(hr: CompanyActor, userId: string) {
    const res = await this.json(
      'POST',
      `/hr/employees/${userId}/activation-link`,
      hr.accessToken,
      {},
    );
    return data<ReissueActivationResponse>(res, [200, 201], 'POST …/activation-link').activation;
  }

  /** Mọi id thông báo hiện có của `actor` (đi hết các trang) — mốc cho `newNotifications`. */
  async notificationIds(actor: CompanyActor): Promise<Set<string>> {
    return new Set((await this.allNotifications(actor)).map((n) => n.id));
  }

  /**
   * §0.4: delta có lọc `refId` — thông báo xuất hiện SAU `before` (tập id lấy bằng `notificationIds`), đúng
   * `type` + `refId`. So theo id, không theo `createdAt` (giờ nghiệp vụ dời theo mốc, không so được với giờ máy).
   */
  async newNotifications(
    actor: CompanyActor,
    before: ReadonlySet<string>,
    filter: { type: string; refId: string },
  ): Promise<NotificationRow[]> {
    return (await this.allNotifications(actor)).filter(
      (n) => !before.has(n.id) && n.type === filter.type && n.refId === filter.refId,
    );
  }

  private async allNotifications(actor: CompanyActor): Promise<NotificationRow[]> {
    const out: NotificationRow[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const qs: string = cursor ? `?limit=50&cursor=${encodeURIComponent(cursor)}` : '?limit=50';
      const res = await this.json('GET', `/me/notifications${qs}`, actor.accessToken);
      if (res.status !== 200) {
        throw new Error(`GET /me/notifications — ${res.status}: ${res.text.slice(0, 300)}`);
      }
      const body = res.json as {
        data: NotificationRow[];
        meta: { page?: { nextCursor: string | null } };
      };
      out.push(...body.data);
      cursor = body.meta.page?.nextCursor ?? null;
      if (!cursor) return out;
    }
    throw new Error('GET /me/notifications: quá 20 trang — lọc theo refId không đáng tin');
  }
}

const apiStarted = (api: ApiUnderTest): boolean => {
  try {
    return Boolean(api.baseUrl);
  } catch {
    return false;
  }
};

/**
 * `useApi` + bootstrap (§1.1): reset DB ⇒ `admin:bootstrap --json` ⇒ khởi động API ⇒ Ada kích hoạt. Trả
 * `{ api, actors }`; `actors.ada` dùng được từ hook/test.
 */
export function useCompanyApi(envOverrides: Record<string, string> = {}, pending?: PendingStartup) {
  let boot: BootstrapResult | undefined;
  const adaEmail = `ada-${randomUUID()}@sec.example`;
  const api = useApi(envOverrides, pending, {
    beforeStart: async ({ env }) => {
      boot = await runBootstrap(env, { email: adaEmail });
    },
  });
  const actors = new CompanyActors(api, () => {
    if (!boot) throw new Error('bootstrap chưa chạy (chỉ dùng trong test/hook)');
    return boot;
  });
  beforeAll(async () => {
    // API bị từ chối khởi động theo `pending` ⇒ beforeEach của useApi skip từng ca, không kích hoạt.
    if (!boot || !apiStarted(api)) return;
    actors.ada = await actors.activate(boot);
  }, 60_000);
  return { api, actors };
}
