import { describe, expect } from 'vitest';

import { Actors, seedTenants, type Tenants } from './harness/actors';
import { errorEnvelope } from './harness/http-client';
import { pendingRoute, useApi } from './harness/suite';

// Đa tenant / RBAC (security.md §8, SEC-01..16, 40..47, 51..55, 58). Toàn bộ chờ route Phase 3.
// Thân test viết sẵn theo contract — khi route merge chỉ đổi `pendingRoute` → `it`.
// Dữ liệu seed lười trong từng test (KHÔNG beforeAll) để file vẫn nạp được khi chưa có route.

const api = useApi();
const actors = new Actors(api);
let seeded: Promise<Tenants> | undefined;
const tenants = () => (seeded ??= seedTenants(actors));

const WS = 'workspaces/:wsId routes (T-015 + Phase 3)';
const TASK = 'task routes (Phase 3)';

describe('IDOR chéo workspace', () => {
  pendingRoute(
    'SEC-01',
    'Bob đọc projects của ws A ⇒ 404 giống hệt ws không tồn tại',
    WS,
    async () => {
      const t = await tenants();
      const foreign = await actors.json('GET', `/workspaces/${t.wsA}/projects`, t.bob.accessToken);
      const missing = await actors.json(
        'GET',
        `/workspaces/00000000-0000-7000-8000-000000000000/projects`,
        t.bob.accessToken,
      );
      expect(foreign.status).toBe(404);
      expect(errorEnvelope(foreign).error).toEqual(errorEnvelope(missing).error);
    },
  );

  pendingRoute(
    'SEC-02',
    'Bob dùng URL ws B với projectId/taskId thuộc A ⇒ 404, DB không đổi',
    TASK,
    async () => {
      const t = await tenants();
      const base = `/workspaces/${t.wsB}/projects/${t.projectA.id}/tasks`;
      const attempts = [
        actors.json('GET', base, t.bob.accessToken),
        actors.json('POST', base, t.bob.accessToken, { title: 'chen ngang' }),
        actors.json('PATCH', `${base}/${t.pamTask.id}`, t.bob.accessToken, {
          expectedVersion: t.pamTask.version,
          title: 'hacked',
        }),
        actors.json('DELETE', `${base}/${t.pamTask.id}`, t.bob.accessToken),
      ];
      for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
      const after = await actors.json(
        'GET',
        `/workspaces/${t.wsA}/projects/${t.projectA.id}/tasks/${t.pamTask.id}`,
        t.alice.accessToken,
      );
      expect((after.json as { data: { title: string; version: number } }).data).toMatchObject({
        title: 'task của Pam',
        version: t.pamTask.version,
      });
    },
  );

  pendingRoute(
    'SEC-03',
    'Mia dùng taskId của project khác (cùng ws) dưới URL project hiện tại ⇒ 404',
    TASK,
  );
  pendingRoute(
    'SEC-16',
    'Mia bị xóa khỏi ws A, access token còn hạn ⇒ 404 ngay request kế tiếp',
    WS,
  );
});

describe('Mass assignment', () => {
  pendingRoute(
    'SEC-04',
    'Body chứa workspaceId/projectId/createdById/role/version lạ ⇒ 400, không ghi',
    TASK,
    async () => {
      const t = await tenants();
      const res = await actors.json(
        'POST',
        `/workspaces/${t.wsA}/projects/${t.projectA.id}/tasks`,
        t.mia.accessToken,
        { title: 'x', workspaceId: t.wsB, createdById: t.alice.userId, version: 99 },
      );
      expect(res.status).toBe(400);
      expect(errorEnvelope(res).error.code).toBe('VALIDATION_ERROR');
    },
  );
});

