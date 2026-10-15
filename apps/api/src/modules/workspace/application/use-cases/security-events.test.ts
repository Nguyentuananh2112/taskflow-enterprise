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
import { ChangeMemberRoleUseCase } from './change-member-role.use-case';
import { RemoveMemberUseCase } from './remove-member.use-case';

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
