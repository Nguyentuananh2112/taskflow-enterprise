// `project:updated` (data-and-api §615): phát SAU commit, đúng một lần mỗi lần ghi thật; không phát
// khi không đổi gì (archive lần 2) hay khi lỗi (rollback).
import { ProjectDto } from '@taskflow/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProjectArchivedError } from '../../../../core/errors';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  type WorkspaceHarness,
} from '../../testing/harness';
import { SetProjectArchivedUseCase } from './set-project-archived.use-case';
import { UpdateProjectUseCase } from './update-project.use-case';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
let projectId: string;
beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h);
  projectId = await h.project(ctx.A, 'WEB');
});

const emits = () => h.notifier.calls.filter((c) => c.method === 'emitToProject');

describe('project:updated', () => {
  it('đổi tên ⇒ một event sau commit tới project, payload đúng ProjectDto, kèm originClientId', async () => {
    const tab = '3b241101-e2bb-4255-8caf-4136c566a962';
    await new UpdateProjectUseCase(h).execute(ctx.pam, {
      projectId,
      name: 'Website',
      originClientId: tab,
    });
    expect(emits()).toEqual([
      {
        method: 'emitToProject',
        args: [
          {
            projectId,
            type: 'project:updated',
            data: {
              project: expect.objectContaining({ id: projectId, name: 'Website' }) as unknown,
            },
          },
          { actorId: ctx.pam.userId, originClientId: tab },
        ],
        duringTransaction: false,
      },
    ]);
    const [input] = emits()[0]!.args as [{ data: { project: unknown } }];
    expect(ProjectDto.safeParse(input.data.project).success).toBe(true);
  });

  it('archive ⇒ isArchived true; archive lần 2 (không đổi) ⇒ không phát thêm', async () => {
    const archive = new SetProjectArchivedUseCase(h);
    await archive.execute(ctx.pam, { projectId, archived: true });
    await archive.execute(ctx.pam, { projectId, archived: true });
    expect(emits()).toHaveLength(1);
    const [input] = emits()[0]!.args as [{ data: { project: { isArchived: boolean } } }];
    expect(input.data.project.isArchived).toBe(true);
  });

  it('sửa project đã archive ⇒ 422, không phát', async () => {
    await new SetProjectArchivedUseCase(h).execute(ctx.pam, { projectId, archived: true });
    h.notifier.calls.length = 0;
    await expect(
      new UpdateProjectUseCase(h).execute(ctx.pam, { projectId, name: 'X' }),
    ).rejects.toBeInstanceOf(ProjectArchivedError);
    expect(emits()).toEqual([]);
  });
});
