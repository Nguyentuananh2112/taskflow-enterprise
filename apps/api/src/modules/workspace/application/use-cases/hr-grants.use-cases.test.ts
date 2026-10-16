// T-037 (ADR-119, test-spec-hr §6 GR-04..GR-10, B-H1 / B-H3a / B-L1 / B-M2). Chạy cả trên Postgres qua
// runner LSP `test/integration/lsp/workspace.hr-grants.use-cases.lsp.int.ts`.
import { beforeEach, describe, expect, it } from 'vitest';

import {
  BusinessRuleViolationError,
  ForbiddenError,
  ResourceNotFoundError,
} from '../../../../core/errors';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
  type WorkspaceHarness,
} from '../../testing/harness';
import { HrAccess } from '../adapters/hr-access';
import { HrAuditWriter } from '../hr-audit-writer';
import { ChangeMemberRoleUseCase } from './change-member-role.use-case';
import { ListHrAuditLogsQuery } from './list-hr-audit-logs.query';
import { SetMemberGrantsUseCase } from './set-member-grants.use-case';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
beforeEach(async () => {
  h = createWorkspaceHarness();
  // Hana: MEMBER sẽ được cấp HR. Olga: OWNER thứ hai (để hạ được Alice / Olga).
  ctx = await givenWorkspaceA(h, { Hana: 'MEMBER', Olga: 'OWNER' });
});

const set = () => new SetMemberGrantsUseCase(h);
const caught = (p: Promise<unknown>) =>
  p.then(
    () => expect.unreachable(),
    (e: unknown) => e,
  );
const hana = () => h.actor(ctx.A, 'Hana', 'MEMBER');
const grantsOf = async (name: string) =>
  (await h.memberships.rows()).find((m) => m.workspaceId === ctx.A && m.userId === uid(name))
    ?.grants;
const emitted = (method: string) => h.notifier.calls.filter((c) => c.method === method);

describe('PUT members/:userId/grants (GR-04..GR-08)', () => {
  it('GR-04: OWNER cấp HR cho MEMBER ⇒ MemberView có grants, audit GRANT, event member:grants-changed sau commit', async () => {
    const view = await set().execute(ctx.alice, { userId: uid('hana'), grants: ['HR_MANAGE'] });
    expect(view).toMatchObject({ userId: uid('hana'), role: 'MEMBER', grants: ['HR_MANAGE'] });
    expect(await grantsOf('hana')).toEqual(['HR_MANAGE']);
    expect(await h.hrAudit.rows()).toEqual([
      expect.objectContaining({
        workspaceId: ctx.A,
        actorId: ctx.alice.userId,
        action: 'GRANT',
        targetUserId: uid('hana'),
        before: { grants: [] },
        after: { grants: ['HR_MANAGE'] },
      }),
    ]);
    expect(emitted('notifyGrantsChanged')).toEqual([
      {
        method: 'notifyGrantsChanged',
        args: [
          { userId: uid('hana'), workspaceId: ctx.A, grants: ['HR_MANAGE'] },
          { actorId: ctx.alice.userId, originClientId: null },
        ],
        duringTransaction: false,
      },
    ]);
    expect(h.logger.messages()).toContain('member.grants_changed');
  });

  it('thu hết ([]) ⇒ audit REVOKE; đặt lại đúng tập đang có ⇒ no-op (không audit, không event)', async () => {
    await set().execute(ctx.alice, { userId: uid('hana'), grants: ['HR_MANAGE'] });
    await set().execute(ctx.alice, { userId: uid('hana'), grants: ['HR_MANAGE'] }); // no-op
    await set().execute(ctx.alice, { userId: uid('hana'), grants: [] });
    expect((await h.hrAudit.rows()).map((r) => r.action)).toEqual(['GRANT', 'REVOKE']);
    expect(emitted('notifyGrantsChanged')).toHaveLength(2);
    expect(await grantsOf('hana')).toEqual([]);
  });

  it.each([
    ['GR-05: HR (Hana có grant) cấp cho người khác', 'hana-hr'],
    ['GR-06: PM cấp', 'pam'],
  ])('%s ⇒ 403 hr:grant, không ghi gì', async (_label, who) => {
    await set().execute(ctx.alice, { userId: uid('hana'), grants: ['HR_MANAGE'] });
    const actor = who === 'pam' ? ctx.pam : { ...hana(), grants: ['HR_MANAGE'] as const };
    const err = await caught(set().execute(actor, { userId: uid('mia'), grants: ['HR_MANAGE'] }));
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as ForbiddenError).details).toEqual({ required: 'hr:grant' });
    expect(await grantsOf('mia')).toEqual([]);
  });

  it.each([
    ['GR-07: VIEWER', 'vic', ['HR_MANAGE']],
    ['GR-08: OWNER', 'olga', ['HR_MANAGE']],
    ['SEC-HR-27: OWNER tự "thu" (OWNER không có grant tường minh)', 'alice', []],
  ] as const)('%s ⇒ 422 GRANT_NOT_ALLOWED, không ghi gì', async (_label, name, grants) => {
    const err = await caught(set().execute(ctx.alice, { userId: uid(name), grants }));
    expect(err).toBeInstanceOf(BusinessRuleViolationError);
    expect((err as BusinessRuleViolationError).details).toMatchObject({
      rule: 'GRANT_NOT_ALLOWED',
    });
    expect(await h.hrAudit.rows()).toEqual([]);
  });

  it('user không phải thành viên ⇒ 404 user', async () => {
    const err = await caught(
      set().execute(ctx.alice, { userId: uid('nina'), grants: ['HR_MANAGE'] }),
    );
    expect(err).toBeInstanceOf(ResourceNotFoundError);
    expect((err as ResourceNotFoundError).details).toEqual({ resource: 'user' });
  });

  it('X6: OWNER vừa bị hạ PM (request còn mang OWNER) ⇒ 403, không cấp được', async () => {
    const m = (await h.memberships.find(ctx.A, uid('olga')))!;
    m.changeRole('PM', h.clock.now());
    await h.memberships.save(m);
    const err = await caught(
      set().execute(ctx.olga, { userId: uid('hana'), grants: ['HR_MANAGE'] }),
    );
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(await grantsOf('hana')).toEqual([]);
  });
});

