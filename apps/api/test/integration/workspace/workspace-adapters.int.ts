// Adapter Prisma của Workspace chỉ kiểm được trên Postgres thật (T-020): cấp số đồng thời, FOR SHARE,
// advisory lock của purge, ILIKE ESCAPE, phạm vi tenant + ws xóa mềm.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { FakeRandom } from '../../support';
import { WorkspaceAccess } from '../../../src/modules/workspace/application/adapters/workspace-access';
import { RemoveMemberUseCase } from '../../../src/modules/workspace/application/use-cases/remove-member.use-case';
import { PrismaWorkspaceQueries } from '../../../src/modules/workspace/infrastructure/persistence/prisma/prisma-queries';
import {
  PrismaAssigneeDirectory,
  PrismaTaskProjectStore,
} from '../../../src/modules/workspace/infrastructure/persistence/prisma/prisma-task-ports';
import { PrismaWorkspacePurger } from '../../../src/modules/workspace/infrastructure/persistence/prisma/prisma-workspace.purger';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
} from '../../../src/modules/workspace/testing/harness';
import { prismaWorkspaceBackend } from '../support/prisma-backends';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';
import { seedTask } from './task-fixtures';

let h: ReturnType<typeof createWorkspaceHarness>;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
let db: () => ReturnType<ReturnType<typeof prismaWorkspaceBackend>['uow']['db']>;

beforeEach(async () => {
  await resetDatabase();
  const backend = prismaWorkspaceBackend();
  db = () => backend.uow.db();
  h = createWorkspaceHarness(new FakeRandom(), backend);
  ctx = await givenWorkspaceA(h);
});
afterAll(disconnectTestPrisma);

async function softDelete(workspaceId: string) {
  const ws = await h.workspaces.findById(workspaceId);
  ws?.softDelete(ctx.alice.userId, h.clock.now());
  if (ws) await h.workspaces.save(ws);
}

describe('ITaskProjectStore (cho module Task — FR-03, data-and-api 1.2)', () => {
  it('allocateTaskNumber: 20 lần đồng thời ⇒ số 1..20, không trùng, không mất (UPDATE … RETURNING)', async () => {
    const projectId = await h.project(ctx.A, 'WEB');
    const store = new PrismaTaskProjectStore(db);
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () =>
        h.uow.run(() => store.allocateTaskNumber({ workspaceId: ctx.A, projectId })),
      ),
    );
    expect([...numbers].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    expect(
      (await testPrisma().project.findUniqueOrThrow({ where: { id: projectId } })).nextTaskNumber,
    ).toBe(21);
  }, 180_000);

  it('allocateTaskNumber ⇒ null (không ném): project archived / ∉ ws / ws đã xóa mềm', async () => {
    const store = new PrismaTaskProjectStore(db);
    const old = await h.project(ctx.A, 'OLD', true);
    const brv = await h.project(ctx.B, 'BRV');
    const web = await h.project(ctx.A, 'WEB');
    expect(await store.allocateTaskNumber({ workspaceId: ctx.A, projectId: old })).toBeNull();
    expect(await store.allocateTaskNumber({ workspaceId: ctx.A, projectId: brv })).toBeNull();
    await softDelete(ctx.A);
    expect(await store.allocateTaskNumber({ workspaceId: ctx.A, projectId: web })).toBeNull();
    expect(
      (await testPrisma().project.findUniqueOrThrow({ where: { id: web } })).nextTaskNumber,
    ).toBe(1);
  });

  it('findInWorkspace: archived vẫn trả (isArchived), ∉ ws / ws đã xóa ⇒ null', async () => {
    const store = new PrismaTaskProjectStore(db);
    const old = await h.project(ctx.A, 'OLD', true);
    expect(await store.findInWorkspace({ workspaceId: ctx.A, projectId: old })).toEqual({
      id: old,
      workspaceId: ctx.A,
      keyPrefix: 'OLD',
      isArchived: true,
    });
    expect(await store.findInWorkspace({ workspaceId: ctx.B, projectId: old })).toBeNull();
    await softDelete(ctx.A);
    expect(await store.findInWorkspace({ workspaceId: ctx.A, projectId: old })).toBeNull();
  });
});

