import { beforeEach, describe, expect, it } from 'vitest';

import { ForbiddenError, ResourceNotFoundError, ValidationError } from '../../../../core/errors';
import { WORKSPACE_PURGE_GRACE_MS } from '../../domain/workspace';
import {
  createWorkspaceHarness,
  GHOST_ID,
  givenWorkspaceA,
  pid,
  uid,
  type WorkspaceHarness,
} from '../../testing/harness';
import { DeleteWorkspaceUseCase } from './delete-workspace.use-case';
import { PurgeDeletedWorkspacesJob } from './purge-deleted-workspaces.job';
import { RestoreWorkspaceUseCase } from './restore-workspace.use-case';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
const caught = (p: Promise<unknown>) =>
  p.then(
    () => expect.unreachable(),
    (e: unknown) => e,
  );
const DAY = 86_400_000;

beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h);
});

async function deleteA() {
  await h.project(ctx.A, 'WEB');
  await h.project(ctx.A, 'OLD', true);
  return new DeleteWorkspaceUseCase(h).execute(ctx.alice, {
    confirmSlug: 'acme',
    originClientId: 'tab-1',
  });
}

describe('DeleteWorkspaceUseCase (ADR-047)', () => {
  it('WSD-01: xóa mềm, purgeAt = +30 ngày, giữ nguyên member/project; closeWorkspace SAU commit', async () => {
    const before = { members: (await h.memberships.rows()).length, projects: 0 };
    const view = await deleteA();
    expect(view).toEqual({
      id: ctx.A,
      name: 'ACME',
      slug: 'acme',
      deletedAt: h.clock.now(),
      purgeAt: new Date(h.clock.now().getTime() + WORKSPACE_PURGE_GRACE_MS),
    });
    expect((await h.workspaces.rows()).find((w) => w.id === ctx.A)?.deletedById).toBe(
      ctx.alice.userId,
    );
    expect(await h.memberships.rows()).toHaveLength(before.members);
    expect(await h.projects.rows()).toHaveLength(2);
    expect(h.notifier.calls).toEqual([
      {
        method: 'closeWorkspace',
        args: [
          {
            workspaceId: ctx.A,
            projectIds: [pid('WEB'), pid('OLD')],
            memberUserIds: [uid('alice'), uid('pam'), uid('mia'), uid('vic')],
          },
          { actorId: ctx.alice.userId, originClientId: 'tab-1' },
        ],
        duringTransaction: false,
      },
    ]);
  });

  it('WSD-02: confirmSlug sai ⇒ 400, không xóa, không notify', async () => {
    const err = await caught(
      new DeleteWorkspaceUseCase(h).execute(ctx.alice, { confirmSlug: 'ACME' }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((await h.workspaces.rows()).find((w) => w.id === ctx.A)?.deletedAt).toBeNull();
    expect(h.notifier.calls).toEqual([]);
  });

  it('WSD-03: PM ⇒ 403', async () => {
    expect(
      await caught(new DeleteWorkspaceUseCase(h).execute(ctx.pam, { confirmSlug: 'acme' })),
    ).toBeInstanceOf(ForbiddenError);
  });

  it('WSD-05 (mức U): xóa lại ws đã xóa ⇒ 404', async () => {
    await deleteA();
    expect(
      await caught(new DeleteWorkspaceUseCase(h).execute(ctx.alice, { confirmSlug: 'acme' })),
    ).toBeInstanceOf(ResourceNotFoundError);
  });
});

describe('RestoreWorkspaceUseCase (ADR-050, security.md 3.6)', () => {
  const restore = (userId: string) =>
    new RestoreWorkspaceUseCase(h).execute({ userId, workspaceId: ctx.A });

  it('WSR-01: OWNER khôi phục trong hạn; log bảo mật; WSR-08: không notify', async () => {
    await deleteA();
    h.notifier.calls.length = 0;
    h.clock.advance(10 * DAY);
    const view = await restore(ctx.alice.userId);
    expect(view).toMatchObject({ id: ctx.A, slug: 'acme', myRole: 'OWNER' });
    expect((await h.workspaces.rows()).find((w) => w.id === ctx.A)).toMatchObject({
      deletedAt: null,
      purgeAt: null,
      deletedById: null,
    });
    expect(h.logger.entries).toContainEqual(
      expect.objectContaining({
        msg: 'workspace.restored',
        data: expect.objectContaining({ userId: ctx.alice.userId, workspaceId: ctx.A }) as unknown,
      }),
    );
    expect(h.notifier.calls).toEqual([]);
  });

  it('WSR-02 (mức U): PM/MEMBER/VIEWER/người ngoài ⇒ cùng một lỗi 404 workspace (không 403)', async () => {
    await deleteA();
    const errors = await Promise.all(
      [uid('pam'), uid('mia'), uid('vic'), uid('bob'), GHOST_ID].map((u) => caught(restore(u))),
    );
    for (const err of errors) {
      expect(err).toBeInstanceOf(ResourceNotFoundError);
      expect((err as ResourceNotFoundError).details).toEqual({ resource: 'workspace' });
    }
    expect((await h.workspaces.rows()).find((w) => w.id === ctx.A)?.deletedAt).not.toBeNull();
  });

  it('WSR-03 (mức U): ws chưa xóa ⇒ 404', async () => {
    expect(await caught(restore(ctx.alice.userId))).toBeInstanceOf(ResourceNotFoundError);
  });

  it('WSR-04: quá purgeAt (job chưa chạy) ⇒ 404, ws vẫn ở trạng thái xóa', async () => {
    await deleteA();
    h.clock.advance(30 * DAY);
    expect(await caught(restore(ctx.alice.userId))).toBeInstanceOf(ResourceNotFoundError);
    expect((await h.workspaces.rows()).find((w) => w.id === ctx.A)?.deletedAt).not.toBeNull();
  });

  it('WSR-05 (mức U): purge vừa xóa cứng giữa lúc đọc và UPDATE ⇒ 404 (UPDATE có điều kiện)', async () => {
    await deleteA();
    h.workspaces.restoreIfWithinGrace = () => Promise.resolve(false);
    expect(await caught(restore(ctx.alice.userId))).toBeInstanceOf(ResourceNotFoundError);
    expect(h.logger.messages()).not.toContain('workspace.restored'); // restore thất bại ⇒ không log khôi phục
  });
});

describe('PurgeDeletedWorkspacesJob (ADR-095)', () => {
  it('xóa cứng ws quá hạn (cùng member/project), bỏ qua ws còn hạn, idempotent', async () => {
    await deleteA();
    const job = new PurgeDeletedWorkspacesJob(h);
    expect(await job.execute()).toEqual({ purged: 0, skipped: 0 });
    h.clock.advance(30 * DAY);
    expect(await job.execute()).toEqual({ purged: 1, skipped: 0 });
    expect((await h.workspaces.rows()).map((w) => w.id)).toEqual([ctx.B]);
    expect((await h.memberships.rows()).every((m) => m.workspaceId === ctx.B)).toBe(true);
    expect(await h.projects.rows()).toEqual([]);
    expect(await job.execute()).toEqual({ purged: 0, skipped: 0 });
    expect(h.logger.messages('info')).toContain('workspace.purged');
  });

  it('purger từ chối (vừa được khôi phục) ⇒ đếm skipped, không lỗi', async () => {
    await deleteA();
    h.clock.advance(30 * DAY);
    h.purger.purge = () => Promise.resolve(false);
    expect(await new PurgeDeletedWorkspacesJob(h).execute()).toEqual({ purged: 0, skipped: 1 });
  });

  it('xử lý theo lô (batchSize)', async () => {
    await deleteA();
    const ws = await h.workspaces.findById(ctx.B);
    ws?.softDelete(uid('bob'), h.clock.now());
    if (ws) await h.workspaces.save(ws);
    h.clock.advance(31 * DAY);
    expect(await new PurgeDeletedWorkspacesJob(h).execute({ batchSize: 1 })).toEqual({
      purged: 1,
      skipped: 0,
    });
    expect(await h.workspaces.rows()).toHaveLength(1);
  });
});
