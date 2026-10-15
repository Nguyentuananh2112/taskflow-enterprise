import { beforeEach, describe, expect, it } from 'vitest';

import type { ResourceNotFoundError } from '../../../../core/errors';
import {
  BusinessRuleViolationError,
  ForbiddenError,
  ValidationError,
} from '../../../../core/errors';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  type WorkspaceHarness,
} from '../../testing/harness';
import { ChangeMemberRoleUseCase } from './change-member-role.use-case';
import { RemoveMemberUseCase } from './remove-member.use-case';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
const caught = (p: Promise<unknown>) =>
  p.then(
    () => expect.unreachable(),
    (e: unknown) => e,
  );
const lastOwner = (err: unknown) => {
  expect(err).toBeInstanceOf(BusinessRuleViolationError);
  expect((err as BusinessRuleViolationError).details).toMatchObject({ rule: 'LAST_OWNER' });
};

beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h);
});

describe('ChangeMemberRoleUseCase', () => {
  const change = () => new ChangeMemberRoleUseCase(h);

  it('ROL-01/10: MEMBER → PM; không bỏ gán; notifyRoleChanged SAU commit', async () => {
    h.cleaner.assigned.set('user-mia', 2);
    const result = await change().execute(ctx.alice, {
      userId: 'user-mia',
      role: 'PM',
      originClientId: null,
    });
    expect(result).toMatchObject({
      member: { userId: 'user-mia', role: 'PM', email: 'mia@example.com' },
      unassignedTaskCount: 0,
    });
    expect(h.cleaner.calls).toEqual([]);
    expect(h.notifier.calls).toEqual([
      {
        method: 'notifyRoleChanged',
        args: [
          { userId: 'user-mia', workspaceId: ctx.A, role: 'PM' },
          { actorId: 'user-alice', originClientId: null },
        ],
        duringTransaction: false,
      },
    ]);
  });

  it('ROL-02: PM đổi role ⇒ 403', async () => {
    expect(
      await caught(change().execute(ctx.pam, { userId: 'user-mia', role: 'VIEWER' })),
    ).toBeInstanceOf(ForbiddenError);
  });

  it('ROL-03: OWNER duy nhất tự hạ ⇒ 422 LAST_OWNER, role không đổi', async () => {
    lastOwner(await caught(change().execute(ctx.alice, { userId: 'user-alice', role: 'PM' })));
    expect(h.roleOf(ctx.A, 'Alice')).toBe('OWNER');
    expect(h.uow.rollbacks).toBe(1);
  });

  it('ROL-04: có 2 OWNER ⇒ hạ được một', async () => {
    const h2 = createWorkspaceHarness();
    const c2 = await givenWorkspaceA(h2, { Olga: 'OWNER' });
    await new ChangeMemberRoleUseCase(h2).execute(c2.alice, { userId: 'user-olga', role: 'PM' });
    expect(h2.roleOf(c2.A, 'Olga')).toBe('PM');
  });

  it('ROL-06: hạ xuống VIEWER ⇒ cleaner gọi đúng 1 lần TRONG transaction; trả số task bỏ gán', async () => {
    h.cleaner.assigned.set('user-mia', 2);
    const result = await change().execute(ctx.alice, { userId: 'user-mia', role: 'VIEWER' });
    expect(result.unassignedTaskCount).toBe(2);
    expect(h.cleaner.calls).toEqual([
      {
        input: { workspaceId: ctx.A, userId: 'user-mia', actorId: 'user-alice' },
        inTransaction: true,
      },
    ]);
  });

  it('ROL-08: đổi sang chính role hiện tại ⇒ no-op: không bỏ gán, không event', async () => {
    const result = await change().execute(ctx.alice, { userId: 'user-mia', role: 'MEMBER' });
    expect(result.unassignedTaskCount).toBe(0);
    expect(h.notifier.calls).toEqual([]);
    expect(h.cleaner.calls).toEqual([]);
  });

  it('ROL-09: user không thuộc ws ⇒ 404 user; role không hợp lệ ⇒ 400', async () => {
    const err = await caught(change().execute(ctx.alice, { userId: 'user-nina', role: 'PM' }));
    expect((err as ResourceNotFoundError).details).toEqual({ resource: 'user' });
    expect(
      await caught(change().execute(ctx.alice, { userId: 'user-mia', role: 'ADMIN' })),
    ).toBeInstanceOf(ValidationError);
  });
});

