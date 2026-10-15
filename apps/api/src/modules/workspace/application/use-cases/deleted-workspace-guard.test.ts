// X7 (T-032, cross-read của F; security.md 3.6): request đang bay khi workspace vừa bị xóa mềm —
// actor vẫn mang membership cũ — không được ghi gì vào ws đang chờ purge (không kéo thêm người vào).
import { beforeEach, describe, expect, it } from 'vitest';

import { ResourceNotFoundError } from '../../../../core/errors';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
  type WorkspaceHarness,
} from '../../testing/harness';
import { AddMemberUseCase } from './add-member.use-case';
import { ChangeMemberRoleUseCase } from './change-member-role.use-case';
import { CreateProjectUseCase } from './create-project.use-case';
import { RemoveMemberUseCase } from './remove-member.use-case';
import { SetProjectArchivedUseCase } from './set-project-archived.use-case';
import { UpdateProjectUseCase } from './update-project.use-case';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
let projectId: string;
beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h);
  projectId = await h.project(ctx.A, 'WEB');
  const ws = (await h.workspaces.findById(ctx.A))!;
  ws.softDelete(uid('alice'), h.clock.now());
  expect(await h.workspaces.save(ws)).toBe(true);
});

describe('workspace đã xóa mềm ⇒ mọi ghi là 404 workspace', () => {
  it.each([
    [
      'thêm thành viên',
      () =>
        new AddMemberUseCase(h).execute(ctx.alice, { email: 'nina@example.com', role: 'MEMBER' }),
    ],
    [
      'đổi role',
      () => new ChangeMemberRoleUseCase(h).execute(ctx.alice, { userId: uid('mia'), role: 'PM' }),
    ],
    ['xóa thành viên', () => new RemoveMemberUseCase(h).execute(ctx.alice, { userId: uid('mia') })],
    [
      'tạo project',
      () => new CreateProjectUseCase(h).execute(ctx.alice, { name: 'Ops', keyPrefix: 'OPS' }),
    ],
    ['sửa project', () => new UpdateProjectUseCase(h).execute(ctx.alice, { projectId, name: 'X' })],
    [
      'archive project',
      () => new SetProjectArchivedUseCase(h).execute(ctx.alice, { projectId, archived: true }),
    ],
  ] as const)('%s', async (_label, run) => {
    const err: unknown = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResourceNotFoundError);
    expect((err as ResourceNotFoundError).details).toMatchObject({ resource: 'workspace' });
  });

  it('không ai bị kéo vào ws đang chờ purge', async () => {
    await new AddMemberUseCase(h)
      .execute(ctx.alice, { email: 'nina@example.com', role: 'MEMBER' })
      .catch(() => undefined);
    expect(await h.memberships.find(ctx.A, uid('nina'))).toBeNull();
  });
});
