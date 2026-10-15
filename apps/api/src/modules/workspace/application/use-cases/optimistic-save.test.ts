// ADR-110 (T-032, X2/X8 của F): ghi Workspace/Project có điều kiện `version`. Mô phỏng một ghi
// đồng thời CHEN GIỮA lúc use case đọc và lúc ghi (cùng backend — chạy lại trên Postgres qua LSP).
// Lần ghi chen vào nằm TRONG transaction của use case ⇒ bị rollback cùng lỗi: test use case chỉ kiểm
// lỗi trả về; trạng thái lưu trữ kiểm ở mức repository (dưới) và bằng race thật (workspace-version-races.int.ts).
import { beforeEach, describe, expect, it } from 'vitest';

import { ResourceNotFoundError, VersionConflictError } from '../../../../core/errors';
import type { Project } from '../../domain/project';
import type { Workspace } from '../../domain/workspace';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
  type WorkspaceHarness,
} from '../../testing/harness';
import { DeleteWorkspaceUseCase } from './delete-workspace.use-case';
import { SetProjectArchivedUseCase } from './set-project-archived.use-case';
import { UpdateProjectUseCase } from './update-project.use-case';
import { UpdateWorkspaceUseCase } from './update-workspace.use-case';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h);
});

/** Lần đọc ĐẦU TIÊN trả bản cũ, rồi `concurrent` ghi xen vào trước khi use case kịp ghi. */
function interleaveWorkspace(concurrent: (fresh: Workspace) => Promise<unknown>) {
  const original = h.workspaces.findById.bind(h.workspaces);
  let done = false;
  h.workspaces.findById = async (id: string) => {
    const stale = await original(id);
    if (!done && stale) {
      done = true;
      const fresh = (await original(id))!;
      await concurrent(fresh);
    }
    return stale;
  };
}

function interleaveProject(concurrent: (fresh: Project) => Promise<unknown>) {
  const original = h.projects.findInWorkspace.bind(h.projects);
  let done = false;
  h.projects.findInWorkspace = async (ws: string, id: string) => {
    const stale = await original(ws, id);
    if (!done && stale) {
      done = true;
      await concurrent((await original(ws, id))!);
    }
    return stale;
  };
}

const workspaceRow = async () => (await h.workspaces.findById(ctx.A))!;

describe('Workspace (X2): PATCH ‖ DELETE không hồi sinh workspace đã xóa', () => {
  it('DELETE chen giữa đọc và ghi của PATCH ⇒ PATCH 404, workspace VẪN đã xóa', async () => {
    interleaveWorkspace(async (fresh) => {
      fresh.softDelete(uid('alice'), h.clock.now());
      expect(await h.workspaces.save(fresh)).toBe(true);
    });
    await expect(
      new UpdateWorkspaceUseCase(h).execute(ctx.alice, { name: 'Renamed' }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('PATCH chen giữa đọc và ghi của DELETE ⇒ DELETE 409 VERSION_CONFLICT, không ghi đè tên mới', async () => {
    interleaveWorkspace(async (fresh) => {
      fresh.rename('Renamed', h.clock.now());
      expect(await h.workspaces.save(fresh)).toBe(true);
    });
    const err: unknown = await new DeleteWorkspaceUseCase(h)
      .execute(ctx.alice, { confirmSlug: 'acme' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VersionConflictError);
  });

  it('mỗi lần ghi thành công tăng version đúng 1', async () => {
    const before = (await workspaceRow()).version;
    await new UpdateWorkspaceUseCase(h).execute(ctx.alice, { name: 'Once' });
    expect((await workspaceRow()).version).toBe(before + 1);
  });
});

describe('Project (X8): rename ‖ archive không gỡ archive', () => {
  it('archive chen giữa đọc và ghi của rename ⇒ rename 409, project VẪN archived', async () => {
    const projectId = await h.project(ctx.A, 'WEB');
    interleaveProject(async (fresh) => {
      fresh.archive(h.clock.now());
      expect(await h.projects.save(fresh)).toBe(true);
    });
    const err: unknown = await new UpdateProjectUseCase(h)
      .execute(ctx.alice, { projectId, name: 'Renamed' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VersionConflictError);
  });

  it('rename chen giữa đọc và ghi của archive ⇒ archive 409, tên mới giữ nguyên', async () => {
    const projectId = await h.project(ctx.A, 'API');
    interleaveProject(async (fresh) => {
      fresh.update({ name: 'Renamed' }, h.clock.now());
      expect(await h.projects.save(fresh)).toBe(true);
    });
    await expect(
      new SetProjectArchivedUseCase(h).execute(ctx.alice, { projectId, archived: true }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });
});

describe('repository (ADR-110): bản cũ không bao giờ ghi đè bản mới', () => {
  it('workspace: xóa bằng bản mới ⇒ ghi bản cũ trả false, vẫn đã xóa, version tăng đúng 1', async () => {
    const stale = await workspaceRow();
    const fresh = await workspaceRow();
    fresh.softDelete(uid('alice'), h.clock.now());
    expect(await h.workspaces.save(fresh)).toBe(true);
    stale.rename('Resurrected', h.clock.now());
    expect(await h.workspaces.save(stale)).toBe(false);
    const ws = await workspaceRow();
    expect(ws.isDeleted).toBe(true);
    expect(ws.name).not.toBe('Resurrected');
    expect(ws.version).toBe(stale.version + 1);
  });

  it('project: archive bằng bản mới ⇒ rename bằng bản cũ trả false, vẫn archived', async () => {
    const projectId = await h.project(ctx.A, 'OPS');
    const read = async () => (await h.projects.findInWorkspace(ctx.A, projectId))!;
    const stale = await read();
    const fresh = await read();
    fresh.archive(h.clock.now());
    expect(await h.projects.save(fresh)).toBe(true);
    stale.update({ name: 'Renamed' }, h.clock.now());
    expect(await h.projects.save(stale)).toBe(false);
    expect((await read()).isArchived).toBe(true);
  });
});
