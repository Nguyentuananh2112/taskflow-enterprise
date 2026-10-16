// T-040 (ADR-123, GR-04 / GR-09; review B — M1): cấp / thu HR ⇒ thông báo bền HR_GRANTED / HR_REVOKED
// qua port `IHrGrantNotifier`, gọi TRONG transaction (module notifications ghi cùng tx, phát sau commit).
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
  type WorkspaceHarness,
} from '../../testing/harness';
import { ChangeMemberRoleUseCase } from './change-member-role.use-case';
import { SetMemberGrantsUseCase } from './set-member-grants.use-case';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h, { Hana: 'MEMBER', Olga: 'OWNER' });
});

const set = (grants: 'HR_MANAGE'[]) =>
  new SetMemberGrantsUseCase(h).execute(ctx.alice, { userId: uid('hana'), grants });
const membershipOfHana = async () =>
  (await h.memberships.rows()).find((m) => m.workspaceId === ctx.A && m.userId === uid('hana'))?.id;
const call = (added: boolean, membershipId: string | undefined) => ({
  method: 'grantsChanged',
  args: [
    { workspaceId: ctx.A, userId: uid('hana'), actorId: ctx.alice.userId, added, membershipId },
  ],
  duringTransaction: true,
});

describe('IHrGrantNotifier — thông báo bền khi grants đổi', () => {
  it('GR-04: cấp ⇒ HR_GRANTED (added true) trong transaction; thu ⇒ HR_REVOKED; no-op ⇒ không gọi', async () => {
    const membershipId = await membershipOfHana();
    await set(['HR_MANAGE']);
    await set(['HR_MANAGE']); // no-op
    await set([]);
    await set([]); // no-op
    expect(h.hrNotifier.calls).toEqual([call(true, membershipId), call(false, membershipId)]);
  });

  it('bị từ chối (target VIEWER ⇒ 422) ⇒ không gọi', async () => {
    await expect(
      new SetMemberGrantsUseCase(h).execute(ctx.alice, {
        userId: uid('vic'),
        grants: ['HR_MANAGE'],
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(h.hrNotifier.calls).toEqual([]);
  });

  it.each(['VIEWER', 'OWNER'] as const)(
    'GR-09: đổi role sang %s xóa grants ⇒ HR_REVOKED trong cùng transaction',
    async (role) => {
      await set(['HR_MANAGE']);
      h.hrNotifier.calls.length = 0;
      await new ChangeMemberRoleUseCase(h).execute(ctx.alice, { userId: uid('hana'), role });
      expect(h.hrNotifier.calls).toEqual([call(false, await membershipOfHana())]);
    },
  );

  it('GR-10: đổi role mà grants giữ nguyên (MEMBER → PM) / người không có grant ⇒ không gọi', async () => {
    await set(['HR_MANAGE']);
    h.hrNotifier.calls.length = 0;
    await new ChangeMemberRoleUseCase(h).execute(ctx.alice, { userId: uid('hana'), role: 'PM' });
    await new ChangeMemberRoleUseCase(h).execute(ctx.alice, { userId: uid('mia'), role: 'VIEWER' });
    expect(h.hrNotifier.calls).toEqual([]);
  });
});