describe('IAssigneeDirectory.roleOf (FOR SHARE OF m)', () => {
  it('trả role của member; người ngoài / user đã ẩn danh hóa ⇒ null', async () => {
    const dir = new PrismaAssigneeDirectory(db);
    expect(await h.uow.run(() => dir.roleOf({ workspaceId: ctx.A, userId: uid('vic') }))).toBe(
      'VIEWER',
    );
    expect(
      await h.uow.run(() => dir.roleOf({ workspaceId: ctx.A, userId: uid('bob') })),
    ).toBeNull();
    await testPrisma().user.update({ where: { id: uid('mia') }, data: { deletedAt: new Date() } });
    expect(
      await h.uow.run(() => dir.roleOf({ workspaceId: ctx.A, userId: uid('mia') })),
    ).toBeNull();
  });
});

describe('PrismaWorkspacePurger (ADR-095)', () => {
  it('xóa cứng ws + member + project + task + audit; ws khác không đụng tới', async () => {
    const web = await h.project(ctx.A, 'WEB');
    const brv = await h.project(ctx.B, 'BRV');
    const taskA = await seedTask({ workspaceId: ctx.A, projectId: web, number: 1 });
    await seedTask({ workspaceId: ctx.B, projectId: brv, number: 1 });
    await testPrisma().taskAuditLog.create({
      data: {
        workspaceId: ctx.A,
        projectId: web,
        taskId: taskA,
        actorId: uid('alice'),
        action: 'CREATED',
      },
    });
    await softDelete(ctx.A);
    const later = new Date(h.clock.now().getTime() + 31 * 86_400_000);
    expect(await h.uow.run(() => new PrismaWorkspacePurger(db).purge(ctx.A, later))).toBe(true);
    const p = testPrisma();
    expect(await p.workspace.findMany({ select: { id: true } })).toEqual([{ id: ctx.B }]);
    expect(await p.task.count({ where: { workspaceId: ctx.A } })).toBe(0);
    expect(await p.taskAuditLog.count()).toBe(0);
    expect(await p.workspaceMember.count({ where: { workspaceId: ctx.A } })).toBe(0);
    expect(await p.task.count({ where: { workspaceId: ctx.B } })).toBe(1);
  });

  it('instance khác đang giữ advisory lock của ws ⇒ bỏ qua (false), không xóa gì', async () => {
    await softDelete(ctx.A);
    const later = new Date(h.clock.now().getTime() + 31 * 86_400_000);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = testPrisma().$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('taskflow:purge:' || ${ctx.A}, 0))`;
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await isLocked;
    expect(await h.uow.run(() => new PrismaWorkspacePurger(db).purge(ctx.A, later))).toBe(false);
    release();
    await holder;
    expect(await testPrisma().workspace.count({ where: { id: ctx.A } })).toBe(1);
  });

  it('purge_at chưa tới (vừa được khôi phục rồi xóa lại) ⇒ false', async () => {
    await softDelete(ctx.A);
    expect(await h.uow.run(() => new PrismaWorkspacePurger(db).purge(ctx.A, h.clock.now()))).toBe(
      false,
    );
  });
});

describe('Phía đọc & truy cập', () => {
  it('MLS-03: % _ \\ khớp theo nghĩa đen (ILIKE … ESCAPE), không trả toàn bộ', async () => {
    await testPrisma().user.update({
      where: { id: uid('pam') },
      data: { fullName: 'Pam 100%_off' },
    });
    const q = new PrismaWorkspaceQueries(db);
    const names = async (term: string) =>
      (await q.listMembers(ctx.A, term, { limit: 50 })).items.map((m) => m.fullName);
    expect(await names('%')).toEqual(['Pam 100%_off']);
    expect(await names('_')).toEqual(['Pam 100%_off']);
    expect(await names('0%_')).toEqual(['Pam 100%_off']);
    expect(await names('\\')).toEqual([]);
    expect(await names('MI')).toEqual(['Mia']);
  });

  it('REM-08: sau khi bị xóa, lần đọc kế tiếp ⇒ 404 workspace (membership đọc DB mỗi request)', async () => {
    const access = new WorkspaceAccess(h);
    await expect(access.resolveActor(ctx.A, uid('mia'))).resolves.toMatchObject({ role: 'MEMBER' });
    await new RemoveMemberUseCase(h).execute(ctx.pam, { userId: uid('mia') });
    await expect(access.resolveActor(ctx.A, uid('mia'))).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('WSD-06 (mức repo): ws xóa mềm ⇒ resolveActor 404 cả với OWNER; listActiveForUser không có ws', async () => {
    await softDelete(ctx.A);
    await expect(new WorkspaceAccess(h).resolveActor(ctx.A, uid('alice'))).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect((await h.queries.listActiveForUser(uid('alice'))).map((r) => r.workspace.id)).toEqual(
      [],
    );
  });
});