describe('RemoveMemberUseCase (gồm tự rời)', () => {
  const remove = () => new RemoveMemberUseCase(h);

  it('REM-01: PM xóa MEMBER ⇒ bỏ gán trong tx; revokeWorkspaceAccess SAU commit với mọi project', async () => {
    await h.project(ctx.A, 'WEB');
    await h.project(ctx.A, 'OLD', true);
    h.cleaner.assigned.set('user-mia', 2);
    const result = await remove().execute(ctx.pam, { userId: 'user-mia', originClientId: 'tab-9' });
    expect(result).toEqual({ userId: 'user-mia', unassignedTaskCount: 2 });
    expect(h.roleOf(ctx.A, 'Mia')).toBeNull();
    expect(h.cleaner.calls).toEqual([
      {
        input: { workspaceId: ctx.A, userId: 'user-mia', actorId: 'user-pam' },
        inTransaction: true,
      },
    ]);
    expect(h.notifier.calls).toEqual([
      {
        method: 'revokeWorkspaceAccess',
        args: [
          { userId: 'user-mia', workspaceId: ctx.A, projectIds: ['p-web', 'p-old'] },
          { actorId: 'user-pam', originClientId: 'tab-9' },
        ],
        duringTransaction: false,
      },
    ]);
  });

  it('REM-02: PM xóa OWNER / PM khác ⇒ 403, không đổi', async () => {
    const h2 = createWorkspaceHarness();
    const c2 = await givenWorkspaceA(h2, { Pete: 'PM' });
    for (const userId of ['user-alice', 'user-pete']) {
      expect(await caught(new RemoveMemberUseCase(h2).execute(c2.pam, { userId }))).toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect(h2.memberships.rows().filter((m) => m.workspaceId === c2.A)).toHaveLength(5);
  });

  it('REM-03: MEMBER xóa người khác ⇒ 403 (trước mọi truy vấn)', async () => {
    expect(await caught(remove().execute(ctx.mia, { userId: 'user-vic' }))).toBeInstanceOf(
      ForbiddenError,
    );
    expect(h.uow.steps).toEqual([]);
  });

  it('REM-04: VIEWER tự rời ⇒ thành công; actorId = chính họ', async () => {
    await expect(remove().execute(ctx.vic, { userId: 'user-vic' })).resolves.toEqual({
      userId: 'user-vic',
      unassignedTaskCount: 0,
    });
    expect(h.notifier.calls[0]?.args[1]).toEqual({ actorId: 'user-vic', originClientId: null });
  });

  it('REM-05: OWNER duy nhất tự rời ⇒ 422 LAST_OWNER, membership còn nguyên', async () => {
    lastOwner(await caught(remove().execute(ctx.alice, { userId: 'user-alice' })));
    expect(h.roleOf(ctx.A, 'Alice')).toBe('OWNER');
    expect(h.cleaner.calls).toEqual([]);
  });

  it('REM-06: có 2 OWNER ⇒ OWNER xóa OWNER kia được', async () => {
    const h2 = createWorkspaceHarness();
    const c2 = await givenWorkspaceA(h2, { Olga: 'OWNER' });
    await new RemoveMemberUseCase(h2).execute(c2.alice, { userId: 'user-olga' });
    expect(h2.roleOf(c2.A, 'Olga')).toBeNull();
  });

  it('REM-10: userId không thuộc ws ⇒ 404 user', async () => {
    const err = await caught(remove().execute(ctx.alice, { userId: 'user-bob' }));
    expect((err as ResourceNotFoundError).details).toEqual({ resource: 'user' });
  });
});
