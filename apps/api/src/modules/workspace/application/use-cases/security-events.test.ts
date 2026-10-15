// T-028 (ASVS V16, security.md §6.7): thay đổi quyền / mất quyền truy cập workspace được ghi log
// sự kiện bảo mật sau commit — rollback (LAST_OWNER, không đổi gì) ⇒ không có sự kiện.
import { beforeEach, describe, expect, it } from 'vitest';

import { BusinessRuleViolationError } from '../../../../core/errors';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
  type WorkspaceHarness,
} from '../../testing/harness';
import { AddMemberUseCase } from './add-member.use-case';
import { ChangeMemberRoleUseCase } from './change-member-role.use-case';
import { DeleteWorkspaceUseCase } from './delete-workspace.use-case';
import { RemoveMemberUseCase } from './remove-member.use-case';
import { UpdateWorkspaceUseCase } from './update-workspace.use-case';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h);
});

const event = (msg: string) => h.logger.entries.filter((e) => e.msg === msg);

describe('member.role_changed', () => {
  it('đổi role ⇒ info { workspaceId, userId, actorId, from, to }', async () => {
    await new ChangeMemberRoleUseCase(h).execute(ctx.alice, { userId: uid('mia'), role: 'PM' });
    expect(event('member.role_changed')).toEqual([
      expect.objectContaining({
        level: 'info',
        data: {
          workspaceId: ctx.alice.workspaceId,
          userId: uid('mia'),
          actorId: ctx.alice.userId,
          from: 'MEMBER',
          to: 'PM',
        },
      }),
    ]);
  });

  it('role không đổi (ROL-08) / hạ OWNER cuối ⇒ không có sự kiện', async () => {
    const change = new ChangeMemberRoleUseCase(h);
    await change.execute(ctx.alice, { userId: uid('mia'), role: 'MEMBER' });
    await expect(
      change.execute(ctx.alice, { userId: ctx.alice.userId, role: 'MEMBER' }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
    expect(event('member.role_changed')).toEqual([]);
  });
});

describe('member.removed', () => {
  it('xóa thành viên ⇒ info { workspaceId, userId, actorId }; OWNER cuối tự rời ⇒ không có sự kiện', async () => {
    const remove = new RemoveMemberUseCase(h);
    await expect(remove.execute(ctx.alice, { userId: ctx.alice.userId })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
    expect(event('member.removed')).toEqual([]);

    await remove.execute(ctx.alice, { userId: uid('mia') });
    expect(event('member.removed')).toEqual([
      expect.objectContaining({
        level: 'info',
        data: { workspaceId: ctx.alice.workspaceId, userId: uid('mia'), actorId: ctx.alice.userId },
      }),
    ]);
  });
});

describe('X9 (T-032): cấp quyền, xóa workspace, đổi slug', () => {
  it('thêm thành viên ⇒ info member.added { workspaceId, userId, actorId, role }', async () => {
    await new AddMemberUseCase(h).execute(ctx.alice, { email: 'nina@example.com', role: 'PM' });
    expect(event('member.added')).toEqual([
      expect.objectContaining({
        level: 'info',
        data: {
          workspaceId: ctx.alice.workspaceId,
          userId: uid('nina'),
          actorId: ctx.alice.userId,
          role: 'PM',
        },
      }),
    ]);
  });

  it('xóa workspace ⇒ info workspace.deleted { workspaceId, actorId, purgeAt }', async () => {
    await new DeleteWorkspaceUseCase(h).execute(ctx.alice, { confirmSlug: 'acme' });
    expect(event('workspace.deleted')).toEqual([
      expect.objectContaining({
        level: 'info',
        data: {
          workspaceId: ctx.alice.workspaceId,
          actorId: ctx.alice.userId,
          purgeAt: expect.any(Date) as unknown,
        },
      }),
    ]);
  });

  it('đổi slug ⇒ info workspace.slug_changed { from, to }; chỉ đổi tên ⇒ không có sự kiện', async () => {
    const update = new UpdateWorkspaceUseCase(h);
    await update.execute(ctx.alice, { name: 'Acme 2' });
    expect(event('workspace.slug_changed')).toEqual([]);
    await update.execute(ctx.alice, { slug: 'acme-two' });
    expect(event('workspace.slug_changed')).toEqual([
      expect.objectContaining({
        data: {
          workspaceId: ctx.alice.workspaceId,
          actorId: ctx.alice.userId,
          from: 'acme',
          to: 'acme-two',
        },
      }),
    ]);
  });
});
