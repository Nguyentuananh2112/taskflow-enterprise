// X6 (T-032, cross-read của F): `actor.role` do middleware đọc TRƯỚC transaction. Request đang bay
// của người vừa bị hạ / xóa không được dùng role cũ — use case đọc lại membership sau khóa owners.
import { beforeEach, describe, expect, it } from 'vitest';

import { ForbiddenError, ResourceNotFoundError } from '../../../../core/errors';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
  type WorkspaceHarness,
} from '../../testing/harness';
import { AddMemberUseCase } from './add-member.use-case';
import { ChangeMemberRoleUseCase } from './change-member-role.use-case';
import { RemoveMemberUseCase } from './remove-member.use-case';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h, { Olga: 'OWNER' });
});

/** Đổi role trong lưu trữ — actor đã nạp trước đó vẫn mang role cũ (như request đang bay). */
async function demote(name: string, role: 'PM' | 'MEMBER' | 'VIEWER') {
  const m = (await h.memberships.find(ctx.A, uid(name)))!;
  m.changeRole(role, h.clock.now());
  await h.memberships.save(m);
}

describe('actor bị hạ role giữa chừng (role cũ còn trong request)', () => {
  it('PM bị hạ xuống MEMBER ⇒ thêm thành viên 403', async () => {
    await demote('pam', 'MEMBER');
    await expect(
      new AddMemberUseCase(h).execute(ctx.pam, { email: 'nina@example.com', role: 'VIEWER' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await h.memberships.find(ctx.A, uid('nina'))).toBeNull();
  });

  // F3 W-1 (P1): OWNER bị hạ xuống PM vẫn còn `member:add` ⇒ `requirePermission` cho qua; kiểm `canGrant`
  // đầu use case dùng role CŨ (OWNER) cũng cho qua. Chốt DUY NHẤT là `canGrant(fresh.role)` sau khóa owners —
  // bỏ nó ⇒ PM tự cấp OWNER/PM cho người khác (leo thang quyền).
  it.each(['OWNER', 'PM'] as const)(
    'OWNER bị hạ xuống PM ⇒ cấp role %s cho người khác 403 (role cũ trong request không được dùng)',
    async (role) => {
      await demote('olga', 'PM');
      const err = await new AddMemberUseCase(h)
        .execute(ctx.olga, { email: 'nina@example.com', role })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).details).toEqual({ required: 'member:add' });
      expect(await h.memberships.find(ctx.A, uid('nina'))).toBeNull();
    },
  );

  it('đối chứng W-1: OWNER bị hạ xuống PM vẫn cấp được MEMBER (quyền của PM)', async () => {
    await demote('olga', 'PM');
    await expect(
      new AddMemberUseCase(h).execute(ctx.olga, { email: 'nina@example.com', role: 'MEMBER' }),
    ).resolves.toMatchObject({ role: 'MEMBER' });
  });

  it('PM bị hạ xuống MEMBER ⇒ xóa người khác 403', async () => {
    await demote('pam', 'MEMBER');
    await expect(
      new RemoveMemberUseCase(h).execute(ctx.pam, { userId: uid('vic') }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await h.memberships.find(ctx.A, uid('vic'))).not.toBeNull();
  });

  it('OWNER bị hạ xuống MEMBER ⇒ đổi role người khác 403', async () => {
    await demote('olga', 'MEMBER');
    await expect(
      new ChangeMemberRoleUseCase(h).execute(ctx.olga, { userId: uid('mia'), role: 'PM' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('actor bị xóa khỏi workspace giữa chừng', () => {
  it.each([
    [
      'add',
      () => new AddMemberUseCase(h).execute(ctx.pam, { email: 'nina@example.com', role: 'VIEWER' }),
    ],
    ['remove', () => new RemoveMemberUseCase(h).execute(ctx.pam, { userId: uid('vic') })],
  ] as const)(
    '%s ⇒ 404 workspace (như middleware với người không còn là thành viên)',
    async (_op, run) => {
      await h.memberships.remove(ctx.A, uid('pam'));
      await expect(run()).rejects.toBeInstanceOf(ResourceNotFoundError);
    },
  );
});