describe('RBAC', () => {
  pendingRoute('SEC-05', 'Vic (VIEWER) tạo/sửa/move/assign/xóa task ⇒ 403 cả 5', TASK, async () => {
    const t = await tenants();
    const base = `/workspaces/${t.wsA}/projects/${t.projectA.id}/tasks`;
    const v = t.pamTask.version;
    const results = await Promise.all([
      actors.json('POST', base, t.vic.accessToken, { title: 'x' }),
      actors.json('PATCH', `${base}/${t.pamTask.id}`, t.vic.accessToken, {
        expectedVersion: v,
        title: 'x',
      }),
      actors.json('PATCH', `${base}/${t.pamTask.id}/move`, t.vic.accessToken, {
        expectedVersion: v,
        status: 'IN_PROGRESS',
      }),
      actors.json('PATCH', `${base}/${t.pamTask.id}/assignee`, t.vic.accessToken, {
        expectedVersion: v,
        assigneeId: t.vic.userId,
      }),
      actors.json('DELETE', `${base}/${t.pamTask.id}`, t.vic.accessToken),
    ]);
    for (const res of results) {
      expect(res.status).toBe(403);
      expect(errorEnvelope(res).error.code).toBe('FORBIDDEN_ACCESS');
    }
  });

  pendingRoute('SEC-06', 'Mia xóa task do Pam tạo ⇒ 403, task còn nguyên', TASK, async () => {
    const t = await tenants();
    const base = `/workspaces/${t.wsA}/projects/${t.projectA.id}/tasks`;
    const res = await actors.json('DELETE', `${base}/${t.pamTask.id}`, t.mia.accessToken);
    expect(res.status).toBe(403);
    const still = await actors.json('GET', `${base}/${t.pamTask.id}`, t.alice.accessToken);
    expect(still.status).toBe(200);
  });

  pendingRoute('SEC-07', 'Mia xóa task của chính Mia ⇒ 200 { id, version }', TASK);
  pendingRoute('SEC-08', 'Pam xóa task của Mia; Alice xóa task bất kỳ ⇒ 200', TASK);
  pendingRoute('SEC-09', 'Task createdById = null: Mia 403 / Pam 200', TASK);
  pendingRoute(
    'SEC-10',
    'Project archived: ghi ⇒ 422 PROJECT_ARCHIVED; Vic ⇒ 403 (thứ tự kiểm tra)',
    TASK,
  );
  pendingRoute('SEC-11', 'Mia gán task cho Bob (ngoài ws) ⇒ 422, không xác nhận Bob tồn tại', TASK);
  pendingRoute('SEC-12', 'Mia đổi assignee task của Pam sang Vic ⇒ 403', TASK);
  pendingRoute('SEC-12b', 'Mia tạo task assigneeId = Vic / = chính Mia ⇒ 403 / 201', TASK);
  pendingRoute('SEC-12c', 'Pam tạo task assigneeId = Bob ⇒ 422, không tạo task', TASK);
  pendingRoute('SEC-13', 'Pam thêm member role OWNER/PM; Pam đổi role ⇒ 403', WS);
  pendingRoute('SEC-14', 'Pam xóa Alice (OWNER); Mia xóa Vic ⇒ 403', WS);
  pendingRoute('SEC-15', 'OWNER duy nhất tự hạ role / tự rời ⇒ 422 LAST_OWNER', WS);
  pendingRoute(
    'SEC-42',
    'Vic PATCH với version cũ ⇒ 403 (không 409, không lộ details.current)',
    TASK,
  );
  pendingRoute(
    'SEC-43',
    'Pam gán task cho Vic (VIEWER) ⇒ 422 ASSIGNEE_NOT_MEMBER cùng message',
    TASK,
  );
});

describe('Toàn vẹn & race', () => {
  pendingRoute(
    'SEC-40',
    'Đăng ký đồng thời trùng fullName / trùng email ⇒ slug khác nhau / 409, không mồ côi',
    'auth routes (Phase 3)',
  );
  pendingRoute(
    'SEC-44',
    'Hạ Mia xuống VIEWER ⇒ bỏ gán task chưa xóa trong cùng transaction + audit',
    `${WS} + ${TASK}`,
  );
  pendingRoute(
    'SEC-45',
    'Race gán task cho Mia ‖ hạ Mia xuống VIEWER (20 lần) ⇒ không bao giờ VIEWER được gán',
    `${WS} + ${TASK}`,
  );
  pendingRoute(
    'SEC-46',
    'Race LAST_OWNER giữa 2 OWNER (20 lần) ⇒ luôn ≥ 1 OWNER, không deadlock',
    WS,
  );
});

describe('Workspace xóa mềm (ADR-047/050)', () => {
  pendingRoute(
    'SEC-47',
    'ws A đã xóa: mọi route ws ⇒ 404, A biến khỏi danh sách, socket bị đẩy ra',
    WS,
  );
  pendingRoute('SEC-51', 'Pam/Mia/Bob restore ws A ⇒ 404 giống ws không tồn tại', WS);
  pendingRoute('SEC-52', 'Restore ws chưa xóa / quá purgeAt ⇒ 404', WS);
  pendingRoute('SEC-53', 'Restore đúng lúc job purge chạy ⇒ đúng một bên thắng, không nửa vời', WS);
  pendingRoute('SEC-54', 'GET /workspaces?deleted=true của Pam/Bob không chứa A', WS);
  pendingRoute('SEC-55', 'Route khác trên ws đã xóa (kể cả Alice) ⇒ 404', WS);
});

describe('Tìm kiếm member (ADR-083)', () => {
  pendingRoute(
    'SEC-58',
    'q=bob không trả Bob (ws khác); q=% và q=_ khớp nghĩa đen',
    WS,
    async () => {
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
    },
  );
});
