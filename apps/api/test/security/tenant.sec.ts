import { describe, expect } from 'vitest';

import { seedTenants, type Actor, type Tenants } from './harness/actors';
import { useCompanyApi } from './harness/company';
import { errorEnvelope } from './harness/http-client';
import { connected, emitAck, nextEvent, openSocket } from './harness/socket';
import { outOfScope, secCase } from './harness/suite';

// Đa tenant / workspace (security.md §8: SEC-01, 13..16, 40, 46, 47, 51..55, 58). Case task: task.sec.ts.
// Dữ liệu seed lười trong từng test (KHÔNG beforeAll). Ca LÀM ĐỔI dữ liệu (xóa member/ws, đổi role) dựng
// tenant riêng (`fresh`) để không làm bẩn bối cảnh chung của ca khác (F4).

const { api, actors } = useCompanyApi();
let seeded: Promise<Tenants> | undefined;
const tenants = () => (seeded ??= seedTenants(actors));

const WS = 'workspaces/:wsId routes (T-015 + Phase 3)';
const NIL_WS = '00000000-0000-7000-8000-000000000000';
const fresh = () => seedTenants(actors);
type Res = Awaited<ReturnType<typeof actors.json>>;

/** 404 chống dò tồn tại: status 404 và lỗi GIỐNG HỆT cùng route trên một ws không tồn tại. */
async function expect404LikeMissing(
  method: string,
  path: (ws: string) => string,
  ws: string,
  actor: Actor,
  body?: unknown,
) {
  const res = await actors.json(method, path(ws), actor.accessToken, body);
  expect(res.status, `${method} ${path(ws)}`).toBe(404);
  const missing = await actors.json(method, path(NIL_WS), actor.accessToken, body);
  expect(errorEnvelope(res).error).toEqual(errorEnvelope(missing).error);
}

/** userId → role, đọc bằng quyền của `viewer`; viewer không còn là member ⇒ undefined. */
async function rolesOf(ws: string, viewer: Actor): Promise<Record<string, string> | undefined> {
  const res = await actors.json('GET', `/workspaces/${ws}/members?limit=100`, viewer.accessToken);
  if (res.status !== 200) return undefined;
  const rows = (res.json as { data: { userId: string; role: string }[] }).data;
  return Object.fromEntries(rows.map((m) => [m.userId, m.role]));
}

const setRole = (actor: Actor, ws: string, userId: string, role: string) =>
  actors.json('PATCH', `/workspaces/${ws}/members/${userId}`, actor.accessToken, { role });
const removeMember = (actor: Actor, ws: string, userId: string) =>
  actors.json('DELETE', `/workspaces/${ws}/members/${userId}`, actor.accessToken);
const restore = (actor: Actor, ws: string) =>
  actors.json('POST', `/workspaces/${ws}/restore`, actor.accessToken);
const ruleOf = (res: Res) =>
  (errorEnvelope(res).error as { details?: { rule?: string } }).details?.rule;

async function deleteWorkspace(owner: Actor, ws: string) {
  const got = await actors.json('GET', `/workspaces/${ws}`, owner.accessToken);
  expect(got.status).toBe(200);
  const { slug } = (got.json as { data: { slug: string } }).data;
  const del = await actors.json('DELETE', `/workspaces/${ws}`, owner.accessToken, {
    confirmSlug: slug,
  });
  expect(del.status, 'DELETE ws').toBe(200);
}

async function deletedIds(actor: Actor): Promise<string[]> {
  const res = await actors.json('GET', '/workspaces?deleted=true', actor.accessToken);
  expect(res.status).toBe(200);
  return (res.json as { data: { id: string }[] }).data.map((w) => w.id);
}

