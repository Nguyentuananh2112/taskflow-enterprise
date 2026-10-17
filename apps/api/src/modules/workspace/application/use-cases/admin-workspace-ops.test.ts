// T-061a: dữ liệu workspace cho Admin công ty (company-level ADR-134) — mồ côi / giao OWNER / lưu trữ.
import { beforeEach, describe, expect, it } from 'vitest';

import { isOrphanWorkspace } from '../../domain/workspace';
import { createWorkspaceHarness, type WorkspaceHarness } from '../../testing/harness';
import { AdminWorkspaceOps } from './admin-workspace-ops';

let h: WorkspaceHarness;
let ops: AdminWorkspaceOps;
const ADMIN = '0199e5a2-0000-7000-8000-0000000000ad';

beforeEach(() => {
  h = createWorkspaceHarness();
  ops = new AdminWorkspaceOps({
    workspaces: h.workspaces,
    memberships: h.memberships,
    queries: h.queries,
    notifier: h.notifier,
    uow: h.uow,
    clock: h.clock,
  });
});

/** Ws mồ côi: OWNER duy nhất đã rời (gỡ dòng membership như `endMembership` của T-062). */
async function orphan(slug: string, rest: Record<string, 'PM' | 'MEMBER' | 'VIEWER'>) {
  const id = await h.workspace(slug, { Otto: 'OWNER', ...rest });
  await h.memberships.remove(id, await h.user('Otto'));
  return id;
}

describe('isOrphanWorkspace', () => {
  it('còn sống + 0 OWNER ⇒ mồ côi; có OWNER / đã xóa mềm / đã lưu trữ ⇒ không', () => {
    const at = new Date(0);
    expect(isOrphanWorkspace({ deletedAt: null, archivedAt: null, ownerCount: 0 })).toBe(true);
    expect(isOrphanWorkspace({ deletedAt: null, ownerCount: 0 })).toBe(true);
    expect(isOrphanWorkspace({ deletedAt: null, archivedAt: null, ownerCount: 1 })).toBe(false);
    expect(isOrphanWorkspace({ deletedAt: at, archivedAt: null, ownerCount: 0 })).toBe(false);
    expect(isOrphanWorkspace({ deletedAt: null, archivedAt: at, ownerCount: 0 })).toBe(false);
  });
});

describe('AdminWorkspaceOps', () => {
  it('list: mọi ws sắp theo tên, thành viên kèm tên + role, cờ mồ côi', async () => {
    await h.workspace('bravo', { Bob: 'OWNER', Mia: 'MEMBER' });
    await orphan('acme', { Pam: 'PM', Mia: 'MEMBER' });
    const rows = await ops.list();
    expect(rows.map((r) => [r.name, r.orphan, r.members.map((m) => [m.fullName, m.role])])).toEqual(
      [
        [
          'ACME',
          true,
          [
            ['Mia', 'MEMBER'],
            ['Pam', 'PM'],
          ],
        ],
        [
          'BRAVO',
          false,
          [
            ['Bob', 'OWNER'],
            ['Mia', 'MEMBER'],
          ],
        ],
      ],
    );
  });

  it('giao OWNER cho thành viên còn lại ⇒ role OWNER, hết mồ côi, phát member:role-changed SAU commit', async () => {
    const A = await orphan('acme', { Pam: 'PM' });
    const pam = await h.user('Pam');
    const view = await ops.assignOwner({ workspaceId: A, userId: pam, actorId: ADMIN });
    expect(view.orphan).toBe(false);
    expect(await h.roleOf(A, 'Pam')).toBe('OWNER');
    expect(h.uow.commits).toBe(1);
    expect(h.notifier.calls.map((c) => [c.method, c.args[0]])).toEqual([
      ['notifyRoleChanged', { userId: pam, workspaceId: A, role: 'OWNER' }],
    ]);
  });

  it('ws còn OWNER ⇒ 409 workspace_has_owner; không là thành viên ⇒ 422 NOT_WORKSPACE_MEMBER; ws lạ ⇒ 404', async () => {
    const B = await h.workspace('bravo', { Bob: 'OWNER', Mia: 'MEMBER' });
    await expect(
      ops.assignOwner({ workspaceId: B, userId: await h.user('Mia'), actorId: ADMIN }),
    ).rejects.toMatchObject({ statusCode: 409, details: { reason: 'workspace_has_owner' } });
    const A = await orphan('acme', { Pam: 'PM' });
    await expect(
      ops.assignOwner({ workspaceId: A, userId: await h.user('Nina'), actorId: ADMIN }),
    ).rejects.toMatchObject({ statusCode: 422, details: { rule: 'NOT_WORKSPACE_MEMBER' } });
    await expect(
      ops.assignOwner({
        workspaceId: '0199e5a2-0000-7000-8000-00000000dead',
        userId: await h.user('Pam'),
        actorId: ADMIN,
      }),
    ).rejects.toMatchObject({ statusCode: 404, details: { resource: 'workspace' } });
    expect(h.notifier.calls).toEqual([]);
  });

  it('lưu trữ: còn thành viên ⇒ 409 workspace_has_members; 0 thành viên ⇒ archivedAt, hết mồ côi; lần 2 ⇒ như cũ; giao OWNER sau đó ⇒ 409 workspace_deleted', async () => {
    const A = await orphan('acme', { Pam: 'PM' });
    await expect(ops.archive({ workspaceId: A })).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'workspace_has_members' },
    });
    const pam = await h.user('Pam');
    await h.memberships.remove(A, pam);
    const archived = await ops.archive({ workspaceId: A });
    expect(archived.archivedAt).toEqual(h.clock.now());
    expect(archived.orphan).toBe(false);
    expect((await ops.archive({ workspaceId: A })).archivedAt).toEqual(archived.archivedAt);
    await expect(
      ops.assignOwner({ workspaceId: A, userId: pam, actorId: ADMIN }),
    ).rejects.toMatchObject({ statusCode: 409, details: { reason: 'workspace_deleted' } });
  });
});
