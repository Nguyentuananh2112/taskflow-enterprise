// T-037b: nhiệm kỳ thành viên cho bảng công (port `IMembershipTenurePort` chốt với A). Chạy cả trên
// Postgres qua `test/integration/lsp/workspace.member-tenure.lsp.int.ts`.
import { beforeEach, describe, expect, it } from 'vitest';

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
const DAY = 86_400_000;
const T0 = new Date('2026-11-01T00:00:00.000Z'); // NOW của harness = joinedAt của thành viên seed

beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h);
});

const remove = (actor = ctx.alice, userId = uid('mia')) =>
  new RemoveMemberUseCase(h).execute(actor, { userId });
const readd = (role = 'MEMBER') =>
  new AddMemberUseCase(h).execute(ctx.alice, { email: 'mia@example.com', role });
const tenures = (q: Partial<{ userIds: string[]; from: Date; to: Date }> = {}) =>
  h.tenure.tenuresOf({
    workspaceId: ctx.A,
    from: new Date(T0.getTime() - 30 * DAY),
    to: new Date(T0.getTime() + 60 * DAY),
    ...q,
  });

describe('ghi departure khi xóa thành viên (cùng transaction)', () => {
  it('OWNER xóa ⇒ REMOVED; tự rời ⇒ LEFT; ghi role + joinedAt + leftAt', async () => {
    h.clock.advance(3 * DAY);
    await remove();
    await remove(ctx.pam, uid('pam'));
    expect(await h.departures.rows()).toEqual([
      expect.objectContaining({
        userId: uid('mia'),
        role: 'MEMBER',
        reason: 'REMOVED',
        joinedAt: T0,
      }),
      expect.objectContaining({ userId: uid('pam'), role: 'PM', reason: 'LEFT' }),
    ]);
    expect((await h.departures.rows())[0]?.leftAt).toEqual(new Date(T0.getTime() + 3 * DAY));
  });

  it('xóa bị rollback ⇒ không có dòng departure, thành viên vẫn còn', async () => {
    await expect(
      h.uow.run(async () => {
        await remove();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await h.departures.rows()).toEqual([]);
    expect(await h.memberships.find(ctx.A, uid('mia'))).not.toBeNull();
  });

  it('xóa bị từ chối (LAST_OWNER) ⇒ không ghi departure', async () => {
    await expect(remove(ctx.alice, uid('alice'))).rejects.toThrow();
    expect(await h.departures.rows()).toEqual([]);
  });
});

describe('tenuresOf', () => {
  it('rời rồi vào lại ⇒ 2 nhiệm kỳ, cũ trước, hiện tại until = null', async () => {
    h.clock.advance(5 * DAY);
    await remove();
    h.clock.advance(10 * DAY);
    await readd();
    expect(await tenures({ userIds: [uid('mia')] })).toEqual([
      { userId: uid('mia'), from: T0, until: new Date(T0.getTime() + 5 * DAY) },
      { userId: uid('mia'), from: new Date(T0.getTime() + 15 * DAY), until: null },
    ]);
  });

  it('bỏ userIds ⇒ mọi nhân viên (gồm người đã rời), không có VIEWER, sắp theo userId', async () => {
    await remove();
    const ids = (await tenures()).map((t) => t.userId);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids)).toEqual(new Set([uid('alice'), uid('pam'), uid('mia')]));
  });

  it('userIds = [] ⇒ []; userId của ws khác ⇒ không có dòng', async () => {
    expect(await tenures({ userIds: [] })).toEqual([]);
    expect(await tenures({ userIds: [uid('bob')] })).toEqual([]);
  });

  it('khoảng [from, to): from = until vẫn giao; to = joinedAt thì không', async () => {
    h.clock.advance(5 * DAY);
    await remove();
    const left = new Date(T0.getTime() + 5 * DAY);
    const only = { userIds: [uid('mia')] };
    expect(await tenures({ ...only, from: left, to: new Date(left.getTime() + DAY) })).toHaveLength(
      1,
    );
    expect(
      await tenures({
        ...only,
        from: new Date(left.getTime() + 1),
        to: new Date(left.getTime() + DAY),
      }),
    ).toEqual([]);
    expect(await tenures({ ...only, from: new Date(T0.getTime() - DAY), to: T0 })).toEqual([]);
  });

  it('VIEWER: hiện là VIEWER ⇒ không có nhiệm kỳ; rời khi là VIEWER ⇒ bỏ dòng; đổi role không cắt', async () => {
    expect(await tenures({ userIds: [uid('vic')] })).toEqual([]);
    await remove(ctx.alice, uid('vic'));
    expect(await tenures({ userIds: [uid('vic')] })).toEqual([]);

    h.clock.advance(DAY);
    await new ChangeMemberRoleUseCase(h).execute(ctx.alice, { userId: uid('mia'), role: 'PM' });
    expect(await tenures({ userIds: [uid('mia')] })).toEqual([
      { userId: uid('mia'), from: T0, until: null },
    ]);
  });
});
