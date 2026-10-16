import { describe, expect } from 'vitest';

import { Actors, seedTenants, type Tenants } from './harness/actors';
import { errorEnvelope } from './harness/http-client';
import { secCase, useApi } from './harness/suite';

// Đa tenant / workspace (security.md §8: SEC-01, 13..16, 40, 46, 47, 51..55, 58). Case task: task.sec.ts.
// Thân test viết sẵn theo contract — khi route merge chỉ đổi `secCase` → `it`.
// Dữ liệu seed lười trong từng test (KHÔNG beforeAll) để file vẫn nạp được khi chưa có route.

const api = useApi();
const actors = new Actors(api);
let seeded: Promise<Tenants> | undefined;
const tenants = () => (seeded ??= seedTenants(actors));

const WS = 'workspaces/:wsId routes (T-015 + Phase 3)';

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

  secCase('SEC-16', 'Mia bị xóa khỏi ws A, access token còn hạn ⇒ 404 ngay request kế tiếp', WS);
});

describe('RBAC', () => {
  secCase('SEC-13', 'Pam thêm member role OWNER/PM; Pam đổi role ⇒ 403', WS);
  secCase('SEC-14', 'Pam xóa Alice (OWNER); Mia xóa Vic ⇒ 403', WS);
  secCase('SEC-15', 'OWNER duy nhất tự hạ role / tự rời ⇒ 422 LAST_OWNER', WS);
});

describe('Toàn vẹn & race', () => {
  secCase(
    'SEC-40',
    'Đăng ký đồng thời trùng fullName / trùng email ⇒ slug khác nhau / 409, không mồ côi',
    'auth routes (Phase 3)',
    async () => {
      const register = (email: string, fullName: string) =>
        actors.json('POST', '/auth/register', undefined, {
          email,
          password: 'correct-horse-battery-staple-9',
          fullName,
        });
      const tag = `${Date.now()}`;
      // Cùng fullName ⇒ cùng slug gốc: cả 5 phải 201 và slug workspace khác nhau.
      const sameName = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          register(`dup-${tag}-${i}@sec.example`, `Trùng Tên ${tag}`),
        ),
      );
      expect(sameName.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      const slugs = await Promise.all(
        sameName.map(async (r) => {
          const token = (r.json as { data: { accessToken: string } }).data.accessToken;
          const me = await actors.json('GET', '/auth/me', token);
          return (me.json as { data: { memberships: { slug: string }[] } }).data.memberships[0]
            ?.slug;
        }),
      );
      expect(new Set(slugs).size).toBe(5);

      // Cùng email: đúng 1 cái 201, còn lại 409 EMAIL_ALREADY_EXISTS — không 500.
      const sameEmail = await Promise.all(
        Array.from({ length: 5 }, () => register(`same-${tag}@sec.example`, 'Same Email')),
      );
      expect(sameEmail.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    },
  );
  secCase('SEC-46', 'Race LAST_OWNER giữa 2 OWNER (20 lần) ⇒ luôn ≥ 1 OWNER, không deadlock', WS);
});

describe('Workspace xóa mềm (ADR-047/050)', () => {
  secCase('SEC-47', 'ws A đã xóa: mọi route ws ⇒ 404, A biến khỏi danh sách, socket bị đẩy ra', WS);
  secCase('SEC-51', 'Pam/Mia/Bob restore ws A ⇒ 404 giống ws không tồn tại', WS);
  secCase('SEC-52', 'Restore ws chưa xóa / quá purgeAt ⇒ 404', WS);
  secCase('SEC-53', 'Restore đúng lúc job purge chạy ⇒ đúng một bên thắng, không nửa vời', WS);
  secCase('SEC-54', 'GET /workspaces?deleted=true của Pam/Bob không chứa A', WS);
  secCase('SEC-55', 'Route khác trên ws đã xóa (kể cả Alice) ⇒ 404', WS);
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
