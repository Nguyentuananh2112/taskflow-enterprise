import { describe, expect } from 'vitest';

import { Actors } from './harness/actors';
import { errorEnvelope } from './harness/http-client';
import { pendingRoute, useApi } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// Cổng nghiệm thu T-032 (đọc chéo T-028 của F: X2, X5, X8; ADR-110). Chỉ kiểm TRẠNG THÁI CUỐI — không phụ
// thuộc bên nào thắng race hay status của bên thua (409/404 đều được), nên không đổi khi contract thêm
// `version`. Trên main ac11caf: X2 hồi sinh 14/40 vòng, X5 trả 500.

const T032 = 'T-032 lost update workspace/project (ADR-110)';
const ROUNDS = 40;
const api = useApi();
const actors = new Actors(api);
const ok = (status: number) => status >= 200 && status < 300;

describe('Lost update workspace / project', () => {
  pendingRoute(
    'X2',
    `PATCH ‖ DELETE workspace ×${String(ROUNDS)} ⇒ DELETE thành công thì workspace KHÔNG BAO GIỜ sống lại`,
    T032,
    async () => {
      let deleted = 0;
      for (let round = 0; round < ROUNDS; round += 1) {
        await flushRateLimitCounters();
        const owner = await actors.register(`ws-race-${String(round)}`);
        const ws = owner.defaultWorkspaceId;
        const got = await actors.json('GET', `/workspaces/${ws}`, owner.accessToken);
        const { slug } = (got.json as { data: { slug: string } }).data;
        const [patch, del] = await Promise.all([
          actors.json('PATCH', `/workspaces/${ws}`, owner.accessToken, {
            name: `Renamed ${String(round)}`,
          }),
          actors.json('DELETE', `/workspaces/${ws}`, owner.accessToken, { confirmSlug: slug }),
        ]);
        const ctx = `vòng ${String(round)} (patch ${String(patch.status)}, delete ${String(del.status)})`;
        expect(patch.status, `${ctx}: ${patch.text.slice(0, 200)}`).toBeLessThan(500);
        const after = await actors.json('GET', `/workspaces/${ws}`, owner.accessToken);
        if (ok(del.status)) {
          deleted += 1;
          expect(after.status, `${ctx}: workspace đã xóa mềm sống lại`).toBe(404);
        } else {
          // ADR-110: DELETE thua race (PATCH đổi version trước) ⇒ 409 VERSION_CONFLICT, workspace còn nguyên.
          expect(del.status, `${ctx}: ${del.text.slice(0, 200)}`).toBe(409);
          expect(errorEnvelope(del).error.code, ctx).toBe('VERSION_CONFLICT');
          expect(after.status, `${ctx}: DELETE thua thì workspace phải còn`).toBe(200);
        }
      }
      // Không xanh giả: phải có vòng DELETE thắng thì mới kiểm được chuyện hồi sinh.
      expect(deleted, 'số vòng DELETE thắng').toBeGreaterThan(0);
    },
  );

  pendingRoute(
    'X8',
    `Đổi tên ‖ archive project ×${String(ROUNDS)} ⇒ archive thành công thì project vẫn archived`,
    T032,
    async () => {
      const owner = await actors.register('pj-race');
      const ws = owner.defaultWorkspaceId;
      for (let round = 0; round < ROUNDS; round += 1) {
        await flushRateLimitCounters();
        const project = await actors.createProject(
          owner,
          ws,
          `R${String(round).padStart(2, '0')}X`,
        );
        const base = `/workspaces/${ws}/projects/${project.id}`;
        const [rename, archive] = await Promise.all([
          actors.json('PATCH', base, owner.accessToken, { name: `Renamed ${String(round)}` }),
          actors.json('POST', `${base}/archive`, owner.accessToken),
        ]);
        const ctx = `vòng ${String(round)} (rename ${String(rename.status)}, archive ${String(archive.status)})`;
        expect(rename.status, ctx).toBeLessThan(500);
        if (!ok(archive.status)) continue; // archive thua race ⇒ không có gì để kiểm
        const after = await actors.json('GET', base, owner.accessToken);
        const data = (after.json as { data: { archivedAt: string | null } }).data;
        expect(data.archivedAt, `${ctx}: archive bị đổi tên song song gỡ mất`).not.toBeNull();
      }
    },
  );

  pendingRoute(
    'X5',
    'Cursor tự chế (after không phải uuid / kind sai) ⇒ 400 VALIDATION_ERROR, không 500',
    T032,
    async () => {
      const owner = await actors.register('cursor');
      const ws = owner.defaultWorkspaceId;
      const cursor = (k: string, v: unknown) =>
        Buffer.from(JSON.stringify({ k, v })).toString('base64url');
      for (const [path, kind] of [
        [`/workspaces/${ws}/members`, 'members'],
        [`/workspaces/${ws}/projects`, 'projects'],
      ] as const) {
        for (const after of ['x', "' OR 1=1 --", '00000000-0000-0000-0000-00000000000g']) {
          const res = await actors.json(
            'GET',
            `${path}?cursor=${cursor(kind, { after })}`,
            owner.accessToken,
          );
          expect(res.status, `${kind} after=${after}: ${res.text.slice(0, 200)}`).toBe(400);
          expect(errorEnvelope(res).error.code).toBe('VALIDATION_ERROR');
        }
      }
    },
  );
});