describe('IDOR chéo workspace', () => {
  secCase('SEC-01', 'Bob đọc projects của ws A ⇒ 404 giống hệt ws không tồn tại', WS, async () => {
    const t = await tenants();
    const foreign = await actors.json('GET', `/workspaces/${t.wsA}/projects`, t.bob.accessToken);
    const missing = await actors.json(
      'GET',
      `/workspaces/00000000-0000-7000-8000-000000000000/projects`,
      t.bob.accessToken,
    );
    expect(foreign.status).toBe(404);
    expect(errorEnvelope(foreign).error).toEqual(errorEnvelope(missing).error);
  });

  secCase(
    'SEC-16',
    'Mia bị xóa khỏi ws A, access token còn hạn ⇒ 404 ngay request kế tiếp',
    WS,
    async () => {
      const t = await fresh();
      const projects = (ws: string) => `/workspaces/${ws}/projects`;
      const project = (ws: string) => `/workspaces/${ws}/projects/${t.projectA.id}`;
      // Đối chứng: trước khi bị xóa, cùng token đọc được cả hai route.
      expect((await actors.json('GET', projects(t.wsA), t.mia.accessToken)).status).toBe(200);
      expect((await actors.json('GET', project(t.wsA), t.mia.accessToken)).status).toBe(200);
      expect((await removeMember(t.alice, t.wsA, t.mia.userId)).status).toBe(200);
      // Cùng access token (chưa hết hạn, không refresh): membership đọc DB mỗi request (REM-08).
      await expect404LikeMissing('GET', projects, t.wsA, t.mia);
      await expect404LikeMissing(
        'GET',
        (ws) => `/workspaces/${ws}/projects/${t.projectA.id}`,
        t.wsA,
        t.mia,
      );
    },
  );
});

describe('RBAC', () => {
  secCase('SEC-13', 'Pam thêm member role OWNER/PM; Pam đổi role ⇒ 403', WS, async () => {
    const t = await fresh();
    const nina = await actors.createUser('nina');
    for (const role of ['OWNER', 'PM']) {
      const res = await actors.json('POST', `/workspaces/${t.wsA}/members`, t.pam.accessToken, {
        userId: nina.userId,
        role,
      });
      expect(res.status, `Pam thêm ${role}`).toBe(403);
    }
    const changes: [Actor, string][] = [
      [t.mia, 'VIEWER'],
      [t.vic, 'MEMBER'],
      [t.alice, 'PM'],
    ];
    for (const [target, role] of changes) {
      expect(
        (await setRole(t.pam, t.wsA, target.userId, role)).status,
        `Pam đổi role → ${role}`,
      ).toBe(403);
    }
    const roles = await rolesOf(t.wsA, t.alice);
    expect(roles?.[nina.userId]).toBeUndefined();
    expect([t.alice, t.pam, t.mia, t.vic].map((a) => roles?.[a.userId])).toEqual([
      'OWNER',
      'PM',
      'MEMBER',
      'VIEWER',
    ]);
  });
  secCase('SEC-14', 'Pam xóa Alice (OWNER); Mia xóa Vic ⇒ 403', WS, async () => {
    const t = await fresh();
    expect((await removeMember(t.pam, t.wsA, t.alice.userId)).status).toBe(403);
    expect((await removeMember(t.mia, t.wsA, t.vic.userId)).status).toBe(403);
    const roles = await rolesOf(t.wsA, t.alice);
    expect(roles?.[t.alice.userId]).toBe('OWNER');
    expect(roles?.[t.vic.userId]).toBe('VIEWER');
  });
  secCase('SEC-15', 'OWNER duy nhất tự hạ role / tự rời ⇒ 422 LAST_OWNER', WS, async () => {
    const alice = await actors.register('s15-alice');
    const ws = alice.defaultWorkspaceId;
    for (const res of [
      await setRole(alice, ws, alice.userId, 'PM'),
      await removeMember(alice, ws, alice.userId),
    ]) {
      expect(res.status).toBe(422);
      expect(errorEnvelope(res).error.code).toBe('BUSINESS_RULE_VIOLATION');
      expect(ruleOf(res)).toBe('LAST_OWNER');
    }
    expect((await rolesOf(ws, alice))?.[alice.userId]).toBe('OWNER');
  });
});

