// F3 mutation (report §4.1, workspace — chủ module B): các GAP P2 W-2..W-9. Mỗi ca chặn đúng một đột
// biến còn sống trên main 4ba066b; tên ca mang mã W-x để đối chiếu với report.
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  ResourceConflictError,
  ResourceNotFoundError,
  VersionConflictError,
} from '../../../../core/errors';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
  type WorkspaceHarness,
} from '../../testing/harness';
import { ChangeMemberRoleUseCase } from './change-member-role.use-case';
import { CreateProjectUseCase } from './create-project.use-case';
import { CreateWorkspaceUseCase } from './create-workspace.use-case';
import { RestoreWorkspaceUseCase } from './restore-workspace.use-case';
import { SetProjectArchivedUseCase } from './set-project-archived.use-case';
import { UpdateProjectUseCase } from './update-project.use-case';
import { ListMyWorkspacesQuery } from './workspace.queries';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h);
});

const TAB = '3b241101-e2bb-4255-8caf-4136c566a962';
const caught = (p: Promise<unknown>) =>
  p.then(
    () => expect.unreachable(),
    (e: unknown) => e,
  );

describe('F3 workspace — GAP P2', () => {
  it('W-2: tạo project CÓ description ⇒ view và bản lưu giữ đúng mô tả', async () => {
    const view = await new CreateProjectUseCase(h).execute(ctx.pam, {
      name: 'Web',
      keyPrefix: 'WEB',
      description: 'Mô tả dự án',
    });
    expect(view.description).toBe('Mô tả dự án');
    const stored = (await h.projects.rows()).find((p) => p.id === view.id);
    expect(stored?.description).toBe('Mô tả dự án');
  });

  it('W-3: archive ⇒ event project:updated với meta { actorId, originClientId } của tab gửi', async () => {
    const projectId = await h.project(ctx.A, 'API');
    await new SetProjectArchivedUseCase(h).execute(ctx.pam, {
      projectId,
      archived: true,
      originClientId: TAB,
    });
    const emits = h.notifier.calls.filter((c) => c.method === 'emitToProject');
    expect(emits).toHaveLength(1);
    expect(emits[0]?.args[0]).toMatchObject({ projectId, type: 'project:updated' });
    expect(emits[0]?.args[1]).toEqual({ actorId: ctx.pam.userId, originClientId: TAB });
  });

  it('W-4: đổi role ⇒ notifyRoleChanged nhận originClientId của tab gửi', async () => {
    await new ChangeMemberRoleUseCase(h).execute(ctx.alice, {
      userId: uid('mia'),
      role: 'PM',
      originClientId: TAB,
    });
    const call = h.notifier.calls.find((c) => c.method === 'notifyRoleChanged');
    expect(call?.args[1]).toEqual({ actorId: ctx.alice.userId, originClientId: TAB });
  });

  describe('W-5: create-workspace chỉ thử lại khi TRÙNG SLUG, lỗi khác ném nguyên vẹn sau 1 lần', () => {
    it.each([
      ['lỗi DB', () => new Error('db down')],
      [
        'conflict khác slug (already_member)',
        () => new ResourceConflictError({ reason: 'already_member' }),
      ],
    ])('%s ⇒ reject đúng lỗi đó, gọi createWithOwner đúng 1 lần', async (_label, make) => {
      const failure = make();
      let calls = 0;
      h.creator.createWithOwner = () => {
        calls += 1;
        return Promise.reject(failure);
      };
      const alice = await h.user('Alice');
      expect(
        await caught(new CreateWorkspaceUseCase(h).execute({ userId: alice, name: 'Marketing' })),
      ).toBe(failure);
      expect(calls).toBe(1);
    });
  });

  it('W-6: khôi phục workspaceId KHÔNG tồn tại ⇒ 404 workspace (không TypeError 500)', async () => {
    const err = await caught(
      new RestoreWorkspaceUseCase(h).execute({
        userId: ctx.alice.userId,
        workspaceId: randomUUID(),
      }),
    );
    expect(err).toBeInstanceOf(ResourceNotFoundError);
    expect((err as ResourceNotFoundError).details).toEqual({ resource: 'workspace' });
  });

  it('W-7: project biến mất giữa đọc và ghi ⇒ UpdateProject 404 project (không TypeError 500)', async () => {
    const projectId = await h.project(ctx.A, 'API');
    const find = h.projects.findInWorkspace.bind(h.projects);
    let reads = 0;
    // Lần đọc 1 (use case) thấy project; ghi thua (save ⇒ false); lần đọc lại để báo lỗi ⇒ đã mất.
    h.projects.findInWorkspace = async (ws: string, id: string) => {
      reads += 1;
      return reads === 1 ? find(ws, id) : null;
    };
    h.projects.save = () => Promise.resolve(false);
    const err = await caught(
      new UpdateProjectUseCase(h).execute(ctx.alice, { projectId, name: 'Mới' }),
    );
    expect(err).toBeInstanceOf(ResourceNotFoundError);
    expect((err as ResourceNotFoundError).details).toEqual({ resource: 'project' });
  });

  it('W-8: 409 VERSION_CONFLICT mang currentVersion của bản đang lưu (FE dùng để hòa giải)', async () => {
    const projectId = await h.project(ctx.A, 'API');
    const find = h.projects.findInWorkspace.bind(h.projects);
    let done = false;
    let storedAfterOtherWrite: number | undefined;
    h.projects.findInWorkspace = async (ws: string, id: string) => {
      const stale = await find(ws, id);
      if (!done && stale) {
        done = true;
        const fresh = (await find(ws, id))!;
        fresh.update({ name: 'Người khác đổi' }, h.clock.now());
        expect(await h.projects.save(fresh)).toBe(true);
        // Snapshot đã lưu NGAY sau lần ghi kia (không qua getter `version` — thứ đang bị kiểm). Đọc lúc
        // này vì FakeUnitOfWork rollback cả lần ghi chen khi use case thất bại (Postgres thì không).
        storedAfterOtherWrite = (await h.projects.rows()).find((p) => p.id === id)?.version;
      }
      return stale;
    };
    const err = await caught(
      new UpdateProjectUseCase(h).execute(ctx.alice, { projectId, name: 'Của tôi' }),
    );
    expect(err).toBeInstanceOf(VersionConflictError);
    expect(storedAfterOtherWrite).toEqual(expect.any(Number));
    expect((err as VersionConflictError).details).toMatchObject({
      currentVersion: storedAfterOtherWrite,
    });
  });

  it('W-9: "workspace của tôi" ⇒ view đầy đủ cho ws đang hoạt động (không chỉ danh sách rỗng)', async () => {
    const views = await new ListMyWorkspacesQuery(h).execute({
      userId: ctx.mia.userId,
      deleted: false,
    });
    const ws = (await h.workspaces.rows()).find((w) => w.id === ctx.A)!;
    expect(views).toEqual([
      {
        id: ctx.A,
        name: ws.name,
        slug: ws.slug,
        myRole: 'MEMBER',
        myGrants: [],
        createdAt: ws.createdAt,
        updatedAt: ws.updatedAt,
      },
    ]);
  });
});
