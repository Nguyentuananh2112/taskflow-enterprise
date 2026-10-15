import { beforeEach, describe, expect, it } from 'vitest';

import { FakeRandom } from '../../../../../test/support';
import { ResourceConflictError, ResourceNotFoundError } from '../../../../core/errors';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  type WorkspaceHarness,
} from '../../testing/harness';
import { WorkspaceMembershipReader } from './membership-reader';
import { WorkspaceProjectAccessChecker } from './project-access-checker';
import { WorkspaceAccess } from './workspace-access';
import { DEFAULT_PROJECT, DefaultWorkspaceProvisioner } from './workspace-provisioner';

let h: WorkspaceHarness;
const suffix = (s: string) => [...s].map((c) => parseInt(c, 36));
const caught = (p: Promise<unknown>) =>
  p.then(
    () => expect.unreachable(),
    (e: unknown) => e,
  );

beforeEach(() => {
  h = createWorkspaceHarness(new FakeRandom({ ints: [...suffix('def456'), ...suffix('abc123')] }));
});

describe('DefaultWorkspaceProvisioner (implements IWorkspaceProvisioner của auth)', () => {
  const provision = (ownerFullName: string, attempt = 0) =>
    h.uow.run(() =>
      new DefaultWorkspaceProvisioner(h).provisionDefault({
        ownerId: 'user-alice',
        ownerFullName,
        attempt,
      }),
    );

  it('tạo ws (slug từ họ tên) + OWNER + project mặc định TF', async () => {
    const { workspaceId } = await provision('Nguyễn Văn Đức');
    expect(h.workspaces.rows()).toEqual([
      expect.objectContaining({
        id: workspaceId,
        slug: 'nguyen-van-duc',
        name: 'Workspace của Nguyễn Văn Đức',
      }),
    ]);
    expect(h.roleOf(workspaceId, 'Alice')).toBe('OWNER');
    expect(h.projects.rows()).toEqual([
      expect.objectContaining({
        workspaceId,
        keyPrefix: DEFAULT_PROJECT.keyPrefix,
        name: DEFAULT_PROJECT.name,
      }),
    ]);
  });

  it('REG-11: attempt ≥ 1 ⇒ hậu tố; REG-13b: tên ngắn / dành riêng ⇒ workspace-xxxxxx', async () => {
    await provision('Alice Nguyen', 1);
    expect(h.workspaces.rows().at(-1)?.slug).toBe('alice-nguyen-def456');
    await provision('Admin', 0);
    expect(h.workspaces.rows().at(-1)?.slug).toBe('workspace-abc123');
  });

  it('hợp đồng với Register: trùng slug ⇒ ResourceConflictError field slug', async () => {
    await provision('Alice Nguyen');
    const err = await caught(provision('Alice Nguyen'));
    expect(err).toBeInstanceOf(ResourceConflictError);
    expect((err as ResourceConflictError).details).toMatchObject({ field: 'slug' });
  });

  it('tên workspace mặc định cắt còn 100 ký tự', async () => {
    await provision('Đ'.repeat(100));
    expect([...(h.workspaces.rows()[0]?.name ?? '')]).toHaveLength(100);
  });
});

describe('WorkspaceMembershipReader (implements IMembershipReader của auth)', () => {
  it('liệt kê ws chưa xóa của user kèm role; bỏ ws đã xóa mềm (ADR-047)', async () => {
    const { A, B } = await givenWorkspaceA(h);
    await h.memberships.add(
      (await import('../../domain/membership')).Membership.create({
        id: 'mx',
        workspaceId: B,
        userId: 'user-alice',
        role: 'VIEWER',
        now: h.clock.now(),
      }),
    );
    const reader = new WorkspaceMembershipReader(h);
    expect(await reader.listForUser('user-alice')).toEqual([
      { workspaceId: A, workspaceName: 'ACME', slug: 'acme', role: 'OWNER' },
      { workspaceId: B, workspaceName: 'BRAVO', slug: 'bravo', role: 'VIEWER' },
    ]);
    const ws = await h.workspaces.findById(B);
    ws?.softDelete('user-bob', h.clock.now());
    if (ws) await h.workspaces.save(ws);
    expect((await reader.listForUser('user-alice')).map((m) => m.workspaceId)).toEqual([A]);
  });
});

describe('WorkspaceAccess (lõi của middleware loadMembership) + ProjectAccessChecker (socket project:join)', () => {
  it('member ws chưa xóa ⇒ Actor; không phải member / ws không tồn tại / đã xóa ⇒ cùng một 404 workspace', async () => {
    const { A, B } = await givenWorkspaceA(h);
    const access = new WorkspaceAccess(h);
    expect(await access.resolveActor(A, 'user-pam')).toEqual({
      userId: 'user-pam',
      workspaceId: A,
      role: 'PM',
    });
    const errs = [
      await caught(access.resolveActor(A, 'user-bob')),
      await caught(access.resolveActor('ws-nope', 'user-pam')),
    ];
    const ws = await h.workspaces.findById(B);
    ws?.softDelete('user-bob', h.clock.now());
    if (ws) await h.workspaces.save(ws);
    errs.push(await caught(access.resolveActor(B, 'user-bob')));
    for (const err of errs) {
      expect(err).toBeInstanceOf(ResourceNotFoundError);
      expect((err as ResourceNotFoundError).details).toEqual({ resource: 'workspace' });
    }
  });

  it('canAccessProject: true cả project archived; false nếu không phải member / project ∉ ws / ws đã xóa', async () => {
    const { A, B } = await givenWorkspaceA(h);
    const web = await h.project(A, 'WEB');
    const old = await h.project(A, 'OLD', true);
    const brv = await h.project(B, 'BRV');
    const checker = new WorkspaceProjectAccessChecker(h);
    expect(
      await checker.canAccessProject({ userId: 'user-vic', workspaceId: A, projectId: web }),
    ).toBe(true);
    expect(
      await checker.canAccessProject({ userId: 'user-vic', workspaceId: A, projectId: old }),
    ).toBe(true);
    expect(
      await checker.canAccessProject({ userId: 'user-bob', workspaceId: A, projectId: web }),
    ).toBe(false);
    expect(
      await checker.canAccessProject({ userId: 'user-vic', workspaceId: A, projectId: brv }),
    ).toBe(false);
    expect(
      await checker.canAccessProject({ userId: 'user-bob', workspaceId: B, projectId: web }),
    ).toBe(false);
    const ws = await h.workspaces.findById(A);
    ws?.softDelete('user-alice', h.clock.now());
    if (ws) await h.workspaces.save(ws);
    expect(
      await checker.canAccessProject({ userId: 'user-vic', workspaceId: A, projectId: web }),
    ).toBe(false);
  });
});