describe('đổi role và grants (GR-09, GR-10)', () => {
  beforeEach(async () => {
    await set().execute(ctx.alice, { userId: uid('hana'), grants: ['HR_MANAGE'] });
    h.notifier.calls.length = 0;
  });

  it.each(['VIEWER', 'OWNER'] as const)(
    'GR-09: hạ / nâng Hana sang %s ⇒ grants về [] CÙNG transaction, response + audit REVOKE + event',
    async (role) => {
      const res = await new ChangeMemberRoleUseCase(h).execute(ctx.alice, {
        userId: uid('hana'),
        role,
      });
      expect(res.member).toMatchObject({ role, grants: [] });
      expect(await grantsOf('hana')).toEqual([]);
      expect((await h.hrAudit.rows()).at(-1)).toMatchObject({
        action: 'REVOKE',
        targetUserId: uid('hana'),
        before: { grants: ['HR_MANAGE'], role: 'MEMBER' },
        after: { grants: [], role },
      });
      expect(emitted('notifyGrantsChanged')[0]?.args[0]).toEqual({
        userId: uid('hana'),
        workspaceId: ctx.A,
        grants: [],
      });
    },
  );

  it('GR-10: đổi role khác (MEMBER → PM) ⇒ grants GIỮ NGUYÊN trong response, không audit REVOKE, log có grants', async () => {
    const res = await new ChangeMemberRoleUseCase(h).execute(ctx.alice, {
      userId: uid('hana'),
      role: 'PM',
    });
    expect(res.member).toMatchObject({ role: 'PM', grants: ['HR_MANAGE'] });
    expect((await h.hrAudit.rows()).map((r) => r.action)).toEqual(['GRANT']);
    expect(emitted('notifyGrantsChanged')).toEqual([]);
  });
});

