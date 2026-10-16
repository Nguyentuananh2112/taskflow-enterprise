// T-040b L2: `INotificationAudience` do Workspace hiện thực qua phía đọc (IWorkspaceQueries). Chạy cả trên
// Postgres qua runner LSP `test/integration/lsp/workspace.notification-audience.lsp.int.ts`.
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
  type WorkspaceHarness,
} from '../../testing/harness';
import { SetMemberGrantsUseCase } from '../use-cases/set-member-grants.use-case';
import { WorkspaceNotificationAudience } from './notification-audience';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
const audience = () => new WorkspaceNotificationAudience(h);
const byUser = <T extends { userId: string }>(rows: T[]) =>
  [...rows].sort((a, b) => (a.userId < b.userId ? -1 : 1));

beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h, { Hana: 'MEMBER' });
  await new SetMemberGrantsUseCase(h).execute(ctx.alice, {
    userId: uid('hana'),
    grants: ['HR_MANAGE'],
  });
});

describe('WorkspaceNotificationAudience (implements INotificationAudience của notifications)', () => {
  it('workspacesOf: ws đang là thành viên + tên + role + grants HIỆN TẠI + joinedAt của membership', async () => {
    const membership = (await h.memberships.rows()).find(
      (m) => m.workspaceId === ctx.A && m.userId === uid('hana'),
    );
    expect(await audience().workspacesOf(uid('hana'))).toEqual([
      {
        userId: uid('hana'),
        workspaceId: ctx.A,
        workspaceName: 'ACME',
        role: 'MEMBER',
        grants: ['HR_MANAGE'],
        joinedAt: membership?.joinedAt,
      },
    ]);
    expect(await audience().workspacesOf(uid('nina'))).toEqual([]); // có tài khoản, không thành viên
  });

  it('membersOf: đúng thành viên của ws đó (không lẫn ws khác), role + grants đọc lại mỗi lần gọi', async () => {
    expect(byUser(await audience().membersOf(ctx.A))).toEqual(
      byUser([
        { userId: uid('alice'), role: 'OWNER', grants: [] },
        { userId: uid('pam'), role: 'PM', grants: [] },
        { userId: uid('mia'), role: 'MEMBER', grants: [] },
        { userId: uid('vic'), role: 'VIEWER', grants: [] },
        { userId: uid('hana'), role: 'MEMBER', grants: ['HR_MANAGE'] },
      ]),
    );
    await new SetMemberGrantsUseCase(h).execute(ctx.alice, { userId: uid('hana'), grants: [] });
    expect(
      (await audience().membersOf(ctx.A)).find((m) => m.userId === uid('hana'))?.grants,
    ).toEqual([]);
    expect(await audience().membersOf(ctx.B)).toEqual([
      { userId: uid('bob'), role: 'OWNER', grants: [] },
    ]);
  });
});