describe('Toàn vẹn & race', () => {
  secCase(
    'SEC-40',
    // Mốc 3.5 (test-spec-company §6): tự đăng ký bỏ ⇒ race slug chuyển sang tạo ws trùng tên, race email
    // chuyển sang HR thêm nhân viên trùng email.
    'Tạo ws đồng thời trùng tên / thêm nhân viên đồng thời trùng email ⇒ slug khác nhau / 409, không mồ côi',
    'workspace + hr/employees (T-061)',
    async () => {
      const tag = `${Date.now()}`;
      // Cùng tên ⇒ cùng slug gốc: cả 5 phải 201 và slug khác nhau (5 owner khác nhau, chạy song song).
      const owners = await Promise.all(
        Array.from({ length: 5 }, (_, i) => actors.createUser(`s40-${i}`)),
      );
      const sameName = await Promise.all(
        owners.map((o) =>
          actors.json('POST', '/workspaces', o.accessToken, { name: `Trùng ${tag}` }),
        ),
      );
      expect(sameName.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      const slugs = sameName.map((r) => (r.json as { data: { slug: string } }).data.slug);
      expect(new Set(slugs).size).toBe(5);

      // Cùng email: đúng 1 cái 201, còn lại 409 — không 500, chỉ một nhân viên.
      const email = `same-${tag}@sec.example`;
      const sameEmail = await Promise.all(
        Array.from({ length: 5 }, () => actors.hire(actors.ada, { email, fullName: 'Same Email' })),
      );
      expect(sameEmail.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
      // B (T-062): cả hai đường đua (unique email ở users / PK company_members) ⇒ cùng một lỗi.
      for (const res of sameEmail.filter((r) => r.status === 409)) {
        const { error } = errorEnvelope(res);
        expect(error.code).toBe('RESOURCE_CONFLICT');
        expect(error.details).toMatchObject({ reason: 'already_employee', field: 'email' });
      }
      // Bên thắng dùng được trọn vẹn (không mồ côi): token của nó kích hoạt ⇒ đăng nhập bằng email đó. Danh sách
      // `GET hr/employees?q=` (đúng 1 dòng) là T-062 — khẳng định thêm ở SEC-HR khi route có.
      const winner = sameEmail.find((r) => r.status === 201);
      const token = (winner?.json as { data: { activation: { token: string } } }).data.activation
        .token;
      const password = 'correct-horse-battery-staple-9';
      expect(
        (await actors.json('POST', '/auth/activate', undefined, { token, password })).status,
      ).toBe(200);
      expect(
        (await actors.json('POST', '/auth/login', undefined, { email, password })).status,
      ).toBe(200);
      // Thêm lại sau đua vẫn 409 cùng lý do.
      const again = await actors.hire(actors.ada, { email, fullName: 'Same Email' });
      expect(again.status).toBe(409);
    },
  );
  secCase(
    'SEC-46',
    'Race LAST_OWNER giữa 2 OWNER (20 lần × 3 biến thể) ⇒ đúng 1 thắng, bên thua bị từ chối an toàn, luôn còn 1 OWNER',
    WS,
    async () => {
      const alice = await actors.register('s46-alice');
      const olga = await actors.register('s46-olga');
      const ws = alice.defaultWorkspaceId;
      await actors.addMember(alice, ws, olga, 'OWNER');
      const RUNS = 20;
      // ROL-05/REM-07: bên thua nhận 422 LAST_OWNER, hoặc 403/404 vì bên thắng đã hạ/xóa chính actor (X6).
      const safeLoss = (res: Res) =>
        (res.status === 422 && ruleOf(res) === 'LAST_OWNER') ||
        res.status === 403 ||
        res.status === 404;
      const variants: [string, () => Promise<Res[]>][] = [
        [
          'hạ nhau',
          () =>
            Promise.all([
              setRole(alice, ws, olga.userId, 'PM'),
              setRole(olga, ws, alice.userId, 'PM'),
            ]),
        ],
        [
          'Alice hạ Olga ‖ Alice tự rời',
          () =>
            Promise.all([
              setRole(alice, ws, olga.userId, 'PM'),
              removeMember(alice, ws, alice.userId),
            ]),
        ],
        [
          'xóa nhau',
          () =>
            Promise.all([
              removeMember(alice, ws, olga.userId),
              removeMember(olga, ws, alice.userId),
            ]),
        ],
      ];
      for (const [name, race] of variants) {
        for (let i = 0; i < RUNS; i += 1) {
          const tag = `${name} #${String(i)}`;
          const results = await race();
          expect(
            results.filter((r) => r.status === 200),
            `${tag}: ${results.map((r) => r.status).join('/')}`,
          ).toHaveLength(1);
          const loser = results.find((r) => r.status !== 200);
          expect(
            loser !== undefined && safeLoss(loser),
            `${tag}: bên thua ${String(loser?.status)} ${loser?.text.slice(0, 200) ?? ''}`,
          ).toBe(true);
          // Còn ĐÚNG 1 OWNER (đọc bằng quyền của người còn trong ws), rồi dựng lại 2 OWNER cho vòng sau.
          const roles = (await rolesOf(ws, alice)) ?? (await rolesOf(ws, olga));
          const owners = Object.entries(roles ?? {})
            .filter(([, r]) => r === 'OWNER')
            .map(([id]) => id);
          expect(owners, `${tag}: số OWNER`).toHaveLength(1);
          const keeper = owners[0] === alice.userId ? alice : olga;
          const other = keeper === alice ? olga : alice;
          if (roles?.[other.userId])
            expect((await setRole(keeper, ws, other.userId, 'OWNER')).status).toBe(200);
          else await actors.addMember(keeper, ws, other, 'OWNER');
        }
      }
    },
    180_000,
  );
});

describe('Workspace xóa mềm (ADR-047/050)', () => {
  secCase(
    'SEC-47',
    'ws A đã xóa: mọi route ws (Alice OWNER + Mia) ⇒ 404 giống ws không tồn tại, A biến khỏi /workspaces và /auth/me (phần socket: SEC-47b)',
    WS,
    async () => {
      const t = await fresh();
      const task = await actors.createTask(t.alice, t.wsA, t.projectA.id, 'task trước khi xóa ws');
      const routes: [string, (ws: string) => string, unknown?][] = [
        ['GET', (ws) => `/workspaces/${ws}`],
        ['GET', (ws) => `/workspaces/${ws}/projects`],
        ['GET', (ws) => `/workspaces/${ws}/projects/${t.projectA.id}/tasks/${task.id}/audit-logs`],
        ['POST', (ws) => `/workspaces/${ws}/members`, { userId: t.bob.userId, role: 'MEMBER' }],
        ['PATCH', (ws) => `/workspaces/${ws}/members/${t.vic.userId}`, { role: 'MEMBER' }],
      ];
      // Đối chứng TRƯỚC khi xóa: mọi route đều hoạt động với Alice (404 sau đó không phải do sai đường).
      for (const [method, path, body] of routes) {
        const res = await actors.json(method, path(t.wsA), t.alice.accessToken, body);
        expect(res.status, `đối chứng ${method} ${path(t.wsA)}`).toBeLessThan(300);
      }
      await deleteWorkspace(t.alice, t.wsA);
      for (const actor of [t.alice, t.mia]) {
        for (const [method, path, body] of routes)
          await expect404LikeMissing(method, path, t.wsA, actor, body);
        const list = await actors.json('GET', '/workspaces', actor.accessToken);
        expect((list.json as { data: { id: string }[] }).data.map((w) => w.id)).not.toContain(
          t.wsA,
        );
        const me = await actors.json('GET', '/auth/me', actor.accessToken);
        expect(
          (me.json as { data: { memberships: { workspaceId: string }[] } }).data.memberships.map(
            (m) => m.workspaceId,
          ),
        ).not.toContain(t.wsA);
      }
    },
  );
  secCase(
    'SEC-47b',
    'ws A bị xóa khi Mia đang ở phòng project:P1 ⇒ nhận workspace:access-revoked, rời phòng; project:join sau đó ⇒ RESOURCE_NOT_FOUND (WSD-07)',
    'socket auth',
    async () => {
      const t = await fresh();
      const sockets = [t.mia, t.pam].map((a) => openSocket(api, a.accessToken));
      try {
        await Promise.all(sockets.map((s) => connected(s)));
        // Đối chứng (F): trước khi xóa, cả hai vào phòng được ⇒ 404 sau đó không phải do helper sai.
        for (const s of sockets) {
          expect(
            await emitAck(s, 'project:join', { workspaceId: t.wsA, projectId: t.projectA.id }),
          ).toEqual({ ok: true });
        }
        const revoked = sockets.map((s) =>
          nextEvent<{ data: unknown }>(s, 'workspace:access-revoked'),
        );
        await deleteWorkspace(t.alice, t.wsA);
        for (const r of await Promise.all(revoked)) expect(r.data).toEqual({ workspaceId: t.wsA });
        // ws đã xóa ⇒ không tạo được task để đo "không nhận event"; join lại phải bị từ chối như ws lạ.
        for (const s of sockets) {
          expect(
            await emitAck(s, 'project:join', { workspaceId: t.wsA, projectId: t.projectA.id }),
          ).toEqual({ ok: false, code: 'RESOURCE_NOT_FOUND' });
        }
      } finally {
        for (const s of sockets) s.close();
      }
    },
  );
  secCase(
    'SEC-51',
    'Pam/Mia/Vic/Bob restore ws A đã xóa ⇒ 404 giống ws không tồn tại; A vẫn bị xóa',
    WS,
    async () => {
      const t = await fresh();
      await deleteWorkspace(t.alice, t.wsA);
      for (const actor of [t.pam, t.mia, t.vic, t.bob]) {
        await expect404LikeMissing('POST', (ws) => `/workspaces/${ws}/restore`, t.wsA, actor);
      }
      expect(await deletedIds(t.alice)).toContain(t.wsA);
      // Đối chứng: OWNER restore được ⇒ 404 ở trên là từ chối thật, không phải route sai.
      expect((await restore(t.alice, t.wsA)).status).toBe(200);
    },
  );
  secCase(
    'SEC-52',
    'Alice restore ws CHƯA xóa ⇒ 404 giống ws không tồn tại (nửa "quá purgeAt" cần tua giờ ⇒ unit WSR-04)',
    WS,
    async () => {
      const alice = await actors.register('s52-alice');
      await expect404LikeMissing(
        'POST',
        (ws) => `/workspaces/${ws}/restore`,
        alice.defaultWorkspaceId,
        alice,
      );
      // Đối chứng: cùng route trên ws đã xóa ⇒ 200 (route thật sự hoạt động, 404 ở trên không phải do sai đường).
      await deleteWorkspace(alice, alice.defaultWorkspaceId);
      expect((await restore(alice, alice.defaultWorkspaceId)).status).toBe(200);
    },
  );
  outOfScope(
    'SEC-53',
    'Restore đúng lúc job purge chạy ⇒ đúng một bên thắng, không nửa vời',
    'integration WSR-05',
  );
  secCase(
    'SEC-54',
    'GET /workspaces?deleted=true của Pam/Bob không chứa A (Alice thì có)',
    WS,
    async () => {
      const t = await fresh();
      await deleteWorkspace(t.alice, t.wsA);
      expect(await deletedIds(t.alice)).toContain(t.wsA);
      expect(await deletedIds(t.pam)).not.toContain(t.wsA);
      expect(await deletedIds(t.bob)).not.toContain(t.wsA);
    },
  );
  secCase(
    'SEC-55',
    'Route khác trên ws đã xóa (kể cả Alice) ⇒ 404; chỉ route restore thấy ws đã xóa',
    WS,
    async () => {
      const alice = await actors.register('s55-alice');
      const ws = alice.defaultWorkspaceId;
      await deleteWorkspace(alice, ws);
      for (const path of [
        (w: string) => `/workspaces/${w}/projects`,
        (w: string) => `/workspaces/${w}/members`,
      ]) {
        await expect404LikeMissing('GET', path, ws, alice);
      }
      await expect404LikeMissing('PATCH', (w) => `/workspaces/${w}`, ws, alice, {
        name: 'đổi tên khi đã xóa',
      });
      expect((await restore(alice, ws)).status).toBe(200);
      expect(
        (await actors.json('GET', `/workspaces/${ws}/projects`, alice.accessToken)).status,
      ).toBe(200);
    },
  );
});

describe('Tìm kiếm member (ADR-083)', () => {
  secCase('SEC-58', 'q=bob không trả Bob (ws khác); q=% và q=_ khớp nghĩa đen', WS, async () => {
    const t = await tenants();
    const search = async (q: string) => {
      const res = await actors.json(
        'GET',
        `/workspaces/${t.wsA}/members?q=${encodeURIComponent(q)}`,
        t.alice.accessToken,
      );
      expect(res.status).toBe(200);
      return (res.json as { data: { userId: string }[] }).data;
    };
    expect((await search('bob')).map((m) => m.userId)).not.toContain(t.bob.userId);
    expect(await search('%')).toEqual([]);
    expect(await search('_')).toEqual([]);
  });
});