describe('HrAccess.authorizeWrite — chốt mọi lệnh ghi hr:manage (B-H1, B-H3a)', () => {
  const access = () => new HrAccess(h);
  const run = (input: Parameters<HrAccess['authorizeWrite']>[0]) =>
    h.uow.run(() => access().authorizeWrite(input));

  it('OWNER ⇒ OK; MEMBER có grant ⇒ OK và trả Actor đã đọc lại (role + grants)', async () => {
    await expect(run({ workspaceId: ctx.A, actorId: ctx.alice.userId })).resolves.toMatchObject({
      role: 'OWNER',
    });
    await set().execute(ctx.alice, { userId: uid('hana'), grants: ['HR_MANAGE'] });
    await expect(
      run({ workspaceId: ctx.A, actorId: uid('hana'), targetUserId: uid('mia') }),
    ).resolves.toEqual({
      userId: uid('hana'),
      workspaceId: ctx.A,
      role: 'MEMBER',
      grants: ['HR_MANAGE'],
    });
  });

  it('PM / MEMBER không có grant ⇒ 403 hr:manage', async () => {
    for (const name of ['pam', 'mia']) {
      const err = await caught(run({ workspaceId: ctx.A, actorId: uid(name) }));
      expect(err, name).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).details).toEqual({ required: 'hr:manage' });
    }
  });

  it('SEC-HR-09 (tầng U): grant vừa bị thu ⇒ lệnh HR kế tiếp 403 ngay (đọc DB, không tin quyền trong request)', async () => {
    await set().execute(ctx.alice, { userId: uid('hana'), grants: ['HR_MANAGE'] });
    await expect(run({ workspaceId: ctx.A, actorId: uid('hana') })).resolves.toBeDefined();
    await set().execute(ctx.alice, { userId: uid('hana'), grants: [] });
    expect(await caught(run({ workspaceId: ctx.A, actorId: uid('hana') }))).toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('không còn là thành viên / ws đã xóa ⇒ 404 workspace (như loadMembership)', async () => {
    const notMember = await caught(run({ workspaceId: ctx.A, actorId: uid('nina') }));
    expect((notMember as ResourceNotFoundError).details).toEqual({ resource: 'workspace' });
    const ws = (await h.workspaces.findById(ctx.A))!;
    ws.softDelete(ctx.alice.userId, h.clock.now());
    await h.workspaces.save(ws);
    const deleted = await caught(run({ workspaceId: ctx.A, actorId: ctx.alice.userId }));
    expect((deleted as ResourceNotFoundError).details).toEqual({ resource: 'workspace' });
  });

  it('B-H1: HR (không phải OWNER) tự xử lý dữ liệu của mình ⇒ 403, kể cả có lý do', async () => {
    await set().execute(ctx.alice, { userId: uid('hana'), grants: ['HR_MANAGE'] });
    const err = await caught(
      run({
        workspaceId: ctx.A,
        actorId: uid('hana'),
        targetUserId: uid('hana'),
        reason: 'quên chấm',
      }),
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('OWNER tự xử lý của mình: thiếu lý do ⇒ 422 REASON_REQUIRED; có lý do ⇒ OK (R26)', async () => {
    for (const reason of [null, '', '   ']) {
      const err = await caught(
        run({
          workspaceId: ctx.A,
          actorId: ctx.alice.userId,
          targetUserId: ctx.alice.userId,
          reason,
        }),
      );
      expect(err).toBeInstanceOf(BusinessRuleViolationError);
      expect((err as BusinessRuleViolationError).details).toMatchObject({
        rule: 'REASON_REQUIRED',
      });
    }
    await expect(
      run({
        workspaceId: ctx.A,
        actorId: ctx.alice.userId,
        targetUserId: ctx.alice.userId,
        reason: 'đi công tác',
      }),
    ).resolves.toMatchObject({ role: 'OWNER' });
  });

  it('isEmployee: OWNER / PM / MEMBER ⇒ true; VIEWER / không phải thành viên ⇒ false', async () => {
    const is = (name: string) => access().isEmployee({ workspaceId: ctx.A, userId: uid(name) });
    expect(await Promise.all(['alice', 'pam', 'mia', 'vic', 'nina'].map(is))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('HrAuditLog (B-H2, B-L1)', () => {
  it('writer từ chối before / after có khóa `reason` (dữ liệu nhạy cảm) — không ghi gì', async () => {
    const writer = new HrAuditWriter({ hrAudit: h.hrAudit, ids: h.ids, clock: h.clock });
    for (const side of ['before', 'after'] as const) {
      await expect(
        writer.record({
          workspaceId: ctx.A,
          actorId: ctx.alice.userId,
          action: 'LEAVE_DECIDE',
          [side]: { status: 'APPROVED', reason: 'sốt cao' },
        }),
      ).rejects.toThrow(/reason/);
    }
    expect(await h.hrAudit.rows()).toEqual([]);
  });

  it('đọc audit: OWNER ⇒ mới nhất trước + tên actor, phân trang; HR có grant / PM ⇒ 403 hr:grant', async () => {
    await set().execute(ctx.alice, { userId: uid('hana'), grants: ['HR_MANAGE'] });
    h.clock.advance(1_000);
    await set().execute(ctx.alice, { userId: uid('mia'), grants: ['HR_MANAGE'] });
    const q = new ListHrAuditLogsQuery(h);
    const page1 = await q.execute(ctx.alice, { limit: 1 });
    expect(page1.items).toEqual([
      expect.objectContaining({ targetUserId: uid('mia'), action: 'GRANT', actorName: 'Alice' }),
    ]);
    expect(page1.nextAfter).toBe(page1.items[0]?.id);
    const page2 = await q.execute(ctx.alice, { limit: 1, after: page1.nextAfter ?? undefined });
    expect(page2.items.map((r) => r.targetUserId)).toEqual([uid('hana')]);
    expect(page2.nextAfter).toBeNull();
    for (const actor of [{ ...hana(), grants: ['HR_MANAGE'] as const }, ctx.pam]) {
      const err = await caught(q.execute(actor, {}));
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).details).toEqual({ required: 'hr:grant' });
    }
  });
});
